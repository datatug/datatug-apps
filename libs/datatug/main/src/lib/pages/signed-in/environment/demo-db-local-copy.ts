import { key, type QueryPage, type StructuredQuery } from '@dalgo/core';
import { IndexedDbDatabase, withIndexedDbQueryHints } from '@dalgo/indexeddb';
import { JsonNumberToken, strictJson, strictJsonNumbers } from '../../../queries/public-data/strict-json';
import { boundedResponseText } from '../../../queries/public-data/bounded-response';

export const DEMODB_DATASETS = ['chinook', 'northwind', 'pubs', 'sakila', 'adventureworks', 'employees'] as const;
export type DemoDbDataset = (typeof DEMODB_DATASETS)[number];
const base = 'https://demodb.dev/ovdb/v1/databases';
const pageSize = 1000;
const maxPageBytes = 7 << 20;
const maxCopyBytes = 512 << 20;
const maxTables = 200;
const maxColumnsPerTable = 512;
const maxForeignKeysPerTable = 4096;
const maxRows = 1_000_000;

export interface LocalDemoDbConnection {
  readonly id: string;
  readonly dataset: DemoDbDataset;
  readonly environment: 'Dev';
  readonly storage: 'indexeddb';
  readonly tags: readonly string[];
  readonly sourceConnectionId: string;
  readonly sourceStorage: 'sqlite';
  readonly databaseName: string;
  readonly descriptor: string;
  readonly descriptorSha256: string;
  readonly sourceFixtureSha256: string;
  readonly sourceRevision: string;
  readonly provenanceScope: 'descriptor-declared';
  readonly snapshotScope: 'per-table';
  readonly schemaScope: 'ovdb-descriptor-projection';
  readonly tables: readonly { readonly name: string; readonly rowCount: number; readonly columns: readonly SourceColumn[]; readonly primaryKey: readonly SourceKey[]; readonly foreignKeys: readonly SourceForeignKey[]; readonly pageChainSha256: string }[];
  readonly rowCount: number;
  readonly bytesRead: number;
  readonly retiredDatabaseNames: readonly string[];
}

interface SourceColumn { readonly name: string; readonly type: string; readonly transport?: 'json-safe-number-or-decimal-string' | 'json-numeric-wire-token' | 'base64-string' | 'logical-boolean' | 'json-scalar' }
interface SourceKey { readonly column: string; readonly position: number }
interface SourceForeignKey { readonly column: string; readonly table: string; readonly referencedColumn: string | null; readonly constraint: number; readonly position: number }
interface SourceTable {
  readonly name: string;
  readonly kind: string;
  readonly rowCount: number;
  readonly columns: readonly SourceColumn[];
  readonly primaryKey?: readonly SourceKey[];
  readonly foreignKeys?: readonly SourceForeignKey[];
}
interface SourceDescriptor {
  readonly localId: string;
  readonly apiUrl: string;
  readonly recordsets: readonly SourceTable[];
  readonly capabilities: { readonly read: boolean; readonly write: boolean };
  readonly provenance: { readonly sha256: string; readonly revision: string };
}
interface SourceDatabase {
  readonly id: string;
  readonly collections: readonly string[];
  readonly capabilities: { readonly read: boolean; readonly write: boolean; readonly dtql: boolean };
}
interface SourceRow { readonly key: string; readonly data: Record<string, unknown> }
interface SourcePage {
  readonly records: readonly SourceRow[];
  readonly nextPageToken?: string;
  readonly snapshotToken?: string;
  readonly snapshotExpiresAt?: string;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}

function safeDataset(value: string): DemoDbDataset {
  if (!DEMODB_DATASETS.includes(value as DemoDbDataset)) throw new Error('This source is not in the DemoDB copy allowlist.');
  return value as DemoDbDataset;
}

function safeTable(value: string): void {
  if (!/^[\p{L}\p{N}_. -]{1,128}$/u.test(value) || value.trim() !== value || value === '.' || value === '..') {
    throw new Error('Unsafe source table name.');
  }
}

