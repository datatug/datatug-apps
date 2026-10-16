import type { TypedValue } from '@sneat/datatug-semantic';
import type {
  ColDef,
  ValueFormatterParams,
  ValueGetterParams,
} from 'ag-grid-community';

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
  if (cell === null || cell === undefined || cell.trim() === '')
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
  if (/^-?\d+$/.test(a ?? '') && /^-?\d+$/.test(b ?? '')) {
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
    default:
      return cell;
  }
}

const cellOf = (
  p: ValueGetterParams | ValueFormatterParams,
): GridCell | undefined => {
  const field = p.colDef?.field;
  const data = p.data as GridRow | undefined;
  return field && data ? data[field] : (p as ValueFormatterParams).value;
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
  column: { readonly name: string; readonly type?: string },
  colId: string,
): ColDef<GridRow> {
  const kind = columnKind(column.type);
  return {
    colId,
    field: colId,
    headerName: column.name,
    type: TYPE_NAME[kind],
    sortable: true,
    minWidth: 90,
    maxWidth: 480,
    valueFormatter: (p) => formatCell(p.value as GridCell, kind),
    tooltipValueGetter: (p) => (isNullCell(p) ? NULL_TEXT : String(p.value)),
    cellClassRules: { 'dt-rg-null': isNullCell },
    ...(isInternalKeyColumn(column.name)
      ? {
          hide: true,
          lockVisible: true,
          suppressColumnsToolPanel: true,
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
  suppressHeaderMenuButton: true,
  headerClass: 'ag-right-aligned-header',
  cellClass: ['ag-right-aligned-cell', 'dt-rg-row-number'],
};
