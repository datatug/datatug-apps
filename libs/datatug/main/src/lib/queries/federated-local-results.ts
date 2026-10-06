import type { TypedValue } from '@sneat/datatug-semantic';
import { decodeTypedValue } from '@sneat/datatug-semantic';
import { decodeResult } from '@sneat/datatug-semantic';
import type { IProjectRef } from '../core/project-context';
import type { IQueryDef } from '../models/definition/query-def';
import type { FederatedQueryResult } from './federated-query-executor';
import { localResultBytes as bytes } from './local-result-bytes';
import { assertHistoricalNativeGraphPlan, graphStableIdentity, graphStorageOverhead } from './public-data/native-graph-executor';

export interface LocalResultRef {
  readonly id: string;
  readonly generation: number;
}
export interface LocalResultScope {
  readonly projectRef: IProjectRef;
  readonly queryId: string;
}
export interface LocalResultDescriptor extends LocalResultRef {
  readonly database: string;
  readonly observedAt: string;
  readonly planIdentity: string;
  readonly executedDefinition: IQueryDef;
  readonly result: FederatedQueryResult;
  readonly counts: Readonly<Record<'affiliations' | 'locations' | 'aliases', number>>;
  readonly rowBytes: number;
  readonly descriptorBytes: number;
}
interface Ownership {
  readonly committed: true;
  readonly associations: readonly LocalResultScope[];
}
interface CatalogEntry extends LocalResultRef {
  readonly database: string;
  readonly associations: readonly LocalResultScope[];
}
const catalogName = 'datatug-local-results-v1';
const unavailable = (): Error => new Error('No local result available. The local artifact is missing or corrupt.');
const stores = ['rows', 'relatedRows', 'metadata'];
const sets = ['affiliations', 'locations', 'aliases'] as const;
const validRef = (ref: LocalResultRef): boolean => /^datatug-output-\d+-[a-f0-9-]+$/.test(ref.id) && Number.isSafeInteger(ref.generation) && ref.generation > 0;
const sameScope = (a: LocalResultScope, b: LocalResultScope): boolean => a.queryId === b.queryId && a.projectRef.storeId === b.projectRef.storeId && a.projectRef.projectId === b.projectRef.projectId;

function validRows(rows: readonly (readonly TypedValue[])[], columns: number): boolean {
  return rows.every((row) => Array.isArray(row) && row.length === columns && row.every((cell) => {
    if (!cell || typeof cell !== 'object') return false;
    try { decodeTypedValue(cell); return true; } catch { return false; }
  }));
}

function validateDescriptor(value: unknown, database: string): LocalResultDescriptor {
  const d = value as LocalResultDescriptor | undefined;
  if (!d || !validRef(d) || d.id !== database || d.database !== database ||
      !d.executedDefinition?.federation?.nativeGraph || !d.result?.nativeGraph ||
      d.planIdentity !== d.result.nativeGraph.planIdentity || typeof d.planIdentity !== 'string' ||
      !d.observedAt || !Number.isFinite(Date.parse(d.observedAt)) ||
      d.result.localResult?.id !== d.id || d.result.localResult.generation !== d.generation ||
      !d.counts || sets.some((set) => !Number.isSafeInteger(d.counts[set]) || d.counts[set] < 0) ||
      sets.reduce((n, set) => n + d.counts[set], 0) > 5000 ||
      !Number.isSafeInteger(d.rowBytes) || d.rowBytes < 0 ||
      !Number.isSafeInteger(d.descriptorBytes) || d.descriptorBytes < 0 ||
      d.rowBytes + d.descriptorBytes > 5242880 ||
      d.result.recordset.rows.length || d.result.totalRows !== d.counts.affiliations ||
      d.result.relatedRecordsets?.some((set) => !['locations', 'aliases'].includes(set.id) || set.recordset.rows.length || set.totalRows !== d.counts[set.id as 'locations' | 'aliases']) ||
      new Set(d.result.relatedRecordsets?.map((set) => set.id)).size !== (d.result.relatedRecordsets?.length ?? 0)) throw unavailable();
  const payload = Object.fromEntries(Object.entries(d).filter(([key]) => key !== 'descriptorBytes'));
  if (bytes(payload) !== d.descriptorBytes) throw unavailable();
  try {
    assertHistoricalNativeGraphPlan(d.executedDefinition.federation.nativeGraph);
    if (graphStableIdentity(d.executedDefinition.federation.nativeGraph) !== d.planIdentity) throw unavailable();
    decodeResult({ recordset: d.result.recordset, limitations: d.result.limitations, bindingsApplied: d.result.bindingsApplied, provenance: d.result.provenance, truncated: d.result.truncated, ...(d.result.sourceRights !== undefined ? { sourceRights: d.result.sourceRights } : {}), ...(d.result.usedSourceIds !== undefined ? { usedSourceIds: d.result.usedSourceIds } : {}) });
    for (const set of d.result.relatedRecordsets ?? []) {
      if (typeof set.label !== 'string' || typeof set.parentField !== 'string' || set.parentSet !== (set.id === 'locations' ? 'affiliations' : 'locations')) throw unavailable();
      decodeResult({ recordset: set.recordset, limitations: [], bindingsApplied: [], provenance: d.result.provenance, truncated: d.result.truncated });
    }
  } catch { throw unavailable(); }
  return d;
}

