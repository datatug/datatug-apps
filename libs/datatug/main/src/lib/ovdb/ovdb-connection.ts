// An OpenVaultDB database DataTug browses (and, when its descriptor allows it, edits).
//
// The same model serves a hosted read-only demo (PostgreSQL on Neon through
// cloud.openvaultdb.com, the public DemoDB OVDB) and the local, editable SQLite copy
// running in the browser (`@openvaultdb/inprocess` over `@dalgo/sqlite-wasm`). What
// the UI offers is decided ONLY by the descriptor's `capabilities`:
//   - browse (table list, rows): `query` or `tugql` — never `read`, which means keyed
//     record reads only (a native PostgreSQL mount reports read: false yet is queryable);
//   - edit a record: `write` (the update first reads the record by key, so also `read`);
//   - delete a record: `delete`;
//   - Reset Database: `reset`.
// Never the engine name.
import { withTugqlCapabilities } from './legacy-dtql-ovdb-metadata';
import { OpenVaultDbHttpError } from '@dalgo/ovdb/client';

/** The `capabilities` map of `GET /v1/databases/{db}` (openvaultdb-go docs/api.md). */
export interface OvdbCapabilities {
  readonly read?: boolean;
  readonly query?: boolean;
  readonly tugql?: boolean;
  readonly write?: boolean;
  readonly delete?: boolean;
  readonly reset?: boolean;
  readonly persistent?: boolean;
  readonly joins?: boolean;
  readonly aggregation?: boolean;
}

/** One field of a collection schema. `declaredType`/`notNull`/`primaryKeyPosition` are set by the local SQLite host. */
export interface OvdbFieldSchema {
  readonly type?: string;
  readonly declaredType?: string;
  readonly notNull?: boolean;
  /** 1-based position in the primary key; 0 or absent for other fields. */
  readonly primaryKeyPosition?: number;
  /** Set by a native PostgreSQL mount: the column's PostgreSQL type, whether it is a key column and whether NULL is allowed. */
  readonly nativeType?: string;
  readonly primaryKey?: boolean;
  readonly nullable?: boolean;
  readonly required?: boolean;
}

/** Where a collection of a native PostgreSQL mount lives: its collection ids are opaque (`pg1_…`), this names the table. */
export interface OvdbCollectionSource {
  readonly schema?: string;
  readonly name: string;
}

export interface OvdbForeignKeySchema {
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly (string | null)[];
}

export interface OvdbCollectionSchema {
  readonly fields?: Readonly<Record<string, OvdbFieldSchema>>;
  /** Primary key field names in key order; empty when the table has none. */
  readonly primaryKey?: readonly string[];
  readonly foreignKeys?: readonly OvdbForeignKeySchema[];
  readonly source?: OvdbCollectionSource;
}

export interface OvdbDescriptor {
  readonly id: string;
  readonly engine?: string;
  readonly capabilities: OvdbCapabilities;
  readonly collections?: readonly string[];
  readonly schemas?: { readonly collections?: Readonly<Record<string, OvdbCollectionSchema>> };
  /** The pristine published copy of a resettable database. */
  readonly canonical?: { readonly url: string; readonly sha256: string; readonly bytes: number };
  readonly localState?: { readonly modified: boolean };
}

export interface OvdbConnection {
  readonly id: string;
  readonly title: string;
  readonly baseUrl: string;
  readonly databaseId: string;
  readonly fetch: typeof globalThis.fetch;
  readonly descriptor: OvdbDescriptor;
}

/** What the UI may offer for a database, from its descriptor only. */
export interface OvdbUiCapabilities {
  readonly browse: boolean;
  readonly edit: boolean;
  readonly delete: boolean;
  readonly reset: boolean;
  readonly persistent: boolean;
}

export function ovdbUiCapabilities(descriptor: OvdbDescriptor | undefined): OvdbUiCapabilities {
  const c = descriptor?.capabilities ?? {};
  return {
    browse: c.query === true || c.tugql === true,
    edit: c.write === true && c.read === true,
    delete: c.delete === true,
    reset: c.reset === true,
    persistent: c.persistent === true,
  };
}

/**
 * The schema key of a table: a table name is either a collection id as such (SQLite, in-process) or the
 * `source.name` of an opaque collection id (a native PostgreSQL mount, whose ids read `pg1_…`).
 */
