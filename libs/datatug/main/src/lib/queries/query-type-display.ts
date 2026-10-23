import { QueryType } from '../models/definition/query-def';

const QUERY_TYPE_DISPLAY_NAMES: Readonly<Record<QueryType, string>> = {
  [QueryType.TugQL]: 'TugQL',
  [QueryType.SQL]: 'SQL',
  [QueryType.HTTP]: 'HTTP',
};

/**
 * The person-facing name of a query type: the single source for every label,
 * badge and subtitle that shows it. An unrecognised or missing value falls
 * back to its own text (empty for none) so a new type never renders as `undefined`.
 */
export function queryTypeDisplayName(type: QueryType | string | null | undefined): string {
  if (type === null || type === undefined) return '';
  return (QUERY_TYPE_DISPLAY_NAMES as Readonly<Record<string, string>>)[type] ?? String(type);
}