export function createOutputStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains('rows')) db.createObjectStore('rows', { autoIncrement: true });
  if (!db.objectStoreNames.contains('relatedRows')) db.createObjectStore('relatedRows', { keyPath: ['set', 'index'] });
  if (!db.objectStoreNames.contains('metadata')) db.createObjectStore('metadata');
}

/** Pure persisted envelope builder shared with the engine startup reservation.
 * It neither clones output rows nor touches IndexedDB. */
export function buildLocalResultDescriptor(
  database: string, definition: IQueryDef, result: FederatedQueryResult,
  rows: readonly (readonly TypedValue[])[], generation: number,
): LocalResultDescriptor {
  if (!definition.federation?.nativeGraph || !result.nativeGraph || !validRows(rows, result.recordset.columns.length)) throw unavailable();
  const related = result.relatedRecordsets ?? [];
  if (new Set(related.map((set) => set.id)).size !== related.length || related.some((set) => !['locations', 'aliases'].includes(set.id) || set.totalRows !== set.recordset.rows.length || !validRows(set.recordset.rows, set.recordset.columns.length))) throw unavailable();
  const counts = { affiliations: rows.length, locations: 0, aliases: 0 };
  let rowBytes = rows.reduce((n, row) => n + bytes(row), 0);
  for (const set of related) {
    counts[set.id as 'locations' | 'aliases'] = set.totalRows;
    rowBytes += set.recordset.rows.reduce((n, row, index) => n + bytes({ set: set.id, index, rows: row }), 0);
  }
  const ref = { id: database, generation };
  const metadataResult: FederatedQueryResult = {
    ...result, localResult: ref, totalRows: rows.length,
    recordset: { ...result.recordset, rows: [] },
    relatedRecordsets: related.map((set) => ({ ...set, recordset: { ...set.recordset, rows: [] } })),
  };
  const payload = { ...ref, database, observedAt: result.provenance.observedAt,
    planIdentity: result.nativeGraph.planIdentity, executedDefinition: definition, result: metadataResult, counts, rowBytes };
  const descriptor = validateDescriptor({ ...payload, descriptorBytes: bytes(payload) }, database);
  return descriptor;
}

/** All requests are enqueued synchronously while the transaction is active. A failed
 * enqueue aborts the transaction; neither counts nor ownership publish before completion. */
