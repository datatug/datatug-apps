import { describe, expect, it } from 'vitest';
import type { ColDef } from 'ag-grid-community';
import {
  RESULTS_GRID_COLUMN_TYPES,
  ROW_NUMBER_COLUMN,
  cellDate,
  cellNumber,
  columnKind,
  compactJson,
  compareNumberCells,
  formatCell,
  gridCell,
  resultColumnDef,
} from './results-grid-columns';

describe('columnKind', () => {
  it.each([
    ['integer', 'number'],
    ['decimal', 'number'],
    ['number', 'number'],
    ['bigint', 'number'],
    ['boolean', 'boolean'],
    ['date', 'date'],
    ['datetime', 'datetime'],
    ['timestamp', 'datetime'],
    ['json', 'json'],
    ['string', 'text'],
    ['', 'text'],
    ['mystery', 'text'],
  ])('%s is %s', (type, kind) => {
    expect(columnKind(type)).toBe(kind);
  });
  it('takes a missing type as text', () => {
    expect(columnKind(undefined)).toBe('text');
    expect(columnKind(null)).toBe('text');
  });
});

describe('gridCell', () => {
  it('keeps every digit of an integer and takes null as null', () => {
    expect(gridCell({ type: 'integer', value: '9007199254740993' })).toBe('9007199254740993');
    expect(gridCell({ type: 'null', value: null })).toBeNull();
    expect(gridCell(undefined)).toBeNull();
    expect(gridCell({ type: 'boolean', value: false })).toBe('false');
    expect(gridCell({ type: 'decimal', value: '2.50' })).toBe('2.50');
  });
});

describe('number cells', () => {
  it('reads finite numbers only', () => {
    expect(cellNumber('12.5')).toBe(12.5);
    expect(cellNumber('')).toBeUndefined();
    expect(cellNumber(null)).toBeUndefined();
    expect(cellNumber('abc')).toBeUndefined();
  });
  it('compares numerically, wide integers exactly, empty values first', () => {
    expect(compareNumberCells('9', '10')).toBeLessThan(0);
    expect(compareNumberCells('9007199254740993', '9007199254740992')).toBeGreaterThan(0);
    expect(compareNumberCells('9007199254740993', '9007199254740993')).toBe(0);
    expect(compareNumberCells('2.5', '2.25')).toBeGreaterThan(0);
    expect(compareNumberCells('1e400', '5')).toBeLessThan(1);
    expect(compareNumberCells(null, '1')).toBeLessThan(0);
    expect(compareNumberCells('1', null)).toBeGreaterThan(0);
    expect(compareNumberCells(null, null)).toBe(0);
  });
});

describe('formatCell', () => {
  it('shows a NULL as null, whatever the kind', () => {
    for (const kind of ['number', 'date', 'boolean', 'json', 'text'] as const) {
      expect(formatCell(null, kind)).toBe('null');
    }
    expect(formatCell('', 'text')).toBe('');
  });
  it('shows dates in the locale, a bare date without a timezone shift', () => {
    expect(formatCell('2024-03-05', 'date')).toBe(new Date(2024, 2, 5).toLocaleDateString());
    expect(formatCell('2024-03-05T10:20:30Z', 'datetime')).toBe(
      new Date('2024-03-05T10:20:30Z').toLocaleString(),
    );
    expect(formatCell('not a date', 'date')).toBe('not a date');
    expect(formatCell('10:20:30', 'datetime')).toBe('10:20:30');
  });
  it('shows booleans as check marks', () => {
    expect(formatCell('true', 'boolean')).toBe('✓');
    expect(formatCell('false', 'boolean')).toBe('✗');
    expect(formatCell('maybe', 'boolean')).toBe('maybe');
  });
  it('shows JSON compactly and leaves other text and numbers alone', () => {
    expect(formatCell('{ "a": 1,\n "b": [1, 2] }', 'json')).toBe('{"a":1,"b":[1,2]}');
    expect(formatCell('{ not json', 'text')).toBe('{ not json');
    expect(formatCell('plain', 'text')).toBe('plain');
    expect(formatCell('0042', 'number')).toBe('0042');
    expect(compactJson('[1, 2]')).toBe('[1,2]');
  });
  it('reads dates', () => {
    expect(cellDate('2024-03-05')?.getDate()).toBe(5);
    expect(cellDate('')).toBeUndefined();
    expect(cellDate(null)).toBeUndefined();
    expect(cellDate('x')).toBeUndefined();
  });
});

