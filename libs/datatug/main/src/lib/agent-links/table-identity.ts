/** A table or view of a source, as a link names it. `schema` is '' for a schemaless source (SQLite). */
export interface TableIdentity {
  readonly schema: string;
  readonly name: string;
}

/** The query parameter that names the schema of the table of a table, view, records or record page. */
export const SCHEMA_QUERY_PARAM = 'schema';

/**
 * The table a page is for (Feature claude-mod-web-links, REQ:table-identity). When the address has a `schema`
 * query parameter (every link `datatug daemon url` prints has one, `?schema=` for a schemaless source) it is
 * authoritative and the path segment is the whole table name, never split on a dot (a SQLite table `a.b` stays
 * `a.b`). Only an address with no `schema` parameter keeps the older `schema.name` reading of the segment, split at
 * its first dot; a segment with no dot is a table with no schema.
 */
export function tableIdentity(
  tableSegment: string,
  schemaParam: string | null | undefined,
): TableIdentity {
  if (schemaParam !== null && schemaParam !== undefined) {
    return { schema: schemaParam, name: tableSegment };
  }
  const dot = tableSegment.indexOf('.');
  return dot < 0
    ? { schema: '', name: tableSegment }
    : { schema: tableSegment.slice(0, dot), name: tableSegment.slice(dot + 1) };
}

/** The name `exec/select` reads the table by: `schema.name`, or the bare name with no schema (and for MSSQL's
 * default `dbo`, which is left out for readability). */
export function qualifiedTableName(table: TableIdentity): string {
  return !table.schema || table.schema === 'dbo'
    ? table.name
    : `${table.schema}.${table.name}`;
}
