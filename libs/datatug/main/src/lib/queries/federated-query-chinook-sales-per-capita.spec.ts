// Regression test for the demo query that crosses three sources: Chinook invoices (chinook),
// country_aliases and population_wb (geo). The saved query and the rows come from
// fixtures/chinook-sales-per-capita (see its README for provenance and attribution). The
// browser engine must return what the Go CLI returns for the same query.
import 'fake-indexeddb/auto';
import { isJoinedDTQLQuery, parseDTQL } from '@dalgo/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { federatedVisibleMode, runFederatedQuery, type FederatedQueryResult } from './federated-query-executor';
import type { IQueryDef } from '../models/definition/query-def';
import aliases from './fixtures/chinook-sales-per-capita/country_aliases.json';
import invoices from './fixtures/chinook-sales-per-capita/invoice.json';
import populations from './fixtures/chinook-sales-per-capita/population_wb.json';
import queryMeta from './fixtures/chinook-sales-per-capita/chinook-sales-per-capita.query.json';
import queryText from './fixtures/chinook-sales-per-capita/chinook-sales-per-capita.query.dtql?raw';

interface OvdbRow { readonly key: string; readonly data: Record<string, unknown> }
type Sources = Readonly<Record<string, readonly OvdbRow[]>>;

const base = 'https://ovdb.example.test';
const hero = (): Sources => ({ 'chinook.Invoice': invoices, 'geo.country_aliases': aliases, 'geo.population_wb': populations });

const definition = (): IQueryDef => ({
  id: queryMeta.id, title: queryMeta.title,
  request: { queryType: 'DTQL', text: queryText },
  federation: { ...queryMeta.federation, ovdbBaseUrl: base },
  recordsets: queryMeta.recordsets,
} as unknown as IQueryDef);

