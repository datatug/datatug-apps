// Act 4 of the public demo: Chinook and Northwind customers (OVDB) joined to
// Countries, an inGitDB database the browser reads straight from GitHub,
// described by an OVDB descriptor. Fixtures are byte copies of the pinned
// geo-ingitdb views; see fixtures/geo-ingitdb-github/README.md.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runFederatedQuery, type FederatedQueryResult } from './federated-query-executor';
import { IngitdbGithubSources, IngitdbSourceError } from './ingitdb-github-source';
import { browserGitFileCache, gitFilePolicy, type CachedGitFile, type GitFileCache } from './ingitdb-github-cache';
import type { IQueryDef } from '../models/definition/query-def';
import descriptor from './fixtures/geo-ingitdb-github/geo-github.ovdb.yaml?raw';
import roots from './fixtures/geo-ingitdb-github/root-collections.yaml?raw';
import settings from './fixtures/geo-ingitdb-github/settings.yaml?raw';
import countriesDefinition from './fixtures/geo-ingitdb-github/countries.definition.yaml?raw';
import populationDefinition from './fixtures/geo-ingitdb-github/population_wb.definition.yaml?raw';
import aliasesDefinition from './fixtures/geo-ingitdb-github/country_aliases.definition.yaml?raw';
import countries from './fixtures/geo-ingitdb-github/countries.ingr?raw';
import population from './fixtures/geo-ingitdb-github/population_wb.ingr?raw';
import aliases from './fixtures/geo-ingitdb-github/country_aliases.ingr?raw';
import chinookMeta from './fixtures/geo-ingitdb-github/chinook-customers-per-million.query.json';
import chinookText from './fixtures/geo-ingitdb-github/chinook-customers-per-million.query.dtql?raw';
import northwindMeta from './fixtures/geo-ingitdb-github/northwind-customer-countries.query.json';
import northwindText from './fixtures/geo-ingitdb-github/northwind-customer-countries.query.dtql?raw';
import worldMeta from './fixtures/geo-ingitdb-github/countries-currency-population.query.json';
import worldText from './fixtures/geo-ingitdb-github/countries-currency-population.query.dtql?raw';

const base = 'https://ovdb.example.test';
const descriptorUrl = chinookMeta.federation.ingitdbSources[0].descriptor;
const raw = 'https://raw.githubusercontent.com/ingitdb/geo-ingitdb/2a84199bcab79744b48ec529e48559a89a4b8851';
const files: Record<string, string> = {
  [descriptorUrl]: descriptor,
  [`${raw}/.ingitdb/root-collections.yaml`]: roots,
  [`${raw}/.ingitdb/settings.yaml`]: settings,
  [`${raw}/countries/.collection/definition.yaml`]: countriesDefinition,
  [`${raw}/population_wb/.collection/definition.yaml`]: populationDefinition,
  [`${raw}/country_aliases/.collection/definition.yaml`]: aliasesDefinition,
  [`${raw}/%24ingitdb/countries/countries.ingr`]: countries,
  [`${raw}/%24ingitdb/population_wb/population_wb.ingr`]: population,
  [`${raw}/%24ingitdb/country_aliases/country_aliases.ingr`]: aliases,
};

const rows = (pairs: readonly (readonly [number, string | null])[], id: string) =>
  pairs.map(([key, country]) => ({ key: String(key), data: { [id]: id === 'CustomerID' ? `C${key}` : key, Country: country } }));
const ovdb: Record<string, unknown[]> = {
  'chinook.Customer': rows([[1, 'Canada'], [2, 'Canada'], [3, 'Czech Republic'], [4, 'USA'], [5, 'USA'], [6, 'Ireland']], 'CustomerId'),
  'northwind.Customers': rows([[1, 'Canada'], [2, 'UK'], [3, 'UK'], [4, 'Mexico'], [5, null], [6, null]], 'CustomerID'),
};

