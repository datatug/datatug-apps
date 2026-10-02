import { describe, expect, it, vi } from 'vitest';
import { createStaticOvdbFetch } from './static-ovdb-fetch';

const base = 'https://static.example.test/data';
const row = (key: string, data: Record<string, unknown>) => ({ key, data });
const items = Array.from({ length: 12 }, (_, index) => row(`k${index}`, { n: index, name: `item-${index}` }));

/** Serves `<base>/<database>/<collection>.json` from memory and records every address it was asked for. */
function memoryFetch(requested: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.startsWith(`${base}/db/items.json`)) return new Response(JSON.stringify(items), { status: 200 });
    return new Response('missing', { status: 404 });
  }) as typeof fetch;
}

const post = (send: typeof fetch, database: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  send(`${base}/v1/databases/${database}/dtql`, { method: 'POST', headers, body: JSON.stringify(body) });

describe('static OVDB adapter', () => {
  it('pages a collection the way an OVDB snapshot does, with a token, and closes it', async () => {
    const send = createStaticOvdbFetch({ baseUrl: base }, memoryFetch());
    const first = await (await post(send, 'db', { from: { name: 'items' } }, { 'OVDB-Page-Size': '5' })).json() as { records: unknown[]; nextPageToken?: string; snapshotToken?: string };
    expect(first.records).toHaveLength(5);
    expect(first.snapshotToken).toBe('static:db');
    expect(first.nextPageToken).toBe('page:5');
    const last = await (await post(send, 'db', { from: { name: 'items' } }, { 'OVDB-Page-Size': '5', 'OVDB-Page-Token': 'page:10' })).json() as { records: unknown[]; nextPageToken?: string };
    expect(last.records).toHaveLength(2);
    expect(last.nextPageToken).toBeUndefined();
    expect((await post(send, 'db', { from: { name: 'items' } }, { 'OVDB-Page-Close': 'true' })).status).toBe(204);
  });

  it('defaults to 500 rows a page when the size header is missing or not a number', async () => {
    const send = createStaticOvdbFetch({ baseUrl: `${base}/` }, memoryFetch());
    const page = await (await post(send, 'db', { from: { name: 'items' } }, { 'OVDB-Page-Size': 'many' })).json() as { records: unknown[]; nextPageToken?: string };
    expect(page.records).toHaveLength(12);
    expect(page.nextPageToken).toBeUndefined();
  });

  it('loads each file once and busts the cache with the version', async () => {
    const requested: string[] = [];
    const send = createStaticOvdbFetch({ baseUrl: base, version: 'v 1' }, memoryFetch(requested));
    await post(send, 'db', { from: { name: 'items' } });
    await post(send, 'db', { from: { name: 'items' } });
    expect(requested).toEqual([`${base}/db/items.json?v=v%201`]);
  });

  it('applies orderBy, descending and ascending, with nulls first and text compared as text', async () => {
    const rows = [row('a', { n: 2, s: 'b' }), row('b', { n: null, s: 'a' }), row('c', { n: 3, s: 'a' }), row('d', { n: 1 })];
    const send = createStaticOvdbFetch({ baseUrl: base }, (async () => new Response(JSON.stringify(rows))) as typeof fetch);
    const keys = async (orderBy: unknown): Promise<string[]> =>
      ((await (await post(send, 'db', { from: { name: 'items' }, orderBy })).json()) as { records: { key: string }[] }).records.map((record) => record.key);
    expect(await keys([{ field: 'n', desc: true }])).toEqual(['c', 'a', 'd', 'b']);
    expect(await keys([{ field: 'n' }])).toEqual(['b', 'd', 'a', 'c']);
    expect(await keys([{ field: 's' }, { field: 'n', desc: true }])).toEqual(['d', 'c', 'b', 'a']);
    expect(await keys([{ field: 'n' }, { field: 'n' }])).toEqual(['b', 'd', 'a', 'c']);
  });

  it('answers 404 for anything that is not a known collection or the dtql endpoint', async () => {
    const send = createStaticOvdbFetch({ baseUrl: base }, memoryFetch());
    expect((await post(send, 'db', { from: { name: 'nope' } })).status).toBe(404);
    expect((await post(send, 'db', { from: { name: '../x' } })).status).toBe(404);
    expect((await post(send, 'db', {})).status).toBe(404);
    expect((await send(`${base}/v1/databases/db/records/items/k1`)).status).toBe(404);
    expect((await send(new URL(`${base}/v1/databases/db/dtql`), { method: 'GET' })).status).toBe(404);
    expect((await send('https://elsewhere.example.test/v1/databases/db/dtql', { method: 'POST' })).status).toBe(404);
    expect((await send(new Request(`${base}/v1/databases/db/dtql`))).status).toBe(404);
  });

  it('retries a file that failed to load', async () => {
    let calls = 0;
    const good = memoryFetch();
    const flaky = createStaticOvdbFetch({ baseUrl: base }, (async (input, init) => (calls++ === 0 ? new Response('x', { status: 500 }) : good(input, init))) as typeof fetch);
    expect((await post(flaky, 'db', { from: { name: 'items' } })).status).toBe(404);
    expect((await post(flaky, 'db', { from: { name: 'items' } })).status).toBe(200);
  });

  it('reads through the global fetch, late bound, when no fetch is given', async () => {
    const global = vi.fn(memoryFetch());
    vi.stubGlobal('fetch', global);
    try {
      const response = await post(createStaticOvdbFetch({ baseUrl: base }), 'db', { from: { name: 'items' } });
      expect(response.status).toBe(200);
      expect(global).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