describe('resultColumnDef', () => {
  const def = (type: string): ColDef =>
    resultColumnDef({ name: 'Col', type }, 'c0') as ColDef;

  it('types, names and bounds the column', () => {
    const d = def('integer');
    expect(d).toMatchObject({
      colId: 'c0',
      field: 'c0',
      headerName: 'Col',
      type: 'dtNumber',
      sortable: true,
      minWidth: 90,
      maxWidth: 480,
    });
  });
  it('aligns numbers to the right and picks the filter of the kind', () => {
    expect(RESULTS_GRID_COLUMN_TYPES['dtNumber']).toMatchObject({
      cellClass: 'ag-right-aligned-cell',
      headerClass: 'ag-right-aligned-header',
      filter: 'agNumberColumnFilter',
    });
    expect(def('decimal').type).toBe('dtNumber');
    expect(def('date').type).toBe('dtDate');
    expect(def('datetime').type).toBe('dtDate');
    expect(RESULTS_GRID_COLUMN_TYPES['dtDate']['filter']).toBe('agDateColumnFilter');
    expect(def('boolean').type).toBe('dtBoolean');
    expect(def('json').type).toBe('dtJson');
    expect(def('string').type).toBe('dtText');
    expect(RESULTS_GRID_COLUMN_TYPES['dtText']['filter']).toBe('agTextColumnFilter');
  });
  it('formats, tips and dims through the column', () => {
    const d = def('boolean');
    const fmt = d.valueFormatter as (p: { value: unknown }) => string;
    expect(fmt({ value: 'true' })).toBe('✓');
    expect(fmt({ value: null })).toBe('null');
    const tip = d.tooltipValueGetter as (p: { value: unknown }) => string;
    expect(tip({ value: null })).toBe('null');
    expect(tip({ value: 'x' })).toBe('x');
    const rule = (d.cellClassRules as Record<string, (p: { value: unknown }) => boolean>)[
      'dt-rg-null'
    ];
    expect(rule({ value: null })).toBe(true);
    expect(rule({ value: undefined })).toBe(true);
    expect(rule({ value: '' })).toBe(false);
  });
  it('filters numbers and dates by their value, not their text', () => {
    const num = RESULTS_GRID_COLUMN_TYPES['dtNumber'];
    const getNumber = num.filterValueGetter as (p: unknown) => unknown;
    const params = (value: string | null) => ({ colDef: { field: 'c0' }, data: { c0: value } });
    expect(getNumber(params('12'))).toBe(12);
    expect(getNumber(params(null))).toBeNull();
    const date = RESULTS_GRID_COLUMN_TYPES['dtDate'];
    const getDate = date.filterValueGetter as (p: unknown) => unknown;
    expect(getDate(params('2024-03-05'))).toEqual(new Date(2024, 2, 5));
    expect(getDate(params(null))).toBeNull();
    const cmp = date.comparator as (a: string | null, b: string | null) => number;
    expect(cmp('2024-03-05', '2024-03-06')).toBeLessThan(0);
    expect(cmp(null, '2024-03-06')).toBeLessThan(0);
    expect(cmp(null, null)).toBe(0);
  });
});

describe('row number column', () => {
  it('numbers the displayed rows from 1 and takes no part in sorting, filtering or focus', () => {
    const get = ROW_NUMBER_COLUMN.valueGetter as (p: unknown) => string;
    expect(get({ node: { rowIndex: 0 } })).toBe('1');
    expect(get({ node: { rowIndex: 41 } })).toBe('42');
    expect(get({ node: {} })).toBe('');
    expect(ROW_NUMBER_COLUMN).toMatchObject({
      pinned: 'left',
      sortable: false,
      filter: false,
      suppressNavigable: true,
    });
  });
});
