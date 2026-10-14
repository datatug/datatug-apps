// Test doubles for the local DemoDB stack. The OVDB server is the REAL
// `@openvaultdb/inprocess` createOvdbFetch (through createLocalOvdbFetch); only the
// SQLite database under it is a small in-memory DALgo database with a Chinook-like
// schema, foreign keys and reset. The runtime fake stands in for openDemoDb + the worker.
import {
  AlreadyExistsError,
  Key,
  NotFoundError,
  type DatabaseCapabilities,
  type QueryPage,
  type ReadwriteTransaction,
  type RecordSnapshot,
  type StructuredQuery,
} from '@dalgo/core';
import { createOvdbFetch } from '@openvaultdb/inprocess';
import type { DemoSqliteCatalogEntry } from '../queries/demo-sqlite-catalog';
import {
  createLocalOvdbFetch,
  LOCAL_OVDB_BASE_URL,
  type CreateOvdbFetch,
  type LocalSqliteDatabase,
  type LocalSqliteSchema,
  type ModifiedFlag,
} from './local-demodb-host';
import type { DemoDbProgress } from './local-demodb-progress';
import type { LocalDemoDbOpenReport, LocalDemoDbRuntime, LocalDemoDbRuntimeOptions } from './local-demodb.types';
import type { LocalDemoDbEnvironment } from './local-demodb.service';

type Row = Record<string, unknown>;

export const chinookLikeSchema: LocalSqliteSchema = {
  tables: {
    Artist: {
      columns: [
        { name: 'ArtistId', declaredType: 'INTEGER', notNull: true, primaryKeyPosition: 1 },
        { name: 'Name', declaredType: 'NVARCHAR(120)', notNull: false, primaryKeyPosition: 0 },
      ],
      primaryKey: ['ArtistId'],
      foreignKeys: [],
    },
    Album: {
      columns: [
        { name: 'AlbumId', declaredType: 'INTEGER', notNull: true, primaryKeyPosition: 1 },
        { name: 'Title', declaredType: 'NVARCHAR(160)', notNull: true, primaryKeyPosition: 0 },
        { name: 'ArtistId', declaredType: 'INTEGER', notNull: true, primaryKeyPosition: 0 },
      ],
      primaryKey: ['AlbumId'],
      foreignKeys: [{ columns: ['ArtistId'], referencedTable: 'Artist', referencedColumns: ['ArtistId'] }],
    },
    Track: {
      columns: [
        { name: 'TrackId', declaredType: 'INTEGER', notNull: true, primaryKeyPosition: 1 },
        { name: 'Name', declaredType: 'NVARCHAR(200)', notNull: true, primaryKeyPosition: 0 },
        { name: 'UnitPrice', declaredType: 'NUMERIC(10,2)', notNull: true, primaryKeyPosition: 0 },
        { name: 'Cover', declaredType: 'BLOB', notNull: false, primaryKeyPosition: 0 },
      ],
      primaryKey: ['TrackId'],
      foreignKeys: [],
    },
    PlaylistTrack: {
      columns: [
        { name: 'PlaylistId', declaredType: 'INTEGER', notNull: true, primaryKeyPosition: 1 },
        { name: 'TrackId', declaredType: 'INTEGER', notNull: true, primaryKeyPosition: 2 },
      ],
      primaryKey: ['PlaylistId', 'TrackId'],
      foreignKeys: [],
    },
  },
};

export function chinookLikeRows(): Record<string, Row[]> {
  return {
    Artist: [
      { ArtistId: 1, Name: 'AC/DC' },
      { ArtistId: 2, Name: 'Accept' },
      { ArtistId: 3, Name: 'Aerosmith' },
    ],
    Album: [
      { AlbumId: 1, Title: 'For Those About To Rock', ArtistId: 1 },
      { AlbumId: 2, Title: 'Balls to the Wall', ArtistId: 2 },
    ],
    Track: [{ TrackId: 1, Name: 'For Those About To Rock', UnitPrice: 0.99, Cover: null }],
    PlaylistTrack: [{ PlaylistId: 1, TrackId: 1 }],
  };
}

class ConstraintViolationError extends Error {
  readonly code = 'constraint_violation';
  constructor(message: string) {
    super(message);
    this.name = 'ConstraintViolationError';
  }
}

/** A DALgo database over plain arrays, enforcing the schema's single-column foreign keys on delete. */
export class MemorySqliteDatabase implements LocalSqliteDatabase {
  tables: Record<string, Row[]>;
  resets = 0;

  constructor(
    private readonly schemaValue: LocalSqliteSchema = chinookLikeSchema,
    private readonly initial: () => Record<string, Row[]> = chinookLikeRows,
    private readonly caps: DatabaseCapabilities = {
      read: true,
      query: true,
      write: true,
      delete: true,
      reset: true,
      persistent: true,
      joins: false,
      aggregation: false,
    },
  ) {
    this.tables = initial();
  }

  capabilities(): DatabaseCapabilities {
    return this.caps;
  }

  async schema(): Promise<LocalSqliteSchema> {
    return this.schemaValue;
  }

  async reset(): Promise<void> {
    this.tables = this.initial();
    this.resets++;
  }