function serve(override: Record<string, () => Response> = {}): string[] {
  const requested: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    requested.push(url);
    if (override[url]) return override[url]();
    if (files[url] !== undefined) return new Response(files[url], { status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'max-age=300' } });
    const match = /^https:\/\/ovdb\.example\.test\/v1\/databases\/([^/]+)\/dtql$/.exec(url);
    if (!match) return new Response('not found', { status: 404 });
    if (new Headers(init.headers).get('OVDB-Page-Close') === 'true') return new Response(null, { status: 204 });
    const { from } = JSON.parse(init.body as string) as { from: { name: string } };
    return new Response(JSON.stringify({ records: ovdb[`${match[1]}.${from.name}`] ?? [] }), { status: 200 });
  }));
  return requested;
}

const definition = (meta: typeof chinookMeta | typeof northwindMeta | typeof worldMeta, text: string): IQueryDef => ({
  id: meta.id, title: meta.title,
  request: { queryType: 'DTQL', text },
  federation: { ...meta.federation, ovdbBaseUrl: base, expectedServerIdentity: undefined },
  recordsets: meta.recordsets,
} as unknown as IQueryDef);

const run = (query: IQueryDef): Promise<FederatedQueryResult> => runFederatedQuery(
  query, undefined, 'ovdb-token', undefined, undefined, 'full', undefined, undefined, { disableNativeStream: true });

function table(result: FederatedQueryResult): Record<string, unknown>[] {
  const names = result.recordset.columns.map((column) => column.name);
  return result.recordset.rows.map((row) => Object.fromEntries(row.map((cell, index) => [names[index], cell.value])));
}

