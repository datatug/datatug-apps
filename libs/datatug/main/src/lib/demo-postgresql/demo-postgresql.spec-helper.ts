// A fake cloud.openvaultdb.com for specs: the descriptor of a native PostgreSQL mount (opaque `pg1_…` collection
// ids named by `source`, `query: false`, `dtql: true`, nothing writable) and its `POST /dtql` reads.
import type { OvdbDescriptor } from '../ovdb/ovdb-connection';

export const ARTIST_ID = 'pg1_AAAAB2NoaW5vb2sAAAAGQXJ0aXN0';
export const ALBUM_ID = 'pg1_AAAAB2NoaW5vb2sAAAAFQWxidW0';

/** What the live server answers for `chinook-postgresql` (two of its eleven tables). */
export const postgresDescriptor: OvdbDescriptor = {
  id: 'chinook-postgresql',
  engine: 'postgres',
  capabilities: {
    read: false,
    query: false,
    dtql: true,
    write: false,
    delete: false,
    reset: false,
    persistent: true,
    joins: true,
    aggregation: true,
  },
  collections: [ARTIST_ID, ALBUM_ID],
  schemas: {
    collections: {
      [ARTIST_ID]: {
        fields: {
          ArtistId: {
            type: 'integer',
            required: true,
            nativeType: 'bigint',
            primaryKey: true,
          },
          Name: { type: 'string', nativeType: 'text', nullable: true },
        },
        source: { schema: 'chinook', name: 'Artist' },
      },
      [ALBUM_ID]: {
        fields: {
          AlbumId: {
            type: 'integer',
            required: true,
            nativeType: 'bigint',
            primaryKey: true,
          },
          ArtistId: { type: 'integer', required: true, nativeType: 'bigint' },
          Title: { type: 'string', required: true, nativeType: 'text' },
        },
        source: { schema: 'chinook', name: 'Album' },
      },
    },
  },
};

export const artistRows = [
  { data: { ArtistId: 1, Name: 'AC/DC' } },
  { data: { ArtistId: 2, Name: 'Accept' } },
];

export interface FakeCloudRequest {
  readonly method: string;
  readonly url: string;
  readonly body?: string;
}

/**
 * A fetch that answers like the public server and records every request. `statuses` are the HTTP statuses of the
 * first requests (503 = `database_unavailable`); a request past them, or answered 200, succeeds.
 */
export function fakeCloudFetch(
  options: {
    readonly descriptor?: OvdbDescriptor;
    readonly statuses?: readonly number[];
  } = {},
): {
  readonly fetch: typeof globalThis.fetch;
  readonly requests: FakeCloudRequest[];
} {
  const requests: FakeCloudRequest[] = [];
  const statuses = [...(options.statuses ?? [])];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = init?.method ?? 'GET';
    requests.push({
      method,
      url,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const status = statuses.shift();
    if (status && status !== 200) {
      return json(status, {
        error: {
          code: status === 503 ? 'database_unavailable' : 'failed',
          message: 'not now',
        },
      });
    }
    if (method === 'GET' && url.endsWith('/v1/databases/chinook-postgresql'))
      return json(200, options.descriptor ?? postgresDescriptor);
    if (
      method === 'POST' &&
      url.endsWith('/v1/databases/chinook-postgresql/dtql')
    ) {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      return json(200, {
        records: query.includes('"Artist"') ? artistRows : [],
        complete: true,
      });
    }
    return json(501, {
      error: { code: 'operation_unsupported', message: `${method} ${url}` },
    });
  };
  return { fetch, requests };
}
