import type { TypedValue } from '@sneat/datatug-semantic';
import type { ColDef } from 'ag-grid-community';

/**
 * Pure column rules of the one results grid (`sneat-datatug-results-grid`), shared by the query page and the query
 * result page: how a contract column type becomes an AG Grid column (alignment, filter, formatter, sort) and how a
 * typed cell becomes the cell value the grid holds. No AG Grid code runs here (only types are imported), so the file
 * is safe to import from any startup path.
 */

/** A cell as the grid holds it: display text, or `null` for a database NULL (drawn as a dimmed `null`). */
export type GridCell = string | null;
/** A row as the grid holds it: one cell per column id. */
export type GridRow = Readonly<Record<string, GridCell>>;

export type ColumnKind =
  | 'number'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'json'
  | 'text';

/** The kind of a contract column type (`integer`, `decimal`, `number`, `boolean`, `date`, `datetime`, ...). */
export function columnKind(type: string | undefined | null): ColumnKind {
  const t = (type ?? '').trim().toLowerCase();
  if (
    /^(?:integer|int\d*|bigint|smallint|tinyint|decimal|numeric|number|float\d*|double|real|money)\b/.test(
      t,
    )
  ) {
    return 'number';
  }
  if (t === 'boolean' || t === 'bool' || t === 'bit') return 'boolean';
  if (t === 'date') return 'date';
  if (/^(?:datetime|timestamp|timestamptz|time)/.test(t)) return 'datetime';
  if (t === 'json' || t === 'jsonb' || t === 'object' || t === 'array')
    return 'json';
  return 'text';
}

/**
 * A typed contract cell as the grid holds it: `null` for a NULL, an integer with every digit (it is a string on the
 * wire), otherwise the value as text.
 */
export function gridCell(value: TypedValue | undefined): GridCell {
  if (
    !value ||
    value.type === 'null' ||
    value.value === null ||
    value.value === undefined
  ) {
    return null;
  }
  return String(value.value);
}

/** The text shown for a NULL cell. */
export const NULL_TEXT = 'null';

/** A number for sorting and filtering; undefined when the text is not a finite number. */
export function cellNumber(cell: GridCell | undefined): number | undefined {
  if (cell === null || cell === undefined || String(cell).trim() === '')
    return undefined;
  const n = Number(cell);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Numeric order for text cells that hold numbers (an integer wider than 2^53 compares exactly as BigInt). Missing
 * values (NULL, empty, not a number) are the smallest: first when ascending, last when descending.
 */
export function compareNumberCells(
  a: GridCell | undefined,
  b: GridCell | undefined,
): number {
  const x = cellNumber(a);
  const y = cellNumber(b);
  if (x === undefined || y === undefined) {
    return x === y ? 0 : x === undefined ? -1 : 1;
  }
  if (Number.isSafeInteger(x) && Number.isSafeInteger(y)) return x - y;
  if (/^-?\d+$/.test(String(a ?? '')) && /^-?\d+$/.test(String(b ?? ''))) {
    const p = BigInt(a as string);
    const q = BigInt(b as string);
    return p < q ? -1 : p > q ? 1 : 0;
  }
  return x === y ? 0 : x < y ? -1 : 1;
}

/** The date of a `YYYY-MM-DD` or RFC 3339 text; undefined when it is neither. A bare date is local midnight. */
export function cellDate(cell: GridCell | undefined): Date | undefined {
  if (!cell) return undefined;
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cell);
  const date = bare
    ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]))
    : new Date(cell);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** A JSON object or array as compact text (no indentation); anything else, as it is. */
export function compactJson(text: string): string {
  const t = text.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return text;
  try {
    return JSON.stringify(JSON.parse(t) as unknown);
  } catch {
    return text;
  }
}