export async function replaceGraphOutput(
  db: IDBDatabase, definition: IQueryDef, result: FederatedQueryResult,
  rows: readonly (readonly TypedValue[])[], generation: number,
  signal?: AbortSignal,
  reserveMetadata?: (bytes: number) => void,
  reserveStorage?: (bytes: number) => void,
): Promise<LocalResultDescriptor> {
  const descriptor = buildLocalResultDescriptor(db.name, definition, result, rows, generation);
  const related = result.relatedRecordsets ?? [];
  const previousOwnership = await new Promise<Ownership | undefined>((resolve, reject) => {
    const tx = db.transaction('metadata'), request = tx.objectStore('metadata').get('ownership');
    tx.oncomplete = () => resolve(request.result as Ownership | undefined);
    tx.onabort = () => reject(tx.error ?? unavailable());
  });
  const reservedOwnershipBytes = bytes({ committed: true, associations: previousOwnership?.associations ?? [] });
  const storedDescriptorBytes = bytes(descriptor);
  if (descriptor.rowBytes + storedDescriptorBytes + reservedOwnershipBytes > 5242880) throw unavailable();
  reserveStorage?.(graphStorageOverhead({ recordset: { ...result.recordset, rows }, relatedRecordsets: result.relatedRecordsets ?? [] }));
  reserveMetadata?.(storedDescriptorBytes + reservedOwnershipBytes);
  if (signal?.aborted) throw new Error('The query was cancelled.');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    const cancel = (): void => { try { tx.abort(); } catch { /* Already completed. */ } };
    signal?.addEventListener('abort', cancel, { once: true });
    const finish = (): void => signal?.removeEventListener('abort', cancel);
    tx.oncomplete = () => { finish(); resolve(descriptor); };
    tx.onerror = () => { /* Default request handling aborts the transaction. */ };
    tx.onabort = () => { finish(); reject(tx.error ?? new Error('The result replacement was cancelled.')); };
    try {
      const primary = tx.objectStore('rows'), secondary = tx.objectStore('relatedRows'), metadata = tx.objectStore('metadata');
      const ownership = metadata.get('ownership');
      ownership.onsuccess = () => {
        try {
          const next = { committed: true, associations: (ownership.result as Ownership | undefined)?.associations ?? [] } satisfies Ownership;
          if (bytes(next) > reservedOwnershipBytes) throw new Error('Local result ownership changed during replacement.');
          metadata.put(next, 'ownership');
        }
        catch (error) { cancel(); reject(error); }
      };
      primary.clear(); secondary.clear();
      rows.forEach((row, index) => primary.put(row, index + 1));
      for (const set of related) set.recordset.rows.forEach((row, index) => secondary.put({ set: set.id, index, rows: row }));
      metadata.put(descriptor, 'descriptor');
    } catch (error) { cancel(); reject(error); }
  });
}

async function openExisting(name: string): Promise<IDBDatabase>;
async function openExisting(name: string, allowAbsent: true): Promise<IDBDatabase | undefined>;
async function openExisting(name: string, allowAbsent = false): Promise<IDBDatabase | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let absent = false;
    request.onupgradeneeded = () => {
      absent = true;
      request.transaction?.abort(); // Never reconstruct a missing artifact.
    };
    request.onerror = () => {
      if (absent && request.error?.name === 'AbortError') {
        if (allowAbsent) resolve(undefined);
        else reject(unavailable());
      }
      else reject(request.error ?? unavailable());
    };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
  });
}
async function catalog(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(catalogName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('results', { keyPath: 'id' });
    request.onerror = () => reject(request.error ?? unavailable());
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
async function catalogEntries(): Promise<CatalogEntry[]> {
  const db = await catalog();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('results'), request = tx.objectStore('results').getAll();
    tx.oncomplete = () => resolve(request.result as CatalogEntry[]);
    tx.onabort = () => reject(tx.error ?? unavailable());
  }); } finally { db.close(); }
}
async function writeCatalog(entry: CatalogEntry): Promise<void> {
  const db = await catalog();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('results', 'readwrite');
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? unavailable());
    try { tx.objectStore('results').put(entry); } catch (error) { tx.abort(); reject(error); }
  }); } finally { db.close(); }
}
async function readMetadata(db: IDBDatabase): Promise<{ descriptor: LocalResultDescriptor; ownership: Ownership }> {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('metadata')) { reject(unavailable()); return; }
    const tx = db.transaction('metadata'), store = tx.objectStore('metadata');
    const descriptor = store.get('descriptor'), ownership = store.get('ownership');
    tx.oncomplete = () => {
      try {
        if (ownership.result?.committed !== true || !Array.isArray(ownership.result.associations)) throw unavailable();
        const d = validateDescriptor(descriptor.result, db.name);
        if (d.rowBytes + bytes(d) + bytes(ownership.result) > 5242880) throw unavailable();
        resolve({ descriptor: d, ownership: ownership.result as Ownership });
      } catch (error) { reject(error); }
    };
    tx.onabort = () => reject(tx.error ?? unavailable());
  });
}
export async function registerLocalResult(descriptor: LocalResultDescriptor): Promise<void> {
  const db = await openExisting(descriptor.database);
  try { const current = await readMetadata(db); await writeCatalog({ id: current.descriptor.id, generation: current.descriptor.generation, database: db.name, associations: current.ownership.associations }); }
  finally { db.close(); }
}
/** Commit is authoritative even if the tab crashed before registering its catalog entry. */
export async function reconcileLocalResults(): Promise<void> {
  if (typeof indexedDB.databases !== 'function') return;
  for (const item of await indexedDB.databases()) {
    if (!item.name?.startsWith('datatug-output-')) continue;
    const db = await openExisting(item.name);
    try {
      if (!db.objectStoreNames.contains('metadata')) continue;
      const current = await readMetadata(db).catch(() => undefined);
      if (current) await writeCatalog({ id: current.descriptor.id, generation: current.descriptor.generation, database: db.name, associations: current.ownership.associations });
    } finally { db.close(); }
  }
}
export async function listLocalResults(scope?: LocalResultScope, onUnavailable?: (message: string) => void): Promise<LocalResultDescriptor[]> {
  await reconcileLocalResults();
  const result: LocalResultDescriptor[] = [];
  for (const entry of await catalogEntries()) {
    if (scope && !entry.associations.some((association) => sameScope(scope, association))) continue;
    try {
      const db = await openExisting(entry.database);
      try { result.push((await readMetadata(db)).descriptor); } finally { db.close(); }
    } catch (error) {
      const message = `${entry.id}: ${error instanceof Error ? error.message : 'No local result available.'}`;
      if (!onUnavailable) throw new Error(message);
      onUnavailable(message);
    }
  }
  return result.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
}

