import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IQueryDef } from '../models/definition/query-def';
import { OVDB_ERROR_STREAM_MIME } from './ovdb-json-record-stream';

type Posted = { type: string; [key: string]: unknown };

const definition = {
  id: 'q',
  title: 'q',
  request: {
    queryType: 'DTQL',
    text: 'from: {database: db, name: items, alias: i}\ncolumns: [{field: name, source: i}]\n',
  },
  federation: {
    ovdbBaseUrl: 'https://static.example.test/data',
    tables: [{ name: 'items', database: 'db', fields: ['name'] }],
  },
} as unknown as IQueryDef;

describe('federated query worker', () => {
  let posted: Posted[];
  let scope: {
    postMessage: (message: Posted) => void;
    onmessage?: (event: { data: unknown }) => void;
  };

  const run = async (extra: object): Promise<void> => {
    scope.onmessage?.({
      data: { type: 'run', definition, token: '', mode: 'full', ...extra },
    });
    await vi.waitFor(
      () => expect(posted.some((message) => message.type === 'result' || message.type === 'error')).toBe(true),
      { timeout: 10_000 },
    );
  };

  beforeEach(async () => {
    posted = [];
    scope = {
      postMessage: (message) => {
        posted.push(message);
      },
    };
    vi.stubGlobal('self', scope);
    vi.resetModules();
    await import('./federated-query.worker');
  });
  afterEach(async () => {
    const closed = posted.filter((message) => message.type === 'closed').length;
    scope.onmessage?.({ data: { type: 'close' } });
    await vi.waitFor(() => expect(posted.filter((message) => message.type === 'closed').length).toBeGreaterThan(closed),
      { timeout: 10_000 });
    vi.unstubAllGlobals();
  });

  it('reads from the static source it is given, never the global fetch, and reports the source it read', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return String(input).startsWith(
          'https://static.example.test/data/db/items.json',
        )
          ? new Response(
              JSON.stringify([
                { key: 'a', data: { name: 'A' } },
                { key: 'b', data: { name: 'B' } },
              ]),
            )
          : new Response('missing', { status: 404 });
      }),
    );
    await run({
      staticSource: {
        baseUrl: 'https://static.example.test/data',
        version: 'v1',
      },
    });
    expect(posted.find((message) => message.type === 'error')).toBeUndefined();
    expect(urls).toEqual([
      'https://static.example.test/data/db/items.json?v=v1',
    ]);
    const source = posted.find((message) => message.type === 'source');
    expect(source?.['event']).toMatchObject({
      database: 'db',
      name: 'items',
      rows: 2,
      requests: 1,
    });
    const result = posted.find((message) => message.type === 'result')?.[
      'result'
    ] as { recordset: { rows: { value: unknown }[][] } };
    const firstRecordIndex = posted.findIndex((message) => message.type === 'first-record');
    expect(firstRecordIndex).toBeGreaterThanOrEqual(0);
    expect(posted[firstRecordIndex]?.['at']).toEqual(expect.any(Number));
    expect(firstRecordIndex).toBeLessThan(posted.findIndex((message) => message.type === 'result'));
    expect(result.recordset.rows.map((row) => row[0].value)).toEqual([
      'A',
      'B',
    ]);
  });

  it('refuses a static public target fallback when the first stage is a declared JSON driver', async () => {
    const http = vi.fn();
    vi.stubGlobal('fetch', http);
    await run({
      definition: {
        ...definition,
        federation: {
          ...definition.federation,
          bounds: { driver: { kind: 'https-json' } },
        },
      },
      staticSource: { baseUrl: 'https://static.example.test/data' },
    });
    expect(
      posted.find((message) => message.type === 'error')?.['message'],
    ).toMatch(/static fallback/);
    expect(http).not.toHaveBeenCalled();
  });

  it('without a static source it speaks to the OVDB server through the global fetch, and still reports each source', async () => {
    const global = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Headers(init?.headers).get('OVDB-Page-Close') === 'true'
          ? new Response(null, { status: 204 })
          : new Response(
              JSON.stringify({ records: [{ key: 'a', data: { name: 'A' } }] }),
            ),
    );
    vi.stubGlobal('fetch', global);
    await run({});
    expect(global).toHaveBeenCalled();
    expect(posted.filter((message) => message.type === 'source')).toHaveLength(
      1,
    );
    expect(posted.find((message) => message.type === 'error')).toBeUndefined();
  });
  it('stages a streamed whole-query result in paged IndexedDB rows and keeps the footer column order', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      if (String(input).endsWith('/v1/databases/db'))
        return new Response(JSON.stringify({ id: 'db', capabilities: { dtql: true, dtqlStreaming: true } }), { headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ records: Array.from({ length: 105 }, (_, index) => ({ data: { name: `row-${index}`, id: String(index) } })),
        columns: ['id', 'name'], execution: {}, complete: true }), { headers: { 'Content-Type': 'application/json' } });
    }));
    await run({});
    const result = posted.find((message) => message.type === 'result')?.['result'] as { nativeStream?: true; totalRows: number; recordset: { rows: { value: unknown }[][] } };
    expect(result.nativeStream).toBe(true);
    expect(result.totalRows).toBe(105);
    expect(result.recordset.rows[0].map((value) => value.value)).toEqual(['0', 'row-0']);
    scope.onmessage?.({ data: { type: 'page', index: 1, requestId: 7 } });
    await vi.waitFor(() => expect(posted.some((message) => message.type === 'page' && message['requestId'] === 7)).toBe(true));
    const page = posted.find((message) => message.type === 'page' && message['requestId'] === 7)?.['rows'] as { value: unknown }[][];
    expect(page.map((row) => row[0].value)).toEqual(['100', '101', '102', '103', '104']);
    expect(calls).toEqual(['https://static.example.test/data/v1/databases/db', 'https://static.example.test/data/v1/databases/db/dtql']);
  });

  it('splits large streamed rows across byte-bounded IndexedDB transactions', async () => {
    const writes = vi.spyOn(IDBDatabase.prototype, 'transaction');
    try {
      const large = 'x'.repeat(600_000);
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/v1/databases/db')
        ? new Response(JSON.stringify({ id: 'db', capabilities: { dtql: true, dtqlStreaming: true } }), { headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify({ records: [{ data: { name: large } }, { data: { name: large } }, { data: { name: large } }],
          columns: ['name'], execution: {}, complete: true }), { headers: { 'Content-Type': 'application/json' } })));
      await run({});
      expect(posted.find((message) => message.type === 'error')).toBeUndefined();
      expect(writes.mock.calls.filter(([store, mode]) => store === 'rows' && mode === 'readwrite')).toHaveLength(3);
    } finally { writes.mockRestore(); }
  });
  it('stops the result cursor before loading an oversized page and removes provisional rows', async () => {
    const before = new Set((await indexedDB.databases()).map((database) => database.name));
    const advance = vi.spyOn(IDBCursorWithValue.prototype, 'continue');
    try {
      const large = 'x'.repeat(900_000);
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/v1/databases/db')
        ? new Response(JSON.stringify({ id: 'db', capabilities: { dtql: true, dtqlStreaming: true } }), { headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify({ records: Array.from({ length: 10 }, () => ({ data: { name: large } })),
          columns: ['name'], execution: {}, complete: true }), { headers: { 'Content-Type': 'application/json' } })));
      scope.onmessage?.({ data: { type: 'run', definition, token: '', mode: 'full' } });
      // The 9 MiB fake IndexedDB stream can take longer on parallel CI workers;
      // this still requires the exact byte-limit error and clean provisional state.
      await vi.waitFor(() => expect(posted.some((message) => message.type === 'error')).toBe(true), { timeout: 25_000 });
      expect(posted.find((message) => message.type === 'result')).toBeUndefined();
      expect(posted.find((message) => message.type === 'error')?.['message']).toMatch(/page exceeds the browser byte limit/);
      expect(advance).toHaveBeenCalledTimes(9);
      const after = new Set((await indexedDB.databases()).map((database) => database.name));
      expect([...after].filter((name) => !before.has(name))).toEqual([]);
    } finally { advance.mockRestore(); }
  }, 30_000);

  it('deletes provisional streamed rows when a late transport failure truncates the JSON footer', async () => {
    const before = new Set((await indexedDB.databases()).map((database) => database.name));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/v1/databases/db')
      ? new Response(JSON.stringify({ id: 'db', capabilities: { dtql: true, dtqlStreaming: true } }), { headers: { 'Content-Type': 'application/json' } })
      : new Response(`{"records":[${Array.from({ length: 100 }, (_, index) => JSON.stringify({ data: { name: String(index) } })).join(',')}`,
        { headers: { 'Content-Type': 'application/json' } })));
    await run({});
    expect(posted.find((message) => message.type === 'result')).toBeUndefined();
    expect(posted.find((message) => message.type === 'error')?.['message']).toMatch(/terminal footer/);
    const after = new Set((await indexedDB.databases()).map((database) => database.name));
    expect([...after].filter((name) => !before.has(name))).toEqual([]);
  });
  it('deletes provisional pages and reports only a mapped negotiated terminal error', async () => {
    const before = new Set((await indexedDB.databases()).map((database) => database.name));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/v1/databases/db')
      ? new Response(JSON.stringify({ id: 'db', capabilities: {
        dtql: true, dtqlStreaming: true, dtqlStreamingErrors: true,
      } }), { headers: { 'Content-Type': 'application/json' } })
      : new Response(`{"records":[${Array.from({ length: 100 }, (_, index) =>
        JSON.stringify({ data: { name: String(index) } })).join(',')}],"error":{"code":"query_budget_exceeded","message":"The row budget was reached.","budget":{"name":"rows","limit":100,"route":"dtql"},"hint":"Narrow the query."},"complete":false}`,
      { headers: { 'Content-Type': OVDB_ERROR_STREAM_MIME } })));
    await run({});
    expect(posted.find((message) => message.type === 'result')).toBeUndefined();
    expect(posted.find((message) => message.type === 'error')?.['message']).toBe(
      'OVDB query failed (query_budget_exceeded): The row budget was reached.');
    const after = new Set((await indexedDB.databases()).map((database) => database.name));
    expect([...after].filter((name) => !before.has(name))).toEqual([]);
  });
  it('aborts a streamed query on close and removes its provisional IndexedDB pages', async () => {
    const before = new Set((await indexedDB.databases()).map((database) => database.name));
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/v1/databases/db')
      ? new Response(JSON.stringify({ id: 'db', capabilities: { dtql: true, dtqlStreaming: true } }), { headers: { 'Content-Type': 'application/json' } })
      : new Response(stream, { headers: { 'Content-Type': 'application/json' } })));
    scope.onmessage?.({ data: { type: 'run', definition, token: '', mode: 'full' } });
    source.enqueue(new TextEncoder().encode(`{"records":[${Array.from({ length: 100 }, (_, index) => JSON.stringify({ data: { name: String(index) } })).join(',')}`));
    await vi.waitFor(() => expect(posted.some((message) => message.type === 'storage')).toBe(true));
    scope.onmessage?.({ data: { type: 'close' } });
    await vi.waitFor(() => expect(posted.some((message) => message.type === 'closed')).toBe(true));
    expect(posted.some((message) => message.type === 'result')).toBe(false);
    const after = new Set((await indexedDB.databases()).map((database) => database.name));
    expect([...after].filter((name) => !before.has(name))).toEqual([]);
  });
  it('executes immutable pages through the installed worker/DALgo path and continues only on an explicit source-page message', async () => {
    const pins = {
      'OVDB-Provider-Revision': 'a'.repeat(40),
      'OVDB-Source-SHA256': 'b'.repeat(64),
      'OVDB-Serving-SHA256': 'c'.repeat(64),
      'OVDB-Manifest-SHA256': 'd'.repeat(64),
    };
    const calls: { name: string; headers: Headers; offset: number }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input, init) => {
        const q = JSON.parse(String(init?.body));
        const headers = new Headers(init?.headers);
        calls.push({ name: q.from.name, headers, offset: q.offset });
        expect(headers.has('OVDB-Page-Size')).toBe(false);
        const rows =
          q.from.name === 'Customer'
            ? [{ key: 'u:1', data: { Country: 'USA' } }]
            : [
                { key: 'p:1', data: { raw: 'USA', iso: 'US' } },
                { key: 'p:2', data: { raw: 'USA', iso: 'US' } },
              ];
        return new Response(
          JSON.stringify({ records: rows.slice(q.offset, q.offset + q.limit) }),
          { headers: pins },
        );
      }),
    );
    const configured = {
      id: 'immutable-worker',
      request: {
        queryType: 'DTQL',
        text: JSON.stringify({
          from: {
            database: 'user',
            name: 'Customer',
            alias: 'u',
            joins: [
              {
                type: 'left',
                from: { database: 'geo', name: 'Countries', alias: 'p' },
                on: [
                  {
                    left: { source: 'u', field: 'Country' },
                    op: '==',
                    right: { source: 'p', field: 'raw' },
                  },
                ],
              },
            ],
          },
        }),
      },
      federation: {
        ovdbBaseUrl: 'https://cloud.openvaultdb.com',
        tables: [
          { database: 'user', name: 'Customer', fields: ['Country'] },
          { database: 'geo', name: 'Countries', fields: ['raw', 'iso'] },
        ],
        bounds: {
          userRows: 10,
          userOffset: 0,
          identifierKind: 'place',
          identifierLimit: 100,
          resultRows: 5000,
          bytes: 5242880,
          timeoutMs: 10000,
          sources: [
            { database: 'user', name: 'Customer', keyField: 'Country' },
            {
              database: 'geo',
              name: 'Countries',
              keyField: 'raw',
              parent: { database: 'user', name: 'Customer', field: 'Country' },
            },
          ],
          runtime: {
            readProfile: 'bounded-immutable/1',
            databases: {
              user: {
                providerRevision: 'a'.repeat(40),
                sourceSha256: 'b'.repeat(64),
              },
              geo: {
                providerRevision: 'a'.repeat(40),
                sourceSha256: 'b'.repeat(64),
              },
            },
            pages: { 'geo.Countries': { limit: 1, offset: 0 } },
          },
        },
      },
    } as unknown as IQueryDef;
    await run({ definition: configured });
    expect(calls).toHaveLength(2);
    const first = posted.find((m) => m.type === 'result')?.['result'] as {
      publicDataExceptions: { unresolved: number };
      totalRows: number;
    };
    expect(first.publicDataExceptions.unresolved).toBe(1);
    expect(first.totalRows).toBe(1);
    scope.onmessage?.({
      data: {
        type: 'source-page',
        sourceId: 'geo.Countries',
        limit: 2,
        offset: 1,
        requestId: 7,
      },
    });
    await vi.waitFor(() =>
      expect(
        posted.some((m) => m.type === 'source-result' && m['requestId'] === 7),
      ).toBe(true),
    );
    expect(calls).toHaveLength(3);
    expect(calls[2].offset).toBe(1);
    expect(calls[2].headers.get('OVDB-Manifest-SHA256')).toBe('d'.repeat(64));
    const continued = posted.find((m) => m.type === 'source-result')?.[
      'result'
    ] as {
      publicDataExceptions: {
        complete: boolean;
        ambiguous: number;
        multiplied: number;
      };
      totalRows: number;
    };
    expect(continued.publicDataExceptions).toMatchObject({
      complete: true,
      ambiguous: 1,
      multiplied: 1,
    });
    expect(continued.totalRows).toBe(2);
    scope.onmessage?.({ data: { type: 'expire-runtime' } });
    scope.onmessage?.({
      data: {
        type: 'source-page',
        sourceId: 'geo.Countries',
        limit: 1,
        offset: 2,
        requestId: 8,
      },
    });
    await vi.waitFor(() =>
      expect(
        posted.some((m) => m.type === 'source-error' && m['requestId'] === 8),
      ).toBe(true),
    );
    expect(calls).toHaveLength(3);
    scope.onmessage?.({ data: { type: 'page', index: 0, requestId: 9 } });
    await vi.waitFor(() =>
      expect(
        posted.some((m) => m.type === 'page' && m['requestId'] === 9),
      ).toBe(true),
    );
    expect(
      posted.find((m) => m.type === 'page' && m['requestId'] === 9)?.['rows'],
    ).toHaveLength(2);
    scope.onmessage?.({ data: { type: 'close' } });
    await vi.waitFor(() =>
      expect(posted.some((m) => m.type === 'closed')).toBe(true),
    );
  });
});
