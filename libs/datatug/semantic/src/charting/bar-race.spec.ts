import { describe, expect, it } from 'vitest';
import type { TypedValue } from '../contract/types';
import { barRaceColor, prepareBarRace, type BarRaceSpec, type ServerChartRecordset } from './bar-race';

const text = (value: string): TypedValue => ({ type: 'string', value });
const num = (value: number): TypedValue => ({ type: 'number', value });
const nil: TypedValue = { type: 'null', value: null };

// AdventureWorks territory/monthly-order result SHAPE. Values are test-only.
const result = (rows: readonly (readonly TypedValue[])[]): ServerChartRecordset => ({
  runtime: 'server',
  complete: true,
  hasMore: false,
  recordset: {
    columns: [{ name: 'month', type: 'string' }, { name: 'territory', type: 'string' }, { name: 'orders', type: 'number' }],
    rows,
  },
  provenance: { source: 'AdventureWorks', collection: 'SalesOrderHeader', queryId: 'territory-monthly-orders', mode: 'snapshot', observedAt: '2026-01-01T00:00:00Z', executionProfile: 'protected' },
  limitations: [{ policy: 'bounded-read', rowsFiltered: false, hiddenColumns: [] }],
  bindingsApplied: [{ parameterId: 'TerritoryId', value: num(1), origin: 'manual', originEvidence: 'client-reported' }],
  truncated: false,
  execution: { storeId: 'github.com', projectId: 'demo', executionId: 'run-1' },
  sourceRights: [{ sourceId: 'ovdb:demo/adventureworks', source: { serverId: 'demo', databaseId: 'adventureworks' }, declaration: { spdx: 'CC0-1.0' }, declarationScope: 'database', declaredAt: { serverId: 'demo', databaseId: 'adventureworks' }, evidenceOrigin: 'publisher-verified', pins: [], transformations: [] }],
  usedSourceIds: ['ovdb:demo/adventureworks'],
});
const spec: BarRaceSpec = { kind: 'bar-race', periodColumn: 'month', categoryColumn: 'territory', measureColumn: 'orders', unit: 'orders', onDuplicate: 'sum', mode: 'period', topN: 2 };

