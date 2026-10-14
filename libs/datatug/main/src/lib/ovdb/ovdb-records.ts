// Record browsing and mutations over an OVDB connection, through the DALgo OVDB
// client (`@dalgo/ovdb/client`): rows come from `POST /query`, an edit is one
// `runReadwriteTransaction` with `update` (`POST /batch`, op "update"), a delete is
// one with `delete` (`POST /batch`, op "delete"). Keys are `<Table>/<pk>`.
import { Key, NotFoundError, AlreadyExistsError, UnsupportedError } from '@dalgo/core';
import { OpenVaultDbDatabase, OpenVaultDbHttpError } from '@dalgo/ovdb/client';
import { ovdbDatabaseUrl, type OvdbConnection } from './ovdb-connection';

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

export async function listOvdbRows(
  connection: OvdbConnection,
  collection: string,
  limit = OVDB_PAGE_SIZE,
): Promise<readonly OvdbRow[]> {
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
  if (!response.ok) {
    let code = 'unknown';
    let message = 'reset failed';
    try {
      const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
      if (typeof body.error?.code === 'string') code = body.error.code;
      if (typeof body.error?.message === 'string') message = body.error.message;
    } catch {
      /* keep the status only */
    }
    throw new OpenVaultDbHttpError(response.status, code, message);
  }
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
