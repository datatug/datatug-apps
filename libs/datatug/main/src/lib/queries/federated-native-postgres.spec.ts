import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_OVDB_FROM_HOSTED_PAGE,
  nativePostgresCollectionId,
  runFederatedQuery,
} from './federated-query-executor';
import { QueryType, type IQueryDef } from '../models/definition/query-def';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('native PostgreSQL OVDB mounts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('encodes schema-qualified collection IDs as the server reports them', () => {
    // Observed on cloud.openvaultdb.com for chinook-postgresql (chinook.Genre / chinook.Artist).
    expect(nativePostgresCollectionId('chinook', 'Genre')).toBe(
      'pg1_AAAAB2NoaW5vb2sAAAAFR2VucmU',
    );
    expect(nativePostgresCollectionId('chinook', 'Artist')).toBe(
      'pg1_AAAAB2NoaW5vb2sAAAAGQXJ0aXN0',
    );
  });

  it('accepts a native stream whose execution sources are encoded PostgreSQL collection IDs', async () => {
    const yaml = `from:
  database: chinook-postgresql
  schema: chinook
  name: Artist
  alias: artist
  joins:
    - from: {database: chinook-postgresql, schema: chinook, name: Album, alias: album}
      on: [{left: {field: ArtistId, source: artist}, op: '==', right: {field: ArtistId, source: album}}]
groupBy: [{field: ArtistId, source: artist}]
columns:
  - {field: ArtistId, source: artist}
  - {aggregate: {function: count, args: [{field: AlbumId, source: album}]}, as: Albums}
limit: 10`;
    const definition = {
      id: 'artist-albums',
      title: 'Artist albums',
      request: { queryType: QueryType.TugQL, text: yaml },
      federation: {
        ovdbBaseUrl: 'https://ovdb.example.test',
        tables: [
          {
            database: 'chinook-postgresql',
            schema: 'chinook',
            name: 'Artist',
            fields: ['ArtistId'],
          },
          {
            database: 'chinook-postgresql',
            schema: 'chinook',
            name: 'Album',
            fields: ['AlbumId', 'ArtistId'],
          },
        ],
      },
      recordsets: [
        {
          columns: [
            { name: 'ArtistId', type: 'integer' },
            { name: 'Albums', type: 'integer' },
          ],
        },
      ],
    } as unknown as IQueryDef;
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith('/chinook-postgresql')
        ? json({
            id: 'chinook-postgresql',
            capabilities: { tugql: true, tugqlStreaming: true },
          })
        : json({
            records: [{ data: { ArtistId: 90, Albums: 21 } }],
            columns: ['ArtistId', 'Albums'],
            complete: true,
            execution: {
              route: 'database',
              rowsReturned: 1,
              sources: [
                {
                  database: 'chinook-postgresql',
                  collection: nativePostgresCollectionId('chinook', 'Album'),
                },
                {
                  database: 'chinook-postgresql',
                  collection: nativePostgresCollectionId('chinook', 'Artist'),
                },
              ],
            },
          }),
    );
    const result = await runFederatedQuery(
      definition,
      undefined,
      '',
      undefined,
      undefined,
      'full',
      undefined,
      undefined,
      { fetch: fetcher },
    );
    expect(result.recordset.rows).toHaveLength(1);
    expect(result.nativeStreamRead?.providerSources).toHaveLength(2);
  });

  it('still refuses a native stream whose execution sources name another relation', async () => {
    const definition = {
      id: 'genres',
      title: 'Genres',
      request: {
        queryType: QueryType.TugQL,
        text: 'from: {database: pg, schema: chinook, name: Genre}\nlimit: 5',
      },
      federation: {
        ovdbBaseUrl: 'https://ovdb.example.test',
        tables: [
          {
            database: 'pg',
            schema: 'chinook',
            name: 'Genre',
            fields: ['GenreId'],
          },
        ],
      },
      recordsets: [{ columns: [{ name: 'GenreId', type: 'integer' }] }],
    } as unknown as IQueryDef;
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith('/pg')
        ? json({
            id: 'pg',
            capabilities: { tugql: true, tugqlStreaming: true },
          })
        : json({
            records: [{ data: { GenreId: 1 } }],
            columns: ['GenreId'],
            complete: true,
            execution: {
              rowsReturned: 1,
              sources: [
                {
                  database: 'pg',
                  collection: nativePostgresCollectionId('chinook', 'Track'),
                },
              ],
            },
          }),
    );
    await expect(
      runFederatedQuery(
        definition,
        undefined,
        '',
        undefined,
        undefined,
        'full',
        undefined,
        undefined,
        { fetch: fetcher },
      ),
    ).rejects.toThrow(
      'The native query stream execution sources differ from its plan.',
    );
  });

  it('reads a schema-qualified leaf of a cross-database join whole, without snapshot paging headers', async () => {
    const yaml = `from:
  database: chinook-postgresql
  schema: chinook
  name: Genre
  alias: pg
  scan: {orderBy: [{field: GenreId}], limit: 2}
  joins:
    - from:
        database: chinook
        name: Genre
        alias: sq
        scan: {orderBy: [{field: GenreId}], limit: 2}
      on: [{left: {field: GenreId, source: pg}, op: '==', right: {field: GenreId, source: sq}}]
columns:
  - {field: GenreId, source: pg}
  - {field: Name, source: pg, as: PostgreSQLName}
  - {field: Name, source: sq, as: SQLiteName}
limit: 2`;
    const definition = {
      id: 'genres',
      title: 'Genres',
      request: { queryType: QueryType.TugQL, text: yaml },
      federation: {
        ovdbBaseUrl: 'https://ovdb.example.test',
        tables: [
          {
            database: 'chinook-postgresql',
            schema: 'chinook',
            name: 'Genre',
            fields: ['GenreId', 'Name'],
          },
          { database: 'chinook', name: 'Genre', fields: ['GenreId', 'Name'] },
        ],
      },
      recordsets: [
        {
          columns: [
            { name: 'GenreId', type: 'integer' },
            { name: 'PostgreSQLName', type: 'string' },
            { name: 'SQLiteName', type: 'string' },
          ],
        },
      ],
    } as unknown as IQueryDef;
    const requests: {
      url: string;
      headers: Headers;
      body: Record<string, unknown>;
    }[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url, headers, body });
      if (url.includes('/chinook-postgresql/')) {
        if (headers.has('OVDB-Page-Size'))
          return json({ error: { code: 'snapshot_unsupported' } }, 422);
        return json({
          records: [
            { data: { GenreId: 1, Name: 'Rock' } },
            { data: { GenreId: 2, Name: 'Jazz' } },
          ],
          columns: ['GenreId', 'Name'],
          complete: true,
        });
      }
      return json({
        records: [
          { key: 'Genre/1', data: { GenreId: 1, Name: 'Rock' } },
          { key: 'Genre/2', data: { GenreId: 2, Name: 'Jazz' } },
        ],
      });
    });
    const result = await runFederatedQuery(
      definition,
      undefined,
      '',
      undefined,
      undefined,
      'full',
      undefined,
      undefined,
      { fetch: fetcher },
    );
    const postgres = requests.filter((request) =>
      request.url.includes('/chinook-postgresql/'),
    );
    expect(postgres).toHaveLength(1);
    expect(postgres[0].headers.has('OVDB-Page-Size')).toBe(false);
    expect(postgres[0].body).toMatchObject({
      from: { name: 'Genre', schema: 'chinook' },
      limit: 2,
    });
    expect(
      result.recordset.rows.map((row) => row.map((cell) => cell.value)),
    ).toEqual([
      [1, 'Rock', 'Rock'],
      [2, 'Jazz', 'Jazz'],
    ]);
  });

  it('refuses a partial whole-result read from a native PostgreSQL leaf', async () => {
    const definition = {
      id: 'genres',
      title: 'Genres',
      request: {
        queryType: QueryType.TugQL,
        text: `from:
  database: pg
  schema: chinook
  name: Genre
  alias: pg
  joins:
    - from: {database: lite, name: Genre, alias: sq}
      on: [{left: {field: GenreId, source: pg}, op: '==', right: {field: GenreId, source: sq}}]
columns:
  - {field: GenreId, source: pg}`,
      },
      federation: {
        ovdbBaseUrl: 'https://ovdb.example.test',
        tables: [
          {
            database: 'pg',
            schema: 'chinook',
            name: 'Genre',
            fields: ['GenreId'],
          },
          { database: 'lite', name: 'Genre', fields: ['GenreId'] },
        ],
      },
      recordsets: [{ columns: [{ name: 'GenreId', type: 'integer' }] }],
    } as unknown as IQueryDef;
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/pg/')
        ? json({ records: [{ data: { GenreId: 1 } }], complete: false })
        : json({ records: [{ key: 'Genre/1', data: { GenreId: 1 } }] }),
    );
    await expect(
      runFederatedQuery(
        definition,
        undefined,
        '',
        undefined,
        undefined,
        'full',
        undefined,
        undefined,
        { fetch: fetcher },
      ),
    ).rejects.toThrow('OVDB pg returned an invalid result.');
  });
});

