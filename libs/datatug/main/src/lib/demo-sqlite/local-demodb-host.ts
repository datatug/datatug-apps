// The in-process OVDB server the leader tab runs over the local SQLite dataset.
//
// `@openvaultdb/inprocess` answers the OVDB routes; this module adds what DataTug's
// browser needs on top of it without a second protocol:
//   - the descriptor (`GET /v1/databases/{db}`) carries the table list and schema in
//     OVDB's own `collections` / `schemas.collections` fields (in-process mounts are
//     schemaless), plus the declared type, NOT NULL, primary key and foreign keys
//     SQLite reports, so the UI can decide what is editable;
//   - `localState.modified` survives reloads: it is set after a successful write and
//     cleared after a successful reset, in a per-version flag of the origin.
import type { DatabaseCapabilities, Resettable, Database } from '@dalgo/core';
import type { OvdbCollectionSchema, OvdbFieldSchema } from '../ovdb/ovdb-connection';

/** The parts of `SqliteSchema` (`@dalgo/sqlite-wasm`) the descriptor uses. */
export interface LocalSqliteSchema {
  readonly tables: Readonly<
    Record<
      string,
      {
        readonly columns: readonly {
          readonly name: string;
          readonly declaredType: string;
          readonly notNull: boolean;
          readonly primaryKeyPosition: number;
        }[];
        readonly primaryKey: readonly string[];
        readonly foreignKeys: readonly {
          readonly columns: readonly string[];
          readonly referencedTable: string;
          readonly referencedColumns: readonly (string | null)[];
        }[];
      }
    >
  >;
}

/** The leader's DALgo database: a `SqliteDatabase & Resettable`. */
export type LocalSqliteDatabase = Database &
  Resettable & {
    capabilities(): DatabaseCapabilities | Promise<DatabaseCapabilities>;
    schema(): Promise<LocalSqliteSchema>;
  };

/** `createOvdbFetch` of `@openvaultdb/inprocess`, as this module uses it. */
export type CreateOvdbFetch = (options: {
  readonly baseUrl?: string;
  readonly databases: Readonly<Record<string, Database>>;
  readonly canonical?: Readonly<Record<string, { readonly url: string; readonly sha256: string; readonly bytes: number }>>;
  readonly localState?: (databaseId: string) => { readonly modified: boolean };
}) => typeof globalThis.fetch;

export const LOCAL_OVDB_BASE_URL = 'https://local.ovdb.invalid';

/** Whether the working copy differs from the pristine one; kept per dataset version. */
export interface ModifiedFlag {
  get(): boolean;
  set(modified: boolean): void;
}

export function storageModifiedFlag(dataset: string, sha256: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined): ModifiedFlag {
  const key = `datatug.demodb.modified.${dataset}`;
  let memory = false;
  return {
    get: () => {
      try {
        const value = storage?.getItem(key);
        if (value !== null && value !== undefined) return value === sha256;
      } catch {
        /* blocked storage: fall back to this page's memory */
      }
      return memory;
    },
    set: (modified) => {
      memory = modified;
      try {
        if (modified) storage?.setItem(key, sha256);
        else storage?.removeItem(key);
      } catch {
        /* blocked storage keeps the in-memory flag */
      }
    },
  };
}

/** SQLite's declared type → an OVDB field type (affinity rules of https://sqlite.org/datatype3.html). */
export function ovdbTypeOfDeclared(declared: string): string {
  const type = declared.toUpperCase();
  if (type.includes('INT')) return 'integer';
  if (/CHAR|CLOB|TEXT/.test(type)) return 'string';
  if (type === '' || type.includes('BLOB')) return type === '' ? 'unknown' : 'blob';
  if (/REAL|FLOA|DOUB/.test(type)) return 'number';
  if (/NUMERIC|DECIMAL|MONEY/.test(type)) return 'decimal';
  if (/BOOL/.test(type)) return 'boolean';
  if (/DATE|TIME/.test(type)) return 'string';
  return 'decimal';
}

export function schemaCollections(schema: LocalSqliteSchema): {
  readonly collections: readonly string[];
  readonly schemas: { readonly collections: Readonly<Record<string, OvdbCollectionSchema>> };
} {
  const collections: Record<string, OvdbCollectionSchema> = {};
  for (const name of Object.keys(schema.tables).sort()) {
    const table = schema.tables[name];
    const fields: Record<string, OvdbFieldSchema> = {};
    for (const column of table.columns) {
      fields[column.name] = {
        type: ovdbTypeOfDeclared(column.declaredType),
        declaredType: column.declaredType,
        notNull: column.notNull,
        primaryKeyPosition: column.primaryKeyPosition,
      };
    }
    collections[name] = {
      fields,
      primaryKey: [...table.primaryKey],
      foreignKeys: table.foreignKeys.map((fk) => ({
        columns: [...fk.columns],
        referencedTable: fk.referencedTable,
        referencedColumns: [...fk.referencedColumns],
      })),
    };
  }
  return { collections: Object.keys(collections), schemas: { collections } };
}

export interface LocalOvdbFetchOptions {
  readonly createOvdbFetch: CreateOvdbFetch;
  readonly dataset: string;
  readonly database: LocalSqliteDatabase;
  readonly canonical: { readonly url: string; readonly sha256: string; readonly bytes: number };
  readonly modified: ModifiedFlag;
  readonly baseUrl?: string;
}

const writeMethods = new Set(['PUT', 'POST', 'PATCH', 'DELETE']);

/** The in-process OVDB fetch for one local dataset, with the descriptor and `localState` described above. */
export function createLocalOvdbFetch(options: LocalOvdbFetchOptions): typeof globalThis.fetch {
  const baseUrl = options.baseUrl ?? LOCAL_OVDB_BASE_URL;
  const inner = options.createOvdbFetch({
    baseUrl,
    databases: { [options.dataset]: options.database },
    canonical: { [options.dataset]: options.canonical },
    localState: () => ({ modified: options.modified.get() }),
  });
  const databasePath = `/v1/databases/${encodeURIComponent(options.dataset)}`;
  return async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    const response = await inner(request);
    if (!response.ok) return response;
    if (request.method === 'GET' && path === databasePath) {
      const descriptor = (await response.json()) as Record<string, unknown>;
      const schema = schemaCollections(await options.database.schema());
      return new Response(JSON.stringify({ ...descriptor, engine: 'sqlite', ...schema }), {
        status: response.status,
        headers: response.headers,
      });
    }
    if (path === `${databasePath}/reset` && request.method === 'POST') {
      options.modified.set(false);
    } else if (
      writeMethods.has(request.method) &&
      (path === `${databasePath}/batch` || path.startsWith(`${databasePath}/records/`))
    ) {
      options.modified.set(true);
    }
    return response;
  };
}
