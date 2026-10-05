import type { ImmutableFile } from './canonical-metadata';
import { immutableUrl, sha256 } from './canonical-metadata';
import type { SourceModelField } from '../../project-files/source-model-declaration';
import { strictJson } from './strict-json';
import type { BoundedRecord } from './bounded-federation';

/** Configured source transport only; never a public target or admission mechanism. */
export interface BoundedJsonDriver {
  readonly kind: 'https-json';
  readonly database: string;
  readonly name: string;
  readonly data: ImmutableFile;
  readonly key: string;
  readonly fields: readonly SourceModelField[];
}
export function validateJsonDriver(driver: BoundedJsonDriver): void {
  immutableUrl(driver.data);
  const key = driver.fields.find((field) => field.name === driver.key);
  if (
    driver.kind !== 'https-json' ||
    !key ||
    key.nullable ||
    key.datatype !== 'string' ||
    !driver.fields.length ||
    driver.fields.length > 128 ||
    new Set(driver.fields.map((field) => field.name)).size !==
      driver.fields.length ||
    driver.fields.some(
      (field) =>
        !/^[A-Za-z][A-Za-z0-9_]*$/.test(field.name) ||
        field.datatype !== 'string' ||
        typeof field.nullable !== 'boolean',
    )
  )
    throw new Error('Invalid explicit bounded source mapping/key.');
}
export async function readJsonDriver(
  driver: BoundedJsonDriver,
  userRows: number,
  offset: number,
  remaining: number,
  http: typeof fetch,
  signal: AbortSignal,
  readResponse: (
    response: Response,
    remaining: number,
    signal: AbortSignal,
  ) => Promise<{ text: string; bytes: number; raw: Uint8Array }>,
): Promise<{ records: readonly BoundedRecord[]; bytes: number }> {
  validateJsonDriver(driver);
  signal.throwIfAborted();
  const response = await http(immutableUrl(driver.data), {
    method: 'GET',
    redirect: 'error',
    credentials: 'omit',
    signal,
  });
  const read = await readResponse(response, remaining, signal);
  if (!response.ok)
    throw new Error(
      `The declared source is unavailable (${response.status}; ${read.bytes} response bytes).`,
    );
  if ((await sha256(read.raw)) !== driver.data.sha256)
    throw new Error('Declared source checksum mismatch.');
  signal.throwIfAborted();
  const raw = strictJson(read.text);
  if (!Array.isArray(raw) || raw.length > 1000)
    throw new Error(
      'The declared source must be a bounded plain array of at most 1000 rows.',
    );
  const keys = new Set<string>();
  const records = raw.map((value): BoundedRecord => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Declared source contains an invalid raw row.');
    const data = value as Record<string, unknown>;
    const key = data[driver.key];
    if (typeof key !== 'string' || !key || keys.has(key))
      throw new Error(
        'Declared source grain requires unique nonempty string keys.',
      );
    keys.add(key);
    for (const field of driver.fields) {
      const value = data[field.name];
      if (
        typeof value !== 'string' &&
        !(field.nullable && (value === null || value === undefined))
      )
        throw new Error('Declared source raw datatype/optionality mismatch.');
    }
    return { key, data };
  });
  return {
    records: records.slice(offset, offset + userRows),
    bytes: read.bytes,
  };
}
