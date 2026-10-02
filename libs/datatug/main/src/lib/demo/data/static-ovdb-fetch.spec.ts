import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { runFederatedQuery } from '../../queries/federated-query-executor';
import { demoBundle, HERO_QUERY_ID, queryDefinition } from '../demo-project';
import { diskFetch, ORIGIN, readAsset, staticRuntime } from '../testing/disk-static-source';
import { must } from '../testing/must';
import { readCollection } from './read-collection';
import { createStaticOvdbFetch } from './static-ovdb-fetch';

const base = `${ORIGIN}/assets/demo-data/ovdb`;
const post = (send: typeof fetch, database: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  send(`${base}/v1/databases/${database}/dtql`, { method: 'POST', headers: { 'OVDB-Page-Size': '100', ...headers }, body: JSON.stringify(body) });

describe('static OVDB adapter', () => {
  const requested: string[] = [];
  const send = createStaticOvdbFetch({ baseUrl: base, version: 'v1' }, diskFetch(requested));

  it('pages a collection the way an OVDB snapshot does, with a token, and closes it', async () => {
    const first = await (await post(send, 'chinook', { from: { name: 'Invoice' } })).json() as { records: { key: string }[]; nextPageToken?: string; snapshotToken?: string };
    expect(first.records).toHaveLength(100);
    expect(first.snapshotToken).toBe('static:chinook');
    expect(first.nextPageToken).toBe('page:100');
    const last = await (await post(send, 'chinook', { from: { name: 'Invoice' } }, { 'OVDB-Page-Token': 'page:400' })).json() as { records: unknown[]; nextPageToken?: string };
    expect(last.records).toHaveLength(12);
    expect(last.nextPageToken).toBeUndefined();
    expect((await post(send, 'chinook', { from: { name: 'Invoice' } }, { 'OVDB-Page-Close': 'true' })).status).toBe(204);
  });

  it('loads each file once and busts the cache with the bundle version', async () => {
    requested.length = 0;
    await post(send, 'geo', { from: { name: 'population_wb' } });
    await post(send, 'geo', { from: { name: 'population_wb' } });
    expect(requested).toEqual([`${base}/geo/population_wb.json?v=v1`]);
  });

  it('applies orderBy, descending too', async () => {
    const page = await (await post(send, 'geo', { from: { name: 'population_wb' }, orderBy: [{ field: 'population', desc: true }] })).json() as { records: { data: { population: number } }[] };
    expect(page.records[0].data.population).toBeGreaterThan(page.records[1].data.population);
    const asc = await (await post(send, 'geo', { from: { name: 'population_wb' }, orderBy: [{ field: 'population' }] })).json() as { records: { data: { population: number } }[] };
    expect(asc.records[0].data.population).toBeLessThanOrEqual(asc.records[1].data.population);
  });

  it('answers 404 for anything that is not a known collection or the dtql endpoint', async () => {
    expect((await post(send, 'geo', { from: { name: 'nope' } })).status).toBe(404);
    expect((await post(send, 'geo', { from: { name: '../x' } })).status).toBe(404);
    expect((await post(send, 'geo', {})).status).toBe(404);
    expect((await send(`${base}/v1/databases/geo/records/population_wb/ie`)).status).toBe(404);
    expect((await send('https://elsewhere.example.test/v1/databases/geo/dtql', { method: 'POST' })).status).toBe(404);
  });

  it('retries a file that failed to load', async () => {
    let calls = 0;
    const flaky = createStaticOvdbFetch({ baseUrl: base }, async (input, init) => (calls++ === 0 ? new Response('x', { status: 500 }) : diskFetch()(input, init)));
    expect((await post(flaky, 'geo', { from: { name: 'country_aliases' } })).status).toBe(404);
    expect((await post(flaky, 'geo', { from: { name: 'country_aliases' } })).status).toBe(200);
  });

  it('reads whole collections for the trace checks', async () => {
    const records = await readCollection({ baseUrl: base, staticSource: { baseUrl: base } }, 'chinook', 'Invoice', diskFetch());
    expect(records).toHaveLength(412);
    await expect(readCollection({ baseUrl: base }, 'chinook', 'Invoice', async () => new Response('x', { status: 503 }))).rejects.toThrow('read failed (503)');
  });
});

// The production data path must give the answer the Go CLI gives: the same query, the same engine, the
// rows read from static files instead of an OVDB server.
describe('the saved query through the static adapter', () => {
  it('returns the 24 rows the Go CLI returns, ordered by sales per million', async () => {
    const result = await runFederatedQuery(queryDefinition(HERO_QUERY_ID, staticRuntime()), undefined, '', undefined, undefined, 'full', undefined, undefined, {
      fetch: createStaticOvdbFetch(must(staticRuntime().staticSource), diskFetch()),
    });
    const names = result.recordset.columns.map((column) => column.name);
    const rows = result.recordset.rows.map((row) => Object.fromEntries(row.map((cell, index) => [names[index], cell.value])));
    expect(names).toEqual(['country', 'totalSales', 'population', 'populationYear', 'salesPerMillion']);
    expect(rows).toHaveLength(24);
    expect(rows.slice(0, 4).map((row) => row['country'])).toEqual(['Ireland', 'Czech Republic', 'Finland', 'Canada']);
    expect(rows[0]['salesPerMillion']).toBeCloseTo(8.318189, 6);
    expect(rows.find((row) => row['country'] === 'USA')?.['salesPerMillion']).toBeCloseTo(1.530378, 6);
  });

  it('serves exactly the rows the bundle says it generated', () => {
    for (const source of demoBundle.data) {
      const [database, name] = source.id.split('.');
      expect((readAsset(database, name) as unknown[]).length).toBe(source.rows);
    }
  });
});