describe('loopback OVDB servers', () => {
  afterEach(() => vi.unstubAllGlobals());

  const local = {
    id: 'local',
    title: 'Local',
    request: {
      queryType: QueryType.TugQL,
      text: 'from: {database: orders, name: Invoice}\nlimit: 2',
    },
    federation: {
      ovdbBaseUrl: 'http://127.0.0.1:50501',
      tables: [{ database: 'orders', name: 'Invoice', fields: ['id'] }],
    },
    recordsets: [{ columns: [{ name: 'id', type: 'integer' }] }],
  } as unknown as IQueryDef;

  it('never contacts a loopback OVDB server from a hosted page', async () => {
    vi.stubGlobal('location', {
      hostname: 'datatug.app',
      origin: 'https://datatug.app',
    });
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      runFederatedQuery(
        local,
        undefined,
        '',
        undefined,
        undefined,
        'full',
        undefined,
        undefined,
        { fetch: fetcher },
      ),
    ).rejects.toThrow(LOCAL_OVDB_FROM_HOSTED_PAGE);
    expect(fetcher).not.toHaveBeenCalled();
    expect(LOCAL_OVDB_FROM_HOSTED_PAGE).not.toMatch(/127\.0\.0\.1|localhost/);
  });

  it('still reaches a loopback OVDB server from a page served on this computer', async () => {
    vi.stubGlobal('location', {
      hostname: '127.0.0.1',
      origin: 'http://127.0.0.1:4200',
    });
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith('/orders')
        ? json({
            id: 'orders',
            capabilities: { tugql: true, tugqlStreaming: true },
          })
        : json({
            records: [{ data: { id: 1 } }],
            columns: ['id'],
            complete: true,
            execution: {},
          }),
    );
    const result = await runFederatedQuery(
      local,
      undefined,
      '',
      undefined,
      undefined,
      'full',
      undefined,
      undefined,
      { fetch: fetcher },
    );
    expect(fetcher).toHaveBeenCalled();
    expect(String(fetcher.mock.calls[0][0])).toBe(
      'http://127.0.0.1:50501/v1/databases/orders',
    );
    expect(result.recordset.rows).toHaveLength(1);
  });
});