function ovdbCollectionId(descriptor: OvdbDescriptor | undefined, collection: string): string | undefined {
  const collections = descriptor?.schemas?.collections;
  if (!collections) return undefined;
  if (Object.hasOwn(collections, collection)) return collection;
  return Object.keys(collections).find((id) => collections[id].source?.name === collection);
}

export function ovdbCollectionSchema(
  descriptor: OvdbDescriptor | undefined,
  collection: string,
): OvdbCollectionSchema | undefined {
  const id = ovdbCollectionId(descriptor, collection);
  return id === undefined ? undefined : descriptor?.schemas?.collections?.[id];
}

/** The collection id the server knows a table by, and the table it names when the mount declares one. */
export function ovdbCollectionTarget(
  descriptor: OvdbDescriptor | undefined,
  collection: string,
): { readonly id: string; readonly source?: OvdbCollectionSource } {
  const id = ovdbCollectionId(descriptor, collection) ?? collection;
  return { id, source: descriptor?.schemas?.collections?.[id]?.source };
}

/** Whether records of a table can be addressed by key for edit/delete, and why not. */
export interface OvdbRecordActions {
  readonly edit: boolean;
  readonly delete: boolean;
  /** Set when the database allows a mutation but this table cannot take it. */
  readonly reason?: string;
  /** The single primary key column, when there is one. */
  readonly keyField?: string;
}

export const NO_SINGLE_COLUMN_KEY = 'This table has no single-column primary key, so its records cannot be edited or deleted by key.';

export function ovdbRecordActions(descriptor: OvdbDescriptor | undefined, collection: string): OvdbRecordActions {
  const caps = ovdbUiCapabilities(descriptor);
  if (!caps.edit && !caps.delete) return { edit: false, delete: false };
  const primaryKey = ovdbCollectionSchema(descriptor, collection)?.primaryKey ?? [];
  if (primaryKey.length !== 1) return { edit: false, delete: false, reason: NO_SINGLE_COLUMN_KEY };
  return { edit: caps.edit, delete: caps.delete, keyField: primaryKey[0] };
}

/**
 * The table names of a descriptor, sorted. A native PostgreSQL mount lists opaque collection ids; its tables
 * are named by their `source` (a name is unique within a dataset: every DemoDB edition uses one schema).
 */
export function ovdbCollections(descriptor: OvdbDescriptor | undefined): readonly string[] {
  const named = descriptor?.collections ?? Object.keys(descriptor?.schemas?.collections ?? {});
  return named.map((id) => descriptor?.schemas?.collections?.[id]?.source?.name ?? id).sort((a, b) => a.localeCompare(b));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates the parts of a descriptor DataTug relies on. */
export function parseOvdbDescriptor(raw: unknown): OvdbDescriptor {
  if (!isRecord(raw) || typeof raw['id'] !== 'string' || !isRecord(raw['capabilities'])) {
    throw new TypeError('invalid OpenVaultDB database descriptor');
  }
  const collections = raw['collections'];
  if (collections !== undefined && !(Array.isArray(collections) && collections.every((name) => typeof name === 'string'))) {
    throw new TypeError('invalid OpenVaultDB descriptor collections');
  }
  return { ...raw, capabilities: withTugqlCapabilities(raw['capabilities']) } as unknown as OvdbDescriptor;
}

export function ovdbDatabaseUrl(baseUrl: string, databaseId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/v1/databases/${encodeURIComponent(databaseId)}`;
}

/** The error of a non-2xx response: its status and the `error.code` / `error.message` of an OVDB error body. */
export async function ovdbHttpError(response: Response, fallbackMessage: string): Promise<OpenVaultDbHttpError> {
  let code = 'unknown';
  let message = fallbackMessage;
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    if (typeof body.error?.code === 'string') code = body.error.code;
    if (typeof body.error?.message === 'string') message = body.error.message;
  } catch {
    /* keep the status only */
  }
  return new OpenVaultDbHttpError(response.status, code, message);
}

/** `GET /v1/databases/{db}`. */
export async function fetchOvdbDescriptor(
  fetchFn: typeof globalThis.fetch,
  baseUrl: string,
  databaseId: string,
): Promise<OvdbDescriptor> {
  const response = await fetchFn(ovdbDatabaseUrl(baseUrl, databaseId), {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok) throw await ovdbHttpError(response, `The database description could not be loaded (HTTP ${response.status}).`);
  return parseOvdbDescriptor(await response.json());
}