/** A cell as display text for its column kind: locale dates, ✓/✗ booleans, compact JSON, a dimmed-able `null`. */
export function formatCell(
  cell: GridCell | undefined,
  kind: ColumnKind,
  groupDigits = false,
): string {
  if (cell === null || cell === undefined) return NULL_TEXT;
  switch (kind) {
    case 'date': {
      const d = cellDate(cell);
      return d ? d.toLocaleDateString() : cell;
    }
    case 'datetime': {
      const d = cellDate(cell);
      return d && /\d{4}-\d{2}-\d{2}/.test(cell) ? d.toLocaleString() : cell;
    }
    case 'boolean':
      return /^(?:true|1|t|yes)$/i.test(cell)
        ? '✓'
        : /^(?:false|0|f|no)$/i.test(cell)
          ? '✗'
          : cell;
    case 'json':
    case 'text':
      return compactJson(cell);
    case 'number':
      return groupDigits ? groupNumberText(cell) : cell;
    default:
      return cell;
  }
}

/**
 * Whether a column name reads as an identifier (`Id`, `InvoiceId`, `customer_id`, `ApiKey`, `order_key`): its digits
 * are a label, not a quantity, so they are never grouped with thousands separators.
 */
export function isIdentifierColumnName(
  name: string | undefined | null,
): boolean {
  const n = (name ?? '').trim();
  // "id" / "key" alone, snake_case `_id` / `_key`, or a camel/Pascal-case word ending `Id` / `ID` / `Key` / `KEY`
  // ("InvoiceId", "customerID"); "Paid", "Valid" and "Monkey" are not identifiers.
  return (
    /^(?:id|key)$/i.test(n) ||
    /_(?:id|key)$/i.test(n) ||
    /[A-Za-z0-9](?:Id|ID|Key|KEY)$/.test(n)
  );
}

const GROUPING = (() => {
  try {
    const parts = new Intl.NumberFormat().formatToParts(1234567.5);
    return {
      group: parts.find((p) => p.type === 'group')?.value ?? ',',
      decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    };
  } catch {
    return { group: ',', decimal: '.' };
  }
})();

/**
 * A number given as text with thousands separators in the integer part (locale separators). The digits are never
 * parsed as a JS number, so a wide integer keeps every digit, and the decimals are kept as they are. Text that is not
 * a plain decimal number (exponent, leading zeros, spaces, `NaN`) is returned unchanged.
 */
export function groupNumberText(text: string): string {
  const m = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(text);
  if (!m) return text;
  const [, sign, int, decimals] = m;
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, GROUPING.group);
  return `${sign}${grouped}${decimals === undefined ? '' : GROUPING.decimal + decimals}`;
}

/** Whether a cell's text probably does not fit a column of this width (so a tooltip with the full text helps). */
export function isLikelyTruncated(
  text: string,
  columnWidth: number | undefined,
): boolean {
  if (!columnWidth) return true;
  // About 7.5px per character at the grid's font size, minus the cell padding: deliberately generous.
  return text.length * 7.5 > columnWidth - 24;
}

const cellOf = (p: {
  colDef?: ColDef;
  data?: unknown;
  value?: unknown;
}): GridCell | undefined => {
  const field = p.colDef?.field;
  const data = p.data as GridRow | undefined;
  return field && data ? data[field] : (p.value as GridCell | undefined);
};

const isNullCell = (p: { value?: unknown }): boolean =>
  p.value === null || p.value === undefined;

/** Column types of the grid, keyed by {@link ColumnKind}-based names; the grid passes them as `columnTypes`. */
export const RESULTS_GRID_COLUMN_TYPES: Record<string, ColDef> = {
  dtNumber: {
    headerClass: 'ag-right-aligned-header',
    cellClass: 'ag-right-aligned-cell',
    filter: 'agNumberColumnFilter',
    filterValueGetter: (p) => cellNumber(cellOf(p)) ?? null,
    comparator: compareNumberCells,
  },
  dtDate: {
    filter: 'agDateColumnFilter',
    filterValueGetter: (p) => cellDate(cellOf(p)) ?? null,
    comparator: (a: GridCell, b: GridCell) =>
      (cellDate(a)?.getTime() ?? -Infinity) -
        (cellDate(b)?.getTime() ?? -Infinity) || 0,
  },
  dtBoolean: {
    headerClass: 'dt-rg-center-header',
    cellClass: 'dt-rg-center-cell',
    filter: 'agTextColumnFilter',
  },
  dtJson: { filter: 'agTextColumnFilter', cellClass: 'dt-rg-json-cell' },
  dtText: { filter: 'agTextColumnFilter' },
};

