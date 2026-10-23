import { describe, expect, it } from 'vitest';
import { OpenVaultDbHttpError } from '@dalgo/ovdb/client';
import { demoSqliteCatalog } from '../queries/demo-sqlite-catalog';
import { localOvdbFetchFor, MemorySqliteDatabase } from '../demo-sqlite/local-demodb.spec-helper';
import {
  fetchOvdbDescriptor,
  NO_SINGLE_COLUMN_KEY,
  ovdbCollections,
  ovdbRecordActions,
  ovdbUiCapabilities,
  parseOvdbDescriptor,
  type OvdbConnection,
  type OvdbDescriptor,
} from './ovdb-connection';
import { ovdbReadsWithTugql, getOvdbRecord, createOvdbRecord, ovdbCreateKeyField, deleteOvdbRecord, describeOvdbError, listOvdbRows, resetOvdbDatabase, updateOvdbRecord } from './ovdb-records';

const entry = demoSqliteCatalog.chinook;

/** A Neon PostgreSQL database served read-only by cloud.openvaultdb.com. */
export const neonLikeDescriptor: OvdbDescriptor = {
  id: 'chinook-postgresql',
  engine: 'postgres',
  capabilities: { read: false, query: true, tugql: true, write: false, delete: false, reset: false, persistent: true, joins: true },
  collections: ['album', 'artist'],
  schemas: { collections: { artist: { fields: { artist_id: { type: 'integer' }, name: { type: 'string' } } } } },
};

async function localConnection(database = new MemorySqliteDatabase()) {
  const local = localOvdbFetchFor(entry, database);
  const descriptor = await fetchOvdbDescriptor(local.fetch, local.baseUrl, entry.dataset);
  const connection: OvdbConnection = {
    id: 'chinook-sqlite-local',
    title: 'Chinook',
    baseUrl: local.baseUrl,
    databaseId: entry.dataset,
    fetch: local.fetch,
    descriptor,
  };
  return { ...local, connection, descriptor };
}

describe('local OVDB descriptor', () => {
  it('describes tables, keys and capabilities in OVDB descriptor fields', async () => {
    const { descriptor } = await localConnection();
    expect(descriptor).toMatchObject({
      id: 'chinook',
      engine: 'sqlite',
      collections: ['Album', 'Artist', 'PlaylistTrack', 'Track'],
      capabilities: { read: true, query: true, tugql: true, write: true, delete: true, reset: true, persistent: true },
      canonical: { url: entry.url, sha256: entry.sha256, bytes: entry.bytes },
      localState: { modified: false },
    });
    expect(descriptor.schemas?.collections?.['Track']?.fields?.['UnitPrice']).toEqual({
      type: 'decimal',
      declaredType: 'NUMERIC(10,2)',
      notNull: true,
      primaryKeyPosition: 0,
    });
    expect(descriptor.schemas?.collections?.['Album']?.foreignKeys).toEqual([
      { columns: ['ArtistId'], referencedTable: 'Artist', referencedColumns: ['ArtistId'] },
    ]);
  });

  it.each([
    ['old-only (removed in TugQL cutover step 9)', { dtql: true, dtqlStreaming: true }],
    ['new-only', { tugql: true, tugqlStreaming: true }],
    ['both', { tugql: true, tugqlStreaming: true, dtql: true, dtqlStreaming: true }],
  ])('reads %s TugQL capabilities as tugql', (_name, capabilities) => {
    const descriptor = parseOvdbDescriptor({ id: 'x', capabilities: { read: true, ...capabilities } });
    expect(descriptor.capabilities).toMatchObject({ tugql: true, tugqlStreaming: true, read: true });
    expect(ovdbReadsWithTugql(descriptor)).toBe(true);
    expect(ovdbUiCapabilities(descriptor).browse).toBe(true);
  });

  it('rejects malformed descriptors', () => {
    expect(() => parseOvdbDescriptor({ id: 'x' })).toThrow();
    expect(() => parseOvdbDescriptor({ id: 'x', capabilities: {}, collections: [1] })).toThrow();
  });
});