function validateKeys(table: SourceTable, tableNames: ReadonlySet<string>): void {
  const columnNames = new Set(table.columns.map((column) => column.name));
  const positions = new Set<number>();
  let lastPosition = 0;
  for (const part of table.primaryKey ?? []) {
    if (!columnNames.has(part.column) || !Number.isSafeInteger(part.position) || part.position < 1 || positions.has(part.position)) {
      throw new Error(`Invalid primary key metadata for ${table.name}.`);
    }
    positions.add(part.position);
    lastPosition = Math.max(lastPosition, part.position);
  }
  if (positions.size && lastPosition !== positions.size) throw new Error(`Gapped primary key metadata for ${table.name}.`);
  const constraints = new Map<number, Set<number>>();
  for (const foreign of table.foreignKeys ?? []) {
    if (!columnNames.has(foreign.column) || !tableNames.has(foreign.table) ||
        (foreign.referencedColumn !== null && (typeof foreign.referencedColumn !== 'string' || !foreign.referencedColumn)) ||
        !Number.isSafeInteger(foreign.constraint) || foreign.constraint < 0 ||
        !Number.isSafeInteger(foreign.position) || foreign.position < 0) {
      throw new Error(`Invalid foreign key metadata for ${table.name}.`);
    }
    const parts = constraints.get(foreign.constraint) ?? new Set<number>();
    if (parts.has(foreign.position)) throw new Error(`Duplicate foreign key position for ${table.name}.`);
    parts.add(foreign.position);
    constraints.set(foreign.constraint, parts);
  }
  for (const parts of constraints.values()) {
    let last = -1;
    for (const position of parts) last = Math.max(last, position);
    if (last !== parts.size - 1) throw new Error(`Gapped foreign key metadata for ${table.name}.`);
  }
}

function validateReferencedKeys(table: SourceTable, tables: ReadonlyMap<string, SourceTable>): void {
  const groups = new Map<number, SourceForeignKey[]>();
  for (const foreign of table.foreignKeys ?? []) {
    const target = tables.get(foreign.table);
    if (!target) throw new Error(`Missing relationship target for ${table.name}.`);
    if (foreign.referencedColumn !== null && !target.columns.some((column) => column.name === foreign.referencedColumn)) {
      throw new Error(`Invalid relationship target column for ${table.name}.`);
    }
    groups.set(foreign.constraint, [...(groups.get(foreign.constraint) ?? []), foreign]);
  }
  for (const group of groups.values()) {
    const target = tables.get(group[0].table);
    if (!target || group.some((entry) => entry.table !== target.name)) throw new Error(`Mixed relationship target for ${table.name}.`);
    if (group.some((entry) => entry.referencedColumn === null) &&
        (!target.primaryKey?.length || target.primaryKey.length !== group.length)) {
      throw new Error(`Unresolved relationship target key for ${table.name}.`);
    }
  }
}

function sourceColumn(column: SourceColumn): SourceColumn {
  const type = column.type.toUpperCase();
  const transport: NonNullable<SourceColumn['transport']> = /^(?:INTEGER|INT|BIGINT|SMALLINT|TINYINT)(?:\b|$)/.test(type)
    ? 'json-safe-number-or-decimal-string'
    : /^(?:DECIMAL_TEXT|DECIMAL|NUMERIC|REAL|FLOAT|DOUBLE)(?:\b|$)/.test(type)
      ? 'json-numeric-wire-token'
      : /^(?:BLOB|BINARY|VARBINARY)(?:\b|$)/.test(type)
        ? 'base64-string'
        : /^(?:BOOL|BOOLEAN)(?:\b|$)/.test(type) ? 'logical-boolean' : 'json-scalar';
  return { name: column.name, type: column.type, transport };
}

function numericKind(type: string): 'integer' | 'decimal' | 'boolean' | undefined {
  if (/^(?:INTEGER|INT|BIGINT|SMALLINT|TINYINT)(?:\b|$)/i.test(type)) return 'integer';
  if (/^(?:DECIMAL_TEXT|DECIMAL|NUMERIC|REAL|FLOAT|DOUBLE)(?:\b|$)/i.test(type)) return 'decimal';
  if (/^(?:BOOL|BOOLEAN)(?:\b|$)/i.test(type)) return 'boolean';
  return undefined;
}

function validDecimal(value: string): boolean {
  if (value.length > 1100) return false;
  const match = /^[+-]?(?:(?:\d+(?:\.(\d*))?)|(?:\.(\d+)))(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) return false;
  const exponent = Number(match[3] ?? 0);
  const scale = (match[1]?.length ?? match[2]?.length ?? 0) - exponent;
  return Number.isSafeInteger(scale) && Math.abs(scale) <= 1000;
}

