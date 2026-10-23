import { strictJson } from './strict-json';

export interface PublicTugqlSource {
  readonly endpoint: string;
  readonly databaseId: string;
  readonly collectionId: string;
  readonly requireExecutionSource: boolean;
  readonly maxRows: number;
  readonly expectedFields?: readonly string[];
}

export interface PublicTugqlResult {
  readonly records: readonly { readonly data: Record<string, unknown> }[];
  readonly fields: readonly string[];
  readonly complete: true;
  readonly rowsReturned: number;
  readonly executionSources: readonly { readonly database: string; readonly collection: string }[];
  readonly observedAt: string;
  readonly raw: unknown;
}

export class PublicTugqlError extends Error {}

function reject(message: string): never { throw new PublicTugqlError(message); }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return reject('The public TugQL response has an invalid shape.');
  return value as Record<string, unknown>;
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || !response.body) return reject('The public TugQL endpoint refused this query.');
  const MAX_BYTES = 1_000_000;
  const header = response.headers.get('Content-Length');
  if (header && Number(header) > MAX_BYTES) return reject('The public TugQL response exceeds the browser limit.');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  let reachedEnd = false;
  try {
    while (true) {
      if (signal.aborted) return reject('The public TugQL request was cancelled.');
      const { done, value } = await reader.read();
      if (done) { reachedEnd = true; break; }
      length += value.byteLength;
      if (length > MAX_BYTES) return reject('The public TugQL response exceeds the browser limit.');
      parts.push(value);
    }
  } finally {
    // EOF releases ownership; cancellation is only for unread or failed bodies.
    if (reachedEnd) reader.releaseLock();
    else void reader.cancel().catch(() => undefined).finally(() => reader.releaseLock());
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return reject('The public TugQL endpoint returned malformed JSON.'); }
}

/** Shared public read path; caller binds policy to a saved connection and query. */
export async function executePublicTugql(
  query: string,
  source: PublicTugqlSource,
  options: { readonly fetch?: typeof globalThis.fetch; readonly signal?: AbortSignal } = {},
): Promise<PublicTugqlResult> {
  const parsedEndpoint = new URL(source.endpoint);
  if (parsedEndpoint.protocol !== 'https:' || parsedEndpoint.username || parsedEndpoint.password ||
    parsedEndpoint.hash || parsedEndpoint.search || !parsedEndpoint.pathname.endsWith(`/v1/databases/${source.databaseId}/tugql`))
    return reject('The saved public connection has an invalid HTTPS TugQL endpoint.');
  if (!query.trim() || query.length > 32_768 || !Number.isSafeInteger(source.maxRows) || source.maxRows < 1 || source.maxRows > 1000)
    return reject('The saved public query exceeds the browser execution policy.');
  const deadline = AbortSignal.timeout(30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  let raw: unknown;
  try {
    const response = await (options.fetch ?? globalThis.fetch)(source.endpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }), credentials: 'omit', cache: 'no-store', redirect: 'error', signal,
    });
    raw = await boundedJson(response, signal);
  } catch (error) {
    if (signal.aborted) return reject(deadline.aborted ? 'The public TugQL request timed out.' : 'The public TugQL request was cancelled.');
    throw error;
  }
  if (signal.aborted) return reject(deadline.aborted ? 'The public TugQL request timed out.' : 'The public TugQL request was cancelled.');
  const body = object(raw);
  if (body['complete'] !== true || body['nextCursor'] != null || !Array.isArray(body['records']) ||
    body['records'].length > source.maxRows)
    return reject('The public TugQL response is incomplete or exceeds the saved row limit.');
  const records = body['records'].map((item) => {
    const data = object(object(item)['data']);
    return { data };
  });
  const fields = source.expectedFields ??
    (Array.isArray(body['columns']) ? body['columns'] : Object.keys(records[0]?.data ?? {}));
  if (!fields.length || fields.length > 40 || fields.some((field) => typeof field !== 'string' || !field) ||
    body['columns'] !== undefined && JSON.stringify(body['columns']) !== JSON.stringify(fields) ||
    records.some(({ data }) => Object.keys(data).length !== fields.length || fields.some((field) => !Object.hasOwn(data, field))))
    return reject('The public TugQL response has different result columns.');
  const expected = [{ database: source.databaseId, collection: source.collectionId }];
  let executionSources: PublicTugqlResult['executionSources'] = [];
  if (body['execution'] !== undefined) {
    const execution = object(body['execution']);
    if (execution['rowsReturned'] !== records.length || JSON.stringify(execution['sources']) !== JSON.stringify(expected))
      return reject('The public TugQL response came from a different physical source.');
    executionSources = expected;
  } else if (source.requireExecutionSource) {
    return reject('The public TugQL response omitted its required physical source receipt.');
  }
  return { records, fields, complete: true, rowsReturned: records.length, executionSources, observedAt: new Date().toISOString(), raw };
}
