import { NativeQueryFailure } from './native-query-failure';
import { TestBed } from '@angular/core/testing';
import { PUBLIC_OVDB_DEV_TRANSPORT } from '@sneat/datatug-semantic';
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_OVDB_LOOPBACK_MODE } from './public-ovdb-dev-transport';
import { FederatedQueryService } from './federated-query.service';
import { QueryType, type IQueryDef } from '../models/definition/query-def';
import { graphFixturePlan } from './public-data/native-graph.spec-helper';
import { graphStableIdentity } from './public-data/native-graph-executor';
import { createOutputStores, replaceGraphOutput, deleteLocalResult } from './federated-local-results';
import type { FederatedQueryResult } from './federated-query-executor';

describe('federated query worker boundary', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('fails clearly when workers are unavailable instead of running an unbounded query on the UI thread', async () => {
    vi.stubGlobal('Worker', undefined);
    const service = new FederatedQueryService();
    const definition = {
      id: 'query',
      title: 'Query',
      request: { queryType: QueryType.DTQL, text: '{}' },
    } as IQueryDef;
    await expect(service.run(definition)).rejects.toThrow(
      /does not support query workers/,
    );
  });

  describe('the per-source report and the static source', () => {
    class FakeWorker {
      static last?: FakeWorker;
      onmessage?: (event: MessageEvent) => void;
      readonly posted: unknown[] = [];
      constructor() {
        FakeWorker.last = this;
      }
      postMessage(message: unknown): void {
        this.posted.push(message);
      }
      addEventListener(): void {
        /* not needed: no dispose in these runs */
      }
      removeEventListener(): void {
        /* not needed */
      }
      terminate = vi.fn();
      send(data: unknown): void {
        this.onmessage?.({ data } as MessageEvent);
      }
    }
    const currentWorker = (): FakeWorker => {
      const worker = FakeWorker.last;
      if (!worker) throw new Error('Expected the worker to have started.');
      return worker;
    };
    const definition = {
      id: 'query',
      title: 'Query',
      request: { queryType: QueryType.DTQL, text: '{}' },
    } as IQueryDef;
    const sourceEvent = {
      database: 'db',
      name: 'items',
      rows: 3,
      requests: 1,
      elapsedMs: 4,
    };
    const result = { recordset: { columns: [], rows: [] } };
    const started = async (
      service: FederatedQueryService,
      extras?: Parameters<FederatedQueryService['run']>[5],
    ) => {
      const previousWorker = FakeWorker.last;
      const run = service.run(
        definition,
        undefined,
        '',
        'full',
        undefined,
        extras,
      );
      await vi.waitFor(() => {
        expect(FakeWorker.last).not.toBe(previousWorker);
        expect(FakeWorker.last?.posted.length).toBe(1);
      });
      return { run, worker: FakeWorker.last as FakeWorker };
    };

    it('passes only app-owned dev mode and preserves progress, source and finished callbacks', async () => {
      vi.stubGlobal('Worker', FakeWorker);
      const progress = vi.fn(), source = vi.fn(), finished = vi.fn();
      TestBed.configureTestingModule({ providers: [
        { provide: PUBLIC_OVDB_DEV_TRANSPORT, useValue: PUBLIC_OVDB_LOOPBACK_MODE },
      ] });
      const service = TestBed.inject(FederatedQueryService);
      const run = service.run(definition, progress, '', 'full', finished, { onSourceLoaded: source });
      await vi.waitFor(() => expect(FakeWorker.last?.posted.length).toBe(1));
      const worker = currentWorker();
      expect(worker.posted[0]).toMatchObject({ devTransport: PUBLIC_OVDB_LOOPBACK_MODE, token: '' });
      const event = { stage: 'loading', rowsLoaded: 3, rowsProcessed: 0 };
      worker.send({ type: 'progress', progress: event });
      worker.send({ type: 'source', event: sourceEvent });
      worker.send({ type: 'finished', totalRows: 3 });
      worker.send({ type: 'result', result: { ...result, totalRows: 3 } });
      await run;
      expect(progress).toHaveBeenCalledWith(event);
      expect(source).toHaveBeenCalledWith(sourceEvent);
      expect(finished).toHaveBeenCalledWith(3);
    });

    it('hands each finished source to the run, and ignores the message when no one listens', async () => {
      vi.stubGlobal('Worker', FakeWorker);
      const events: unknown[] = [];
      const listening = await started(new FederatedQueryService(), {
        onSourceLoaded: (event) => events.push(event),
      });
      listening.worker.send({ type: 'source', event: sourceEvent });
      listening.worker.send({ type: 'result', result });
      await expect(listening.run).resolves.toEqual(result);
      expect(events).toEqual([sourceEvent]);

      const silent = await started(new FederatedQueryService());
      silent.worker.send({ type: 'source', event: sourceEvent });
      silent.worker.send({ type: 'result', result });
      await expect(silent.run).resolves.toEqual(result);
    });

    it('routes the worker first decoded-record timestamp to the current run', async () => {
      vi.stubGlobal('Worker', FakeWorker);
      const firstRecord = vi.fn();
      const active = await started(new FederatedQueryService(), {
        onFirstRecord: firstRecord,
      });
      const at = 123456.75;
      active.worker.send({ type: 'first-record', at });
      active.worker.send({ type: 'result', result });
      await expect(active.run).resolves.toEqual(result);
      expect(firstRecord).toHaveBeenCalledOnce();
      expect(firstRecord).toHaveBeenCalledWith(at);
    });

    it.each([{ type: 'fixture-audit' }, { type: 'error', message: '' }, { type: 'error' }])('rejects unexpected or empty error messages visibly without accepting output: %j', async (message) => {
      vi.stubGlobal('Worker', FakeWorker);
      const active = await started(new FederatedQueryService());
      active.worker.send(message);
      await expect(active.run).rejects.toThrow('unexpected or invalid protocol message');
      expect(active.worker.posted).toContainEqual({ type: 'close' });
    });

    it('reconstructs only the finite worker diagnostic, never its arbitrary message or raw cause', async () => {
      vi.stubGlobal('Worker', FakeWorker);
      const active = await started(new FederatedQueryService());
      const diagnostic = { stage: 'capability_discovery', reason: 'http_status', status: 403 };
      active.worker.send({ type: 'error', diagnostic, message: 'secret URL SQL token', cause: new Error('private') });
      const failure = await active.run.catch(error => error);
      expect(failure).toBeInstanceOf(NativeQueryFailure);
      expect(failure.diagnostic).toEqual(diagnostic);
      expect(failure.cause).toEqual(diagnostic);
      expect(failure.message).toContain('HTTP 403');
      expect(failure.message).not.toMatch(/secret|SQL|token|private/);
      expect(active.worker.posted).toContainEqual({ type: 'close' });
    });

    it('rejects malformed worker diagnostics without falling back to their arbitrary message', async () => {
      vi.stubGlobal('Worker', FakeWorker);
      for (const diagnostic of [undefined, null, { stage: 'secret URL', reason: 'network' }, { stage: 'query_execution', reason: 'http_status', status: 999 }]) {
        const active = await started(new FederatedQueryService());
        active.worker.send({ type: 'error', diagnostic, message: 'secret SQL auth' });
        await expect(active.run).rejects.toThrow('invalid diagnostic');
      }
    });

    it('sends the static source to the worker only when one is given', async () => {
      vi.stubGlobal('Worker', FakeWorker);
      const plain = await started(new FederatedQueryService());
      expect(plain.worker.posted[0]).toEqual({
        type: 'run',
        definition,
        token: '',
        mode: 'full',
      });
      expect('staticSource' in (plain.worker.posted[0] as object)).toBe(false);
      plain.worker.send({ type: 'result', result });
      await plain.run;

      const staticSource = {
        baseUrl: 'https://static.example.test/data',
        version: 'v1',
      };
      const withSource = await started(new FederatedQueryService(), {
        staticSource,
      });
      expect(withSource.worker.posted[0]).toEqual({
        type: 'run',
        definition,
        token: '',
        mode: 'full',
        staticSource,
      });
      withSource.worker.send({ type: 'result', result });
      await withSource.run;
    });
    it.each(['previous-session', 'orphan-storage'])('settles cancellation during deferred %s cleanup without creating a Worker', async (phase) => {
      vi.stubGlobal('Worker', FakeWorker); FakeWorker.last = undefined;
      const service = new FederatedQueryService();
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const cleanup = phase === 'previous-session'
        ? vi.spyOn(service as unknown as { closeWorker: () => Promise<void> }, 'closeWorker').mockImplementationOnce(() => held)
        : vi.spyOn(indexedDB, 'databases').mockImplementationOnce(() => held.then(() => []));
      const run = service.run(definition), rejected = expect(run).rejects.toThrow('cancelled');
      if (phase === 'orphan-storage') await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
      await service.dispose(); await rejected;
      expect(FakeWorker.last).toBeUndefined();
      release(); await Promise.resolve(); await Promise.resolve();
      expect(FakeWorker.last).toBeUndefined();
    });

    it('starts replacement before old startup cleanup settles and ignores old cleanup failure', async () => {
      vi.stubGlobal('Worker', FakeWorker); FakeWorker.last = undefined;
      const service = new FederatedQueryService();
      let failOld!: (error: Error) => void;
      vi.spyOn(indexedDB, 'databases').mockImplementationOnce(() => new Promise((_resolve, reject) => { failOld = reject; }));
      const old = service.run(definition), rejected = expect(old).rejects.toThrow('cancelled');
      await vi.waitFor(() => expect(failOld).toBeDefined());
      const replacement = service.run(definition);
      await rejected;
      await vi.waitFor(() => expect(FakeWorker.last?.posted.length).toBe(1));
      const worker = currentWorker();
      failOld(new Error('Old cleanup failed.')); await Promise.resolve(); await Promise.resolve();
      worker.send({ type: 'result', result });
      await expect(replacement).resolves.toEqual(result);
      expect(worker.terminate).not.toHaveBeenCalled();
    });

    it('captures immutable executed graph identity before asynchronous startup cleanup', async () => {
      vi.stubGlobal('Worker', FakeWorker);
      const service = new FederatedQueryService(), nativeGraph = graphFixturePlan();
      const graph = { ...definition, federation: { ovdbBaseUrl: 'https://runtime.example', tables: [], nativeGraph } };
      FakeWorker.last = undefined;
      const run = service.run(graph), rejected = expect(run).rejects.toThrow('cancelled');
      Object.assign(nativeGraph, { aliases: false });
      await vi.waitFor(() => expect(FakeWorker.last?.posted.length).toBe(1));
      const sent = currentWorker().posted[0] as { definition: IQueryDef };
      expect(sent.definition.federation?.nativeGraph?.aliases).toBe(true);
      expect(sent.definition).not.toBe(graph);
      await service.dispose(); await rejected;
    });

    it('cancels before graph output creation, immediately restarts, and allows a local history switch', async () => {
      vi.stubGlobal('Worker', FakeWorker);
      const service = new FederatedQueryService(), graph = { ...definition, federation: { ovdbBaseUrl: 'https://runtime.example', tables: [], nativeGraph: graphFixturePlan() } };
      const start = async () => {
        FakeWorker.last = undefined;
        const run = service.run(graph), rejected = expect(run).rejects.toThrow('cancelled');
        await vi.waitFor(() => expect(FakeWorker.last?.posted.length).toBe(1));
        const worker = currentWorker();
        const storageId = (worker.posted[0] as { storageId: string }).storageId;
        return { rejected, worker, output: `datatug-output-${storageId}` };
      };
      const first = await start(); await expect(service.dispose()).resolves.toBeUndefined(); await first.rejected;
      expect(first.worker.terminate).toHaveBeenCalledOnce();
      expect((await indexedDB.databases()).some((db) => db.name === first.output)).toBe(false);
      const artifact = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(`datatug-output-100000-${crypto.randomUUID()}`, 2);
        request.onupgradeneeded = () => createOutputStores(request.result);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const primary = [[{ type: 'string' as const, value: 'recorded-row' }]];
      const stored = { recordset: { columns: [{ name: 'Affiliation', type: 'string' }], rows: primary }, nativeGraph: { planIdentity: graphStableIdentity(graph.federation.nativeGraph), stageActions: [], coverage: {}, edges: {}, ledger: {} }, limitations: [], bindingsApplied: [], truncated: false, provenance: { observedAt: '2026-10-05T10:00:00Z', queryId: graph.id, source: 'synthetic', mode: 'live', executionProfile: 'protected' } } as unknown as FederatedQueryResult;
      const descriptor = await replaceGraphOutput(artifact, graph, stored, primary, 1); artifact.close();
      const second = await start();
      // This is the component's dispose-before-local-open sequence, with no artifact created by the pending run.
      await expect(service.dispose()).resolves.toBeUndefined(); await second.rejected;
      expect((await service.openLocalResult(descriptor.id)).result.recordset.rows).toEqual(primary);
      await deleteLocalResult(descriptor.id);
    });
    it('terminates a bounded worker that never answers and rejects instead of keeping synchronous work alive', async () => {
      vi.stubGlobal('Worker', FakeWorker);
      const service = new FederatedQueryService();
      const bounded = {
        ...definition,
        federation: {
          ovdbBaseUrl: 'https://ovdb.demodb.dev',
          tables: [],
          bounds: {
            userRows: 100,
            userOffset: 0,
            identifierKind: 'place' as const,
            identifierLimit: 100,
            resultRows: 5000,
            bytes: 5242880,
            timeoutMs: 100,
            sources: [
              { database: 'user', name: 'Customer', keyField: 'Country' },
              {
                database: 'geo',
                name: 'countries',
                keyField: 'id',
                parent: {
                  database: 'user',
                  name: 'Customer',
                  field: 'Country',
                },
              },
            ],
          },
        },
      };
      FakeWorker.last = undefined;
      const run = service.run(bounded);
      const rejected = expect(run).rejects.toThrow(/exceeded its deadline/);
      await vi.waitFor(() => expect(FakeWorker.last?.posted.length).toBe(1));
      await rejected;
      expect(currentWorker().terminate).toHaveBeenCalledOnce();
      await expect(service.dispose()).resolves.toBeUndefined();
    });

    it('shares a single monotonic deadline with a configured worker and cancels synchronous work promptly with owned-storage cleanup', async () => {
      vi.stubGlobal('Worker', FakeWorker);
      const service = new FederatedQueryService();
      const configured = {
        ...definition,
        federation: {
          ovdbBaseUrl: 'https://cloud.openvaultdb.com',
          tables: [],
          bounds: {
            timeoutMs: 10000,
            runtime: { readProfile: 'bounded-immutable/1' },
          },
        },
      } as unknown as IQueryDef;
      FakeWorker.last = undefined;
      const promise = service.run(configured);
      const rejected = expect(promise).rejects.toThrow(/cancelled/);
      await vi.waitFor(() => expect(FakeWorker.last?.posted.length).toBe(1));
      const worker = currentWorker();
      const first = worker.posted[0] as { deadline: number; storageId: string };
      expect(first.deadline).toBeGreaterThan(
        performance.timeOrigin + performance.now(),
      );
      expect(first.deadline).toBeLessThanOrEqual(
        performance.timeOrigin + performance.now() + 10000,
      );
      const name = `datatug-output-${first.storageId}`;
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
      worker.send({ type: 'storage', name });
      worker.send({ type: 'storage', name: 'unowned-user-database' });
      await service.dispose();
      await rejected;
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect((await indexedDB.databases()).some((db) => db.name === name)).toBe(
        false,
      );
      await expect(service.getPage(0)).rejects.toThrow(/unavailable/);
    });
  });
});
