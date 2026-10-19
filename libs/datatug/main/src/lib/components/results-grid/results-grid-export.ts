import type {
  ExcelStyle,
  ProcessCellForExportParams,
  ShouldRowBeSkippedParams,
} from 'ag-grid-community';
import type { GridRow } from './results-grid-columns';

/** AG Excel infers numeric-looking callback strings as numbers unless its default cell style forces Text. */
export const RAW_RESULT_EXCEL_STYLES: ExcelStyle[] = [
  { id: 'cell', dataType: 'String' },
];

export const skipResultSummaryRow = (
  p: ShouldRowBeSkippedParams<GridRow>,
): boolean => !!p.node.group || !!p.node.footer;

/** Original leaf text, including decimal zeros and wide integers, for CSV/Excel/range clipboard. */
export function rawResultCell(p: ProcessCellForExportParams<GridRow>): string {
  const field = p.column?.getColDef().field;
  const value =
    p.node?.data && !p.node.group && !p.node.footer && field
      ? p.node.data[field]
      : p.value;
  return value == null ? '' : String(value);
}
