/** The OVDB query stream keeps its existing JSON result shape. Records arrive
 * first; metadata and `complete:true` are written only after the server has
 * finished reading and closing the source. A partial body is never a result. */
import { strictJson } from './public-data/strict-json';
export interface OvdbStreamRecord {
  readonly key?: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface OvdbStreamFooter {
  readonly columns: readonly string[];
  readonly complete: true;
  readonly execution?: unknown;
  readonly sourceRights?: unknown;
  readonly usedSourceIds?: unknown;
  readonly providerReads?: unknown;
}

export interface OvdbStreamLimits {
  readonly bytes: number;
  readonly rows: number;
  readonly recordBytes: number;
  readonly footerBytes: number;
}

const defaultLimits: OvdbStreamLimits = {
  bytes: 128 * 1024 * 1024,
  rows: 100_000,
  recordBytes: 4 * 1024 * 1024,
  footerBytes: 1024 * 1024,
};

/** Reject integer-valued JSON tokens that JavaScript would round before the
 * caller can apply column metadata. Exact decimals use quoted wire values;
 * ordinary floating-point JSON values retain the existing numeric path. */
function refuseLossyNumericTokens(json: string): void {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < json.length; index++) {
    const char = json[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char !== '-' && (char < '0' || char > '9')) continue;
    const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(json.slice(index))?.[0];
    if (!token) continue;
    const next = json[index + token.length];
    if (next !== undefined && !/[\s,}\]]/.test(next)) continue;
    const value = Number(token);
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      throw new Error('OVDB returned an unquoted numeric value that JavaScript cannot preserve exactly.');
    index += token.length - 1;
  }
}

function recordFromJson(json: string): OvdbStreamRecord {
  refuseLossyNumericTokens(json);
  const value: unknown = strictJson(json);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('OVDB returned an invalid streamed record.');
  const record = value as Record<string, unknown>;
  if (record['key'] !== undefined && typeof record['key'] !== 'string')
    throw new Error('OVDB returned an invalid streamed record key.');
  if (record['data'] === undefined && typeof record['key'] === 'string')
    return { key: record['key'], data: {} };
  if (!record['data'] || typeof record['data'] !== 'object' || Array.isArray(record['data']))
    throw new Error('OVDB returned an invalid streamed record data object.');
  return record as unknown as OvdbStreamRecord;
}

function footerFromJson(json: string, observed: ReadonlySet<string>, relational: boolean): OvdbStreamFooter {
  const value: unknown = strictJson(`{"records":[]${json}`);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('OVDB returned an invalid query stream footer.');
  const footer = value as Record<string, unknown>;
  if (footer['complete'] !== true)
    throw new Error('OVDB did not complete the query stream.');
  const columns = footer['columns'] ?? (!relational && footer['execution'] === undefined ? [...observed] : undefined);
  if (!Array.isArray(columns) || columns.some((name) => typeof name !== 'string' || !name.length) ||
      new Set(columns).size !== columns.length ||
      [...observed].some((name) => !columns.includes(name)))
    throw new Error('OVDB returned inconsistent query columns.');
  if ((relational || footer['execution'] !== undefined) &&
    (!footer['execution'] || typeof footer['execution'] !== 'object' || Array.isArray(footer['execution'])))
    throw new Error('OVDB returned invalid relational execution metadata.');
  return { ...footer, columns: columns as string[], complete: true };
}

/** Consumes the existing JSON envelope without buffering all result rows.
 * `onRecord` may stage a provisional row; callers must publish success only
 * after this function returns the terminal footer. */
export async function readOvdbJsonRecordStream(
  response: Response,
  onRecord: (record: OvdbStreamRecord) => Promise<void> | void,
  signal?: AbortSignal,
  limits: OvdbStreamLimits = defaultLimits,
): Promise<{ readonly footer: OvdbStreamFooter; readonly rows: number; readonly bytes: number }> {
  if (response.redirected || !response.ok || !response.body)
    throw new Error('OVDB query stream is unavailable.');
  if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('Content-Type') ?? ''))
    throw new Error('OVDB query stream has an unexpected content type.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const prefix = '{"records":[';
  let prefixIndex = 0;
  let phase: 'prefix' | 'first' | 'record' | 'between' | 'footer' = 'prefix';
  let recordParts: string[] = [];
  let recordPart = '';
  let recordLength = 0;
  const footerParts: string[] = [];
  let footerPart = '';
  let footerLength = 0;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let rows = 0;
  let bytes = 0;
  let relational = false;
  const observed = new Set<string>();
  const footerReached = (): boolean => phase === 'footer';

  const consume = async (text: string): Promise<void> => {
    for (const char of text) {
      signal?.throwIfAborted();
      if (phase === 'prefix') {
        if (char !== prefix[prefixIndex++])
          throw new Error('OVDB returned an invalid query stream prefix.');
        if (prefixIndex === prefix.length) phase = 'first';
        continue;
      }
      if (phase === 'footer') {
        footerPart += char;
        footerLength++;
        if (footerPart.length === 4096) { footerParts.push(footerPart); footerPart = ''; }
        if (footerLength > limits.footerBytes)
          throw new Error('OVDB query stream metadata exceeds the browser limit.');
        continue;
      }
      if (phase === 'first' || phase === 'between') {
        if (/\s/.test(char)) continue;
        if (char === ']') { phase = 'footer'; continue; }
        if (phase === 'between' && char === ',') { phase = 'record'; continue; }
        if (phase === 'between') throw new Error('OVDB returned an invalid query record separator.');
        if (char !== '{') throw new Error('OVDB returned an invalid query record separator.');
        phase = 'record';
      }
      if (phase !== 'record') continue;
      if (!recordLength) {
        if (/\s/.test(char)) continue;
        if (char !== '{') throw new Error('OVDB returned an invalid query record.');
      }
      recordPart += char;
      recordLength++;
      if (recordPart.length === 4096) { recordParts.push(recordPart); recordPart = ''; }
      if (recordLength > limits.recordBytes)
        throw new Error('OVDB query record exceeds the browser limit.');
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') depth--;
      if (depth < 0) throw new Error('OVDB returned an invalid query record.');
      if (depth === 0) {
        const parsed = recordFromJson(recordParts.join('') + recordPart);
        if (parsed.key === undefined) relational = true;
        rows++;
        if (rows > limits.rows)
          throw new Error('OVDB query stream exceeds the browser row limit.');
        for (const name of Object.keys(parsed.data)) observed.add(name);
        await onRecord(parsed);
        recordParts = [];
        recordPart = '';
        recordLength = 0;
        phase = 'between';
      }
    }
  };

  try {
    for (;;) {
      signal?.throwIfAborted();
      const part = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        const abort = (): void => {
          reject(signal?.reason ?? new Error('The OVDB query was cancelled.'));
          void reader.cancel(signal?.reason).catch(() => undefined);
        };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        reader.read().then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
      });
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limits.bytes)
        throw new Error('OVDB query stream exceeds the browser byte limit.');
      await consume(decoder.decode(part.value, { stream: true }));
    }
    await consume(decoder.decode());
    if (!footerReached() || recordLength)
      throw new Error('OVDB query stream ended before the terminal footer.');
    return { footer: footerFromJson(footerParts.join('') + footerPart, observed, relational), rows, bytes };
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}
