// Record browsing and mutations over an OVDB connection, through the DALgo OVDB
// client (`@dalgo/ovdb/client`): rows come from `POST /query`, an edit is one
// `runReadwriteTransaction` with `update` (`POST /batch`, op "update"), a delete is
// one with `delete` (`POST /batch`, op "delete"). Keys are `<Table>/<pk>`.
import { Key, NotFoundError, AlreadyExistsError, UnsupportedError } from '@dalgo/core';
import { OpenVaultDbDatabase, OpenVaultDbHttpError } from '@dalgo/ovdb/client';
import { ovdbCollectionSchema, ovdbCollectionTarget, ovdbDatabaseUrl, ovdbHttpError, type OvdbConnection, type OvdbDescriptor } from './ovdb-connection';

export interface OvdbRow {
  /** The record key path as the server returned it (`Album/1`). */
  readonly key: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export const OVDB_PAGE_SIZE = 100;

export function ovdbDatabase(connection: OvdbConnection): OpenVaultDbDatabase {
  return new OpenVaultDbDatabase({
    baseUrl: connection.baseUrl,
    databaseId: connection.databaseId,
    fetch: connection.fetch,
  });
}

/**
 * Whether rows are read with `POST /tugql` instead of `POST /query`: a native PostgreSQL mount (the hosted DemoDB
 * editions on cloud.openvaultdb.com) reports `query: false` yet answers TugQL reads.
 */
export function ovdbReadsWithTugql(descriptor: OvdbDescriptor | undefined): boolean {
  const capabilities = descriptor?.capabilities;
  return capabilities?.query !== true && capabilities?.tugql === true;
}

/** A TugQL-YAML document reading one table. JSON strings are valid YAML scalars, so no name can alter the document. */
export function ovdbTugqlDocument(target: { readonly id: string; readonly source?: { readonly schema?: string; readonly name: string } }, limit: number): string {
  const from = target.source
    ? [...(target.source.schema ? [`  schema: ${JSON.stringify(target.source.schema)}`] : []), `  name: ${JSON.stringify(target.source.name)}`]
    : [`  name: ${JSON.stringify(target.id)}`];
  return ['from:', ...from, `limit: ${limit}`, ''].join('\n');
}

async function listOvdbRowsWithTugql(connection: OvdbConnection, collection: string, limit: number): Promise<readonly OvdbRow[]> {
  const response = await connection.fetch(`${ovdbDatabaseUrl(connection.baseUrl, connection.databaseId)}/tugql`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: ovdbTugqlDocument(ovdbCollectionTarget(connection.descriptor, collection), limit) }),
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok) throw await ovdbHttpError(response, 'read failed');
  const body = (await response.json()) as { records?: unknown };
  if (!Array.isArray(body.records)) throw new TypeError('The server answered without records.');
  return body.records.map((record: { key?: unknown; data?: unknown }, index) => ({
    // A TugQL record of a native mount carries no key; the position keeps rows apart.
    key: typeof record.key === 'string' ? record.key : `#${index}`,
    data: (record.data ?? {}) as Record<string, unknown>,
  }));
}

export async function listOvdbRows(
  connection: OvdbConnection,
  collection: string,
  limit = OVDB_PAGE_SIZE,
): Promise<readonly OvdbRow[]> {
  if (ovdbReadsWithTugql(connection.descriptor)) return listOvdbRowsWithTugql(connection, collection, limit);
  const page = await ovdbDatabase(connection).query<Record<string, unknown>>({
    source: { kind: 'collection', name: collection },
    filters: [],
    orders: [],
    limit,
  });
  return page.records.map((record) => ({
    key: record.key.path,
    data: (record.data ?? {}) as Record<string, unknown>,
  }));
}

/** Reads one keyed record, including records outside the first query page. */
export async function getOvdbRecord(connection: OvdbConnection, collection: string, id: string | number): Promise<OvdbRow | undefined> {
  const record = await ovdbDatabase(connection).get<Record<string, unknown>>(new Key(collection, id));
  return record.exists ? { key: record.key.path, data: record.data ?? {} } : undefined;
}

/** Creation requires a typed, addressable key and fields this form can supply. */
export function ovdbCreateKeyField(descriptor: OvdbDescriptor, collection: string): string | undefined {
  if (descriptor.capabilities.write !== true) return undefined;
  const schema = ovdbCollectionSchema(descriptor, collection);
  const keys = schema?.primaryKey ?? [];
  if (keys.length !== 1) return undefined;
  const key = schema?.fields?.[keys[0]];
  if (!key || !['integer', 'string'].includes(key.type ?? '')) return undefined;
  // Required binary values cannot be supplied by the record form.
  if (Object.values(schema?.fields ?? {}).some((field) =>
    ['blob', 'bytes'].includes(field.type ?? '') && (field.notNull || field.required))) return undefined;
  return keys[0];
}

