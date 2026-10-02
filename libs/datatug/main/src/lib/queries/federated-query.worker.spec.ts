import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IQueryDef } from '../models/definition/query-def';

type Posted = { type: string; [key: string]: unknown };

const definition = {
  id: 'q', title: 'q', request: { queryType: 'DTQL', text: 'from: {database: db, name: items, alias: i}\ncolumns: [{field: name, source: i}]\n' },
  federation: { ovdbBaseUrl: 'https://static.example.test/data', tables: [{ name: 'items', database: 'db', fields: ['name'] }] },
} as unknown as IQueryDef;

describe('federated query worker', () => {
  let posted: Posted[];
  let scope: { postMessage: (message: Posted) => void; onmessage?: (event: { data: unknown }) => void };

  const run = async (extra: object): Promise<void> => {
    scope.onmessage?.({ data: { type: 'run', definition, token: '', mode: 'full', ...extra } });
    await vi.waitFor(() => expect(posted.some((message) => message.type === 'result' || message.type === 'error')).toBe(true));
  };

  beforeEach(async () => {
    posted = [];
    scope = { postMessage: (message) => { posted.push(message); } };
    vi.stubGlobal('self', scope);
    vi.resetModules();
    await import('./federated-query.worker');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads from the static source it is given, never the global fetch, and reports the source it read', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return String(input).startsWith('https://static.example.test/data/db/items.json')
        ? new Response(JSON.stringify([{ key: 'a', data: { name: 'A' } }, { key: 'b', data: { name: 'B' } }]))
        : new Response('missing', { status: 404 });
    }));
    await run({ staticSource: { baseUrl: 'https://static.example.test/data', version: 'v1' } });
    expect(posted.find((message) => message.type === 'error')).toBeUndefined();
    expect(urls).toEqual(['https://static.example.test/data/db/items.json?v=v1']);
    const source = posted.find((message) => message.type === 'source');
    expect(source?.['event']).toMatchObject({ database: 'db', name: 'items', rows: 2, requests: 1 });
    const result = posted.find((message) => message.type === 'result')?.['result'] as { recordset: { rows: { value: unknown }[][] } };
    expect(result.recordset.rows.map((row) => row[0].value)).toEqual(['A', 'B']);
  });

  it('without a static source it speaks to the OVDB server through the global fetch, and still reports each source', async () => {
    const global = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Headers(init?.headers).get('OVDB-Page-Close') === 'true' ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ records: [{ key: 'a', data: { name: 'A' } }] })));
    vi.stubGlobal('fetch', global);
    await run({});
    expect(global).toHaveBeenCalled();
    expect(posted.filter((message) => message.type === 'source')).toHaveLength(1);
    expect(posted.find((message) => message.type === 'error')).toBeUndefined();
  });
});
