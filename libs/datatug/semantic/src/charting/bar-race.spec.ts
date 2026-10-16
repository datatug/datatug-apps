import { describe, expect, it } from 'vitest';
import type { Result, TypedValue } from '../contract/types';
import { barRaceColor, prepareBarRace, type BarRaceSpec } from './bar-race';

const text = (value: string): TypedValue => ({ type: 'string', value });
const num = (value: number): TypedValue => ({ type: 'number', value });
const nil: TypedValue = { type: 'null', value: null };

// AdventureWorks territory/monthly-order result SHAPE. Values are test-only.
const result = (rows: readonly (readonly TypedValue[])[]): Pick<Result, 'recordset' | 'provenance'> => ({
  recordset: {
    columns: [{ name: 'month', type: 'string' }, { name: 'territory', type: 'string' }, { name: 'orders', type: 'number' }],
    rows,
  },
  provenance: { source: 'AdventureWorks', collection: 'SalesOrderHeader', queryId: 'territory-monthly-orders', mode: 'snapshot', observedAt: '2026-01-01T00:00:00Z', executionProfile: 'protected' },
});
const spec: BarRaceSpec = { kind: 'bar-race', periodColumn: 'month', categoryColumn: 'territory', measureColumn: 'orders', unit: 'orders', mode: 'period', topN: 2 };

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
    expect(prepared.data.dimensions.map((field) => [field.column, field.type])).toEqual([['month', 'string'], ['territory', 'string']]);
    expect(prepared.data.measures).toEqual([{ column: 'orders', type: 'number', unit: 'orders' }]);
  });

  it('fills missing periods with zero in period mode and carries totals in cumulative mode', () => {
    const input = result([
      [text('2025-01'), text('East'), num(3)], [text('2025-01'), text('West'), num(2)],
      [text('2025-02'), text('West'), num(4)], [text('2025-03'), text('East'), nil],
    ]);
    const period = prepareBarRace(input, spec);
    const cumulative = prepareBarRace(input, { ...spec, mode: 'cumulative' });
    expect(period.ok && period.data.frames[1].entries.map(({ category, value }) => [category, value])).toEqual([['West', 4], ['East', 0]]);
    expect(cumulative.ok && cumulative.data.frames[1].entries.map(({ category, value }) => [category, value])).toEqual([['West', 6], ['East', 3]]);
    expect(cumulative.ok && cumulative.data.frames[2].entries.map(({ category, value }) => [category, value])).toEqual([['West', 6], ['East', 3]]);
  });

  it('respects top N and safely returns empty frames for empty or null-dimension rows', () => {
    const top = prepareBarRace(result([[text('2025-01'), text('East'), num(1)], [text('2025-01'), text('West'), num(2)]]), { ...spec, topN: 1 });
    expect(top.ok && top.data.frames[0].entries.map((entry) => entry.category)).toEqual(['West']);
    const empty = prepareBarRace(result([[nil, text('West'), num(2)]]), spec);
    expect(empty.ok && empty.data.frames).toEqual([]);
  });

  it('explains incompatible shapes and values without fabricating a frame', () => {
    expect(prepareBarRace(result([]), { ...spec, measureColumn: 'revenue' })).toMatchObject({ ok: false, code: 'MISSING_COLUMN' });
    expect(prepareBarRace(result([[text('2025-01'), text('West'), text('many')]]), spec)).toMatchObject({ ok: false, code: 'INCOMPATIBLE_VALUE' });
    expect(prepareBarRace(result([[text('2025-01'), num(4), num(2)]]), spec)).toMatchObject({ ok: false, code: 'INCOMPATIBLE_VALUE' });
    expect(prepareBarRace(result([[text('2025-01'), text('West'), { type: 'integer', value: '9007199254740993' }]]), spec)).toMatchObject({ ok: false, code: 'INCOMPATIBLE_VALUE' });
    expect(prepareBarRace(result([[text('2025-01')]]), spec)).toMatchObject({ ok: false, code: 'INVALID_ROW' });
    expect(prepareBarRace(result([]), { ...spec, topN: 0 })).toMatchObject({ ok: false, code: 'INVALID_SPEC' });
  });
});
