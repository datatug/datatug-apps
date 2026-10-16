import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { vi } from 'vitest';
import {
  chartEvidenceError,
  prepareBarRace,
  transformOrdersMonthlyCountryCount,
} from '@sneat/datatug-semantic';
import {
  QueryType,
  type IQueryDef,
  type ISqlQueryRequest,
} from '../../models/definition/query-def';
import { BrowserSqliteQueryService } from '../browser-sqlite-query.service';
import {
  executeBrowserSqlite,
  type BrowserSqliteWorkerRequest,
} from '../browser-sqlite-query.worker';
import { executeBrowserShowcaseQuery } from './browser-showcase-query';

const sql = {
  'northwind-orders-browser-sqlite':
    'SELECT OrderID, CustomerID, EmployeeID, OrderDate, RequiredDate, ShippedDate, ShipVia, Freight, ShipName, ShipAddress, ShipCity, ShipRegion, ShipPostalCode, ShipCountry\nFROM Orders\nORDER BY OrderID\n',
  'northwind-country-counts-browser-sqlite':
    'SELECT ShipCountry, COUNT(*) AS orders\nFROM Orders\nGROUP BY ShipCountry\nORDER BY ShipCountry\n',
  'chinook-billing-browser-sqlite':
    "SELECT\n    c.CustomerId,\n    c.FirstName || ' ' || c.LastName AS CustomerName,\n    c.Country,\n    COUNT(i.InvoiceId) AS InvoiceCount,\n    SUM(CAST(ROUND(i.Total * 100) AS INTEGER)) AS TotalCents\nFROM Customer c\nJOIN Invoice i\n    ON i.CustomerId = c.CustomerId\nGROUP BY c.CustomerId,c.FirstName,c.LastName,c.Country\nORDER BY TotalCents DESC,c.CustomerId\nLIMIT 10\n",
};
const definition = (id: keyof typeof sql): IQueryDef => ({
  id,
  title: id,
  connectionId: id.startsWith('chinook')
    ? 'chinook-sqlite'
    : 'northwind-sqlite',
  request: { queryType: QueryType.SQL, text: sql[id] } as ISqlQueryRequest,
});

