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

/**
 * S160 — placeholder `dbServerId` route segment for a server with no `host`
 * at all (sqlite3 is file-based, not network-addressed — the GitHub demo
 * project's own aggregated server, `ServersPageComponent`'s
 * `getGithubDbServers()` read path, `PR #116`). A route segment
 * (`servers/db/:dbDriver/:dbServerId`, `servers-routing.module.ts`) can
 * never be an empty string, so `getDbServerId()` below emits this literal
 * instead, and `getDbServerFromId()` maps it straight back to an empty
 * host. `'-'` can never collide with a real `host[:port]` id: neither `:`
 * (the host/port separator) nor a bare host containing only `-` is a valid
 * hostname.
 */
export const DB_SERVER_ID_NO_HOST = '-';

/**
 * Inverse of {@link getDbServerId} — parses a `servers/db/:dbDriver/
 * :dbServerId` route segment back into an `IDbServer`. `id` is either
 * {@link DB_SERVER_ID_NO_HOST} (a host-less server, e.g. sqlite3), a bare
 * host (`"localhost"`), or `host:port` (`"localhost:5432"`).
 */
export const getDbServerFromId = (driver: string, id: string): IDbServer => {
  if (id === DB_SERVER_ID_NO_HOST) {
    return { driver, host: '' };
  }
  const v = id.split(':');
  if (v.length === 1) {
    return { driver, host: v[0] };
  }
  // S160: this used to read `+v[0]` here — the HOST segment, always `NaN`
  // (`+"localhost"` is `NaN`) — so a server's Port row never rendered
  // (`dbserver-page.component.html`'s `@if (dbServer()?.port)` is falsy for
  // `NaN`). `v[1]` is the actual port segment.
  return { driver, host: v[0], port: +v[1] };
};

/**
 * Inverse of {@link getDbServerFromId} — builds the `dbServerId` route
 * segment (`servers/db/:dbDriver/:dbServerId`) for a given server: `host`,
 * `host:port` when a port is set, or {@link DB_SERVER_ID_NO_HOST} when
 * `host` is empty/whitespace-only (see that constant's own doc comment).
 * `ServersPageComponent.goDbServer()` is the one caller today.
 */
export const getDbServerId = (dbServer: IDbServer): string => {
  const host = dbServer.host?.trim();
  if (!host) {
    return DB_SERVER_ID_NO_HOST;
  }
  return dbServer.port ? `${host}:${dbServer.port}` : host;
};
