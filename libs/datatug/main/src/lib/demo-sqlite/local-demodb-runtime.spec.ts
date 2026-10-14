import { describe, expect, it, vi } from 'vitest';
import { createOvdbFetch, fetchOverPort, serveFetchOverPort, type FetchPort } from '@openvaultdb/inprocess';
import { demoSqliteCatalog } from '../queries/demo-sqlite-catalog';
import { fetchOvdbDescriptor } from '../ovdb/ovdb-connection';
import type { CreateOvdbFetch } from './local-demodb-host';
import type { MessageOnlyPort } from './local-demodb-port';
import { createLocalDemoDbRuntime, type DemoDbSessionLike, type DemoDbSessionOptions, type LocalDemoDbRuntimeDeps } from './local-demodb-runtime';
import { MemorySqliteDatabase, memoryModifiedFlag } from './local-demodb.spec-helper';

/**
 * A port shaped like @dalgo/sqlite-wasm's bridge ports: listeners are kept
 * whatever the event type (as `Endpoint`/`ServedPort` do), and data is copied.
 */
class TypeIgnoringPort implements MessageOnlyPort {
  readonly listeners = new Set<(event: MessageEvent) => void>();
  peer?: TypeIgnoringPort;
  closed = false;
  postMessage(message: unknown): void {
    const copy = structuredClone(message);
    setTimeout(() => this.peer?.listeners.forEach((listener) => listener({ data: copy } as MessageEvent)), 0);
  }
  addEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }
  start(): void {
    /* flowing */
  }
  close(): void {
    this.closed = true;
  }
}

function pair(): [TypeIgnoringPort, TypeIgnoringPort] {
  const a = new TypeIgnoringPort();
  const b = new TypeIgnoringPort();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

const entry = demoSqliteCatalog.chinook;

function fakeDeps() {
  const database = new MemorySqliteDatabase();
  const worker = new EventTarget() as EventTarget & Worker;
  let options: DemoDbSessionOptions | undefined;
  const session = {
    role: 'leader',
    closed: false,
    ready: vi.fn(async () => ({
      persistent: true,
      replacedPreviousVersion: true,
      imported: true,
      canonical: { sha256: entry.sha256 },
    })),
    connect: vi.fn(() => {
      const [client, served] = pair();
      options?.serve.port(served, { database });
      return client;
    }),
    subscribe: vi.fn(() => () => undefined),
    close: vi.fn(),
  } satisfies DemoDbSessionLike & Record<string, unknown>;
  const deps: LocalDemoDbRuntimeDeps = {
    openDemoDb: (given) => {
      options = given;
      given.createWorker();
      return session;
    },
    createOvdbFetch: createOvdbFetch as unknown as CreateOvdbFetch,
    fetchOverPort: (port) => fetchOverPort(port),
    serveFetchOverPort: (fetch, port) => serveFetchOverPort(fetch, port),
    createWorker: () => worker,
    modifiedFlag: () => memoryModifiedFlag(),
  };
  return { deps, session, database, worker, options: () => options };
}

describe('createLocalDemoDbRuntime', () => {
  it('pins the canonical file and serves OVDB to this tab over the bridge port', async () => {
    const { deps, options } = fakeDeps();
    const runtime = createLocalDemoDbRuntime(deps, { entry, onProgress: vi.fn() });
    expect(options()?.pin).toEqual({ dataset: 'chinook', url: entry.url, sha256: entry.sha256, bytes: entry.bytes });
    expect(await runtime.ready()).toEqual({
      persistent: true,
      replacedPreviousVersion: true,
      imported: true,
      canonicalSha256: entry.sha256,
    });
    // Several requests in a row: a message must never be taken for the port closing.
    for (let i = 0; i < 3; i++) {
      const descriptor = await fetchOvdbDescriptor(runtime.fetch, runtime.baseUrl, 'chinook');
      expect(descriptor.collections).toContain('Artist');
      expect(descriptor.capabilities.write).toBe(true);
    }
  });

  it('forwards the worker’s download progress', () => {
    const { deps, worker } = fakeDeps();
    const onProgress = vi.fn();
    createLocalDemoDbRuntime(deps, { entry, onProgress });
    worker.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'datatug/demodb-progress', phase: 'download', loaded: 42 } }));
    worker.dispatchEvent(Object.assign(new Event('message'), { data: { id: 1, ok: true, value: null } }));
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith({ type: 'datatug/demodb-progress', phase: 'download', loaded: 42 });
  });

  it('closes the fetch and the session', async () => {
    const { deps, session } = fakeDeps();
    const runtime = createLocalDemoDbRuntime(deps, { entry, onProgress: vi.fn() });
    runtime.close();
    expect(session.close).toHaveBeenCalled();
    await expect(runtime.fetch(`${runtime.baseUrl}/v1/databases/chinook`)).rejects.toThrow();
  });

  it('positive control: fetchOverPort straight on a bridge-shaped port dies after the first answer', async () => {
    const [client, served] = pair();
    serveFetchOverPort(createOvdbFetch({ databases: { chinook: new MemorySqliteDatabase() } }), served as unknown as FetchPort);
    const fetch = fetchOverPort(client as unknown as FetchPort);
    await fetchOvdbDescriptor(fetch, 'https://local.ovdb.invalid', 'chinook');
    await expect(fetchOvdbDescriptor(fetch, 'https://local.ovdb.invalid', 'chinook')).rejects.toThrow();
  });
});