  #pk(table: string): string {
    const pk = this.schemaValue.tables[table]?.primaryKey ?? [];
    if (pk.length !== 1) throw new Error(`composite primary key: ${table}`);
    return pk[0];
  }

  #find(key: Key): Row | undefined {
    const rows = this.tables[key.collection];
    if (!rows) throw new NotFoundError(key);
    const pk = this.#pk(key.collection);
    return rows.find((row) => String(row[pk]) === String(key.id));
  }

  async get<T>(key: Key): Promise<RecordSnapshot<T>> {
    const row = this.#find(key);
    return row ? { key, exists: true, data: { ...row } as T } : { key, exists: false };
  }

  async getMany<T>(keys: readonly Key[]): Promise<readonly RecordSnapshot<T>[]> {
    return Promise.all(keys.map((key) => this.get<T>(key)));
  }

  async query<T>(query: StructuredQuery<T>): Promise<QueryPage<T>> {
    const name = query.source.name;
    const rows = this.tables[name] ?? [];
    const pk = this.schemaValue.tables[name]?.primaryKey ?? [];
    const limited = query.limit === undefined ? rows : rows.slice(0, query.limit);
    return {
      records: limited.map((row, index) => ({
        key: new Key(name, pk.length === 1 ? (row[pk[0]] as string | number) : JSON.stringify(pk.length ? pk.map((c) => row[c]) : [index])),
        exists: true as const,
        data: { ...row } as T,
      })),
    } as unknown as QueryPage<T>;
  }

  async runReadwriteTransaction<Result>(callback: (tx: ReadwriteTransaction) => Promise<Result>): Promise<Result> {
    const snapshot = structuredClone(this.tables);
    const tx: ReadwriteTransaction = {
      get: (key) => this.get(key),
      getMany: (keys) => this.getMany(keys),
      insert: async (key, data) => {
        if (this.#find(key)) throw new AlreadyExistsError(key);
        this.tables[key.collection].push({ ...(data as Row) });
      },
      set: async (key, data) => {
        const row = this.#find(key);
        if (row) Object.assign(row, data as Row);
        else this.tables[key.collection].push({ ...(data as Row) });
      },
      update: async (key, data) => {
        const row = this.#find(key);
        if (!row) throw new NotFoundError(key);
        Object.assign(row, data);
      },
      delete: async (key) => {
        const row = this.#find(key);
        if (!row) throw new NotFoundError(key);
        const pk = this.#pk(key.collection);
        for (const [child, table] of Object.entries(this.schemaValue.tables)) {
          for (const fk of table.foreignKeys) {
            if (fk.referencedTable === key.collection && this.tables[child]?.some((r) => r[fk.columns[0]] === row[pk])) {
              throw new ConstraintViolationError('FOREIGN KEY constraint failed');
            }
          }
        }
        this.tables[key.collection] = this.tables[key.collection].filter((r) => r !== row);
      },
    };
    try {
      return await callback(tx);
    } catch (error) {
      this.tables = snapshot;
      throw error;
    }
  }
}

export function memoryModifiedFlag(): ModifiedFlag & { value: boolean } {
  const flag = {
    value: false,
    get: () => flag.value,
    set: (modified: boolean) => {
      flag.value = modified;
    },
  };
  return flag;
}

/** A real in-process OVDB fetch over a memory database, with every request recorded. */
export function localOvdbFetchFor(entry: Pick<DemoSqliteCatalogEntry, 'dataset' | 'url' | 'sha256' | 'bytes'>, database = new MemorySqliteDatabase()) {
  const requests: { method: string; url: string; body?: unknown }[] = [];
  const modified = memoryModifiedFlag();
  const inner = createLocalOvdbFetch({
    createOvdbFetch: createOvdbFetch as unknown as CreateOvdbFetch,
    dataset: entry.dataset,
    database,
    canonical: { url: entry.url, sha256: entry.sha256, bytes: entry.bytes },
    modified,
  });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const text = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.clone().text();
    requests.push({ method: request.method, url: request.url, ...(text ? { body: JSON.parse(text) } : {}) });
    return inner(request);
  };
  return { fetch, requests, database, modified, baseUrl: LOCAL_OVDB_BASE_URL };
}

/** Stands in for openDemoDb + the worker: resolves or rejects `ready()` when told to. */
export class FakeLocalDemoDbRuntime implements LocalDemoDbRuntime {
  readonly baseUrl = LOCAL_OVDB_BASE_URL;
  readonly fetch: typeof globalThis.fetch;
  closed = false;
  #role = 'connecting';
  #listeners = new Set<(role: string) => void>();
  #settle!: { resolve(report: LocalDemoDbOpenReport): void; reject(error: unknown): void };
  readonly #ready = new Promise<LocalDemoDbOpenReport>((resolve, reject) => {
    this.#settle = { resolve, reject };
  });
  readonly local: ReturnType<typeof localOvdbFetchFor>;

  constructor(readonly options: LocalDemoDbRuntimeOptions) {
    this.local = localOvdbFetchFor(options.entry);
    this.fetch = this.local.fetch;
  }

  ready(): Promise<LocalDemoDbOpenReport> {
    return this.#ready;
  }
  role(): string {
    return this.#role;
  }
  onRoleChange(listener: (role: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  close(): void {
    this.closed = true;
  }

  progress(message: DemoDbProgress): void {
    this.options.onProgress(message);
  }
  open(report: Partial<LocalDemoDbOpenReport> = {}): void {
    this.#role = 'leader';
    this.#listeners.forEach((listener) => listener('leader'));
    this.#settle.resolve({
      persistent: true,
      replacedPreviousVersion: false,
      imported: false,
      canonicalSha256: this.options.entry.sha256,
      ...report,
    });
  }
  fail(error: unknown): void {
    this.#settle.reject(error);
  }
}

export function fakeEnvironment(overrides: Partial<LocalDemoDbEnvironment> = {}): LocalDemoDbEnvironment & { stored: Map<string, boolean> } {
  const stored = new Map<string, boolean>();
  return {
    stored,
    supportsWorkers: () => true,
    opfsAvailable: async () => true,
    storageEstimate: async () => ({ quota: 10_000_000_000, usage: 0 }),
    isStored: async (entry) => stored.get(entry.dataset) === true,
    markStored: (entry, value) => {
      stored.set(entry.dataset, value);
    },
    ...overrides,
  };
}