describe('inGitDB databases read straight from GitHub', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('joins Chinook customers to the World Bank population in geo-ingitdb', async () => {
    const requested = serve();
    const result = await run(definition(chinookMeta, chinookText));
    const byCountry = Object.fromEntries(table(result).map((row) => [row['country'], row]));
    expect(Object.keys(byCountry).sort()).toEqual(['Canada', 'Czech Republic', 'Ireland', 'USA']);
    expect(byCountry['Canada']).toMatchObject({ customers: 2, population: 41651653, populationYear: 2025 });
    expect(byCountry['Ireland']['customersPerMillion']).toBeCloseTo(1 / 5.484367, 6);
    expect(table(result)[0]['country']).toBe('Ireland');
    expect(result.provenance.source).toBe(`${base} (direct OVDB) and GitHub (direct, no server)`);
    expect(result.gitSources).toEqual([{
      title: 'Countries',
      repositoryUrl: 'https://github.com/ingitdb/geo-ingitdb',
      revision: '2a84199bcab79744b48ec529e48559a89a4b8851',
    }]);
    // One view per collection, no GitHub API listing, no per-record files.
    const github = requested.filter((url) => url.startsWith('https://raw.githubusercontent.com/ingitdb/'));
    expect(github.filter((url) => url.endsWith('.ingr'))).toHaveLength(2);
    expect(requested.some((url) => url.includes('api.github.com') || url.includes('/$records/'))).toBe(false);
    // GitHub reads are anonymous simple requests; only OVDB sees the token.
    for (const [url, init] of vi.mocked(fetch).mock.calls)
      if (!String(url).startsWith(base)) {
        expect(init?.headers).toBeUndefined();
        expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
      }
    expect(requested.filter((url) => url.startsWith(base)).every((url) => url.includes('/chinook/'))).toBe(true);
  });

  it('gives Northwind customers a currency and population, leaving out customers without a Country', async () => {
    serve();
    const result = await run(definition(northwindMeta, northwindText));
    expect(table(result)).toEqual([
      { country: 'Canada', iso2: 'CA', currency: 'CAD', customers: 1, population: 41651653, populationYear: 2025 },
      { country: 'Mexico', iso2: 'MX', currency: 'MXN', customers: 1, population: expect.any(Number), populationYear: 2025 },
      { country: 'UK', iso2: 'GB', currency: 'GBP', customers: 2, population: 69487000, populationYear: 2025 },
    ]);
  });

  it('runs a query over GitHub alone, with no OVDB request', async () => {
    const requested = serve();
    const result = await run(definition(worldMeta, worldText));
    const rows = table(result);
    expect(rows).toHaveLength(216);
    expect(rows[0]).toMatchObject({ iso2: 'IN', currency: 'INR', populationYear: 2025 });
    expect(rows.find((row) => row['iso2'] === 'CA')).toMatchObject({ currency: 'CAD', population: 41651653 });
    expect(requested.some((url) => url.startsWith(base))).toBe(false);
    expect(result.provenance.source).toBe('GitHub (direct, no server)');
  });

  it('says the source is unavailable, without a URL, when GitHub does not answer', async () => {
    serve({ [`${raw}/%24ingitdb/population_wb/population_wb.ingr`]: () => new Response('busy', { status: 503 }) });
    const error = await run(definition(chinookMeta, chinookText)).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe('Countries is unavailable right now. Run the query again in a minute.');
    expect((error as Error).message).not.toMatch(/https?:|503|\$ingitdb/);
  });

  it('never falls back to reading record files when a collection publishes no view', async () => {
    const withoutView = populationDefinition.replace(/^default_view:.*$/m, '');
    const requested = serve({ [`${raw}/population_wb/.collection/definition.yaml`]: () => new Response(withoutView) });
    const error = await run(definition(chinookMeta, chinookText)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IngitdbSourceError);
    expect((error as IngitdbSourceError).detail).toBe('collection population_wb publishes no default view');
    expect(requested.some((url) => url.includes('api.github.com') || url.includes('/$records/') || url.includes('%24records'))).toBe(false);
  });

  it('refuses a descriptor that is not pinned to a commit', async () => {
    serve({ [descriptorUrl]: () => new Response(descriptor.replace(/revision: [0-9a-f]{40}/, 'revision: main')) });
    const sources = new IngitdbGithubSources([{ database: 'geo', descriptor: descriptorUrl }], fetch);
    await expect(sources.read('geo', 'countries')).rejects.toMatchObject({
      detail: 'descriptor has no ingitdb storage pinned to a GitHub commit',
    });
  });

  describe('browser cache', () => {
    let clock = 0;
    const memory = (): GitFileCache => {
      const store = new Map<string, CachedGitFile>();
      return { get: async (url) => store.get(url), put: async (url, text, ttlMs) => { store.set(url, { text, storedAt: clock, ttlMs }); } };
    };
    const read = (cache: GitFileCache) => new IngitdbGithubSources(
      [{ database: 'geo', descriptor: descriptorUrl }], fetch, undefined, cache, () => clock).read('geo', 'population_wb');

    it('keeps pinned data files for their declared max-age; metadata follows GitHub\'s max-age=300', async () => {
      const cache = memory();
      const requested = serve();
      clock = 0;
      expect(await read(cache)).toHaveLength(216);
      const first = requested.length;
      clock = 299_000; // within GitHub's max-age=300: nothing is fetched
      await read(cache);
      expect(requested.length).toBe(first);
      clock = 10 * 24 * 3600_000; // ten days: metadata is revalidated, the pinned view is not
      await read(cache);
      const again = requested.slice(first);
      expect(again).toContain(descriptorUrl);
      expect(again.some((url) => url.endsWith('.ingr'))).toBe(false);
      expect(vi.mocked(fetch).mock.calls.at(-1)?.[1]).toMatchObject({ cache: 'no-cache' });
    });

    it('follows the standard semantics and precedence', () => {
      const url = `${raw}/x`;
      const year = 31536000_000;
      // A content-addressed revision: the descriptor may relax the origin.
      expect(gitFilePolicy(url, 'max-age=300', { descriptor: 'public, max-age=31536000, immutable' }, true)).toEqual({ storable: true, ttlMs: year });
      // A moving address: the descriptor may only tighten it.
      expect(gitFilePolicy(url, 'max-age=300', { descriptor: 'public, max-age=31536000, immutable' }, false)).toEqual({ storable: true, ttlMs: 300_000 });
      expect(gitFilePolicy(url, 'max-age=300', { descriptor: 'max-age=60' }, false).ttlMs).toBe(60_000);
      expect(gitFilePolicy(url, 'max-age=300', { descriptor: 'no-store' }, false).storable).toBe(false);
      expect(gitFilePolicy(url, 'no-store', {}, true).storable).toBe(false);
      expect(gitFilePolicy(url, 'max-age=300', { descriptor: 'no-cache' }, false).ttlMs).toBe(0);
      // no-store and no-cache win even on a pinned read; immutable does not relax an unpinned one.
      expect(gitFilePolicy(url, 'no-cache', { descriptor: 'public, max-age=31536000, immutable' }, true).ttlMs).toBe(0);
      expect(gitFilePolicy(url, 'max-age=300', { descriptor: 'immutable' }, false).ttlMs).toBe(0);
      expect(gitFilePolicy(url, 'max-age=300', { descriptor: 'immutable' }, true).ttlMs).toBe(year);
      // Metadata files follow the origin.
      expect(gitFilePolicy(url, 'max-age=300', { descriptor: 'public, max-age=31536000, immutable' }, true, false).ttlMs).toBe(300_000);
      // A malformed directive is dropped, the rest still applies.
      expect(gitFilePolicy(url, 'max-age=300', { descriptor: 'max-age=abc, max-age=600' }, true).ttlMs).toBe(600_000);
      expect(gitFilePolicy(url, 'max-age=300, must-revalidate', {}, false).ttlMs).toBe(300_000);
      expect(gitFilePolicy(url, 'max-age=300, x-unknown=1', {}, false).ttlMs).toBe(300_000);
      expect(gitFilePolicy(url, null, {}, false).ttlMs).toBe(0);
      // inGitDB's collection value first; the descriptor can only tighten it.
      expect(gitFilePolicy(url, 'max-age=300', { ingitdb: 'max-age=86400, immutable', descriptor: 'public, max-age=31536000, immutable' }, true).ttlMs).toBe(86400_000);
      expect(gitFilePolicy(url, 'max-age=300', { ingitdb: 'max-age=86400', descriptor: 'max-age=600' }, true).ttlMs).toBe(600_000);
      expect(gitFilePolicy(url, 'max-age=300', { ingitdb: 'max-age=86400', descriptor: 'no-store' }, true).storable).toBe(false);
    });

    it('does not store a no-cache file and revalidates it on every read', async () => {
      const store = new Map<string, CachedGitFile>();
      const cache: GitFileCache = { get: async (key) => store.get(key), put: async (key, text, ttlMs) => { store.set(key, { text, storedAt: clock, ttlMs }); } };
      serve({ [descriptorUrl]: () => new Response(descriptor, { headers: { 'Cache-Control': 'no-cache' } }) });
      clock = 0;
      await read(cache);
      expect(store.has(descriptorUrl)).toBe(false);
      expect([...store.keys()].every((key) => key.startsWith(raw))).toBe(true);
    });

    it('fetches normally when browser storage is unavailable or full', async () => {
      vi.stubGlobal('caches', { open: async () => { throw new DOMException('blocked', 'SecurityError'); } });
      const blocked = browserGitFileCache();
      expect(await blocked.get('https://example.test/a')).toBeUndefined();
      await expect(blocked.put('https://example.test/a', 'x', 1000)).resolves.toBeUndefined();
      const requested = serve();
      vi.stubGlobal('caches', { open: async () => ({ match: async () => undefined,
        put: async () => { throw new DOMException('full', 'QuotaExceededError'); } }) });
      expect(await read(browserGitFileCache())).toHaveLength(216);
      expect(requested.length).toBeGreaterThan(0);
    });
  });

  it('rejects a descriptor URL with a query string', () => {
    expect(() => new IngitdbGithubSources([{ database: 'geo', descriptor: `${descriptorUrl}?token=1` }], fetch))
      .toThrow(IngitdbSourceError);
  });
});