const TYPE_NAME: Record<ColumnKind, string> = {
  number: 'dtNumber',
  date: 'dtDate',
  datetime: 'dtDate',
  boolean: 'dtBoolean',
  json: 'dtJson',
  text: 'dtText',
};

/**
 * The name of the record-identity column some sources add to a recordset (`$key`). Its cells are an internal
 * placeholder, not data: the grid keeps the column (the rows keep their identity) but never shows it, offers it in
 * the column chooser or exports it.
 */
export const INTERNAL_KEY_COLUMN = '$key';

export function isInternalKeyColumn(name: string | undefined | null): boolean {
  return name === INTERNAL_KEY_COLUMN;
}

/**
 * The base AG Grid column of a recordset column: type-based alignment, filter, sort and formatting, the minimum and
 * maximum widths that bound auto-sizing, a tooltip with the full text, and a dimmed `null`. Callers spread it and
 * add what is theirs (a header component, a renderer).
 */
export function resultColumnDef(
  column: {
    readonly name: string;
    readonly type?: string;
    /** True for a column of the primary key: its digits are never grouped. */
    readonly primaryKey?: boolean;
  },
  colId: string,
): ColDef<GridRow> {
  const kind = columnKind(column.type);
  // Thousands separators only for a quantity: not for an identifier or a key column.
  const groupDigits =
    kind === 'number' &&
    !column.primaryKey &&
    !isIdentifierColumnName(column.name);
  return {
    colId,
    field: colId,
    headerName: column.name,
    type: TYPE_NAME[kind],
    sortable: true,
    minWidth: 90,
    maxWidth: 480,
    headerTooltip: column.type
      ? `${column.name} (${column.type})`
      : column.name,
    valueFormatter: (p) => {
      const raw = cellOf(p);
      return formatCell(raw == null ? raw : String(raw), kind, groupDigits);
    },
    ...(column.primaryKey || isIdentifierColumnName(column.name)
      ? { enableValue: false, chartDataType: 'category' as const }
      : {}),
    // The full text, only where the column is probably too narrow for it (text only: the grid never renders it as HTML).
    tooltipValueGetter: (p) => {
      if (isNullCell(p)) return undefined;
      const definition = p.column && 'getColDef' in p.column ? p.column.getColDef() : undefined;
      const text = String(cellOf({ colDef: definition, data: p.data, value: p.value }));
      const column = p.column as { getActualWidth?: () => number } | undefined;
      return isLikelyTruncated(text, column?.getActualWidth?.())
        ? text
        : undefined;
    },
    cellClassRules: { 'dt-rg-null': isNullCell },
    ...(isInternalKeyColumn(column.name)
      ? {
          hide: true,
          lockVisible: true,
          suppressColumnsToolPanel: true,
          enableRowGroup: false,
          enablePivot: false,
          enableValue: false,
          chartDataType: 'excluded',
          suppressFiltersToolPanel: true,
        }
      : {}),
  };
}

/** The row-number column: pinned left, not sortable, filterable or focusable. */
export const ROW_NUMBER_COLUMN: ColDef<GridRow> = {
  colId: '__row',
  headerName: '#',
  valueGetter: (p) =>
    p.node?.rowIndex != null ? String(p.node.rowIndex + 1) : '',
  width: 64,
  minWidth: 48,
  maxWidth: 96,
  pinned: 'left',
  lockPinned: true,
  lockPosition: 'left',
  sortable: false,
  filter: false,
  floatingFilter: false,
  resizable: false,
  suppressMovable: true,
  suppressNavigable: true,
  enableValue: false,
  enableRowGroup: false,
  enablePivot: false,
  chartDataType: 'excluded',
  suppressHeaderMenuButton: true,
  headerClass: 'ag-right-aligned-header',
  cellClass: ['ag-right-aligned-cell', 'dt-rg-row-number'],
};