export async function readLocalResultPage(ref: LocalResultRef, page: number, set = 'affiliations'): Promise<TypedValue[][]> {
  if (!validRef(ref) || !Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(page * 100 + 100)) throw unavailable();
  if (!sets.includes(set as typeof sets[number])) throw new Error('Unknown related result set.');
  const db = await openExisting(ref.id);
  try { return await new Promise((resolve, reject) => {
    const related = set !== 'affiliations', tx = db.transaction([related ? 'relatedRows' : 'rows', 'metadata']);
    const descriptor = tx.objectStore('metadata').get('descriptor');
    const ownership = tx.objectStore('metadata').get('ownership');
    const rows = tx.objectStore(related ? 'relatedRows' : 'rows').getAll(related ? IDBKeyRange.bound([set, page * 100], [set, page * 100 + 99]) : IDBKeyRange.bound(page * 100 + 1, page * 100 + 100));
    tx.onabort = () => reject(tx.error ?? unavailable());
    tx.oncomplete = () => {
      try {
        const d = validateDescriptor(descriptor.result, db.name);
        if (ownership.result?.committed !== true || d.rowBytes + bytes(d) + bytes(ownership.result) > 5242880) throw unavailable();
        if (d.generation !== ref.generation) throw new Error('The local result generation changed. Open the committed result again.');
        const count = d.counts[set as typeof sets[number]], values = (related ? rows.result.map((row) => row.rows) : rows.result) as TypedValue[][];
        const columns = related ? d.result.relatedRecordsets?.find((recordset) => recordset.id === set)?.recordset.columns.length ?? 0 : d.result.recordset.columns.length;
        if (values.length !== Math.max(0, Math.min(100, count - page * 100)) || !validRows(values, columns)) throw unavailable();
        resolve(values);
      } catch (error) { reject(error); }
    };
  }); } finally { db.close(); }
}

/** Validate disk bounds with cursors. Only requested pages, never all archived rows,
 * are retained in the UI or granted execution authority. */