describe('pinned browser showcase SQLite execution', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('executes both real bundled databases through the generic WASM worker and admits honest snapshot evidence', async () => {
    const SQL = await initSqlJs();
    const reads: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input);
        reads.push(url.pathname);
        const bytes = readFileSync(
          resolve(process.cwd(), 'apps/datatug-app/src', url.pathname.slice(1)),
        );
        return new Response(bytes, {
          status: 200,
          headers: { 'content-length': String(bytes.length) },
        });
      }),
    );
    vi.stubGlobal(
      'Worker',
      class {
        onmessage?: (event: MessageEvent) => void;
        postMessage(request: BrowserSqliteWorkerRequest): void {
          void executeBrowserSqlite(request, async () => SQL).then(
            (result) =>
              this.onmessage?.({ data: { ok: true, result } } as MessageEvent),
            (error: Error) =>
              this.onmessage?.({
                data: { ok: false, error: error.message },
              } as MessageEvent),
          );
        }
        terminate(): void {
          this.onmessage = undefined;
        }
      },
    );
    const run = (id: keyof typeof sql) =>
      executeBrowserShowcaseQuery(new BrowserSqliteQueryService(), {
        projectRef: {
          storeId: 'github.com',
          projectId: 'datatug/datatug-demo-project',
        },
        queryId: `demodb/${id}`,
        definition: definition(id),
      });
    const orders = await run('northwind-orders-browser-sqlite');
    expect(orders.runtime).toBe('browser-sqlite');
    expect(orders.provenance.mode).toBe('snapshot');
    expect('publicApiReceipt' in orders).toBe(false);
    expect(orders.recordset.rows).toHaveLength(830);
    expect(orders.recordset.columns).toHaveLength(14);
    expect(orders.recordset.rows[0][0]).toEqual({
      type: 'integer',
      value: '10248',
    });
    expect(chartEvidenceError(orders)).toBeUndefined();
    expect(
      chartEvidenceError({
        ...orders,
        sqliteReceipt: {
          ...orders.sqliteReceipt,
          fixtureSha256: '0'.repeat(64),
        },
      }),
    ).toMatch(/pinned snapshot/);
    expect(
      chartEvidenceError({
        ...orders,
        sqliteReceipt: { ...orders.sqliteReceipt, rowsReturned: 10 },
      }),
    ).toMatch(/rows/);
    const transformed = transformOrdersMonthlyCountryCount(orders, {
      name: 'orders-monthly-country-count',
      orderIdColumn: 'OrderID',
      dateColumn: 'OrderDate',
      countryColumn: 'ShipCountry',
    });
    expect(transformed.ok && transformed.data).toMatchObject({
      orderCount: 830,
      months: 23,
      countries: 21,
    });
    if (!transformed.ok) throw new Error(transformed.message);
    const race = prepareBarRace(transformed.data.recordset, {
      kind: 'bar-race',
      periodColumn: 'period',
      categoryColumn: 'category',
      measureColumn: 'value',
      onDuplicate: 'reject',
      mode: 'cumulative',
      topN: 21,
    });
    expect(race.ok && race.data.runtime).toBe('browser-sqlite');
    expect(
      race.ok &&
        race.data.frames
          .at(-1)
          ?.entries.reduce((total, entry) => total + entry.value, 0),
    ).toBe(830);
    const countries = await run('northwind-country-counts-browser-sqlite');
    expect(countries.recordset.rows).toHaveLength(21);
    expect(
      countries.recordset.rows.reduce(
        (total, row) => total + Number(row[1].value),
        0,
      ),
    ).toBe(830);
    const billing = await run('chinook-billing-browser-sqlite');
    expect(billing.recordset.rows).toHaveLength(10);
    expect(billing.recordset.columns.map(({ name }) => name)).toEqual([
      'CustomerId',
      'CustomerName',
      'Country',
      'InvoiceCount',
      'TotalCents',
    ]);
    expect(billing.recordset.rows[0][1]).toEqual({
      type: 'string',
      value: 'Helena Holý',
    });
    expect(billing.recordset.rows[0][4]).toEqual({
      type: 'integer',
      value: '4962',
    });
    expect(reads).toEqual([
      '/assets/showcase/northwind.sqlite',
      '/assets/showcase/northwind.sqlite',
      '/assets/showcase/chinook.sqlite',
    ]);
    await expect(
      executeBrowserShowcaseQuery(new BrowserSqliteQueryService(), {
        projectRef: { storeId: 'github.com', projectId: 'other' },
        queryId: 'demodb/northwind-orders-browser-sqlite',
        definition: {
          ...definition('northwind-orders-browser-sqlite'),
          request: {
            queryType: QueryType.SQL,
            text: `${sql['northwind-orders-browser-sqlite']}LIMIT 10`,
          } as ISqlQueryRequest,
        },
      }),
    ).rejects.toThrow(/admitted SQL/);
  });

  it('rejects an explicit different environment before executing the snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      executeBrowserShowcaseQuery(new BrowserSqliteQueryService(), {
        projectRef: { storeId: 'github.com', projectId: 'test' },
        queryId: 'demodb/northwind-orders-browser-sqlite',
        definition: definition('northwind-orders-browser-sqlite'),
        environment: 'QA',
      }),
    ).rejects.toThrow(/pinned browser SQLite runtime/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    '/assets/other.sqlite',
    '/assets/showcase/../showcase/northwind.sqlite',
    '/assets/showcase/northwind.sqlite?x=1',
    'http://127.0.0.1/private.sqlite',
  ])('rejects unadmitted local fixture URL %s before fetch', async (url) => {
    vi.stubGlobal('fetch', vi.fn());
    const def = definition('northwind-orders-browser-sqlite');
    await expect(
      new BrowserSqliteQueryService().execute(
        {
          projectRef: { storeId: 'github.com', projectId: 'test' },
          definition: def,
          target: { kind: 'browser-sqlite' },
          connection: {
            fixtureSha256:
              '279b34136771aee75d802094b3329515a2b01da65d2a20a4a9e3b58c29b4fd20',
            browserFixture: { url, bytes: 602112 },
          },
        },
        {
          projectRef: { storeId: 'github.com', projectId: 'test' },
          definition: def,
        },
      ),
    ).rejects.toThrow(/valid, bounded/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