describe('capability gating', () => {
  it('offers edit, delete and reset only when the descriptor says so', async () => {
    const { descriptor } = await localConnection();
    expect(ovdbUiCapabilities(descriptor)).toEqual({ browse: true, edit: true, delete: true, reset: true, persistent: true });
    expect(ovdbRecordActions(descriptor, 'Artist')).toEqual({ edit: true, delete: true, keyField: 'ArtistId' });
  });

  it('hides every mutation for a hosted read-only database, yet lets it be browsed', () => {
    expect(ovdbUiCapabilities(neonLikeDescriptor)).toEqual({ browse: true, edit: false, delete: false, reset: false, persistent: true });
    expect(ovdbRecordActions(neonLikeDescriptor, 'artist')).toEqual({ edit: false, delete: false });
    expect(ovdbCollections(neonLikeDescriptor)).toEqual(['album', 'artist']);
  });

  it('never gates browsing on read, and never on the engine name', () => {
    const queryOnly: OvdbDescriptor = { id: 'x', engine: 'sqlite', capabilities: { read: false, tugql: true } };
    expect(ovdbUiCapabilities(queryOnly).browse).toBe(true);
    expect(ovdbUiCapabilities({ id: 'x', engine: 'sqlite', capabilities: { read: true } }).browse).toBe(false);
    expect(ovdbUiCapabilities({ id: 'x', engine: 'sqlite', capabilities: { query: true } }).edit).toBe(false);
  });

  it('hides edit and delete for composite-key and keyless tables, with a reason', async () => {
    const { descriptor } = await localConnection();
    expect(ovdbRecordActions(descriptor, 'PlaylistTrack')).toEqual({ edit: false, delete: false, reason: NO_SINGLE_COLUMN_KEY });
    expect(ovdbRecordActions(descriptor, 'Unknown')).toEqual({ edit: false, delete: false, reason: NO_SINGLE_COLUMN_KEY });
  });
});

describe('OVDB record operations', () => {
  it('creates without overwriting, marks modified, and resets to the pristine data', async () => {
    const { connection, database, modified } = await localConnection();
    const row = await createOvdbRecord(connection, 'Artist', { ArtistId: 4, Name: null });
    expect(row).toEqual({ key: 'Artist/4', data: { ArtistId: 4, Name: null } });
    expect((await listOvdbRows(connection, 'Artist')).at(-1)).toEqual(row);
    expect(await getOvdbRecord(connection, 'Artist', 4)).toEqual(row);
    expect(modified.value).toBe(true);
    await expect(createOvdbRecord(connection, 'Artist', { ArtistId: 4, Name: 'duplicate' })).rejects.toBeDefined();
    expect(database.tables['Artist'].at(-1)?.['Name']).toBeNull();
    await resetOvdbDatabase(connection);
    expect(database.tables['Artist']).toHaveLength(3);
    expect(modified.value).toBe(false);
  });

  it('gates creation on a writable descriptor and supported typed single key', async () => {
    const { descriptor, connection, requests } = await localConnection();
    expect(ovdbCreateKeyField(descriptor, 'Artist')).toBe('ArtistId');
    expect(ovdbCreateKeyField(descriptor, 'PlaylistTrack')).toBeUndefined();
    expect(ovdbCreateKeyField(neonLikeDescriptor, 'artist')).toBeUndefined();
    const before = requests.length;
    await expect(createOvdbRecord(connection, 'Artist', { ArtistId: '' })).rejects.toThrow('record key');
    expect(requests).toHaveLength(before);
  });

  it('lists rows through POST /query', async () => {
    const { connection, requests } = await localConnection();
    const rows = await listOvdbRows(connection, 'Artist', 2);
    expect(rows).toEqual([
      { key: 'Artist/1', data: { ArtistId: 1, Name: 'AC/DC' } },
      { key: 'Artist/2', data: { ArtistId: 2, Name: 'Accept' } },
    ]);
    expect(requests.at(-1)).toMatchObject({ method: 'POST', url: 'https://local.ovdb.invalid/v1/databases/chinook/query', body: { collection: 'Artist', limit: 2 } });
  });

  it('sends an edit as one batch update of the changed fields and marks the copy modified', async () => {
    const { connection, requests, database, modified } = await localConnection();
    await updateOvdbRecord(connection, 'Artist', 1, { Name: 'AC-DC' });
    expect(requests.at(-1)).toEqual({
      method: 'POST',
      url: 'https://local.ovdb.invalid/v1/databases/chinook/batch',
      body: { ops: [{ op: 'update', key: 'Artist/1', updates: [{ fieldName: 'Name', value: 'AC-DC' }] }] },
    });
    expect(database.tables['Artist'][0]).toEqual({ ArtistId: 1, Name: 'AC-DC' });
    expect(modified.value).toBe(true);
    expect((await fetchOvdbDescriptor(connection.fetch, connection.baseUrl, 'chinook')).localState).toEqual({ modified: true });
  });

  it('sends nothing for an edit without changes', async () => {
    const { connection, requests } = await localConnection();
    const before = requests.length;
    await updateOvdbRecord(connection, 'Artist', 1, {});
    expect(requests.length).toBe(before);
  });

  it('deletes through a batch delete', async () => {
    const { connection, requests, database } = await localConnection();
    await deleteOvdbRecord(connection, 'Artist', 3);
    expect(requests.at(-1)?.body).toEqual({ ops: [{ op: 'delete', key: 'Artist/3' }] });
    expect(database.tables['Artist'].map((row) => row['ArtistId'])).toEqual([1, 2]);
  });

  it('explains a foreign key refusal when deleting an Artist that has Albums', async () => {
    const { connection, database } = await localConnection();
    const error = await deleteOvdbRecord(connection, 'Artist', 1).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(OpenVaultDbHttpError);
    expect(error).toMatchObject({ status: 409, code: 'constraint_violation' });
    expect(describeOvdbError(error, 'delete')).toBe(
      'This record cannot be deleted because other records refer to it (a foreign key constraint). Delete or change those records first.',
    );
    expect(database.tables['Artist']).toHaveLength(3);
  });

  it('resets through POST /reset and clears localState.modified', async () => {
    const { connection, database, modified } = await localConnection();
    await updateOvdbRecord(connection, 'Artist', 2, { Name: 'Changed' });
    await resetOvdbDatabase(connection);
    expect(database.resets).toBe(1);
    expect(database.tables['Artist'][1]['Name']).toBe('Accept');
    expect(modified.value).toBe(false);
    const descriptor = await fetchOvdbDescriptor(connection.fetch, connection.baseUrl, 'chinook');
    expect(descriptor.localState).toEqual({ modified: false });
    expect(descriptor.canonical?.sha256).toBe(entry.sha256);
  });

  it('is refused by a read-only database with a readable message', async () => {
    const readOnly = new MemorySqliteDatabase(undefined, undefined, {
      read: true, query: true, write: false, delete: false, reset: false, persistent: true,
    });
    const { connection, descriptor } = await localConnection(readOnly);
    expect(ovdbUiCapabilities(descriptor)).toMatchObject({ edit: false, delete: false, reset: false });
    const error = await deleteOvdbRecord(connection, 'Artist', 3).then(() => undefined, (e: unknown) => e);
    expect(describeOvdbError(error, 'delete')).toBe('This database is read-only: changes are not allowed.');
  });
});