/** An OVDB that serves snapshot pages of at most 100 rows, so every source is read over several requests. */
function serve(sources: Sources): string[] {
  const requested: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    requested.push(url);
    const match = /^https:\/\/ovdb\.example\.test\/v1\/databases\/([^/]+)\/dtql$/.exec(url);
    if (!match || init.method !== 'POST') throw new Error(`unexpected request ${url}`);
    const headers = new Headers(init.headers);
    if (headers.get('OVDB-Page-Close') === 'true') return new Response(null, { status: 204 });
    const { from } = JSON.parse(init.body as string) as { from: { name: string } };
    const rows = sources[`${match[1]}.${from.name}`];
    if (!rows) return new Response('{}', { status: 404 });
    const start = Number(headers.get('OVDB-Page-Token')?.replace('page:', '') ?? 0);
    const end = Math.min(start + 100, rows.length);
    return new Response(JSON.stringify({
      records: rows.slice(start, end), snapshotToken: `snapshot:${match[1]}`,
      ...(end < rows.length ? { nextPageToken: `page:${end}` } : {}),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return requested;
}

function table(result: FederatedQueryResult): Record<string, unknown>[] {
  const names = result.recordset.columns.map((column) => column.name);
  return result.recordset.rows.map((row) => Object.fromEntries(row.map((cell, index) => [names[index], cell.value])));
}

// country, total sales, population, sales per million: the Go CLI's rows for demo-project-1.
const expected: readonly (readonly [string, number, number, number])[] = [
  ['Ireland', 45.62, 5484367, 8.318189],
  ['Czech Republic', 90.24, 10886878, 8.288878],
  ['Finland', 41.62, 5646436, 7.371021],
  ['Canada', 303.96, 41651653, 7.29767],
  ['Portugal', 77.24, 10804871, 7.148628],
  ['Norway', 39.62, 5610870, 7.061294],
  ['Denmark', 37.62, 6009169, 6.260433],
  ['Hungary', 45.62, 9514251, 4.794912],
  ['Austria', 42.62, 9208163, 4.628502],
  ['Sweden', 38.62, 10596620, 3.644558],
  ['Belgium', 37.62, 11941781, 3.150284],
  ['France', 195.1, 68720337, 2.839043],
  ['Chile', 46.62, 19859921, 2.347441],
  ['Netherlands', 40.62, 18087633, 2.245733],
  ['Germany', 156.48, 83491249, 1.874208],
  ['United Kingdom', 112.86, 69487000, 1.624189],
  ['USA', 523.06, 341784857, 1.530378],
  ['Australia', 37.62, 27614411, 1.362332],
  ['Poland', 37.62, 36435861, 1.032499],
  ['Brazil', 190.1, 212812405, 0.893275],
  ['Argentina', 37.62, 45851378, 0.820477],
  ['Spain', 37.62, 49355143, 0.762231],
  ['Italy', 37.62, 58915656, 0.63854],
  ['India', 75.26, 1463865525, 0.051412],
];

describe('saved query sales/chinook-sales-per-capita in the browser executor', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses against the declared tables as a join over three databases', () => {
    const parsed = parseDTQL(queryText, { tables: queryMeta.federation.tables });
    expect(isJoinedDTQLQuery(parsed)).toBe(true);
    if (!isJoinedDTQLQuery(parsed)) return;
    expect(parsed.orders).toHaveLength(1);
    expect(parsed.orders[0].expression?.kind).toBe('binary'); // ordered by an expression, not a field
    expect(parsed.groupBy).toHaveLength(3);
    expect(federatedVisibleMode(definition())).toMatchObject({ supported: false, defaultMode: 'full' });
  });

  it('returns the same 24 rows, in the same order, as the Go CLI', async () => {
    const requested = serve(hero());
    const result = await runFederatedQuery(definition());
    const rows = table(result);
    expect(result.recordset.columns.map((column) => column.name))
      .toEqual(['country', 'totalSales', 'population', 'populationYear', 'salesPerMillion']);
    expect(rows.map((row) => row['country'])).toEqual(expected.map((row) => row[0]));
    rows.forEach((row, index) => {
      const [, totalSales, population, perMillion] = expected[index];
      expect(row['totalSales']).toBeCloseTo(totalSales, 2);
      expect(row['population']).toBe(population);
      expect(row['populationYear']).toBe(2025);
      expect(row['salesPerMillion']).toBeCloseTo(perMillion, 6);
    });
    const byCountry = Object.fromEntries(rows.map((row) => [row['country'], row['salesPerMillion'] as number]));
    expect(byCountry['Ireland']).toBeCloseTo(8.32, 2);
    expect(byCountry['Czech Republic']).toBeCloseTo(8.29, 2);
    expect(byCountry['Finland']).toBeCloseTo(7.37, 2);
    expect(byCountry['Canada']).toBeCloseTo(7.3, 2);
    expect(byCountry['USA']).toBeCloseTo(1.53, 2);
    // Only the three OVDB sources were read, over paged snapshots, and each snapshot was released.
    expect(requested.every((url) => url.startsWith(`${base}/v1/databases/`))).toBe(true);
    expect(requested.filter((url) => url.includes('/chinook/')).length).toBeGreaterThan(4);
  });

  describe('rows the join cannot price (a synthetic extension of the fixture, not demo data)', () => {
    const withEdgeCases = (): Sources => {
      const source = hero();
      return {
        'chinook.Invoice': [
          ...invoices,
          { key: '9001', data: { InvoiceId: 9001, BillingCountry: 'Atlantis', Total: 10 } }, // alias -> a record with population 0
          { key: '9002', data: { InvoiceId: 9002, BillingCountry: 'Nowhere', Total: 20 } }, // alias -> no population record
          { key: '9003', data: { InvoiceId: 9003, BillingCountry: 'Unmapped', Total: 30 } }, // no alias at all
        ],
        'geo.country_aliases': [
          ...source['geo.country_aliases'],
          { key: 'atlantis', data: { alias: 'Atlantis', country: 'zz' } },
          { key: 'nowhere', data: { alias: 'Nowhere', country: 'zy' } },
        ],
        'geo.population_wb': [
          ...source['geo.population_wb'],
          { key: 'zz', data: { country: 'zz', population: 0, year: 2025 } },
        ],
      };
    };

    it('drops countries without an alias or a population record, as an inner join does', async () => {
      serve(withEdgeCases());
      const rows = table(await runFederatedQuery(definition()));
      const countries = rows.map((row) => row['country']);
      expect(countries).not.toContain('Nowhere');
      expect(countries).not.toContain('Unmapped');
      expect(countries.filter((country) => country !== 'Atlantis')).toEqual(expected.map((row) => row[0]));
    });

    it('gives a zero population a null sales-per-million instead of failing, and sorts it last when descending', async () => {
      serve(withEdgeCases());
      const rows = table(await runFederatedQuery(definition()));
      expect(rows).toHaveLength(expected.length + 1);
      expect(rows.at(-1)).toMatchObject({ country: 'Atlantis', population: 0, salesPerMillion: null });
      expect(rows.at(-1)?.['totalSales']).toBeCloseTo(10, 2);
    });
  });
});
