import { describe, expect, it } from 'vitest';
import type { TypedValue } from '../contract/types';
import { prepareBarRace, type BrowserPublicApiChartRecordset } from './bar-race';
import { transformOrdersMonthlyCountryCount, type OrdersMonthlyCountryCountSpec } from './orders-monthly-country-count';

const text = (value: string): TypedValue => ({ type: 'string', value });
const integer = (value: number): TypedValue => ({ type: 'integer', value: String(value) });
const spec: OrdersMonthlyCountryCountSpec = {
  name: 'orders-monthly-country-count',
  orderIdColumn: 'OrderID',
  dateColumn: 'OrderDate',
  countryColumn: 'ShipCountry',
};
const rights = [{
  sourceId: 'ovdb:northwind-postgresql/pg1_AAAACW5vcnRod2luZAAAAAZPcmRlcnM',
  source: { serverId: 'northwind-postgresql', databaseId: 'pg1_AAAACW5vcnRod2luZAAAAAZPcmRlcnM' },
  declaration: { spdx: 'MIT' },
  declarationScope: 'database' as const,
  declaredAt: { serverId: 'northwind-postgresql', databaseId: 'pg1_AAAACW5vcnRod2luZAAAAAZPcmRlcnM' },
  evidenceOrigin: 'publisher-verified' as const,
  pins: [],
  transformations: [],
}];
const input = (rows: readonly (readonly TypedValue[])[]): BrowserPublicApiChartRecordset => ({
  runtime: 'browser-public-api',
  complete: true,
  hasMore: false,
  truncated: false,
  recordset: {
    columns: [
      { name: 'OrderID', type: 'integer' },
      { name: 'OrderDate', type: 'string' },
      { name: 'ShipCountry', type: 'string' },
    ],
    rows,
  },
  provenance: {
    source: 'northwind-postgresql',
    collection: 'Orders',
    queryId: 'northwind-shipping-country-race',
    mode: 'live',
    observedAt: '2026-10-16T12:00:00Z',
    endpoint: 'https://northwind-postgresql.demodb.dev/dtql',
    databaseId: 'pg1_AAAACW5vcnRod2luZAAAAAZPcmRlcnM',
  },
  publicApiReceipt: {
    endpoint: 'https://northwind-postgresql.demodb.dev/dtql',
    databaseId: 'pg1_AAAACW5vcnRod2luZAAAAAZPcmRlcnM',
    collection: 'Orders',
    queryId: 'northwind-shipping-country-race',
    rowsReturned: rows.length,
    observedAt: '2026-10-16T12:00:00Z',
  },
  limitations: [],
  bindingsApplied: [],
  sourceRights: rights,
  usedSourceIds: [rights[0].sourceId],
});

describe('transformOrdersMonthlyCountryCount', () => {
  it('derives the complete 23-month, 830-order race shape with explicit country zeros and lineage', () => {
    const rows: TypedValue[][] = [];
    for (let index = 0; index < 830; index++) {
      const monthIndex = index % 23;
      const year = 2016 + Math.floor((6 + monthIndex) / 12);
      const month = (6 + monthIndex) % 12 + 1;
      rows.push([integer(10248 + index), text(`${year}-${String(month).padStart(2, '0')}-04`), text(`Country ${index % 21}`)]);
    }
    const transformed = transformOrdersMonthlyCountryCount(input(rows), spec);
    expect(transformed.ok).toBe(true);
    if (!transformed.ok) return;
    expect([transformed.data.orderCount, transformed.data.months, transformed.data.countries]).toEqual([830, 23, 21]);
    expect(transformed.data.recordset.recordset.rows).toHaveLength(23 * 21);
    const total = transformed.data.recordset.recordset.rows.reduce((sum, row) => sum + (row[2].type === 'number' ? row[2].value : 0), 0);
    expect(total).toBe(830);
    expect(transformed.data.lineage).toEqual([
      { output: 'period', input: 'Orders.OrderDate', operation: 'calendar-month' },
      { output: 'category', input: 'Orders.ShipCountry', operation: 'identity' },
      { output: 'value', input: 'Orders.OrderID', operation: 'distinct-count' },
    ]);
    expect(transformed.data.recordset.runtime).toBe('browser-public-api');
    expect(transformed.data.recordset.provenance).toEqual(input(rows).provenance);
    const prepared = prepareBarRace(transformed.data.recordset, {
      kind: 'bar-race', periodColumn: 'period', categoryColumn: 'category', measureColumn: 'value',
      unit: 'orders', onDuplicate: 'reject', mode: 'period', topN: 21,
    });
    expect(prepared.ok && prepared.data.frames).toHaveLength(23);
    expect(prepared.ok && prepared.data.runtime).toBe('browser-public-api');
    expect(prepared.ok && prepared.data.publicApiReceipt?.rowsReturned).toBe(830);
  });

  it('fails closed for partial pages, filtered rows, missing rights and mismatched API receipts', () => {
    const row = [integer(1), text('2016-07-04'), text('France')];
    const valid = input([row]);
    expect(transformOrdersMonthlyCountryCount({ ...valid, complete: false }, spec)).toMatchObject({ ok: false, code: 'INCOMPLETE' });
    expect(transformOrdersMonthlyCountryCount({ ...valid, hasMore: true }, spec)).toMatchObject({ ok: false, code: 'INCOMPLETE' });
    expect(transformOrdersMonthlyCountryCount({ ...valid, limitations: [{ policy: 'restricted', rowsFiltered: true, hiddenColumns: [] }] }, spec)).toMatchObject({ ok: false, code: 'INCOMPLETE' });
    expect(transformOrdersMonthlyCountryCount({ ...valid, sourceRights: undefined }, spec)).toMatchObject({ ok: false, code: 'RIGHTS' });
    expect(transformOrdersMonthlyCountryCount({ ...valid, publicApiReceipt: { ...valid.publicApiReceipt, rowsReturned: 2 } }, spec)).toMatchObject({ ok: false, code: 'INCOMPLETE' });
  });

  it('rejects duplicate OrderIDs and invalid calendar dates or countries', () => {
    const first = [integer(1), text('2016-07-04'), text('France')];
    expect(transformOrdersMonthlyCountryCount(input([first, first]), spec)).toMatchObject({ ok: false, code: 'ROW' });
    expect(transformOrdersMonthlyCountryCount(input([[integer(1), text('2016-02-30'), text('France')]]), spec)).toMatchObject({ ok: false, code: 'ROW' });
    expect(transformOrdersMonthlyCountryCount(input([[integer(1), text('2016-07-04'), text(' ')]]), spec)).toMatchObject({ ok: false, code: 'ROW' });
  });
});
