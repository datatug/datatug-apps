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
  groupNumberText,
  isIdentifierColumnName,
  isInternalKeyColumn,
  isLikelyTruncated,
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
    expect(gridCell({ type: 'integer', value: '9007199254740993' })).toBe(
      '9007199254740993',
    );
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
    expect(
      compareNumberCells('9007199254740993', '9007199254740992'),
    ).toBeGreaterThan(0);
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
    expect(formatCell('2024-03-05', 'date')).toBe(
      new Date(2024, 2, 5).toLocaleDateString(),
    );
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
    expect(formatCell('{ "a": 1,\n "b": [1, 2] }', 'json')).toBe(
      '{"a":1,"b":[1,2]}',
    );
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
    expect(RESULTS_GRID_COLUMN_TYPES['dtDate']['filter']).toBe(
      'agDateColumnFilter',
    );
    expect(def('boolean').type).toBe('dtBoolean');
    expect(def('json').type).toBe('dtJson');
    expect(def('string').type).toBe('dtText');
    expect(RESULTS_GRID_COLUMN_TYPES['dtText']['filter']).toBe(
      'agTextColumnFilter',
    );
  });
  it('formats, tips and dims through the column', () => {
    const d = def('boolean');
    const fmt = d.valueFormatter as (p: { value: unknown }) => string;
    expect(fmt({ value: 'true' })).toBe('✓');
    expect(fmt({ value: null })).toBe('null');
    const tip = d.tooltipValueGetter as (p: {
      value: unknown;
      column?: { getActualWidth: () => number };
    }) => string | undefined;
    // No tooltip for a NULL, nor for text that fits the column; the full text where it probably does not.
    expect(tip({ value: null })).toBeUndefined();
    expect(tip({ value: 'x', column: { getActualWidth: () => 200 } })).toBeUndefined();
    expect(tip({ value: 'x'.repeat(80), column: { getActualWidth: () => 200 } })).toBe('x'.repeat(80));
    const rule = (
      d.cellClassRules as Record<string, (p: { value: unknown }) => boolean>
    )['dt-rg-null'];
    expect(rule({ value: null })).toBe(true);
    expect(rule({ value: undefined })).toBe(true);
    expect(rule({ value: '' })).toBe(false);
  });
  it('filters numbers and dates by their value, not their text', () => {
    const num = RESULTS_GRID_COLUMN_TYPES['dtNumber'];
    const getNumber = num.filterValueGetter as (p: unknown) => unknown;
    const params = (value: string | null) => ({
      colDef: { field: 'c0' },
      data: { c0: value },
    });
    expect(getNumber(params('12'))).toBe(12);
    expect(getNumber(params(null))).toBeNull();
    const date = RESULTS_GRID_COLUMN_TYPES['dtDate'];
    const getDate = date.filterValueGetter as (p: unknown) => unknown;
    expect(getDate(params('2024-03-05'))).toEqual(new Date(2024, 2, 5));
    expect(getDate(params(null))).toBeNull();
    const cmp = date.comparator as (
      a: string | null,
      b: string | null,
    ) => number;
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

  it('is lean: a 44px start, tight header padding, so a narrow result fits beside the 44px checkbox column', () => {
    expect(ROW_NUMBER_COLUMN).toMatchObject({ width: 44, minWidth: 36 });
    expect(ROW_NUMBER_COLUMN.headerClass).toContain('dt-rg-row-number-header');
    expect(ROW_NUMBER_COLUMN.cellClass).toContain('dt-rg-row-number');
  });
});

describe('the internal $key column', () => {
  it('is hidden from the grid, the column chooser and the filters, but stays a column of the rows', () => {
    expect(isInternalKeyColumn('$key')).toBe(true);
    expect(isInternalKeyColumn('InvoiceId')).toBe(false);
    expect(isInternalKeyColumn(undefined)).toBe(false);
    const def = resultColumnDef({ name: '$key', type: 'string' }, 'c0');
    expect(def).toMatchObject({
      colId: 'c0',
      field: 'c0',
      hide: true,
      lockVisible: true,
      suppressColumnsToolPanel: true,
      suppressFiltersToolPanel: true,
    });
  });
  it('leaves every other column visible', () => {
    expect(resultColumnDef({ name: 'InvoiceId', type: 'integer' }, 'c1').hide).toBeUndefined();
  });
});

describe('number grouping', () => {
  const sep = (1234.5).toLocaleString().replace(/[0-9]/g, '');
  const group = sep[0];
  const decimal = sep[1];
  it('groups the integer part, keeps decimals and every digit of a wide integer', () => {
    expect(groupNumberText('1234567')).toBe(['1', '234', '567'].join(group));
    expect(groupNumberText('-1234')).toBe(`-1${group}234`);
    expect(groupNumberText('1234.50')).toBe(`1${group}234${decimal}50`);
    expect(groupNumberText('9007199254740993')).toBe(
      ['9', '007', '199', '254', '740', '993'].join(group),
    );
    expect(groupNumberText('999')).toBe('999');
  });
  it.each(['1e10', '007', '12 345', 'NaN', '', '1,234', '+5', '1234.'])(
    'leaves %j as it is',
    (text) => {
      expect(groupNumberText(text)).toBe(text);
    },
  );
  it.each([
    ['Id', true],
    ['id', true],
    ['InvoiceId', true],
    ['customerID', true],
    ['customer_id', true],
    ['ApiKey', true],
    ['key', true],
    ['order_key', true],
    ['Total', false],
    ['Paid', false],
    ['Valid', false],
    ['Monkey', false],
    ['Quantity', false],
    ['', false],
  ])('%j is an identifier: %s', (name, expected) => {
    expect(isIdentifierColumnName(name)).toBe(expected);
  });
  it('groups a quantity column but not an id, a key or a primary key', () => {
    const fmt = (name: string, primaryKey = false, type = 'integer') =>
      resultColumnDef({ name, type, primaryKey }, 'c')
        .valueFormatter as (p: { value: unknown }) => string;
    expect(fmt('Total')({ value: '1234567' })).toBe(groupNumberText('1234567'));
    expect(fmt('InvoiceId')({ value: '1234567' })).toBe('1234567');
    expect(fmt('SessionKey')({ value: '1234567' })).toBe('1234567');
    expect(fmt('Number', true)({ value: '1234567' })).toBe('1234567');
    expect(fmt('Total', false, 'string')({ value: '1234567' })).toBe('1234567');
    expect(fmt('Total')({ value: null })).toBe('null');
  });
  it('still right-aligns numbers', () => {
    expect(resultColumnDef({ name: 'Total', type: 'decimal' }, 'c').type).toBe('dtNumber');
    expect(RESULTS_GRID_COLUMN_TYPES['dtNumber']['cellClass']).toBe('ag-right-aligned-cell');
  });
});

describe('tooltips', () => {
  it('names the column and its type in the header tooltip', () => {
    expect(resultColumnDef({ name: 'Total', type: 'decimal' }, 'c').headerTooltip).toBe('Total (decimal)');
    expect(resultColumnDef({ name: 'Total' }, 'c').headerTooltip).toBe('Total');
  });
  it('estimates truncation from the width', () => {
    expect(isLikelyTruncated('abc', 100)).toBe(false);
    expect(isLikelyTruncated('a'.repeat(100), 200)).toBe(true);
    expect(isLikelyTruncated('abc', undefined)).toBe(true);
  });
});