function convertNumber(value: JsonNumberToken, columnType: string): string | number | boolean {
  const kind = numericKind(columnType);
  if (kind === 'integer') {
    if (value.token.length > 1100 || !/^-?(?:0|[1-9]\d*)$/.test(value.token)) throw new Error('Source integer is not integral or is too wide.');
    const asNumber = Number(value.token);
    return Number.isSafeInteger(asNumber) ? asNumber : value.token;
  }
  if (kind === 'boolean') {
    if (value.token !== '0' && value.token !== '1') throw new Error('Source boolean is not 0 or 1.');
    return value.token === '1';
  }
  if (kind !== 'decimal' || !validDecimal(value.token)) throw new Error('Unexpected numeric source value for this column.');
  // A decimal string preserves the exact JSON wire token, including a value
  // wider than JavaScript's safe integer range.
  return value.token;
}

function canonicalBase64(value: string): boolean {
  if (value === '') return true;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  return btoa(atob(value)) === value;
}

function sourceRecord(raw: unknown, table: SourceTable): SourceRow {
  const value = object(raw, 'source record');
  const rowKey = value['key'];
  const rawData = object(value['data'], 'source record data');
  if (typeof rowKey !== 'string' || !rowKey.startsWith(`${table.name}/`) || rowKey.length > 1024) {
    throw new Error(`Invalid source key for ${table.name}.`);
  }
  const known = new Map(table.columns.map((column) => [column.name, column.type]));
  const data: Record<string, unknown> = {};
  for (const [field, cell] of Object.entries(rawData)) {
    // OVDB adds an `id` transport alias that is not a source SQL column.
    if (!known.has(field) && field !== 'id') throw new Error(`Unexpected source field ${field}.`);
    if (field === 'id' && !known.has(field)) continue;
    if (/^(?:BLOB|BINARY|VARBINARY)(?:\b|$)/i.test(known.get(field) ?? '') &&
        cell !== null && (typeof cell !== 'string' || !canonicalBase64(cell))) {
      throw new Error(`Invalid base64 source value for ${field}.`);
    }
    if (cell instanceof JsonNumberToken) data[field] = convertNumber(cell, known.get(field) ?? 'INTEGER');
    else if (typeof cell === 'string' && numericKind(known.get(field) ?? '') === 'integer') {
      if (cell.length > 1100 || !/^-?(?:0|[1-9]\d*)$/.test(cell)) throw new Error(`Invalid integer source value for ${field}.`);
      data[field] = cell;
    } else if (typeof cell === 'string' && numericKind(known.get(field) ?? '') === 'decimal') {
      if (!validDecimal(cell)) throw new Error(`Invalid numeric source value for ${field}.`);
      data[field] = cell;
    } else if (typeof cell === 'string' && numericKind(known.get(field) ?? '') === 'boolean') {
      throw new Error(`Invalid boolean source value for ${field}.`);
    } else if (typeof cell === 'boolean' && numericKind(known.get(field) ?? '') !== 'boolean') {
      throw new Error(`Invalid boolean source value for ${field}.`);
    } else if (cell === null || typeof cell === 'string' || typeof cell === 'boolean') data[field] = cell;
    else throw new Error(`Unsupported source value for ${field}.`);
  }
  for (const column of table.columns) {
    if (!(column.name in data)) throw new Error(`Missing source field ${column.name}.`);
  }
  return { key: rowKey, data };
}

async function responseText(response: Response, signal: AbortSignal): Promise<{ text: string; bytes: number }> {
  if (!response.ok) throw new Error(`The public OVDB source returned ${response.status}.`);
  return boundedResponseText(response, maxPageBytes, signal);
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function closeSnapshot(httpFetch: typeof fetch, url: string, body: string, snapshot: string): Promise<void> {
  const controller = new AbortController();
  const headers = new Headers({ 'Content-Type': 'application/json', 'OVDB-Page-Size': String(pageSize),
    'OVDB-Page-Token': snapshot, 'OVDB-Page-Close': 'true' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      httpFetch(url, { method: 'POST', headers, body, signal: controller.signal,
        redirect: 'error', cache: 'no-store', credentials: 'omit' }).then(() => undefined, () => undefined),
      new Promise<void>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(); }, 3000); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseSource<T>(text: string, label: string, exactNumbers = false): T {
  return object(exactNumbers ? strictJsonNumbers(text) : strictJson(text), label) as T;
}

async function deleteDatabase(factory: IDBFactory, name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.addEventListener('success', () => resolve(), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('Failed to remove incomplete copy.')), { once: true });
    request.addEventListener('blocked', () => reject(new Error('Close other tabs to remove the old local copy.')), { once: true });
  });
}

