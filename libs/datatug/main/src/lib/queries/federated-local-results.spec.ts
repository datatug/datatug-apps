import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TypedValue } from '@sneat/datatug-semantic';
import rightsFixture from '@sneat/datatug-semantic/fixtures/client-only-source-rights.json';
import type { IQueryDef } from '../models/definition/query-def';
import type { FederatedQueryResult } from './federated-query-executor';
import {
  associateLocalResult, createOutputStores, deleteLocalResult, listLocalResults,
  openLocalResult, readLocalResultPage, registerLocalResult, replaceGraphOutput, isCommittedLocalResult,
  type LocalResultDescriptor,
} from './federated-local-results';
import { cleanupOrphanedQueryDatabases } from './federated-query-storage';
import { graphFixturePlan } from './public-data/native-graph.spec-helper';
import { graphStableIdentity } from './public-data/native-graph-executor';

const definition = { id: 'synthetic-history', federation: { nativeGraph: graphFixturePlan() } } as unknown as IQueryDef;
const rows = (count: number, tag: string): TypedValue[][] => Array.from({ length: count }, (_, index) => [{ type: 'string', value: `${tag}:${index}` }]);
const result = (primary: TypedValue[][], locations: number, aliases: number, tag: string): FederatedQueryResult => ({
  recordset: { columns: [{ name: 'Affiliation', type: 'string' }], rows: primary },
  relatedRecordsets: (['locations', 'aliases'] as const).map((id) => ({ id, label: id, parentSet: id === 'locations' ? 'affiliations' : 'locations', parentField: 'Parent', totalRows: id === 'locations' ? locations : aliases, recordset: { columns: [{ name: id, type: 'string' }], rows: rows(id === 'locations' ? locations : aliases, tag + ':' + id) } })),
  nativeGraph: { planIdentity: graphStableIdentity(definition.federation?.nativeGraph), stageActions: [], coverage: {}, edges: {}, ledger: { intermediate: 100, candidates: 100, outputRows: primary.length + locations + aliases, networkBytes: 10 } },
  bindingsApplied: [], limitations: [], truncated: false,
  provenance: { observedAt: '2026-10-05T10:00:00Z', source: tag, queryId: definition.id, mode: 'live', executionProfile: 'protected' },
} as unknown as FederatedQueryResult);
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`datatug-output-100000-${crypto.randomUUID()}`, 2);
    request.onupgradeneeded = () => createOutputStores(request.result);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function disk(db: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['rows', 'relatedRows', 'metadata']);
    const records = ['rows', 'relatedRows', 'metadata'].map((name) => ({ name, keys: tx.objectStore(name).getAllKeys(), values: tx.objectStore(name).getAll() }));
    tx.oncomplete = () => resolve(records.map((record) => ({ name: record.name, keys: record.keys.result, values: record.values.result })));
    tx.onabort = () => reject(tx.error);
  });
}
async function assertPages(d: LocalResultDescriptor, expected: FederatedQueryResult, primary: TypedValue[][]): Promise<void> {
  const sets = [{ id: 'affiliations', data: primary }, ...(expected.relatedRecordsets ?? []).map((set) => ({ id: set.id, data: set.recordset.rows }))];
  for (const set of sets) for (let page = 0; page <= Math.ceil(set.data.length / 100); page++) {
    expect(await readLocalResultPage(d, page, set.id)).toEqual(set.data.slice(page * 100, page * 100 + 100));
  }
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { name } of await indexedDB.databases()) if (name?.startsWith('datatug-')) await new Promise<void>((resolve) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); });
});
describe('local graph artifact transaction and lifecycle', () => {
  it('keeps captured source notices in supported history and refuses unsafe or oversized metadata before replacing rows', async () => {
    const db = await database(), primary = rows(2, 'rights');
    const captured = { ...result(primary, 1, 0, 'rights'), ...structuredClone(rightsFixture.structured) };
    const descriptor = await replaceGraphOutput(db, definition, captured, primary, 1); db.close();
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No history traffic'));
    captured.sourceRights[0].declaration.text = 'Changed live terms';
    const opened = await openLocalResult(descriptor.id);
    expect(opened.result.sourceRights).toEqual(rightsFixture.structured.sourceRights);
    expect(opened.result.usedSourceIds).toEqual(rightsFixture.structured.usedSourceIds);
    expect(fetcher).not.toHaveBeenCalled();
    const writable = await new Promise<IDBDatabase>((resolve) => { const req = indexedDB.open(descriptor.id); req.onsuccess = () => resolve(req.result); });
    const before = await disk(writable);
    await expect(replaceGraphOutput(writable, definition, { ...captured, sourceRights: [{ ...captured.sourceRights[0], declaration: { url: 'javascript:alert(1)' } }] }, primary, 2)).rejects.toThrow();
    await expect(replaceGraphOutput(writable, definition, { ...captured, sourceRights: Array.from({ length: 6 }, (_, index) => ({ ...captured.sourceRights[0], sourceId: `ovdb:fixture-server/fx/Rates${index}`, source: { ...captured.sourceRights[0].source, recordset: `Rates${index}` }, declaration: { text: 'x'.repeat(65536) } })) }, primary, 2)).rejects.toThrow();
    expect(await disk(writable)).toEqual(before); writable.close();
  });
  it('reopens original-only history with its exact old rows and identity without fetching or accepting it for execution', async () => {
    const { default: oldProfile } = await import('./public-data/native-graph-historical-profile.json');
    const oldDefinition = structuredClone(definition), graph = oldDefinition.federation?.nativeGraph;
    if (!graph) throw new Error('Missing graph fixture.');
    Object.assign(graph, { envelope: { ...graph.envelope, graphs: [oldProfile] }, references: [oldProfile.decision.document] });
    const primary = rows(2, 'old-raw-1e3'), value = result(primary, 1, 0, 'old');
    Object.assign(value.nativeGraph ?? {}, { planIdentity: graphStableIdentity(graph) });
    const db = await database(), descriptor = await replaceGraphOutput(db, oldDefinition, value, primary, 1); db.close();
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Historical reads must not fetch.'));
    const opened = await openLocalResult(descriptor.id);
    expect(opened.executedDefinition).toEqual(oldDefinition); expect(opened.result.recordset.rows).toEqual(primary);
    expect(await readLocalResultPage(descriptor, 0)).toEqual(primary); expect(network).not.toHaveBeenCalled();
    const { assertNativeGraphPlan } = await import('./public-data/native-graph-executor');
    expect(() => assertNativeGraphPlan(graph)).toThrow(/decision pin/);
  });
  it('reserves association growth before put, commits exact new metadata and rolls back a refused association', async () => {
    const db = await database(), primary = rows(2, 'kept'), descriptor = await replaceGraphOutput(db, definition, result(primary, 1, 0, 'original'), primary, 1); db.close();
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    const scope = { projectRef: { storeId: 'test', projectId: 'é🦊' }, queryId: 'returned-id' }, reserve = vi.fn(), commit = vi.fn(), rollback = vi.fn();
    await associateLocalResult(scope.projectRef, scope.queryId, descriptor, { reserve, commit, rollback });
    expect(reserve).toHaveBeenCalledExactlyOnceWith(encode(descriptor) + encode({ committed: true, associations: [scope] })); expect(commit).toHaveBeenCalledOnce(); expect(rollback).not.toHaveBeenCalled();
    const before = await listLocalResults(scope);
    await expect(associateLocalResult({ storeId: 'test', projectId: 'refused' }, 'new-id', descriptor, { reserve: () => { throw new Error('Live byte limit'); }, commit, rollback })).rejects.toThrow('Live byte limit');
    expect(rollback).toHaveBeenCalledOnce(); expect(await listLocalResults(scope)).toEqual(before); expect(await listLocalResults({ projectRef: { storeId: 'test', projectId: 'refused' }, queryId: 'new-id' })).toEqual([]);
    expect(await readLocalResultPage(descriptor, 0)).toEqual(primary);
  });
  it('treats only an absent database as uncommitted and propagates genuine IndexedDB failures', async () => {
    const missing = `datatug-output-100000-${crypto.randomUUID()}`;
    await expect(isCommittedLocalResult(missing)).resolves.toBe(false);
    expect((await indexedDB.databases()).some((db) => db.name === missing)).toBe(false);
    const db = await database(); db.close();
    await expect(isCommittedLocalResult(db.name)).resolves.toBe(false);
    const originalOpen = indexedDB.open.bind(indexedDB);
    vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
      if (name === db.name) throw new DOMException('Storage permission denied', 'SecurityError');
      return originalOpen(name, version);
    });
    await expect(isCommittedLocalResult(db.name)).rejects.toThrow('Storage permission denied');
  });
  it('uses exact 1..N keys through 150→230→125, related pages grow/shrink and an optional set empties', async () => {
    const db = await database();
    let previous: LocalResultDescriptor | undefined;
    try {
      for (const [generation, count, locations, aliases] of [[1, 150, 145, 115], [2, 230, 235, 212], [3, 125, 105, 0]]) {
        const primary = rows(count, String(generation)), value = result(primary, locations, aliases, String(generation));
        const metadataReservation = vi.fn();
        const descriptor = await replaceGraphOutput(db, definition, value, primary, generation, undefined, metadataReservation);
        const encoded = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;
        expect(metadataReservation).toHaveBeenCalledExactlyOnceWith(encoded(descriptor) + encoded({ committed: true, associations: [] }));
        expect(descriptor.rowBytes).toBe(primary.reduce((size, row) => size + encoded(row), 0) + (value.relatedRecordsets ?? []).reduce((size, set) => size + set.recordset.rows.reduce((n, row, index) => n + encoded({ set: set.id, index, rows: row }), 0), 0));
        const stored = await disk(db) as { name: string; keys: unknown[] }[];
        expect(stored[0].keys).toEqual(Array.from({ length: count }, (_, index) => index + 1));
        expect(stored[1].keys).toEqual([...Array.from({ length: aliases }, (_, index) => ['aliases', index]), ...Array.from({ length: locations }, (_, index) => ['locations', index])]);
        await assertPages(descriptor, value, primary);
        if (previous) await expect(readLocalResultPage(previous, 0)).rejects.toThrow('generation changed');
        previous = descriptor;
      }
    } finally { db.close(); }
  });

  it('refuses a self-consistent corrupt saved plan without source I/O and protects its committed marker', async () => {
    const db = await database();
    const descriptor = await replaceGraphOutput(db, definition, result(rows(2, 'é🦊'), 1, 0, 'original'), rows(2, 'é🦊'), 1);
    const malformed = structuredClone(descriptor);
    Object.assign(malformed.executedDefinition.federation?.nativeGraph?.selection ?? {}, { rows: 1001 });
    const identity = graphStableIdentity(malformed.executedDefinition.federation?.nativeGraph);
    Object.assign(malformed, { planIdentity: identity }); Object.assign(malformed.result.nativeGraph ?? {}, { planIdentity: identity });
    const payload = Object.fromEntries(Object.entries(malformed).filter(([key]) => key !== 'descriptorBytes'));
    Object.assign(malformed, { descriptorBytes: new TextEncoder().encode(JSON.stringify(payload)).byteLength });
    await new Promise<void>((resolve) => { const tx = db.transaction('metadata', 'readwrite'); tx.objectStore('metadata').put(malformed, 'descriptor'); tx.oncomplete = () => resolve(); });
    db.close(); await expect(openLocalResult(descriptor.id)).rejects.toThrow('No local result');
    await expect(isCommittedLocalResult(descriptor.id)).resolves.toBe(true);
    await cleanupOrphanedQueryDatabases(200000000); expect((await indexedDB.databases()).some((entry) => entry.name === descriptor.id)).toBe(true);
  });

  for (const count of [150, 230, 125]) for (const failure of ['primary', 'related', 'descriptor', 'ownership', 'quota', 'enqueue', 'request', 'abort', 'cancel'] as const) {
    it(`preserves every committed byte/page at ${count} rows on ${failure} failure`, async () => {
      const db = await database();
      try {
        const originalRows = rows(count, 'old'), original = result(originalRows, 135, 115, 'old');
        const d = await replaceGraphOutput(db, definition, original, originalRows, 1), before = await disk(db);
        const controller = new AbortController();
        const originalPut = IDBObjectStore.prototype.put;
        let injected = false;
        const target = failure === 'primary' || failure === 'quota' || failure === 'enqueue' || failure === 'request' || failure === 'abort' || failure === 'cancel' ? 'rows' : failure === 'related' ? 'relatedRows' : 'metadata';
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey): IDBRequest {
          if (!injected && this.name === target && (failure !== 'ownership' || key === 'ownership') && (failure !== 'descriptor' || key === 'descriptor')) {
            injected = true;
            if (failure === 'abort') { const request = originalPut.call(this, value, key); queueMicrotask(() => this.transaction.abort()); return request; }
            if (failure === 'cancel') { const request = originalPut.call(this, value, key); queueMicrotask(() => controller.abort()); return request; }
            if (failure === 'request') { const request = originalPut.call(this, value, key); this.add(value, key); return request; }
            throw failure === 'quota' ? new DOMException('quota', 'QuotaExceededError') : new Error('injected enqueue failure');
          }
          return originalPut.call(this, value, key);
        });
        await expect(replaceGraphOutput(db, definition, result(rows(200, 'new'), 150, 100, 'new'), rows(200, 'new'), 2, controller.signal)).rejects.toThrow();
        vi.restoreAllMocks();
        expect(injected).toBe(true); expect(await disk(db)).toEqual(before);
        await assertPages(d, original, originalRows);
        const retried = await replaceGraphOutput(db, definition, result(rows(125, 'retry'), 0, 0, 'retry'), rows(125, 'retry'), 2);
        expect((await readLocalResultPage(retried, 0))[0]).toEqual(rows(1, 'retry')[0]);
      } finally { db.close(); }
    });
  }

  it('reconciles registration crashes, protects committed >24h, associates query locally and deletes only selected artifact', async () => {
    const first = await database(), second = await database();
    const a = await replaceGraphOutput(first, definition, result(rows(150, 'a'), 135, 110, 'a'), rows(150, 'a'), 1);
    const b = await replaceGraphOutput(second, definition, result(rows(125, 'b'), 0, 0, 'b'), rows(125, 'b'), 1);
    first.close(); second.close();
    // No explicit registration occurred. The committed marker repairs that crash window.
    expect((await listLocalResults()).map((entry) => entry.id).sort()).toEqual([a.id, b.id].sort());
    const scope = { projectRef: { storeId: 'local', projectId: 'p' }, queryId: 'q' };
    await associateLocalResult(scope.projectRef, scope.queryId, a);
    expect((await listLocalResults(scope)).map((entry) => entry.id)).toEqual([a.id]);
    await cleanupOrphanedQueryDatabases(200000000);
    const opened = await openLocalResult(a.id); expect(opened.executedDefinition).toEqual(definition);
    expect(opened.result.relatedRecordsets?.find((set) => set.id === 'aliases')?.recordset.rows).toHaveLength(100);
    expect(await readLocalResultPage(a, 1, 'aliases')).toHaveLength(10);
    await deleteLocalResult(a.id);
    await expect(openLocalResult(a.id)).rejects.toThrow('No local result');
    expect(await readLocalResultPage(b, 1)).toHaveLength(25);
  });

  it('reaps a provisional crash but preserves an unregistered committed marker with a corrupt descriptor', async () => {
    const provisional = await database(), committed = await database();
    const d = await replaceGraphOutput(committed, definition, result(rows(2, 'old'), 0, 0, 'old'), rows(2, 'old'), 1);
    await new Promise<void>((resolve) => { const tx = committed.transaction('metadata', 'readwrite'); tx.objectStore('metadata').put({ corrupt: true }, 'descriptor'); tx.oncomplete = () => resolve(); });
    provisional.close(); committed.close();
    await cleanupOrphanedQueryDatabases(200000000);
    expect((await indexedDB.databases()).some((entry) => entry.name === provisional.name)).toBe(false);
    expect((await indexedDB.databases()).some((entry) => entry.name === d.id)).toBe(true);
    await expect(openLocalResult(d.id)).rejects.toThrow('No local result');
  });

  it('reports a catalog failure after association without erasing rows, and reconciles that registration crash', async () => {
    const db = await database();
    const d = await replaceGraphOutput(db, definition, result(rows(125, 'saved'), 115, 105, 'saved'), rows(125, 'saved'), 1);
    db.close();
    const scope = { projectRef: { storeId: 'local', projectId: 'p' }, queryId: 'saved-query' };
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey): IDBRequest {
      if (this.name === 'results') throw new Error('catalog registration crash');
      return originalPut.call(this, value, key);
    });
    await expect(associateLocalResult(scope.projectRef, scope.queryId, d)).rejects.toThrow('catalog registration crash');
    vi.restoreAllMocks();
    expect(await readLocalResultPage(d, 1, 'locations')).toHaveLength(15);
    expect((await listLocalResults(scope)).map((entry) => entry.id)).toEqual([d.id]);
  });

  it('refuses incomplete/corrupt rows, overbound output, stale association, and reserved metadata failure before mutation', async () => {
    const db = await database();
    try {
      const d = await replaceGraphOutput(db, definition, result(rows(2, 'old'), 0, 0, 'old'), rows(2, 'old'), 1);
      const before = await disk(db);
      await expect(replaceGraphOutput(db, definition, result(rows(3000, 'wide'), 3000, 0, 'wide'), rows(3000, 'wide'), 2)).rejects.toThrow();
      await expect(replaceGraphOutput(db, definition, result(rows(2, 'new'), 0, 0, 'new'), rows(2, 'new'), 2, undefined, () => { throw new Error('metadata capacity'); })).rejects.toThrow('metadata capacity');
      expect(await disk(db)).toEqual(before);
      await expect(associateLocalResult({ storeId: 's', projectId: 'p' }, 'q', { ...d, generation: 2 })).rejects.toThrow();
      await registerLocalResult(d);
      await new Promise<void>((resolve) => { const tx = db.transaction('rows', 'readwrite'); tx.objectStore('rows').delete(2); tx.oncomplete = () => resolve(); });
    } finally { db.close(); }
    await expect(openLocalResult(db.name)).rejects.toThrow('No local result');
  });
});