describe('prepareBarRace', () => {
  it('sorts periods, aggregates duplicate pairs, breaks ties by category and keeps category colors stable', () => {
    const prepared = prepareBarRace(result([
      [text('2025-02'), text('West'), num(4)], [text('2025-01'), text('West'), num(2)],
      [text('2025-01'), text('East'), num(3)], [text('2025-01'), text('West'), num(1)],
      [text('2025-02'), text('East'), num(5)],
    ]), spec);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.data.frames.map((frame) => frame.period)).toEqual(['2025-01', '2025-02']);
    expect(prepared.data.frames[0].entries.map(({ category, value }) => [category, value])).toEqual([['East', 3], ['West', 3]]);
    expect(prepared.data.frames[1].entries[1].color).toBe(barRaceColor('West'));
    expect(prepared.data.source.source).toBe('AdventureWorks');
    expect(prepared.data.source.mode).toBe('snapshot');
    expect(prepared.data.source.executionProfile).toBe('protected');
    expect(prepared.data.limitations).toEqual(result([]).limitations);
    expect(prepared.data.bindingsApplied).toEqual(result([]).bindingsApplied);
    expect(prepared.data.truncated).toBe(false);
    expect(prepared.data.execution?.executionId).toBe('run-1');
    expect(prepared.data.sourceRights?.[0].sourceId).toBe('ovdb:demo/adventureworks');
    expect(prepared.data.usedSourceIds).toEqual(['ovdb:demo/adventureworks']);
    expect(prepared.data.dimensions.map((field) => [field.column, field.type])).toEqual([['month', 'string'], ['territory', 'string']]);
    expect(prepared.data.measures).toEqual([{ column: 'orders', type: 'number', unit: 'orders' }]);
  });

  it('fills missing periods with zero in period mode and carries totals in cumulative mode', () => {
    const input = result([
      [text('2025-01'), text('East'), num(3)], [text('2025-01'), text('West'), num(2)],
      [text('2025-02'), text('West'), num(4)], [text('2025-03'), text('East'), num(0)],
    ]);
    const period = prepareBarRace(input, spec);
    const cumulative = prepareBarRace(input, { ...spec, mode: 'cumulative' });
    expect(period.ok && period.data.frames[1].entries.map(({ category, value }) => [category, value])).toEqual([['West', 4], ['East', 0]]);
    expect(cumulative.ok && cumulative.data.frames[1].entries.map(({ category, value }) => [category, value])).toEqual([['West', 6], ['East', 3]]);
    expect(cumulative.ok && cumulative.data.frames[2].entries.map(({ category, value }) => [category, value])).toEqual([['West', 6], ['East', 3]]);
  });

  it('creates a zero-valued frame for globally missing calendar months', () => {
    const input = result([
      [text('2024-12'), text('East'), num(3)],
      [text('2025-02'), text('West'), num(4)],
    ]);
    const period = prepareBarRace(input, spec);
    const cumulative = prepareBarRace(input, { ...spec, mode: 'cumulative' });
    expect(period.ok && period.data.frames.map((frame) => frame.period)).toEqual(['2024-12', '2025-01', '2025-02']);
    expect(period.ok && period.data.frames[1].entries.map(({ category, value }) => [category, value])).toEqual([['East', 0]]);
    expect(cumulative.ok && cumulative.data.frames[1].entries.map(({ category, value }) => [category, value])).toEqual([['East', 3]]);
    expect(cumulative.ok && cumulative.data.source).toEqual(input.provenance);
    expect(cumulative.ok && cumulative.data.limitations).toEqual(input.limitations);
    expect(cumulative.ok && cumulative.data.usedSourceIds).toEqual(input.usedSourceIds);
  });

  it('bounds calendar expansion even when source rows are sparse', () => {
    const distant = result([[text('2000-01'), text('East'), num(1)], [text('2025-01'), text('East'), num(1)]]);
    expect(prepareBarRace(distant, spec)).toMatchObject({ ok: false, code: 'UNSUPPORTED_PERIOD' });
  });

  it('respects top N and returns empty frames only for an empty result', () => {
    const top = prepareBarRace(result([[text('2025-01'), text('East'), num(1)], [text('2025-01'), text('West'), num(2)]]), { ...spec, topN: 1 });
    expect(top.ok && top.data.frames[0].entries.map((entry) => entry.category)).toEqual(['West']);
    const empty = prepareBarRace(result([]), spec);
    expect(empty.ok && empty.data.frames).toEqual([]);
  });

  it('rejects incomplete or truncated input before charting', () => {
    const input = result([[text('2025-01'), text('West'), num(1)]]);
    expect(prepareBarRace({ ...input, complete: false }, spec)).toMatchObject({ ok: false, code: 'INCOMPLETE' });
    expect(prepareBarRace({ ...input, hasMore: true }, spec)).toMatchObject({ ok: false, code: 'INCOMPLETE' });
    expect(prepareBarRace({ ...input, truncated: true }, spec)).toMatchObject({ ok: false, code: 'INCOMPLETE' });
    expect(prepareBarRace({ ...input, limitations: [{ policy: 'filtered', rowsFiltered: true, hiddenColumns: [] }] }, spec)).toMatchObject({ ok: false, code: 'INCOMPLETE' });
    expect(prepareBarRace({ ...input, sourceRights: undefined }, spec)).toMatchObject({ ok: false, code: 'SOURCE_RIGHTS_UNAVAILABLE' });
  });

  it('explains incompatible shapes and values without fabricating a frame', () => {
    expect(prepareBarRace(result([]), { ...spec, measureColumn: 'revenue' })).toMatchObject({ ok: false, code: 'MISSING_COLUMN' });
    expect(prepareBarRace(result([[text('2025-01'), text('West'), text('many')]]), spec)).toMatchObject({ ok: false, code: 'INCOMPATIBLE_VALUE' });
    expect(prepareBarRace(result([[text('2025-01'), num(4), num(2)]]), spec)).toMatchObject({ ok: false, code: 'INCOMPATIBLE_VALUE' });
    expect(prepareBarRace(result([[text('2025-01'), text('West'), { type: 'integer', value: '9007199254740993' }]]), spec)).toMatchObject({ ok: false, code: 'PRECISION_UNSUPPORTED' });
    expect(prepareBarRace(result([[text('2025-01')]]), spec)).toMatchObject({ ok: false, code: 'INVALID_ROW' });
    expect(prepareBarRace(result([]), { ...spec, topN: 0 })).toMatchObject({ ok: false, code: 'INVALID_SPEC' });
    const wrongCategory = result([]);
    expect(prepareBarRace({ ...wrongCategory, recordset: { ...wrongCategory.recordset, columns: [
      { name: 'month', type: 'string' }, { name: 'territory', type: 'integer' }, { name: 'orders', type: 'number' },
    ] } }, spec)).toMatchObject({ ok: false, code: 'INCOMPATIBLE_VALUE' });
    expect(prepareBarRace({ ...wrongCategory, recordset: { ...wrongCategory.recordset, columns: [
      { name: 'month', type: 'string' }, { name: 'territory', type: 'string' }, { name: 'orders', type: 'decimal' },
    ] } }, spec)).toMatchObject({ ok: false, code: 'INCOMPATIBLE_VALUE' });
  });

  it('rejects nulls, decimals, fractional numbers and unsafe aggregation explicitly', () => {
    expect(prepareBarRace(result([[nil, text('West'), num(2)]]), spec)).toMatchObject({ ok: false, code: 'NULL_VALUE' });
    expect(prepareBarRace(result([[text('2025-01'), text('West'), nil]]), spec)).toMatchObject({ ok: false, code: 'NULL_VALUE' });
    expect(prepareBarRace(result([[text('2025-01'), text('West'), { type: 'decimal', value: '1.25' }]]), spec)).toMatchObject({ ok: false, code: 'PRECISION_UNSUPPORTED' });
    expect(prepareBarRace(result([[text('2025-01'), text('West'), num(1.25)]]), spec)).toMatchObject({ ok: false, code: 'PRECISION_UNSUPPORTED' });
    expect(prepareBarRace(result([[text('2025-01'), text('West'), num(Number.MAX_SAFE_INTEGER)], [text('2025-01'), text('West'), num(1)]]), spec)).toMatchObject({ ok: false, code: 'PRECISION_UNSUPPORTED' });
  });

  it('requires a declared duplicate policy and can reject duplicate category-period rows', () => {
    const duplicate = result([[text('2025-01'), text('West'), num(2)], [text('2025-01'), text('West'), num(3)]]);
    expect(prepareBarRace(duplicate, { ...spec, onDuplicate: 'reject' })).toMatchObject({ ok: false, code: 'DUPLICATE_CATEGORY_PERIOD' });
    expect(prepareBarRace(duplicate, { ...spec, onDuplicate: undefined as unknown as 'sum' })).toMatchObject({ ok: false, code: 'INVALID_SPEC' });
    const summed = prepareBarRace(duplicate, spec);
    expect(summed.ok && summed.data.frames[0].entries[0].value).toBe(5);
  });

  it('requires canonical month strings until the spec declares a date grain', () => {
    expect(prepareBarRace(result([[text('Feb 2025'), text('West'), num(1)]]), spec)).toMatchObject({ ok: false, code: 'UNSUPPORTED_PERIOD' });
    expect(prepareBarRace(result([[text('2025-13'), text('West'), num(1)]]), spec)).toMatchObject({ ok: false, code: 'UNSUPPORTED_PERIOD' });
    expect(prepareBarRace(result([[{ type: 'date', value: '2025-02-31' }, text('West'), num(1)]]), spec)).toMatchObject({ ok: false, code: 'UNSUPPORTED_PERIOD' });
    expect(prepareBarRace(result([[text('2025-01'), text('West'), num(1)], [{ type: 'date', value: '2025-02-01' }, text('West'), num(2)]]), spec)).toMatchObject({ ok: false, code: 'UNSUPPORTED_PERIOD' });
    const dates = result([[{ type: 'date', value: '2025-01-01' }, text('West'), num(1)], [{ type: 'date', value: '2025-03-01' }, text('West'), num(2)]]);
    expect(prepareBarRace(dates, spec)).toMatchObject({ ok: false, code: 'UNSUPPORTED_PERIOD' });
    expect(prepareBarRace({ ...dates, recordset: { ...dates.recordset, columns: [
      { name: 'month', type: 'date' }, { name: 'territory', type: 'string' }, { name: 'orders', type: 'number' },
    ] } }, spec)).toMatchObject({ ok: false, code: 'UNSUPPORTED_PERIOD' });
  });
});
