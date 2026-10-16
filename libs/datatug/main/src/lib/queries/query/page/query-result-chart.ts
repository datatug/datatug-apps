import type { FederatedQueryResult } from '../../federated-query-executor';
import {
  prepareCategoryBars,
  type CategoryBarFields,
  type CategoryBarsResult,
} from '../../../board/ui/components/held-result-presentation/held-result-presentation.component';

type Recordset = FederatedQueryResult['recordset'];

export interface QueryResultChartOptions {
  readonly categories: readonly string[];
  readonly measures: readonly string[];
  readonly reason?: string;
}

/** Chart admission uses the complete held result, never the current grid page. */
export function queryResultChartOptions(
  result: FederatedQueryResult,
  recordset: Recordset,
  reportedRows: number | undefined,
): QueryResultChartOptions {
  if (
    result.truncated ||
    result.hasMore ||
    (reportedRows !== undefined && reportedRows !== recordset.rows.length) ||
    Object.values(result.runtimeRead?.pages ?? {}).some(
      (page) => !page.complete || page.possiblyMore,
    )
  ) return { categories: [], measures: [], reason: 'The complete result is needed before charting. Inspect the available rows in the grid.' };
  if (result.limitations.length)
    return { categories: [], measures: [], reason: 'Source restrictions limit this result. Inspect the rows and limitations before charting.' };
  if (recordset.rows.length > 1000)
    return { categories: [], measures: [], reason: 'This result has more than 1,000 rows. Narrow the saved query before charting.' };
  const used = result.usedSourceIds;
  if (!used?.length || !result.sourceRights?.length || used.some((id) =>
    !result.sourceRights?.some((right) =>
      right.sourceId === id && right.evidenceOrigin !== 'legacy-metadata',
    ),
  )) return { categories: [], measures: [], reason: 'Source usage rights are unavailable for this result. The rows remain inspectable.' };

  const names = recordset.columns.map((column) => column.name);
  if (new Set(names).size !== names.length)
    return { categories: [], measures: [], reason: 'Duplicate column names prevent an unambiguous chart.' };
  const categories = recordset.columns.filter((column) => column.type === 'string').map((column) => column.name);
  const measures = recordset.columns.filter((column) => column.type === 'integer' || column.type === 'number').map((column) => column.name);
  if (!categories.length || !measures.length)
    return { categories, measures, reason: 'A category chart needs a string column and a numeric count column.' };
  return { categories, measures };
}

export function prepareQueryResultChart(
  result: FederatedQueryResult,
  recordset: Recordset,
  fields: CategoryBarFields,
): CategoryBarsResult {
  return prepareCategoryBars({ recordset }, fields);
}