/** Explicit, local-only copy. The pointer is committed after all tables pass. */
export class DemoDbLocalCopy {
  private readonly metadata: IndexedDbDatabase;

  constructor(
    private readonly factory: IDBFactory = globalThis.indexedDB,
    private readonly httpFetch: typeof fetch = globalThis.fetch,
  ) {
    this.metadata = new IndexedDbDatabase({ name: 'datatug-demo-dev-connections', version: 1, factory });
  }

  async connection(dataset: string): Promise<LocalDemoDbConnection | undefined> {
    const id = safeDataset(dataset);
    const snapshot = await this.metadata.get<LocalDemoDbConnection>(key('connections', `dev/${id}`));
    return snapshot.exists ? snapshot.data : undefined;
  }

  async copy(dataset: string, expectedFixtureSha256: string, signal: AbortSignal, progress?: (done: number, total: number, table: string) => void): Promise<LocalDemoDbConnection> {
    const id = safeDataset(dataset);
    if (!/^[a-f0-9]{64}$/.test(expectedFixtureSha256)) throw new Error('Missing pinned DemoDB source fixture.');
    signal.throwIfAborted();
    const sourceBase = `${base}/${id}`;
    const [databaseResponse, descriptorResponse] = await Promise.all([
      this.httpFetch(sourceBase, { signal, redirect: 'error', cache: 'no-store', credentials: 'omit' }),
      this.httpFetch(`https://demodb.dev/ovdb/db/${id}/ovdb-database.json`, { signal, redirect: 'error', cache: 'no-store', credentials: 'omit' }),
    ]);
    const databaseWire = await responseText(databaseResponse, signal);
    const descriptorWire = await responseText(descriptorResponse, signal);
    const database = parseSource<SourceDatabase>(databaseWire.text, 'OVDB database');
    const descriptor = parseSource<SourceDescriptor>(descriptorWire.text, 'OVDB descriptor');
    if (database.id !== id || descriptor.localId !== id || descriptor.apiUrl !== sourceBase ||
        !database.capabilities?.read || database.capabilities.write || !database.capabilities.dtql ||
        !descriptor.capabilities?.read || descriptor.capabilities.write ||
        descriptor.provenance?.sha256 !== expectedFixtureSha256 ||
        !/^[a-f0-9]{40}$/.test(descriptor.provenance?.revision ?? '') ||
        !Array.isArray(database.collections) || !Array.isArray(descriptor.recordsets) ||
        descriptor.recordsets.length < 1 || descriptor.recordsets.length > maxTables) {
      throw new Error('The OVDB database does not match the selected read-only edition.');
    }
    const tables = descriptor.recordsets.filter((table) => table.kind === 'table');
    const tableNames = new Set(tables.map((table) => table.name));
    const tableByName = new Map(tables.map((table) => [table.name, table]));
    if (tables.length !== database.collections.length ||
        new Set(database.collections).size !== database.collections.length ||
        new Set(tables.map((table) => table.name)).size !== tables.length ||
        tables.some((table) => !database.collections.includes(table.name))) throw new Error('OVDB table metadata changed.');
    let total = 0;
    for (const table of tables) {
      safeTable(table.name);
      if (!Number.isSafeInteger(table.rowCount) || table.rowCount < 0 || !Array.isArray(table.columns) ||
          table.columns.length < 1 || table.columns.length > maxColumnsPerTable ||
          !Array.isArray(table.primaryKey) || table.primaryKey.length > maxColumnsPerTable ||
          !Array.isArray(table.foreignKeys) || table.foreignKeys.length > maxForeignKeysPerTable ||
          table.columns.some((column: SourceColumn) => typeof column.name !== 'string' || !column.name || typeof column.type !== 'string' || !column.type) ||
          new Set(table.columns.map((column: SourceColumn) => column.name)).size !== table.columns.length) {
        throw new Error(`Invalid source schema for ${table.name}.`);
      }
      validateKeys(table, tableNames);
      validateReferencedKeys(table, tableByName);
      total += table.rowCount;
      if (total > maxRows) throw new Error('The source exceeds the local-copy row bound.');
    }
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    const available = estimate?.quota !== undefined && estimate.usage !== undefined
      ? estimate.quota - estimate.usage : undefined;
    const minimumCapacity = Math.min(maxCopyBytes, Math.max(16 << 20, total * 512));
    if (available !== undefined && available < minimumCapacity) {
      throw new Error('Browser storage capacity is too low for this copy.');
    }
    const databaseName = `datatug-demo-dev-${id}-${crypto.randomUUID()}`;
    const stage = new IndexedDbDatabase({ name: databaseName, version: 1, factory: this.factory });
    let committed = false;
    let done = 0;
    let bytesRead = databaseWire.bytes + descriptorWire.bytes;
    const tableReceipts: { name: string; rowCount: number; columns: readonly SourceColumn[]; primaryKey: readonly SourceKey[]; foreignKeys: readonly SourceForeignKey[]; pageChainSha256: string }[] = [];
    try {
      for (const table of tables) {
        signal.throwIfAborted();
        const body = JSON.stringify({ query: `from: {name: ${JSON.stringify(table.name)}}\n` });
        let token: string | undefined;
        let snapshot: string | undefined;
        const seen = new Set<string>();
        let tableRows = 0;
        let pageChain = await digest('');
        try {
          for (;;) {
            signal.throwIfAborted();
            const headers = new Headers({ 'Content-Type': 'application/json', 'Accept': 'application/json', 'OVDB-Page-Size': String(pageSize) });
            if (token) headers.set('OVDB-Page-Token', token);
            const response = await this.httpFetch(`${sourceBase}/dtql`, { method: 'POST', headers, body, signal, redirect: 'error', cache: 'no-store', credentials: 'omit' });
            const pageWire = await responseText(response, signal);
            bytesRead += pageWire.bytes;
            if (bytesRead > maxCopyBytes) throw new Error('The source exceeds the browser-copy byte bound.');
            const page = parseSource<SourcePage>(pageWire.text, 'OVDB page', true);
            if (!Array.isArray(page.records) || page.records.length > pageSize ||
                typeof page.snapshotToken !== 'string' || !page.snapshotToken ||
                (snapshot && page.snapshotToken !== snapshot) ||
                typeof page.snapshotExpiresAt !== 'string' ||
                !Number.isFinite(Date.parse(page.snapshotExpiresAt)) ||
                Date.parse(page.snapshotExpiresAt) <= Date.now() ||
                (page.nextPageToken !== undefined && (typeof page.nextPageToken !== 'string' || !page.nextPageToken))) {
              throw new Error('The source returned an inconsistent page.');
            }
            snapshot = page.snapshotToken ?? snapshot;
            const rows = page.records.map((record) => sourceRecord(record, table));
            pageChain = await digest(`${pageChain}\n${pageWire.text}`);
            await stage.runReadwriteTransaction(async (tx) => {
              for (const row of rows) await tx.insert(key(`main.${table.name}`, row.key), row.data);
            });
            done += rows.length;
            tableRows += rows.length;
            if (tableRows > table.rowCount) throw new Error(`The source returned too many ${table.name} rows.`);
            progress?.(done, total, table.name);
            if (!page.nextPageToken) break;
            if (!page.records.length || seen.has(page.nextPageToken)) throw new Error('The source page did not advance.');
            seen.add(page.nextPageToken);
            token = page.nextPageToken;
          }
        } finally {
          if (snapshot) {
            await closeSnapshot(this.httpFetch, `${sourceBase}/dtql`, body, snapshot);
          }
        }
        if (tableRows !== table.rowCount) throw new Error(`The source returned ${tableRows} ${table.name} rows, expected ${table.rowCount}.`);
        tableReceipts.push({ name: table.name, rowCount: tableRows, columns: table.columns.map(sourceColumn),
          primaryKey: table.primaryKey ?? [], foreignKeys: table.foreignKeys ?? [], pageChainSha256: pageChain });
      }
      signal.throwIfAborted();
      const [afterDatabase, afterDescriptor] = await Promise.all([
        this.httpFetch(sourceBase, { signal, redirect: 'error', cache: 'no-store', credentials: 'omit' }),
        this.httpFetch(`https://demodb.dev/ovdb/db/${id}/ovdb-database.json`, { signal, redirect: 'error', cache: 'no-store', credentials: 'omit' }),
      ]);
      const afterDatabaseWire = await responseText(afterDatabase, signal);
      const afterDescriptorWire = await responseText(afterDescriptor, signal);
      bytesRead += afterDatabaseWire.bytes + afterDescriptorWire.bytes;
      if (bytesRead > maxCopyBytes || afterDatabaseWire.text !== databaseWire.text ||
          afterDescriptorWire.text !== descriptorWire.text) {
        throw new Error('The DemoDB source changed while the local copy was being prepared.');
      }
      const staged: LocalDemoDbConnection = {
        id: `${id}-indexeddb-local`, dataset: id, environment: 'Dev', storage: 'indexeddb',
        tags: [id, 'indexeddb', 'local'], sourceConnectionId: `${id}-sqlite`, sourceStorage: 'sqlite', databaseName,
        descriptor: `https://demodb.dev/ovdb/db/${id}/ovdb-database.json`,
        descriptorSha256: await digest(descriptorWire.text),
        sourceFixtureSha256: descriptor.provenance.sha256,
        sourceRevision: descriptor.provenance.revision,
        provenanceScope: 'descriptor-declared',
        snapshotScope: 'per-table', schemaScope: 'ovdb-descriptor-projection',
        tables: tableReceipts,
        rowCount: done,
        bytesRead,
        retiredDatabaseNames: [],
      };
      const connection = await this.metadata.runReadwriteTransaction(async (tx) => {
        const pointer = key('connections', `dev/${id}`);
        const previous = await tx.get<LocalDemoDbConnection>(pointer);
        if (previous.exists && previous.data.retiredDatabaseNames.length >= 2) {
          throw new Error('Clear old local copies before refreshing this connection again.');
        }
        const retiredDatabaseNames = previous.exists
          ? [...(previous.data.retiredDatabaseNames ?? []), previous.data.databaseName]
          : [];
        const promoted = { ...staged, retiredDatabaseNames };
        await tx.set(pointer, promoted);
        return promoted;
      });
      committed = true;
      await stage.close();
      // Keep retired generations so a reader that opened an older pointer can
      // finish. A separate explicit cleanup can reclaim them after readers end.
      return connection;
    } finally {
      await stage.close();
      if (!committed) await deleteDatabase(this.factory, databaseName).catch(() => undefined);
    }
  }

