import { graphFixtureMetadataTransport } from './public-data/native-graph.spec-helper';
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './public-data/native-graph-fixture.json';
import { graphFixturePlan, graphFixtureTransport } from './public-data/native-graph.spec-helper';
import { NativeGraphExecution, nativeGraphRunResponse, graphStableIdentity, verifyNativeGraphPlan } from './public-data/native-graph-executor';
import { BoundedRunBudget } from './public-data/bounded-run-budget';
import { FederatedQueryService } from './federated-query.service';
import type { FederatedQueryResult } from './federated-query-executor';
import type { IQueryDef } from '../models/definition/query-def';
import { saveRuntimePins } from './public-data/saved-runtime-pins';
const control = vi.hoisted(() => ({ commit: vi.fn(), rollback: vi.fn(), reserve: vi.fn(), read: vi.fn(), suspend: false, release: undefined as (() => void) | undefined, wireToken: undefined as string | undefined, wireRequests: [] as { from: { name: string }; where: { right: { values: string[] } } }[], fallbackFailure: false, initialPageLimit: 1000, stageFault: undefined as string | undefined }));

// Exercise real engine -> actual Worker IndexedDB storage -> service result-set messages.
// The only replaced seam is the still-closed canonical publication boundary, for one named synthetic fixture ID.
vi.mock('./federated-query-executor', async (original) => {
  const module = await original<typeof import('./federated-query-executor')>();
  return { ...module, runFederatedQuery: async (...args: Parameters<typeof module.runFederatedQuery>) => {
    if (args[0].id === 'native-graph-history-transaction-fixture') {
      let generation = 0;
      const publish = async (count: number, locations: number, aliases: number): Promise<FederatedQueryResult> => {
        generation++;
        const cells = (n: number, tag: string) => Array.from({ length: n }, (_, index) => [{ type: 'string', value: `${generation}:${tag}:${index}` }]);
        const primary = cells(count, 'affiliations'); await args[3]?.(primary as never);
        return { recordset: { columns: [{ name: 'Affiliation', type: 'string' }], rows: primary }, relatedRecordsets: (['locations', 'aliases'] as const).map((id) => ({ id, label: id, parentSet: id === 'locations' ? 'affiliations' : 'locations', parentField: 'Parent', totalRows: id === 'locations' ? locations : aliases, recordset: { columns: [{ name: id, type: 'string' }], rows: cells(id === 'locations' ? locations : aliases, id) } })), nativeGraph: { planIdentity: graphStableIdentity(args[0].federation?.nativeGraph), stageActions: [], coverage: {}, edges: {}, ledger: { intermediate: generation * 100, candidates: generation * 100, outputRows: count + locations + aliases, networkBytes: generation * 10 } }, limitations: [], bindingsApplied: [], truncated: false, provenance: { queryId: args[0].id, source: 'synthetic Worker lifecycle', mode: 'live', observedAt: '2026-10-05T10:00:00Z', executionProfile: 'protected' } } as unknown as FederatedQueryResult;
      };
      args[8]?.onRuntimeSession?.({
        readPage: async () => { control.read(); if (control.suspend) await new Promise<void>((resolve) => { control.release = resolve; }); return generation === 1 ? publish(230, 235, 212) : publish(125, 105, 0); },
        close: () => control.release?.(), commitOutput: control.commit, rollbackOutput: control.rollback, reserveOutputMetadata: control.reserve,
      });
      return publish(150, 145, 115);
    }
    if (args[0].id !== 'native-graph-storage-fixture' && args[0].id !== 'native-graph-p1-storage-fixture') return module.runFederatedQuery(...args);
    const plan = args[0].federation?.nativeGraph ?? graphFixturePlan(), native = structuredClone(fixture.multiplicity);
    // Separate synthetic alias capacity extension; the pinned native witness remains unchanged.
    native.aliases.push(...Array.from({ length: 30 }, (_, i) => ({ ...native.aliases[0], alternate_name_id: 'synthetic-' + i })));
    const ordinary = graphFixtureTransport(plan, native);
    const transport = async (url: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const response = await ordinary(url, init), query = JSON.parse(String(init?.body));
      control.wireRequests.push(query);
      if (args[0].id !== 'native-graph-p1-storage-fixture' || query.from.name !== 'locations') return response;
      const text = await response.text();
      if (control.stageFault === 'pins') return new Response(text, { headers: { ...Object.fromEntries(response.headers.entries()), 'ovdb-source-sha256': 'f'.repeat(64) } });
      if (control.stageFault === 'malformed') return new Response('{records:', { headers: response.headers });
      if (control.stageFault === 'duplicate') return new Response(text.replace('\"geonames_id\":4369596', '\"geonames_id\":4369596,\"geonames_id\":4369596'), { headers: response.headers });
      if (control.stageFault === 'ordinal') return new Response(text.replace('\"ordinal\":0', '\"ordinal\":9007199254740993'), { headers: response.headers });
      const raw = control.wireToken;
      const changed = raw === undefined ? text.replace(',"geonames_id":4369596', '') : text.replace('"geonames_id":4369596', '"geonames_id":' + raw);
      return new Response(changed, { headers: response.headers });
    };
    const execution = new NativeGraphExecution(plan, native.affiliations.map((data, i) => ({ key: String(i), data })), new BoundedRunBudget(5242880, 10000, args[4], args[8]?.deadline), transport, 'https://runtime.example', graphFixtureMetadataTransport);
    const adapt = async (output: Awaited<ReturnType<typeof execution.run>>): Promise<FederatedQueryResult> => {
      await args[3]?.(output.recordset.rows);
      return nativeGraphRunResponse(execution, output, args[0].id, 'Explicit graph storage fixture');
    };
    args[8]?.onRuntimeSession?.({ readPage: async (id, page) => adapt(await execution.continueStage(id as never, page)), close: () => execution.close(), commitOutput: () => execution.commitOutput(), rollbackOutput: () => execution.rollbackOutput(), reserveOutputMetadata: (bytes: number) => execution.reserveOutputMetadata(bytes), reserveOutputStorage: (bytes: number) => execution.reserveOutputStorage(bytes), commitOutputMetadata: () => execution.commitOutputMetadata(), rollbackOutputMetadata: () => execution.rollbackOutputMetadata(), prepareOutputMetadata: (sizer) => execution.prepareOutputMetadata((response) => control.fallbackFailure && Object.keys(response.nativeGraph?.coverage ?? {}).length ? 5242880 : sizer(response), args[0].id, 'Explicit graph storage fixture') });
    return adapt(await execution.run(control.initialPageLimit));
  } };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function workerFixture() {
  vi.resetModules(); control.commit.mockClear(); control.rollback.mockClear(); control.reserve.mockClear(); control.read.mockClear(); control.suspend = false; control.release = undefined; control.wireToken = undefined; control.wireRequests = []; control.fallbackFailure = false; control.stageFault = undefined; control.initialPageLimit = 1000;
  const posted: Record<string, unknown>[] = [];
  const scope: { onmessage?: (event: { data: unknown }) => void; postMessage: (message: Record<string, unknown>) => void } = { postMessage: (data) => posted.push(data) };
  class InProcessWorker {
    onmessage?: (event: MessageEvent) => void;
    listeners = new Set<(event: MessageEvent) => void>();
    constructor() { scope.postMessage = (data) => { posted.push(data); const event = { data: structuredClone(data) } as MessageEvent; this.onmessage?.(event); for (const listener of this.listeners) listener(event); }; }
    postMessage(data: unknown): void { scope.onmessage?.({ data: structuredClone(data) }); }
    addEventListener(_type: string, listener: (event: MessageEvent) => void): void { this.listeners.add(listener); }
    removeEventListener(_type: string, listener: (event: MessageEvent) => void): void { this.listeners.delete(listener); }
    terminate(): void { /* In-process test surface only. */ }
  }
  vi.stubGlobal('self', scope); vi.stubGlobal('Worker', InProcessWorker);
  await import('./federated-query.worker');
  const http = vi.fn(); vi.stubGlobal('fetch', http);
  return { service: new FederatedQueryService(), http, posted };
}
const transactionDefinition = (): IQueryDef => ({ id: 'native-graph-history-transaction-fixture', request: { queryType: 'DTQL' }, federation: { ovdbBaseUrl: 'https://runtime.example', tables: [], nativeGraph: graphFixturePlan() } }) as unknown as IQueryDef;
describe('native graph Worker/service/storage fixture integration, no publication claim', () => {
  it.each(['1', '9007199254740991', '1e0', '-0', '1.0', '1e3', '1.0000000000000001', '9007199254740990.5', '9007199254740993', '1e400', '-1e400', '0e400', '{"nested":[-0,1e3,9007199254740993]}', '[]', 'true', '"1"', 'null', undefined])('retains exact P1 wire evidence %s through actual Worker/IDB pages and reopen while a valid sibling continues', async (token) => {
    const { service, http } = await workerFixture(); control.wireToken = token;
    const definition = { ...transactionDefinition(), id: 'native-graph-p1-storage-fixture' };
    const result = await service.run(definition), ref = result.localResult;
    if (!ref) throw new Error('Missing committed result reference.');
    const locations = result.relatedRecordsets?.find((set) => set.id === 'locations');
    expect(result.recordset.rows).toHaveLength(2); expect(locations?.totalRows).toBe(4);
    const evidenceIndex = locations?.recordset.columns.findIndex((column) => column.name === 'Exact reference evidence');
    expect(evidenceIndex).toBe(14);
    expect(locations?.recordset.rows[0][14].value).toBe(token ?? 'missing-field');
    expect(locations?.recordset.rows[1][14].value).toBe('4431780');
    const keys = control.wireRequests.filter((query) => query['from'].name === definition.federation?.nativeGraph?.stages.places.collection).flatMap((query) => query['where'].right.values);
    expect(keys).toContain('4431780'); expect(keys).not.toContain('4369596'); expect(keys).not.toContain('1000');
    if (token === '1' || token === '9007199254740991') expect(keys).toContain(token);
    expect(http).not.toHaveBeenCalled();
    await service.associateLocalResult({ storeId: 'synthetic', projectId: 'p1' }, definition.id, ref);
    await service.dispose();
    const reopened = await service.openLocalResult(ref.id);
    expect(reopened.executedDefinition).toEqual(definition);
    expect(reopened.result.relatedRecordsets?.find((set) => set.id === 'locations')?.recordset.rows).toEqual(locations?.recordset.rows);
    expect(await service.getPage(0, 'locations', ref)).toEqual(locations?.recordset.rows);
    await expect(service.continueSource('locations', 100, 0)).rejects.toThrow(/unavailable|expired/);
    await service.deleteLocalResult(ref.id);
  });

  it.each(['pins', 'malformed', 'duplicate', 'ordinal'])('refuses general stage fault %s before any child request or committed artifact', async (fault) => {
    const { service, http } = await workerFixture(); control.stageFault = fault;
    await expect(service.run({ ...transactionDefinition(), id: 'native-graph-p1-storage-fixture' })).rejects.toThrow();
    expect(control.wireRequests.map(q => q.from.name)).toEqual(['organizations', 'locations']);
    expect(http).not.toHaveBeenCalled(); await service.dispose();
  });

  it('refuses changed native provenance before source I/O at the actual Worker boundary', async () => {
    const { service, http } = await workerFixture(), definition = { ...transactionDefinition(), id: 'native-graph-p1-storage-fixture' };
    if (!definition.federation?.nativeGraph) throw new Error('Missing graph fixture.');
    definition.federation.nativeGraph.stages.locations.nativeSnapshot.sha256 = 'f'.repeat(64);
    await expect(service.run(definition)).rejects.toThrow();
    expect(control.wireRequests).toEqual([]); expect(http).not.toHaveBeenCalled(); await service.dispose();
  });

  it('saves an incomplete real-engine result after one-stage atomic continuation and reopens its original grids and receipts', async () => {
    const { service, http } = await workerFixture(); control.initialPageLimit = 1;
    const definition = { ...transactionDefinition(), id: 'native-graph-storage-fixture' };
    const first = await service.run(definition);
    expect(first.truncated).toBe(true); expect(first.totalRows).toBe(2);
    expect(Object.keys(first.runtimeRead?.pins ?? {})).toEqual(['ror']);
    const next = await service.continueSource('organizations', 1000, 1);
    expect(next.localResult?.generation).toBe(2);
    expect(control.wireRequests.map(q => q.from.name)).toEqual(['organizations', 'organizations']);
    expect(next.truncated).toBe(true);
    expect(next.relatedRecordsets?.every(set => set.totalRows === 0)).toBe(true);
    // A real Worker structured clone cannot carry process-local closure proof.
    expect(() => saveRuntimePins(definition, definition, next)).toThrow(/locally verified/);
    const graph = definition.federation?.nativeGraph;
    if (!graph) throw new Error('Missing receiving-side graph.');
    const metadataReads = vi.fn(graphFixtureMetadataTransport);
    await verifyNativeGraphPlan(graph, metadataReads, new AbortController().signal);
    expect(metadataReads).toHaveBeenCalled();
    const saved = saveRuntimePins(definition, definition, next);
    expect(saved.federation?.nativeGraph).toEqual(definition.federation?.nativeGraph);
    expect(Object.keys(saved.federation?.readReceipt?.pins ?? {})).toEqual(['ror']);
    if (!next.localResult) throw new Error('Missing incomplete result.');
    await service.associateLocalResult({ storeId: 'localhost:56070', projectId: 'offline' }, 'partial-saved-query', next.localResult);
    await service.dispose();
    const opened = await service.openLocalResult(next.localResult.id);
    expect(opened.result.nativeGraph).toEqual(next.nativeGraph);
    expect(opened.result.recordset.rows).toEqual(next.recordset.rows);
    expect(opened.result.runtimeRead).toEqual(next.runtimeRead);
    expect(opened.executedDefinition.federation?.nativeGraph).toEqual(definition.federation?.nativeGraph);
    expect(http).not.toHaveBeenCalled();
    await service.deleteLocalResult(next.localResult.id);
  });

  it('commits the preheld initial stopped envelope when prospective metadata capacity refuses a page before acceptance', async () => {
    const { service, http } = await workerFixture(); control.fallbackFailure = true;
    const result = await service.run({ ...transactionDefinition(), id: 'native-graph-storage-fixture' });
    expect(result.nativeGraph?.coverage).toEqual({}); expect(result.relatedRecordsets?.every((set) => set.totalRows === 0)).toBe(true);
    expect(result.totalRows).toBe(2); expect(control.wireRequests).toHaveLength(1);
    expect(result.nativeGraph?.ledger.networkBytes).toBeGreaterThan(0); expect(http).not.toHaveBeenCalled();
    await service.dispose();
    if (!result.localResult) throw new Error('Missing stopped result reference.');
    expect((await service.openLocalResult(result.localResult.id)).result.nativeGraph).toEqual(result.nativeGraph);
    await service.deleteLocalResult(result.localResult.id);
  });
  it('stores separate grains and reopens all historical pages after close without provider access', async () => {
    const { service, http, posted } = await workerFixture();
    const result = await service.run({ id: 'native-graph-storage-fixture', request: { queryType: 'DTQL' }, federation: { ovdbBaseUrl: 'https://runtime.example', tables: [], nativeGraph: graphFixturePlan() } } as unknown as IQueryDef);
    expect(result.recordset.rows).toHaveLength(2); expect(result.relatedRecordsets?.find((s) => s.id === 'locations')?.totalRows).toBe(4);
    expect(result.relatedRecordsets?.find((s) => s.id === 'aliases')?.totalRows).toBe(136);
    expect(result.relatedRecordsets?.find((s) => s.id === 'aliases')?.recordset.rows).toHaveLength(100);
    const remaining = await service.getPage(1, 'aliases'); expect(remaining).toHaveLength(36);
    expect(await service.getPage(0, 'locations')).toHaveLength(4); expect(await service.getPage(0)).toHaveLength(2);
    await expect(service.getPage(0, 'unknown')).rejects.toThrow('Unknown related'); expect(http).not.toHaveBeenCalled();
    const storage = posted.filter((m) => m['type'] === 'storage').map((m) => String(m['name'])); expect(storage.length).toBeGreaterThan(0);
    await service.dispose();
    const names = await indexedDB.databases(); expect(names.some((db) => db.name === result.localResult?.id)).toBe(true);
    const localRef = result.localResult;
    if (!localRef) throw new Error('Expected a committed local result.');
    const opened = await service.openLocalResult(localRef.id);
    expect(opened.result.recordset.rows).toEqual(result.recordset.rows);
    expect(opened.executedDefinition.federation?.nativeGraph).toEqual(graphFixturePlan());
    expect(await service.getPage(1, 'aliases', result.localResult)).toEqual(remaining);
    const scopeRef = { storeId: 'local', projectId: 'history' };
    await service.associateLocalResult(scopeRef, 'saved-fixture', localRef);
    expect((await service.listLocalResults({ projectRef: scopeRef, queryId: 'saved-fixture' })).map((entry) => entry.id)).toEqual([localRef.id]);
    expect(http).not.toHaveBeenCalled();
    await service.deleteLocalResult(localRef.id);
    expect((await indexedDB.databases()).some((db) => storage.includes(db.name ?? ''))).toBe(false);
  });

  it('publishes generations only after all three sets commit, using the Worker/service continuation path', async () => {
    const { service, http } = await workerFixture();
    let current = await service.run(transactionDefinition());
    try {
      expect(current.totalRows).toBe(150); expect(current.localResult?.generation).toBe(1); expect(control.commit).toHaveBeenCalledTimes(1);
      const old = current.localResult;
      current = await service.continueSource('locations', 100, 100);
      expect(current.totalRows).toBe(230); expect(current.localResult?.generation).toBe(2);
      expect(await service.getPage(2)).toHaveLength(30); expect(await service.getPage(2, 'locations')).toHaveLength(35); expect(await service.getPage(2, 'aliases')).toHaveLength(12);
      await expect(service.getPage(0, 'affiliations', old)).rejects.toThrow('generation changed');
      current = await service.continueSource('locations', 100, 200);
      expect(current.totalRows).toBe(125); expect(current.localResult?.generation).toBe(3);
      expect(await service.getPage(0)).toHaveLength(100); expect(await service.getPage(1)).toHaveLength(25); expect(await service.getPage(2)).toEqual([]);
      expect(await service.getPage(1, 'locations')).toHaveLength(5); expect(await service.getPage(0, 'aliases')).toEqual([]);
      expect(control.commit).toHaveBeenCalledTimes(3); expect(control.reserve).toHaveBeenCalledTimes(3); expect(http).not.toHaveBeenCalled();
    } finally { await service.dispose(); if (current.localResult) await service.deleteLocalResult(current.localResult.id); }
  });

  it('keeps committed counts/pins/pages after descriptor failure and closes further continuation before I/O', async () => {
    const { service, http, posted } = await workerFixture(); const original = await service.run(transactionDefinition());
    try {
      const put = IDBObjectStore.prototype.put;
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey): IDBRequest {
        if (this.name === 'metadata' && key === 'descriptor') throw new Error('descriptor failure');
        return put.call(this, value, key);
      });
      await expect(service.continueSource('locations', 100, 100)).rejects.toThrow('descriptor failure');
      vi.restoreAllMocks();
      expect(control.commit).toHaveBeenCalledTimes(1); expect(control.rollback).toHaveBeenCalledTimes(1);
      expect(posted.filter((message) => message['type'] === 'source-result')).toEqual([]);
      expect(await service.getPage(1)).toHaveLength(50); expect(await service.getPage(1, 'locations')).toHaveLength(45); expect(await service.getPage(1, 'aliases')).toHaveLength(15);
      if (!original.localResult) throw new Error('Missing retained result.');
      const reopened = await service.openLocalResult(original.localResult.id);
      expect(reopened.result.nativeGraph).toEqual(original.nativeGraph); expect(reopened.result.localResult).toEqual(original.localResult); expect(reopened.result.totalRows).toBe(150);
      await expect(service.continueSource('locations', 100, 100)).rejects.toThrow('unavailable'); expect(control.read).toHaveBeenCalledTimes(1); expect(http).not.toHaveBeenCalled();
    } finally { await service.dispose(); if (original.localResult) await service.deleteLocalResult(original.localResult.id); }
  });

  it('cancel during continuation retains the previous generation and local pages, with no next request', async () => {
    const { service, http, posted } = await workerFixture(); const original = await service.run(transactionDefinition());
    control.suspend = true;
    const pending = service.continueSource('locations', 100, 100);
    const rejection = expect(pending).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(control.release).toBeDefined());
    await service.dispose(); await rejection;
    try {
      expect(await service.getPage(1, 'aliases', original.localResult)).toHaveLength(15);
      expect(control.commit).toHaveBeenCalledTimes(1); expect(control.read).toHaveBeenCalledTimes(1);
      expect(posted.filter((message) => message['type'] === 'source-result')).toEqual([]); expect(http).not.toHaveBeenCalled();
    } finally { if (original.localResult) await service.deleteLocalResult(original.localResult.id); }
  });
});
