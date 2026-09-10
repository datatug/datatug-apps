export interface IEnvDatabaseBase {
  id: string;
  title?: string;
  server: IDbServer;
  driver: 'sqlserver' | string;
}

export interface IColumn {
  name: string;
  dbType: string;
  pkPosition?: number;
  isNullable?: boolean;
}

export interface ITableFull {
  schema: string;
  name: string;
  /** Object kind, e.g. 'table' or 'view' (additive field from DataTug CLI). */
  type?: 'table' | 'view' | string;
  dbType: 'BASE TABLE' | 'VIEW' | string;
  columns?: IColumn[];
  primaryKey?: IPrimaryKey;
  foreignKeys?: IForeignKey[];
  referencedBy?: IReferencedBy[];
  indexes?: IIndex[];
  alternateKeys?: IAlternateKey[];
}

export interface IPrimaryKey {
  name: string;
  columns: string[];
}

/** Unique/alternate key (additive field from DataTug CLI). */
export interface IAlternateKey {
  name: string;
  columns: string[];
}

export interface IIndexColumn {
  name: string;
}

/** Table index (additive field from DataTug CLI). */
export interface IIndex {
  name: string;
  type?: 'BTREE' | string;
  unique?: boolean;
  primaryKey?: boolean;
  columns: IIndexColumn[];
}

export interface IReferencedBy {
  name: string;
  schema: string;
  /** Object kind of the referencing table (additive field from DataTug CLI). */
  type?: 'table' | 'view' | string;
  foreignKeys: IForeignKey[];
}

export interface ITableRef {
  name: string;
  schema: string;
  /** Object kind of the referenced table (additive field from DataTug CLI). */
  type?: 'table' | 'view' | string;
  catalog?: string;
}
export interface IForeignKey {
  name: string;
  columns: string[];
  refTable: ITableRef;
}

export interface IDatabaseFull extends IEnvDatabaseBase {
  tables: ITableFull[];
  views: ITableFull[];
  version?: {
    min?: string;
    max?: string;
  };
}

/**
 * GET /datatug/catalog-tables's response shape (datatug-cli's
 * api.CatalogTables — Task 17 item A.2): a catalog's table/view identity
 * list, no column/key detail (env-db-table.page.ts's own /exec/select-backed
 * row fetch remains the source of those). Deliberately lighter than
 * `IDatabaseFull` — it has no `server`/`driver` (this call is scoped by
 * project+environment+catalog id, not a server connection) — so
 * `EnvDbPageComponent` uses this instead of `IDatabaseFull` for the data
 * this endpoint actually returns.
 */
export interface ICatalogTables {
  tables: ITableFull[];
  views: ITableFull[];
}

export interface IDatabaseSummary {
  id: string;
  title?: string;
  environments?: string[];
}

export interface IServer {
  host: string;
  port?: number;
}

export interface IDbServer extends IServer {
  driver: string;
}

/** One environment's contribution to an aggregated {@link IProjDbServerSummary}
 * row's `databasesCount` — see that interface's own `environments` doc comment. */
export interface IProjDbServerEnvironmentUsage {
  envId: string;
  databasesCount: number;
}

export interface IProjDbServerSummary {
  dbServer: IDbServer;
  databasesCount: number;
  /**
   * Per-environment breakdown of {@link databasesCount} — which
   * environments contribute to this aggregated server row, and how many
   * databases/catalogs each one contributes. Populated by the GitHub read
   * path (`DbServerService`'s own `getGithubDbServers()`, which aggregates
   * this row across every `environments/<id>/<id>.env.json` file) so the
   * Servers page can recompute a narrower `databasesCount` — and hide the
   * row entirely — once its environment filter excludes every environment
   * that contributes to it (S153: the founder's "numbers mismatch" ruling
   * against the GitHub-store demo project).
   *
   * `undefined` for the live-agent path (`ProjectService.getFull()`'s
   * project-level `dbServers` carries no per-environment breakdown): the
   * Servers page's environment filter is a deliberate no-op there, same as
   * before this field existed.
   */
  environments?: IProjDbServerEnvironmentUsage[];
}

export interface IProjDbServerFull extends IDbServer {
  dbServer: IDbServer;
  databases: IDatabaseFull[];
}

export interface IDbServerSummary extends IDbServer {
  title?: string;
  databases?: IDatabaseSummary[];
}

export interface IDbCatalogSummary {
  name: string;
}

export const getDbServerFromId = (driver: string, id: string): IDbServer => {
  const v = id.split(':');
  if (v.length === 1) {
    return { driver, host: v[0] };
  }
  return { driver, host: v[0], port: +v[0] };
};
