import type { ColDef } from 'ag-grid-community';
import type { GridCell, GridRow } from './results-grid-columns';

/** Grouping is session-only; automatic hiding must not contaminate the saved manual column layout. */
export const ENTERPRISE_GROUP_VISIBILITY = {
  suppressGroupChangesColumnVisibility: true,
  suppressDragLeaveHidesColumns: true,
} as const;

/** Normalize a bounded decimal representation without first rounding it through Number. */
function decimalKey(text: string): string | undefined {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return undefined;
  const exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400)
    return undefined;
  let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, '');
  if (!digits) return '0';
  let scale = exponent;
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    scale++;
  }
  return `${match[1]}${digits}e${scale}`;
}

/** Finite, round-tripping analytics projection. Raw cells remain authoritative for display/export. */
export function analyticsNumber(
  cell: GridCell | undefined,
): number | undefined {
  if (cell == null || cell.trim() === '') return undefined;
  const value = Number(cell);
  // This also bounds every possible held-page sum far below Infinity. Finite sums/averages remain approximate.
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
    return undefined;
  return decimalKey(cell) === decimalKey(String(value)) ? value : undefined;
}

export function analyticsColumns(
  columns: readonly ColDef<GridRow>[],
  rows: readonly GridRow[],
): {
  columns: ColDef<GridRow>[];
  excluded: string[];
} {
  const excluded: string[] = [];
  return {
    excluded,
    columns: columns.map((column) => {
      const field = column.field;
      const numeric = column.type === 'dtNumber';
      if (!numeric || !field || column.suppressColumnsToolPanel) {
        return {
          ...column,
          enableValue: false,
          chartDataType: column.suppressColumnsToolPanel
            ? 'excluded'
            : 'category',
        };
      }
      const cells = rows
        .map((row) => row[field])
        .filter((value) => value != null);
      const safe =
        cells.length > 0 &&
        cells.every((value) => analyticsNumber(value) !== undefined);
      if (!safe) {
        if (cells.length && column.enableValue !== false)
          excluded.push(column.headerName ?? field);
        return {
          ...column,
          enableValue: false,
          chartDataType: 'excluded',
          cellDataType: 'text',
          filter: 'agTextColumnFilter',
          filterValueGetter: (p) => p.data?.[field] ?? null,
        };
      }
      if (column.enableValue === false)
        return { ...column, chartDataType: 'category' };
      return {
        ...column,
        enableValue: true,
        cellDataType: 'number',
        chartDataType: 'series',
        allowedAggFuncs: ['sum', 'avg', 'min', 'max', 'count', 'first', 'last'],
        valueGetter: (p) =>
          p.data
            ? (analyticsNumber(p.data[field]) ?? null)
            : (p.node?.aggData?.[field] ?? null),
      };
    }),
  };
}