describe('describeOvdbError', () => {
  it.each([
    [new OpenVaultDbHttpError(404, 'not_found', 'gone'), 'save', 'The record no longer exists. Refresh the table to see the current data.'],
    [new OpenVaultDbHttpError(409, 'constraint_violation', 'NOT NULL constraint failed: Album.Title'), 'save', 'A required field is empty (a NOT NULL constraint).'],
    [new OpenVaultDbHttpError(409, 'constraint_violation', 'FOREIGN KEY constraint failed'), 'save', 'The new value does not match an existing related record (a foreign key constraint).'],
    [new OpenVaultDbHttpError(409, 'constraint_violation', 'UNIQUE constraint failed: Genre.Name'), 'save', 'Another record already has this value (a UNIQUE constraint).'],
    [new OpenVaultDbHttpError(409, 'already_exists', 'x'), 'save', 'A record with this key already exists.'],
    [new OpenVaultDbHttpError(403, 'read_only', 'server is read-only'), 'reset', 'This database is read-only: changes are not allowed.'],
    [new OpenVaultDbHttpError(422, 'not_supported', 'composite primary key'), 'delete', 'This operation is not supported for this table: composite primary key'],
    [new OpenVaultDbHttpError(500, 'internal', 'x'), 'save', 'Could not save the record (HTTP 500).'],
    [new Error('boom'), 'load', 'Could not load the data: boom'],
  ] as const)('maps %s', (error, action, message) => {
    expect(describeOvdbError(error, action)).toBe(message);
  });

  it('follows a translated error to its HTTP cause', () => {
    const cause = new OpenVaultDbHttpError(409, 'constraint_violation', 'FOREIGN KEY constraint failed');
    expect(describeOvdbError(new Error('wrapped', { cause }), 'delete')).toContain('other records refer to it');
  });
});
