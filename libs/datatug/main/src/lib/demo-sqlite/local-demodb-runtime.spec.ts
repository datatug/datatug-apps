import { describe, expect, it, vi } from 'vitest';
import {
  CanonicalFetchError,
  CanonicalIntegrityError,
  DatasetStorageError,
  PoolUnavailableError,
  reviveError,
  serializeError,
  type BridgePort,
} from '@dalgo/sqlite-wasm/opfs';
import { createOvdbFetch, fetchOverPort, serveFetchOverPort } from '@openvaultdb/inprocess';
import { demoSqliteCatalog } from '../queries/demo-sqlite-catalog';
import { fetchOvdbDescriptor } from '../ovdb/ovdb-connection';
import type { CreateOvdbFetch } from './local-demodb-host';
import { LocalDemoDbOpenError } from './local-demodb-errors';
import {
  classifyOpenFailure,
  createLocalDemoDbRuntime,
  type DemoDbSessionLike,
  type DemoDbSessionOptions,
  type LocalDemoDbRuntimeDeps,
} from './local-demodb-runtime';
import { MemorySqliteDatabase, memoryModifiedFlag } from './local-demodb.spec-helper';

/**
 * A port with the contract of @dalgo/sqlite-wasm's `BridgePort`: listeners are kept per
 * event type, `message` carries data (copied), and `close` is dispatched once.
 */
class FakeBridgePort implements BridgePort {
  readonly #listeners = { message: new Set<(event: never) => void>(), messageerror: new Set<(event: never) => void>(), close: new Set<(event: never) => void>() };
  peer?: FakeBridgePort;
  closed = false;
  postMessage(message: unknown): void {
    if (this.closed) return;
    const copy = structuredClone(message);
    setTimeout(() => this.peer?.deliver(copy), 0);
  }
  deliver(data: unknown): void {
    if (this.closed) return;
    this.#listeners.message.forEach((listener) => (listener as (event: MessageEvent) => void)({ data } as MessageEvent));
  }
  addEventListener(type: 'message' | 'messageerror' | 'close', listener: (event: never) => void): void {
    this.#listeners[type].add(listener);
  }
  removeEventListener(type: 'message' | 'messageerror' | 'close', listener: (event: never) => void): void {
    this.#listeners[type].delete(listener);
  }
  start(): void {
    /* flowing */
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.#listeners.close.forEach((listener) => (listener as (event: Event) => void)(new Event('close')));
    this.peer?.close();
  }
}

function pair(): [FakeBridgePort, FakeBridgePort] {
  const a = new FakeBridgePort();
  const b = new FakeBridgePort();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

const entry = demoSqliteCatalog.chinook;

function fakeDeps() {
  const database = new MemorySqliteDatabase();
  let options: DemoDbSessionOptions | undefined;
  const session = {
    role: 'leader',
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
      return session;
    },
    createOvdbFetch: createOvdbFetch as unknown as CreateOvdbFetch,
    fetchOverPort: (port) => fetchOverPort(port),
    serveFetchOverPort: (fetch, port) => serveFetchOverPort(fetch, port),
    createWorker: () => ({}) as Worker,
    modifiedFlag: () => memoryModifiedFlag(),
  };
  return {
    deps,
    session,
    database,
    options: (): DemoDbSessionOptions => {
      if (!options) throw new Error('openDemoDb was not called');
      return options;
    },
  };
}

