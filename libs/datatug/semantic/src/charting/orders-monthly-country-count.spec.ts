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
const serverId = 'https://demodb.dev/ovdb';
const endpoint = `${serverId}/v1/databases/northwind/dtql`;
const databaseId = 'northwind';
const collectionId = 'Orders';
const sourceId = `ovdb:${encodeURIComponent(serverId)}/${databaseId}/${collectionId}`;
// Synthetic fixture: this presentation test exercises receipt consistency only.
// The dispatcher must hash live rows and verify the fetched publisher artifact.
const canonicalRowsSha256 = 'a'.repeat(64);
const providerSourceSha256 = '279b34136771aee75d802094b3329515a2b01da65d2a20a4a9e3b58c29b4fd20';
const rights = [{
  sourceId,
  source: { serverId, databaseId, recordset: collectionId },
  declaration: { spdx: 'MIT' },
  declarationScope: 'recordset' as const,
  declaredAt: { serverId, databaseId, recordset: collectionId },
  evidenceOrigin: 'publisher-verified' as const,
  pins: [{
    role: 'provider' as const,
    repository: 'https://github.com/demo-db/northwind',
    revision: 'de7f81c591abccc30fb9a0a58f44be9fd7265cd6',
    path: 'data-source/source.sqlite',
    sha256: providerSourceSha256,
    bytes: 602112,
  }],
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
    source: databaseId,
    collection: 'Orders',
    queryId: 'northwind-shipping-country-race',
    mode: 'live',
    observedAt: '2026-10-16T12:00:00Z',
    endpoint,
    databaseId,
  },
  publicApiReceipt: {
    endpoint,
    serverId,
    databaseId,
    logicalCollection: 'Orders',
    collectionId,
    queryId: 'northwind-shipping-country-race',
    rowsReturned: rows.length,
    observedAt: '2026-10-16T12:00:00Z',
    sourceVerification: { kind: 'publisher-digest', canonicalRowsSha256 },
    // Test-only receipt shape. The browser dispatcher must fetch and hash
    // the actual publisher artifact and full result before constructing it.
    rightsPublication: {
      url: 'https://raw.githubusercontent.com/demo-db/northwind/83ea600a7eae8b35ad33bf4c53bab6440d697850/artifacts/hosting-imports/source-rights.json',
      sha256: '50454d5f30db615178fcd0c6a846854f9434f4f93bb44835cc75fdad4af52e30',
      sourceId,
      providerSourceSha256,
      canonicalRowsSha256,
    },
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
    expect(transformed.data.recordset.sourceRowsReturned).toBe(830);
    expect(transformed.data.recordset.recordset.rows[0][0]).toEqual(text('2016-07'));
    expect(transformed.data.recordset.recordset.rows.at(-1)?.[0]).toEqual(text('2018-05'));
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
    expect(prepared.ok && prepared.data.sourceRowsReturned).toBe(830);
    expect(prepared.ok && prepared.data.lineage).toEqual(transformed.data.lineage);
  });

  it('fails closed for partial pages, filtered rows, missing rights and mismatched API receipts', () => {
    const row = [integer(1), text('2016-07-04'), text('France')];
    const valid = input([row]);
    expect(transformOrdersMonthlyCountryCount({ ...valid, complete: false }, spec)).toMatchObject({ ok: false, code: 'INCOMPLETE' });
    expect(transformOrdersMonthlyCountryCount({ ...valid, hasMore: true }, spec)).toMatchObject({ ok: false, code: 'INCOMPLETE' });
    expect(transformOrdersMonthlyCountryCount({ ...valid, limitations: [{ policy: 'restricted', rowsFiltered: true, hiddenColumns: [] }] }, spec)).toMatchObject({ ok: false, code: 'INCOMPLETE' });
    expect(transformOrdersMonthlyCountryCount({ ...valid, sourceRights: undefined }, spec)).toMatchObject({ ok: false, code: 'RIGHTS' });
    expect(transformOrdersMonthlyCountryCount({ ...valid, publicApiReceipt: { ...valid.publicApiReceipt, rowsReturned: 2 } }, spec)).toMatchObject({ ok: false, code: 'RIGHTS' });
    expect(transformOrdersMonthlyCountryCount({ ...valid, sourceRowsReturned: 830, publicApiReceipt: { ...valid.publicApiReceipt, rowsReturned: 830 } }, spec)).toMatchObject({ ok: false, code: 'RIGHTS' });
    expect(prepareBarRace({ ...valid, sourceRowsReturned: 830, publicApiReceipt: { ...valid.publicApiReceipt, rowsReturned: 830 } }, {
      kind: 'bar-race', periodColumn: 'OrderDate', categoryColumn: 'ShipCountry', measureColumn: 'OrderID',
      onDuplicate: 'reject', mode: 'period', topN: 21,
    })).toMatchObject({ ok: false, code: 'SOURCE_RIGHTS_UNAVAILABLE' });
    expect(transformOrdersMonthlyCountryCount({ ...valid, publicApiReceipt: { ...valid.publicApiReceipt, sourceVerification: { kind: 'publisher-digest', canonicalRowsSha256: '0'.repeat(64) } } }, spec)).toMatchObject({ ok: false, code: 'RIGHTS' });
    expect(transformOrdersMonthlyCountryCount({ ...valid, publicApiReceipt: { ...valid.publicApiReceipt, sourceVerification: undefined } as unknown as typeof valid.publicApiReceipt }, spec)).toMatchObject({ ok: false, code: 'RIGHTS' });
    expect(transformOrdersMonthlyCountryCount({ ...valid, publicApiReceipt: { ...valid.publicApiReceipt, serverId: 'https://another.example' } }, spec)).toMatchObject({ ok: false, code: 'RIGHTS' });
    expect(transformOrdersMonthlyCountryCount({ ...valid, publicApiReceipt: { ...valid.publicApiReceipt, rightsPublication: undefined } }, spec)).toMatchObject({ ok: false, code: 'RIGHTS' });
    expect(transformOrdersMonthlyCountryCount({ ...valid, sourceRights: [{ ...rights[0], evidenceOrigin: 'legacy-metadata' }] }, spec)).toMatchObject({ ok: false, code: 'RIGHTS' });
  });

  it('rejects duplicate OrderIDs and invalid calendar dates or countries', () => {
    const first = [integer(1), text('2016-07-04'), text('France')];
    expect(transformOrdersMonthlyCountryCount(input([first, first]), spec)).toMatchObject({ ok: false, code: 'ROW' });
    expect(transformOrdersMonthlyCountryCount(input([[integer(1), text('2016-02-30'), text('France')]]), spec)).toMatchObject({ ok: false, code: 'ROW' });
    expect(transformOrdersMonthlyCountryCount(input([[integer(1), text('2016-07-04'), text(' ')]]), spec)).toMatchObject({ ok: false, code: 'ROW' });
  });
});
