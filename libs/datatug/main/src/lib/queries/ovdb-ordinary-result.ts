import { JsonNumberToken, strictJsonNumbers } from './public-data/strict-json';
import type { OvdbStreamRecord } from './ovdb-json-record-stream';

/** The released OVDB /dtql endpoint returns a complete JSON envelope without
 * the newer stream footer. Buffer only its bounded response and validate the
 * entire envelope before exposing any rows to the caller. */
export interface OvdbOrdinaryResult {
  readonly records: readonly OvdbStreamRecord[];
  readonly columns: readonly string[];
  readonly evidence: Readonly<Record<string, unknown>>;
}

const maximumBytes = 8 * 1024 * 1024;
const maximumRows = 100_000;

function plain(value: unknown): unknown {
  if (value instanceof JsonNumberToken) {
    const number = Number(value.token);
    if (
      !Number.isFinite(number) ||
      (Number.isInteger(number) && !Number.isSafeInteger(number))
    )
      throw new Error(
        'OVDB returned an unquoted numeric value that JavaScript cannot preserve exactly.',
      );
    return number;
  }
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, plain(entry)]),
    );
  return value;
}

export async function readOvdbOrdinaryResult(
  response: Response,
  signal?: AbortSignal,
): Promise<OvdbOrdinaryResult> {
  if (response.redirected || !response.ok || !response.body)
    throw new Error('OVDB ordinary query result is unavailable.');
  if (
    !/^application\/json(?:\s*;|\s*$)/i.test(
      response.headers.get('Content-Type') ?? '',
    )
  )
    throw new Error(
      'OVDB ordinary query result has an unexpected content type.',
    );
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const part = await new Promise<ReadableStreamReadResult<Uint8Array>>(
        (resolve, reject) => {
          const abort = (): void => {
            reject(signal?.reason);
            void reader.cancel(signal?.reason).catch(() => undefined);
          };
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
          reader
            .read()
            .then(resolve, reject)
            .finally(() => signal?.removeEventListener('abort', abort));
        },
      );
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximumBytes)
        throw new Error(
          'OVDB ordinary query result exceeds the browser limit.',
        );
      chunks.push(part.value);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  signal?.throwIfAborted();
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const decoded: unknown = plain(
    strictJsonNumbers(new TextDecoder('utf-8', { fatal: true }).decode(body)),
  );
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))
    throw new Error('OVDB returned an invalid ordinary query result.');
  const document = decoded as Record<string, unknown>;
  if (
    (document['complete'] !== undefined && document['complete'] !== true) ||
    !Array.isArray(document['records']) ||
    document['records'].length > maximumRows ||
    !Array.isArray(document['columns']) ||
    document['columns'].some(
      (name) => typeof name !== 'string' || !name.length,
    ) ||
    new Set(document['columns']).size !== document['columns'].length ||
    !document['execution'] ||
    typeof document['execution'] !== 'object' ||
    Array.isArray(document['execution'])
  )
    throw new Error('OVDB returned an invalid ordinary query result.');
  const columns = document['columns'] as string[];
  const records: OvdbStreamRecord[] = [];
  for (const entry of document['records']) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error('OVDB returned an invalid ordinary query record.');
    const record = entry as Record<string, unknown>;
    if (record['key'] !== undefined && typeof record['key'] !== 'string')
      throw new Error('OVDB returned an invalid ordinary query record key.');
    if (
      !record['data'] ||
      typeof record['data'] !== 'object' ||
      Array.isArray(record['data']) ||
      Object.keys(record['data']).some((name) => !columns.includes(name))
    )
      throw new Error('OVDB returned an invalid ordinary query record data.');
    records.push({
      ...(record['key'] === undefined ? {} : { key: record['key'] as string }),
      data: record['data'] as Record<string, unknown>,
    });
  }
  return { records, columns, evidence: document };
}
