import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FederatedQueryService } from './federated-query.service';
import { QueryType, type IQueryDef } from '../models/definition/query-def';

describe('federated query worker boundary', () => {
  afterEach(() => vi.unstubAllGlobals());

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
      const run = service.run(
        definition,
        undefined,
        '',
        'full',
        undefined,
        extras,
      );
      await vi.waitFor(() => expect(FakeWorker.last?.posted.length).toBe(1));
      return { run, worker: FakeWorker.last as FakeWorker };
    };

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
    it('terminates a bounded worker that never answers and rejects instead of keeping synchronous work alive', async () => {
      vi.stubGlobal('Worker', FakeWorker);
      const service = new FederatedQueryService();
      const bounded = {
        ...definition,
        federation: {
          ovdbBaseUrl: 'https://demodb.dev/ovdb',
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
      const worker = FakeWorker.last;
      await rejected;
      expect(worker?.terminate).toHaveBeenCalledOnce();
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
      const worker = FakeWorker.last;
      const first = worker?.posted[0] as { deadline: number; storageId: string };
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
      worker?.send({ type: 'storage', name });
      worker?.send({ type: 'storage', name: 'unowned-user-database' });
      await service.dispose();
      await rejected;
      expect(worker?.terminate).toHaveBeenCalledOnce();
      expect((await indexedDB.databases()).some((db) => db.name === name)).toBe(
        false,
      );
      await expect(service.getPage(0)).rejects.toThrow(/unavailable/);
    });
  });
});
