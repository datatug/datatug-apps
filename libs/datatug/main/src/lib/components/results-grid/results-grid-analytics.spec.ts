import type {
  ValueGetterParams,
  ValueFormatterParams,
} from 'ag-grid-community';
import { analyticsColumns, analyticsNumber } from './results-grid-analytics';
import {
  resultColumnDef,
  RESULTS_GRID_COLUMN_TYPES,
  compareNumberCells,
} from './results-grid-columns';

const quantity = resultColumnDef({ name: 'Amount', type: 'decimal' }, 'amount');
const rows = (...values: (string | null)[]) =>
  values.map((amount) => ({ amount }));

describe('raw-preserving Enterprise analytics', () => {
  it.each([
    '0.1',
    '2.50',
    '-0.25',
    '1e-7',
    '9007199254740991',
    '-9007199254740991',
    '0',
    '-0',
  ])('projects round-tripping %s', (raw) => {
    expect(analyticsNumber(raw)).toBe(Number(raw));
  });
  it.each([
    '9007199254740993',
    '-9007199254740992',
    '0.1000000000000000001',
    '1.0000000000000001',
    '1e100',
    '1e309',
    'NaN',
    'Infinity',
    '',
    ' ',
    '0x10',
  ])('rejects lossy/nonfinite %s', (raw) => {
    expect(analyticsNumber(raw)).toBeUndefined();
  });
  it('enables the whole safe column, preserves original decimal/null display, filtering, copying and comparison', () => {
    const data = rows('2.50', '0.1', null);
    const { columns, excluded } = analyticsColumns([quantity], data);
    const column = columns[0];
    expect(column).toMatchObject({
      chartDataType: 'series',
      cellDataType: 'number',
      enableValue: true,
    });
    expect(excluded).toEqual([]);
    const get = column.valueGetter as (p: ValueGetterParams) => unknown;
    expect(get({ data: data[0] } as ValueGetterParams)).toBe(2.5);
    expect(get({ data: data[2] } as ValueGetterParams)).toBeNull();
    const format = column.valueFormatter as (p: ValueFormatterParams) => string;
    expect(
      format({
        data: data[0],
        colDef: column,
        value: 2.5,
      } as ValueFormatterParams),
    ).toMatch(/2[.,]50/);
    expect(
      format({ colDef: column, value: 2.6 } as ValueFormatterParams),
    ).toMatch(/2[.,]6/);
    expect(data).toEqual(rows('2.50', '0.1', null));
    expect(compareNumberCells(2.5 as never, 3 as never)).toBeLessThan(0);
    const filter = RESULTS_GRID_COLUMN_TYPES['dtNumber'].filterValueGetter as (
      p: unknown,
    ) => unknown;
    expect(filter({ data: data[0], colDef: column })).toBe(2.5);
  });
  it('one unsafe value excludes the entire column, including safe rows, from measures and uses exact text filtering', () => {
    const { columns, excluded } = analyticsColumns(
      [quantity],
      rows('2.50', '9007199254740993'),
    );
    expect(excluded).toEqual(['Amount']);
    expect(columns[0]).toMatchObject({
      enableValue: false,
      chartDataType: 'excluded',
      filter: 'agTextColumnFilter',
    });
    expect(columns[0].valueGetter).toBeUndefined();
    const get = columns[0].filterValueGetter as (p: unknown) => unknown;
    expect(get({ data: { amount: '9007199254740993' } })).toBe(
      '9007199254740993',
    );
  });
  it('does not offer empty/null-only columns as measures or label them precision failures', () => {
    expect(
      analyticsColumns([quantity], rows(null)).columns[0].enableValue,
    ).toBe(false);
    expect(analyticsColumns([quantity], []).excluded).toEqual([]);
  });
  it('keeps identifiers as categories, hidden identities excluded and never silently rounds their filters', () => {
    const id = resultColumnDef(
      { name: 'InvoiceId', type: 'integer' },
      'amount',
    );
    expect(analyticsColumns([id], rows('42')).columns[0]).toMatchObject({
      enableValue: false,
      chartDataType: 'category',
    });
    expect(
      analyticsColumns([id], rows('9007199254740993')).columns[0].filter,
    ).toBe('agTextColumnFilter');
    const hidden = resultColumnDef({ name: '$key', type: 'string' }, 'key');
    expect(
      analyticsColumns([hidden], [{ key: 'secret' }]).columns[0].chartDataType,
    ).toBe('excluded');
  });
  it('retains native approximate aggregation with bounded leaves rather than promising exact totals', () => {
    const max = String(Number.MAX_SAFE_INTEGER);
    const { columns } = analyticsColumns([quantity], rows(max, max));
    expect(columns[0].allowedAggFuncs).toContain('sum');
    expect(Number.isFinite(Number(max) * 2)).toBe(true);
    expect(0.1 + 0.2).not.toBe(0.3);
    // Even the maximum JS array length of admitted magnitudes cannot reach floating-point overflow.
    expect(Number.isFinite(Number.MAX_SAFE_INTEGER * (2 ** 32 - 1))).toBe(true);
  });
});
