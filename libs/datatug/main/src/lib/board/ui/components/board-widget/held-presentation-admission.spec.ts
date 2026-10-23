import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  admitComparisonChart,
  completeOrdersForFilter,
  filterHeldOrders,
} from './held-presentation-admission';
import {
  QueryType,
  type ITextQueryRequest,
  type IQueryDef,
} from '../../../../models/definition/query-def';
import {
  executeSavedPublicChartQuery,
  PUBLIC_ORDERS_QUERY_ID,
} from '../../../../queries/public-data/public-chart-query';
import { NORTHWIND_ORDERS_PIN } from '../../../../queries/public-data/public-orders-admission';
import type { FederatedQueryResult } from '../../../../queries/federated-query-executor';
const definition: IQueryDef = {
  id: 'customer-country-comparison-server',
  title: 'Comparison',
  request: { queryType: QueryType.TugQL, text: '' } as ITextQueryRequest,
  federation: {
    ovdbBaseUrl: 'https://cloud.openvaultdb.com',
    tables: [
      { database: 'northwind', name: 'Customers', fields: [] },
      { database: 'chinook', name: 'Customer', fields: [] },
    ],
  },
};
const result = (): FederatedQueryResult => ({
  recordset: {
    columns: [
      { name: 'country', type: 'string' },
      { name: 'northwindCustomers', type: 'integer' },
      { name: 'chinookCustomers', type: 'integer' },
    ],
    rows: Array.from({ length: 17 }, (_, i) => [
      { type: 'string', value: `country-${i}` },
      { type: 'integer', value: '3' },
      { type: 'integer', value: '8' },
    ]),
  },
  totalRows: 17,
  hasMore: false,
  truncated: false,
  nativeDirect: true,
  ordinaryComplete: true,
  ordinarySources: [
    { database: 'northwind', collection: 'Customers' },
    { database: 'chinook', collection: 'Customer' },
  ],
  limitations: [],
  bindingsApplied: [],
  provenance: {
    source: 'https://cloud.openvaultdb.com/v1/tugql (direct OVDB)',
    mode: 'live',
    observedAt: '2026-10-19T00:00:00Z',
  },
});
describe('held presentation admission', () => {
  it('admits genuine ordinary root evidence without inventing profile, collection, rights or execution', () => {
    const held = result(),
      before = JSON.stringify(held);
    expect(() => admitComparisonChart(held, definition)).not.toThrow();
    expect(JSON.stringify(held)).toBe(before);
  });
  it('refuses incomplete, paged, missing/extra source and mismatched materialized counts', () => {
    for (const patch of [
      { nativeDirect: false },
      { ordinaryComplete: false },
      { hasMore: true },
      { truncated: true },
      { totalRows: 16 },
      { ordinarySources: [{ database: 'northwind', collection: 'Customers' }] },
      {
        ordinarySources: [
          ...(result().ordinarySources ?? []),
          { database: 'third', collection: 'Data' },
        ],
      },
      { recordset: { columns: [], rows: [] } },
    ]) {
      expect(() =>
        admitComparisonChart(
          { ...result(), ...patch } as FederatedQueryResult,
          definition,
        ),
      ).toThrow();
    }
  });
  it('keeps showcase count admission strict even though generic series allow fractional and signed numbers', () => {
    for (const value of ['-1', '2.5']) {
      const held = result();
      const rows = held.recordset.rows.map((row) => [...row]);
      rows[0][1] = { type: 'integer', value };
      expect(() =>
        admitComparisonChart(
          { ...held, recordset: { ...held.recordset, rows } },
          definition,
        ),
      ).toThrow();
    }
  });
  it('only filters complete publisher-verified Orders; altered proof flags/receipts cannot claim a full-set count', async () => {
    const fixture = (name: string) =>
      readFileSync(
        resolve(process.cwd(), 'apps/datatug-app/e2e/fixtures', name),
        'utf8',
      );
    const records = JSON.parse(
      fixture('northwind-orders-records.json'),
    ) as Record<string, unknown>[];
    const held = await executeSavedPublicChartQuery(
      PUBLIC_ORDERS_QUERY_ID,
      {
        id: 'northwind-orders-full-sqlite',
        title: 'Orders',
        connectionId: 'northwind-sqlite',
        request: {
          queryType: QueryType.TugQL,
          text: fixture('northwind-orders-query.tugql'),
        } as ITextQueryRequest,
      },
      {
        fetch: async (input) =>
          new Response(
            String(input) === NORTHWIND_ORDERS_PIN.publicationUrl
              ? fixture('northwind-orders-rights.json')
              : JSON.stringify({
                  complete: true,
                  columns: NORTHWIND_ORDERS_PIN.fields,
                  records: records.map((data) => ({ data })),
                }),
          ),
      },
    );
    expect(
      completeOrdersForFilter(held, PUBLIC_ORDERS_QUERY_ID, 'ShipCountry'),
    ).toBe(true);
    const filter = { selectionId: 'country', column: 'ShipCountry' };
    const before = JSON.stringify(held);
    const selected = filterHeldOrders(
      held,
      PUBLIC_ORDERS_QUERY_ID,
      filter,
      'Canada',
    );
    const countryIndex = held.recordset.columns.findIndex(
      (column) => column.name === 'ShipCountry',
    );
    expect(selected.count).toBe(
      records.filter((row) => row['ShipCountry'] === 'Canada').length,
    );
    expect(selected.result?.recordset.rows).toEqual(
      held.recordset.rows.filter((row) => row[countryIndex].value === 'Canada'),
    );
    expect(
      filterHeldOrders(held, PUBLIC_ORDERS_QUERY_ID, filter, 'United Kingdom')
        .count,
    ).toBe(0);
    expect(
      filterHeldOrders(held, PUBLIC_ORDERS_QUERY_ID, filter, undefined).result,
    ).toBe(held);
    expect(
      filterHeldOrders(held, PUBLIC_ORDERS_QUERY_ID, undefined, 'Canada')
        .result,
    ).toBe(held);
    expect(JSON.stringify(held)).toBe(before);
    expect(
      completeOrdersForFilter(held, PUBLIC_ORDERS_QUERY_ID, 'CustomerID'),
    ).toBe(false);
    for (const patch of [
      { complete: false },
      { hasMore: true },
      { truncated: true },
      { recordset: { ...held.recordset, rows: held.recordset.rows.slice(1) } },
      { publicApiReceipt: { ...held.publicApiReceipt, rowsReturned: 829 } },
      {
        publicApiReceipt: {
          ...held.publicApiReceipt,
          sourceVerification: {
            kind: 'publisher-digest' as const,
            canonicalRowsSha256: 'a'.repeat(64),
          },
        },
      },
    ]) {
      expect(
        completeOrdersForFilter(
          { ...held, ...patch },
          PUBLIC_ORDERS_QUERY_ID,
          'ShipCountry',
        ),
      ).toBe(false);
      const refused = filterHeldOrders(
        { ...held, ...patch },
        PUBLIC_ORDERS_QUERY_ID,
        filter,
        'Canada',
      );
      expect(refused.result).toBeUndefined();
      expect(refused.error).toContain('filtering is unavailable');
    }
  });
});