export async function openLocalResult(id: string): Promise<{ result: FederatedQueryResult; executedDefinition: IQueryDef; descriptor: LocalResultDescriptor }> {
  const db = await openExisting(id);
  let descriptor: LocalResultDescriptor;
  try {
    descriptor = (await readMetadata(db)).descriptor;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores), metadata = tx.objectStore('metadata').get('descriptor');
      const counts = { affiliations: 0, locations: 0, aliases: 0 }; let rowBytes = 0;
      tx.onabort = () => reject(tx.error ?? unavailable());
      tx.oncomplete = () => {
        try { const current = validateDescriptor(metadata.result, db.name); if (current.generation !== descriptor.generation || rowBytes !== descriptor.rowBytes || sets.some((set) => counts[set] !== descriptor.counts[set])) throw unavailable(); resolve(); }
        catch (error) { reject(error); }
      };
      for (const storeName of ['rows', 'relatedRows']) {
        const request = tx.objectStore(storeName).openCursor();
        request.onsuccess = () => {
          const cursor = request.result; if (!cursor) return;
          try {
            const related = storeName === 'relatedRows', set = related ? cursor.value.set as 'locations' | 'aliases' : 'affiliations';
            if (!sets.includes(set) || counts[set] >= descriptor.counts[set]) throw unavailable();
            const key = related ? [set, counts[set]] : counts[set] + 1;
            if (indexedDB.cmp(cursor.key, key) !== 0) throw unavailable();
            const row = related ? cursor.value.rows : cursor.value;
            const columns = related ? descriptor.result.relatedRecordsets?.find((recordset) => recordset.id === set)?.recordset.columns.length ?? 0 : descriptor.result.recordset.columns.length;
            if (!validRows([row], columns)) throw unavailable();
            rowBytes += bytes(cursor.value); counts[set]++; if (rowBytes > descriptor.rowBytes) throw unavailable(); cursor.continue();
          } catch { tx.abort(); }
        };
      }
    });
  } finally { db.close(); }
  const result = descriptor.result;
  return { descriptor, executedDefinition: descriptor.executedDefinition, result: {
    ...result, recordset: { ...result.recordset, rows: await readLocalResultPage(descriptor, 0) },
    relatedRecordsets: await Promise.all((result.relatedRecordsets ?? []).map(async (set) => ({ ...set, recordset: { ...set.recordset, rows: await readLocalResultPage(descriptor, 0, set.id) } }))),
  } };
}

export async function associateLocalResult(projectRef: IProjectRef, queryId: string, ref: LocalResultRef, accounting?: {
  readonly reserve: (bytes: number) => void; readonly commit: () => void; readonly rollback: () => void; readonly signal?: AbortSignal;
}): Promise<void> {
  if (!projectRef.storeId || !projectRef.projectId || !queryId || !validRef(ref)) throw unavailable();
  const db = await openExisting(ref.id), scope = { projectRef, queryId };
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('metadata', 'readwrite'), store = tx.objectStore('metadata');
      const cancel = (): void => { try { tx.abort(); } catch { /* Already settled. */ } };
      accounting?.signal?.addEventListener('abort', cancel, { once: true });
      const finish = (): void => accounting?.signal?.removeEventListener('abort', cancel);
      if (accounting?.signal?.aborted) { cancel(); reject(new Error('The query was cancelled.')); return; }
      const descriptor = store.get('descriptor'), ownership = store.get('ownership');
      ownership.onsuccess = () => {
        try {
          if (validateDescriptor(descriptor.result, db.name).generation !== ref.generation || ownership.result?.committed !== true) throw unavailable();
          const associations = (ownership.result as Ownership).associations;
          const next = { committed: true, associations: associations.some((value) => sameScope(value, scope)) ? associations : [...associations, scope] } satisfies Ownership;
          const d = validateDescriptor(descriptor.result, db.name);
          if (d.rowBytes + bytes(d) + bytes(next) > 5242880) throw new Error('The saved association exceeds this result’s original output allowance.');
          accounting?.reserve(bytes(d) + bytes(next));
          store.put(next, 'ownership');
        } catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => { finish(); resolve(); }; tx.onabort = () => { finish(); reject(tx.error ?? unavailable()); };
    });
    accounting?.commit();
    await registerLocalResult((await readMetadata(db)).descriptor);
  } catch (error) { accounting?.rollback(); throw error; } finally { db.close(); }
}

export async function deleteLocalResult(id: string): Promise<void> {
  if (!/^datatug-output-\d+-[a-f0-9-]+$/.test(id)) throw unavailable();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(id);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error ?? unavailable());
    request.onblocked = () => reject(new Error('This result is still open in another tab. Close it before deleting.'));
  });
  const db = await catalog();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('results', 'readwrite'); tx.objectStore('results').delete(id);
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? unavailable());
  }); } finally { db.close(); }
}

/** A committed marker protects the registration crash window, even if the descriptor
 * is corrupt. Unavailability must remain visible; it is never inferred as garbage. */
export async function isCommittedLocalResult(name: string): Promise<boolean> {
  if ((await catalogEntries()).some((entry) => entry.database === name)) return true;
  const db = await openExisting(name, true);
  if (!db) return false;
  try {
    if (!db.objectStoreNames.contains('metadata')) return false;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('metadata'), request = tx.objectStore('metadata').get('ownership');
      tx.oncomplete = () => resolve(request.result?.committed === true);
      tx.onabort = () => reject(tx.error ?? unavailable());
    });
  } finally { db.close(); }
}