/** Inserts through the generic DALgo OVDB adapter; never overwrites an existing key. */
export async function createOvdbRecord(
  connection: OvdbConnection,
  collection: string,
  data: Readonly<Record<string, unknown>>,
): Promise<OvdbRow> {
  const keyField = ovdbCreateKeyField(connection.descriptor, collection);
  if (!keyField) throw new UnsupportedError('This table does not support creating records.');
  const id = data[keyField];
  if ((typeof id !== 'string' && typeof id !== 'number') ||
      (typeof id === 'string' && (!id.trim() || id.includes('/'))) ||
      (typeof id === 'number' && !Number.isSafeInteger(id))) {
    throw new TypeError('Enter a non-empty record key without slashes, or a safe whole number.');
  }
  const key = new Key(collection, id);
  await ovdbDatabase(connection).runReadwriteTransaction(async (tx) => {
    await tx.insert(key, { ...data });
  });
  return { key: key.path, data: { ...data } };
}

/** Updates fields of one record (`update` op): only the changed fields are sent. */
export async function updateOvdbRecord(
  connection: OvdbConnection,
  collection: string,
  id: string | number,
  changes: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  await ovdbDatabase(connection).runReadwriteTransaction(async (tx) => {
    await tx.update(new Key(collection, id), { ...changes });
  });
}

export async function deleteOvdbRecord(
  connection: OvdbConnection,
  collection: string,
  id: string | number,
): Promise<void> {
  await ovdbDatabase(connection).runReadwriteTransaction(async (tx) => {
    await tx.delete(new Key(collection, id));
  });
}

/** `POST /v1/databases/{db}/reset` (in-process OVDB only). */
export async function resetOvdbDatabase(connection: OvdbConnection): Promise<void> {
  const response = await connection.fetch(`${ovdbDatabaseUrl(connection.baseUrl, connection.databaseId)}/reset`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok) throw await ovdbHttpError(response, 'reset failed');
}

function httpCause(error: unknown): OpenVaultDbHttpError | undefined {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth++) {
    if (current instanceof OpenVaultDbHttpError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** What went wrong, in words a user can act on. */
export function describeOvdbError(error: unknown, action: 'save' | 'delete' | 'reset' | 'load'): string {
  const http = httpCause(error);
  const verb = { save: 'save the record', delete: 'delete the record', reset: 'reset the database', load: 'load the data' }[action];
  if (http) {
    const detail = http.message.replace(/^OpenVaultDB request failed \(\d+ [\w-]+\): /, '');
    switch (http.code) {
      case 'constraint_violation':
        if (action === 'delete' && /foreign key/i.test(detail)) {
          return 'This record cannot be deleted because other records refer to it (a foreign key constraint). Delete or change those records first.';
        }
        if (/foreign key/i.test(detail)) {
          return 'The new value does not match an existing related record (a foreign key constraint).';
        }
        if (/not null/i.test(detail)) return 'A required field is empty (a NOT NULL constraint).';
        if (/unique/i.test(detail)) return 'Another record already has this value (a UNIQUE constraint).';
        return `The database refused the change: ${detail}`;
      case 'already_exists':
        return 'A record with this key already exists.';
      case 'read_only':
        return 'This database is read-only: changes are not allowed.';
      case 'database_unavailable':
        return 'The hosted demo database is waking up or temporarily unavailable. Try again in a few seconds.';
      case 'operation_unsupported':
      case 'query_unsupported':
        return 'The hosted database does not support this operation: it is read-only and opened for browsing only.';
      case 'read_denied':
        return 'This database does not allow reading records by key.';
      case 'not_supported':
        return `This operation is not supported for this table: ${detail}`;
      case 'not_found':
        return action === 'reset'
          ? 'This database cannot be reset.'
          : 'The record no longer exists. Refresh the table to see the current data.';
      case 'bad_request':
      case 'invalid_key':
        return `The request was invalid: ${detail}`;
    }
    if (http.status === 503) return 'The hosted demo database is waking up or temporarily unavailable. Try again in a few seconds.';
    if (http.status === 501) return 'The hosted database does not support this operation.';
    if (http.status === 404) return 'The record no longer exists. Refresh the table to see the current data.';
    if (http.status === 409) return 'The change conflicts with the data in the database.';
    if (http.status === 403) return 'This database does not allow this change.';
    if (http.status === 422) return 'This operation is not supported for this table.';
    return `Could not ${verb} (HTTP ${http.status}).`;
  }
  if (error instanceof NotFoundError) return 'The record no longer exists. Refresh the table to see the current data.';
  if (error instanceof AlreadyExistsError) return 'A record with this key already exists.';
  if (error instanceof UnsupportedError) return 'This operation is not supported for this table.';
  const message = error instanceof Error ? error.message : String(error);
  return `Could not ${verb}: ${message}`;
}