  async query<T extends Record<string, unknown>>(dataset: string, table: string, query: Omit<StructuredQuery<T>, 'source'>): Promise<QueryPage<T>> {
    const id = safeDataset(dataset);
    const read = async () => {
      const connection = await this.connection(id);
      if (!connection || !connection.tables.some((entry) => entry.name === table)) throw new Error('No completed local Dev connection for this table.');
      const numeric = connection.tables.find((entry) => entry.name === table)?.columns
        .filter((column) => column.transport === 'json-numeric-wire-token' || column.transport === 'json-safe-number-or-decimal-string')
        .map((column) => column.name) ?? [];
      const database = new IndexedDbDatabase({ name: connection.databaseName, version: 1, factory: this.factory });
      try {
        return await database.query<T>(withIndexedDbQueryHints(
          { ...query, source: { kind: 'collection', name: `main.${table}` } },
          { numericFields: numeric },
        ));
      } finally {
        await database.close();
      }
    };
    const locks = globalThis.navigator?.locks;
    return locks ? locks.request(`datatug-demodb-copy-${id}`, { mode: 'shared' }, read) : read();
  }

  /** Reclaim old copies after all browser tabs release their readers. */
  async clearRetired(dataset: string): Promise<number> {
    const id = safeDataset(dataset);
    const locks = globalThis.navigator?.locks;
    if (!locks) throw new Error('Safe cleanup needs browser Web Locks support.');
    return locks.request(`datatug-demodb-copy-${id}`, { mode: 'exclusive' }, async () => {
      const current = await this.connection(id);
      if (!current) return 0;
      const retired = [...new Set(current.retiredDatabaseNames)];
      const ownedName = new RegExp(`^datatug-demo-dev-${id}-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`);
      if (retired.some((name) => !ownedName.test(name) || name === current.databaseName)) {
        throw new Error('The old-copy list contains a database outside this DemoDB connection.');
      }
      for (const name of retired) await deleteDatabase(this.factory, name);
      await this.metadata.runReadwriteTransaction(async (tx) => {
        const pointer = key('connections', `dev/${id}`);
        const latest = await tx.get<LocalDemoDbConnection>(pointer);
        if (latest.exists) await tx.set(pointer, {
          ...latest.data,
          retiredDatabaseNames: latest.data.retiredDatabaseNames.filter((name) => !retired.includes(name)),
        });
      });
      return retired.length;
    });
  }

  async close(): Promise<void> { await this.metadata.close(); }
}
