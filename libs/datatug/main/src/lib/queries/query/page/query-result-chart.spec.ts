import type { FederatedQueryResult } from '../../federated-query-executor';
import { prepareQueryResultChart, queryResultChartOptions } from './query-result-chart';

const sourceId = 'ovdb:demo/northwind/Orders';
function heldResult(overrides: Partial<FederatedQueryResult> = {}): FederatedQueryResult {
  return {
    recordset: {
      columns: [
        { name: 'country', type: 'string' },
        { name: 'orders', type: 'integer' },
      ],
      rows: [
        [{ type: 'string', value: 'France' }, { type: 'integer', value: '2' }],
        [{ type: 'string', value: 'Germany' }, { type: 'integer', value: '3' }],
      ],
    },
    limitations: [],
    bindingsApplied: [],
    provenance: { mode: 'live', source: 'Saved SQL result', observedAt: '2026-10-16T00:00:00Z' },
    truncated: false,
    totalRows: 2,
    hasMore: false,
    usedSourceIds: [sourceId],
    sourceRights: [{
      sourceId,
      source: { serverId: 'demo', databaseId: 'northwind', recordset: 'Orders' },
      declaredAt: { serverId: 'demo', databaseId: 'northwind', recordset: 'Orders' },
      declarationScope: 'recordset',
      declaration: { spdx: 'MIT' },
      evidenceOrigin: 'publisher-verified',
      pins: [],
      transformations: [],
    }],
    ...overrides,
  } as FederatedQueryResult;
}

describe('saved query result chart admission', () => {
  it('offers typed selectors and prepares bars from the held result', () => {
    const result = heldResult();
    expect(queryResultChartOptions(result, result.recordset, result.totalRows)).toEqual({
      categories: ['country'], measures: ['orders'],
    });
    expect(prepareQueryResultChart(result, result.recordset, {
      categoryColumn: 'country', measureColumn: 'orders', title: 'Orders',
    })).toMatchObject({ ok: true, bars: [
      { category: 'Germany', value: 3, sourceRow: 1 },
      { category: 'France', value: 2, sourceRow: 0 },
    ] });
  });

  it.each([
    ['truncated', { truncated: true }],
    ['next page', { hasMore: true }],
    ['reported total', { totalRows: 3 }],
    ['limitation', { limitations: [{ policy: 'restricted', rowsFiltered: true, hiddenColumns: [] }] }],
  ] as const)('refuses an incomplete or restricted %s result', (_name, override) => {
    const result = heldResult(override as Partial<FederatedQueryResult>);
    expect(queryResultChartOptions(result, result.recordset, result.totalRows).reason).toBeTruthy();
  });

  it('refuses missing and descriptive-only rights without hiding the rows', () => {
    const missing = heldResult({ usedSourceIds: undefined });
    expect(queryResultChartOptions(missing, missing.recordset, missing.totalRows).reason).toBe('DataTug can’t confirm that the data’s source allows charting it. The rows are still in the grid.');
    const legacy = heldResult({ sourceRights: heldResult().sourceRights?.map((right) => ({ ...right, evidenceOrigin: 'legacy-metadata' as const })) });
    expect(queryResultChartOptions(legacy, legacy.recordset, legacy.totalRows).reason).toBe('DataTug can’t confirm that the data’s source allows charting it. The rows are still in the grid.');
  });

  it('refuses incompatible columns and unsafe counts', () => {
    const incompatible = heldResult({ recordset: { columns: [{ name: 'count', type: 'integer' }], rows: [[{ type: 'integer', value: '1' }]] }, totalRows: 1 });
    expect(queryResultChartOptions(incompatible, incompatible.recordset, incompatible.totalRows).reason).toContain('string');
    const unsafe = heldResult({ recordset: { columns: heldResult().recordset.columns, rows: [[{ type: 'string', value: 'France' }, { type: 'integer', value: '9007199254740993' }]] }, totalRows: 1 });
    expect(prepareQueryResultChart(unsafe, unsafe.recordset, { categoryColumn: 'country', measureColumn: 'orders', title: 'Orders' })).toMatchObject({ ok: false });
  });
});