describe('createLocalDemoDbRuntime', () => {
  it('pins the canonical file and serves OVDB to this tab over the bridge port', async () => {
    const { deps, options } = fakeDeps();
    const runtime = createLocalDemoDbRuntime(deps, { entry, onProgress: vi.fn() });
    expect(options().pin).toEqual({ dataset: 'chinook', url: entry.url, sha256: entry.sha256, bytes: entry.bytes });
    expect(await runtime.ready()).toEqual({
      persistent: true,
      replacedPreviousVersion: true,
      imported: true,
      canonicalSha256: entry.sha256,
    });
    // Several requests in a row: the bridge's `message` events must not be taken for `close`.
    for (let i = 0; i < 3; i++) {
      const descriptor = await fetchOvdbDescriptor(runtime.fetch, runtime.baseUrl, 'chinook');
      expect(descriptor.collections).toContain('Artist');
      expect(descriptor.capabilities.write).toBe(true);
    }
  });

  it('keeps small datasets in two copies with a memory fallback, and large ones in one copy without', () => {
    const small = fakeDeps();
    createLocalDemoDbRuntime(small.deps, { entry, onProgress: vi.fn() });
    expect(small.options()).toMatchObject({ memoryFallback: 'allow', storagePolicy: 'working-and-pristine' });
    const large = fakeDeps();
    createLocalDemoDbRuntime(large.deps, { entry: demoSqliteCatalog.adventureworks, onProgress: vi.fn() });
    expect(large.options()).toMatchObject({ memoryFallback: 'forbid', storagePolicy: 'single-copy' });
  });

  it('pins a chunked dataset by its manifest URL as a gzip stream, keeping the decoded SQLite pin', () => {
    const { deps, options } = fakeDeps();
    const chunked = demoSqliteCatalog.adventureworks;
    createLocalDemoDbRuntime(deps, { entry: chunked, onProgress: vi.fn() });
    expect(options().pin).toEqual({
      dataset: 'adventureworks',
      url: 'https://adventureworks.demodb.dev/data/adventureworks.sqlite.parts.json',
      sha256: chunked.sha256,
      bytes: chunked.bytes,
      compression: 'gzip',
    });
  });

  it('maps the worker phases to the download bar and install steps', () => {
    const { deps, options } = fakeDeps();
    const onProgress = vi.fn();
    createLocalDemoDbRuntime(deps, { entry, onProgress });
    options().onProgress({ phase: 'fetch', loaded: 42, total: 100 });
    options().onProgress({ phase: 'verify' });
    options().onProgress({ phase: 'importWorking', total: 100 });
    options().onProgress({ phase: 'somethingNew' });
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { phase: 'download', loaded: 42, total: 100 },
      { phase: 'install', step: 'verify' },
      { phase: 'install', step: 'importWorking' },
    ]);
  });

  it('closes the fetch and the session', async () => {
    const { deps, session } = fakeDeps();
    const runtime = createLocalDemoDbRuntime(deps, { entry, onProgress: vi.fn() });
    runtime.close();
    expect(session.close).toHaveBeenCalled();
    await expect(runtime.fetch(`${runtime.baseUrl}/v1/databases/chinook`)).rejects.toThrow();
  });

  it('reports a failed open as a classified error', async () => {
    const { deps, session } = fakeDeps();
    session.ready.mockRejectedValueOnce(new PoolUnavailableError('locked', 'held'));
    const runtime = createLocalDemoDbRuntime(deps, { entry, onProgress: vi.fn() });
    await expect(runtime.ready()).rejects.toMatchObject({ kind: 'locked' });
  });
});

describe('classifyOpenFailure', () => {
  const quota = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
  const kindOf = (error: unknown) => (classifyOpenFailure(error) as LocalDemoDbOpenError).kind;

  it('recognises a quota failure by class, operation and cause, not by message', () => {
    expect(kindOf(new DatasetStorageError('import', 'could not write', { cause: quota }))).toBe('quota');
    expect(kindOf(new PoolUnavailableError('quota', 'full'))).toBe('quota');
    // A message that mentions space or quota is not a quota failure.
    expect(kindOf(new DatasetStorageError('import', 'no space left, quota full', { cause: new Error('I/O') }))).toBe('storage');
    expect(kindOf(new DatasetStorageError('open', 'could not open', { cause: quota }))).toBe('storage');
  });

  it('tells a held pool and unusable OPFS apart', () => {
    expect(kindOf(new PoolUnavailableError('locked', 'held'))).toBe('locked');
    for (const reason of ['missing-api', 'security', 'sync-handles-unavailable', 'other'] as const) {
      expect(kindOf(new PoolUnavailableError(reason, 'no OPFS'))).toBe('opfs-unavailable');
    }
  });

  it('classifies download and integrity failures, and leaves other errors alone', () => {
    expect(kindOf(new CanonicalFetchError('HTTP 503', 503))).toBe('download');
    expect(kindOf(new CanonicalFetchError('HTTP 429', 429))).toBe('rate-limited');
    expect(kindOf(reviveError(serializeError(new CanonicalFetchError('HTTP 429', 429))))).toBe('rate-limited');
    expect(kindOf(new CanonicalIntegrityError('bad sha'))).toBe('integrity');
    const other = new Error('boom');
    expect(classifyOpenFailure(other)).toBe(other);
  });

  it('works on errors revived from the worker, which keep their class', () => {
    const revived = reviveError(serializeError(new DatasetStorageError('import', 'could not write', { cause: quota })));
    expect(kindOf(revived)).toBe('quota');
  });
});
