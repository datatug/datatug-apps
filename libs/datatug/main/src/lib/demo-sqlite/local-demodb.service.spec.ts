import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoSqliteCatalog } from '../queries/demo-sqlite-catalog';
import {
  LARGE_DATASET_NEEDS_OPFS,
  LocalDemoDbSession,
  PROGRESS_DELAY_MS,
  classifyOpenError,
  type LocalDemoDbEnvironment,
} from './local-demodb.service';
import { LocalDemoDbOpenError } from './local-demodb-errors';
import { FakeLocalDemoDbRuntime, fakeEnvironment } from './local-demodb.spec-helper';
import type { LocalDemoDbRuntimeOptions } from './local-demodb.types';
import { QueryRuntimeRegistry } from '../queries/query-runtime-registry.service';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function harness(dataset: keyof typeof demoSqliteCatalog, environment: LocalDemoDbEnvironment = fakeEnvironment(), registry?: QueryRuntimeRegistry) {
  const runtimes: FakeLocalDemoDbRuntime[] = [];
  const loader = vi.fn(async () => (options: LocalDemoDbRuntimeOptions) => {
    const runtime = new FakeLocalDemoDbRuntime(options);
    runtimes.push(runtime);
    return runtime;
  });
  const session = new LocalDemoDbSession(demoSqliteCatalog[dataset], environment, loader, registry);
  return { session, runtimes, loader, environment };
}

describe('LocalDemoDbSession', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens a small dataset without asking and exposes an OVDB connection', async () => {
    const env = fakeEnvironment();
    const { session, runtimes, loader } = harness('chinook', env);
    const started = session.start();
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(session.state()).toMatchObject({ kind: 'loading', phase: 'opening', showProgress: false });
    runtimes[0].open();
    await started;
    expect(session.state()).toEqual({ kind: 'ready', persistent: true, replacedPreviousVersion: false });
    expect(session.role()).toBe('leader');
    const connection = session.connection();
    expect(connection).toMatchObject({ id: 'chinook-sqlite-local', baseUrl: 'https://local.ovdb.invalid', databaseId: 'chinook' });
    expect(session.baseUrl).toBe('https://local.ovdb.invalid');
    expect(session.fetch).toBe(runtimes[0].fetch);
    expect(connection?.descriptor.capabilities).toMatchObject({ write: true, delete: true, reset: true, persistent: true });
    expect(connection?.descriptor.collections).toEqual(['Album', 'Artist', 'PlaylistTrack', 'Track']);
    expect(connection?.descriptor.canonical?.sha256).toBe(demoSqliteCatalog.chinook.sha256);
    expect(env.stored.get('chinook')).toBe(true);
  });

  it('registers only the live ready connection and removes it when the provider closes', async () => {
    const registry = new QueryRuntimeRegistry();
    const { session, runtimes } = harness('chinook', fakeEnvironment(), registry);
    const declaration = { id: 'an-arbitrary-logical-id', fixtureSha256: demoSqliteCatalog.chinook.sha256 };
    expect(registry.candidates(declaration)).toEqual([]);
    const started = session.start();
    await flush();
    runtimes[0].open();
    await started;
    const candidates = registry.candidates(declaration);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].connection.fetch).toBe(runtimes[0].fetch);
    expect(registry.resolve(candidates[0].selectionId, { ...declaration, fixtureSha256: '0'.repeat(64) })).toBeUndefined();
    session.dispose();
    expect(registry.candidates(declaration)).toEqual([]);
    expect(registry.resolve(candidates[0].selectionId, declaration)).toBeUndefined();
  });

  it('shares overlapping opens and revisits an already ready session without a second runtime', async () => {
    const registry = new QueryRuntimeRegistry();
    const { session, runtimes, loader } = harness('chinook', fakeEnvironment(), registry);
    const first = session.start();
    const overlapping = session.start();
    expect(overlapping).toBe(first);
    await flush();
    expect(loader).toHaveBeenCalledOnce();
    runtimes[0].open();
    await first;
    const connection = session.connection();
    await session.start();
    expect(loader).toHaveBeenCalledOnce();
    expect(session.connection()).toBe(connection);
    expect(registry.candidates({ fixtureSha256: demoSqliteCatalog.chinook.sha256 })).toHaveLength(1);
    session.dispose();
  });

  it('shows no progress UI for a quick open and phased progress for a slow one', async () => {
    const { session, runtimes } = harness('sakila');
    const started = session.start();
    await flush();
    runtimes[0].progress({ phase: 'download', loaded: 1_000_000 });
    expect(session.state()).toMatchObject({ kind: 'loading', phase: 'download', loaded: 1_000_000, total: 4915200, showProgress: false });
    vi.advanceTimersByTime(PROGRESS_DELAY_MS);
    expect(session.state()).toMatchObject({ showProgress: true });
    // The download reports its own total when it knows one.
    runtimes[0].progress({ phase: 'download', loaded: 2_000_000, total: 4_000_000 });
    expect(session.state()).toMatchObject({ phase: 'download', loaded: 2_000_000, total: 4_000_000 });
    runtimes[0].progress({ phase: 'install', step: 'importWorking' });
    expect(session.state()).toMatchObject({ phase: 'install', step: 'importWorking', loaded: 4_000_000 });
    runtimes[0].open({ imported: true });
    await started;
    expect(session.state().kind).toBe('ready');
  });

  it('asks before downloading a large dataset that is not stored, then opens on Continue', async () => {
    const { session, runtimes, loader } = harness('adventureworks');
    await session.start();
    expect(session.state()).toEqual({ kind: 'confirm-large', downloadBytes: 35367459, storageBytes: 126820352 });
    expect(loader).not.toHaveBeenCalled();
    const confirmed = session.confirmDownload();
    await flush();
    expect(session.state()).toMatchObject({ kind: 'loading', total: 126820352 });
    runtimes[0].open({ imported: true });
    await confirmed;
    expect(session.state().kind).toBe('ready');
  });

  it('opens a stored large dataset without asking', async () => {
    const env = fakeEnvironment();
    env.stored.set('adventureworks', true);
    const { session, runtimes } = harness('adventureworks', env);
    const started = session.start();
    await flush();
    expect(session.state().kind).toBe('loading');
    runtimes[0].open();
    await started;
    expect(session.state().kind).toBe('ready');
  });

  it('refuses to start when the storage quota is clearly too small', async () => {
    const env = fakeEnvironment({ storageEstimate: async () => ({ quota: 300_000_000, usage: 200_000_000 }) });
    const { session, loader } = harness('adventureworks', env);
    await session.start();
    // AdventureWorks keeps one copy (~126.8 MB): it does not fit into 100 MB.
    expect(session.state()).toEqual({ kind: 'insufficient-storage', neededBytes: 126820352, availableBytes: 100_000_000 });
    expect(loader).not.toHaveBeenCalled();
  });

  it('never prompts or downloads a large dataset when OPFS is unavailable', async () => {
    const env = fakeEnvironment({ opfsAvailable: async () => false });
    const { session, loader } = harness('adventureworks', env);
    await session.start();
    expect(session.state()).toEqual({ kind: 'unsupported-browser', message: LARGE_DATASET_NEEDS_OPFS });
    expect(loader).not.toHaveBeenCalled();
  });

  it('closes a large dataset that fell back to memory instead of using it', async () => {
    const env = fakeEnvironment();
    env.stored.set('adventureworks', true);
    const { session, runtimes } = harness('adventureworks', env);
    const started = session.start();
    await flush();
    runtimes[0].open({ persistent: false, fallback: { reason: 'security', message: 'refused' } });
    await started;
    expect(session.state()).toEqual({ kind: 'unsupported-browser', message: LARGE_DATASET_NEEDS_OPFS });
    expect(runtimes[0].closed).toBe(true);
    expect(session.connection()).toBeUndefined();
    expect(env.stored.get('adventureworks')).toBe(false);
  });

  it('keeps small datasets in memory with persistent:false when OPFS is unavailable', async () => {
    const env = fakeEnvironment();
    const { session, runtimes } = harness('pubs', env);
    const started = session.start();
    await flush();
    runtimes[0].open({ persistent: false, fallback: { reason: 'security', message: 'private window' } });
    await started;
    expect(session.state()).toEqual({ kind: 'ready', persistent: false, replacedPreviousVersion: false, fallbackReason: 'security' });
    expect(env.stored.get('pubs')).toBe(false);
  });

  it('surfaces a replaced previous version', async () => {
    const { session, runtimes } = harness('chinook');
    const started = session.start();
    await flush();
    runtimes[0].open({ replacedPreviousVersion: true, imported: true });
    await started;
    expect(session.state()).toMatchObject({ kind: 'ready', replacedPreviousVersion: true });
  });

  it('offers a retry when the pool stays locked, and opens on retry', async () => {
    const { session, runtimes } = harness('chinook');
    const started = session.start();
    await flush();
    runtimes[0].fail(new LocalDemoDbOpenError('locked', 'OPFS files are locked'));
    await started;
    expect(session.state().kind).toBe('locked-retry');
    expect(runtimes[0].closed).toBe(true);
    const retried = session.retry();
    await flush();
    runtimes[1].open();
    await retried;
    expect(session.state().kind).toBe('ready');
  });

  it('explains a quota failure while importing, with the dataset-specific need', async () => {
    const env = fakeEnvironment();
    env.stored.set('adventureworks', true);
    const { session, runtimes } = harness('adventureworks', env);
    const started = session.start();
    await flush();
    runtimes[0].fail(new LocalDemoDbOpenError('quota', 'could not write'));
    await started;
    expect(session.state()).toEqual({
      kind: 'failed',
      storage: true,
      message: 'Not enough browser storage for this dataset (needs ~126.8 MB). Free space or try a smaller dataset.',
    });
  });

  it('shows a large dataset that cannot use OPFS as unsupported, with nothing downloaded', async () => {
    const env = fakeEnvironment();
    env.stored.set('adventureworks', true);
    const { session, runtimes } = harness('adventureworks', env);
    const started = session.start();
    await flush();
    runtimes[0].fail(new LocalDemoDbOpenError('opfs-unavailable', 'no OPFS'));
    await started;
    expect(session.state()).toEqual({ kind: 'unsupported-browser', message: LARGE_DATASET_NEEDS_OPFS });
    expect(runtimes[0].closed).toBe(true);
  });

  it('reports a runtime that cannot be loaded as failed', async () => {
    const session = new LocalDemoDbSession(demoSqliteCatalog.chinook, fakeEnvironment(), async () => {
      throw new Error('chunk load failed');
    });
    await session.start();
    expect(session.state()).toMatchObject({ kind: 'failed', storage: false });
  });

  it('refuses browsers without workers', async () => {
    const { session, loader } = harness('chinook', fakeEnvironment({ supportsWorkers: () => false }));
    await session.start();
    expect(session.state().kind).toBe('unsupported-browser');
    expect(loader).not.toHaveBeenCalled();
  });

  it('opens a single-copy dataset like any other', async () => {
    const env = fakeEnvironment();
    env.stored.set('adventureworks', true);
    const { session, runtimes } = harness('adventureworks', env);
    expect(demoSqliteCatalog.adventureworks.storagePolicy).toBe('single-copy');
    const started = session.start();
    await flush();
    runtimes[0].open();
    await started;
    expect(session.state().kind).toBe('ready');
  });

  it('refreshes the descriptor and closes the runtime on dispose', async () => {
    const { session, runtimes } = harness('chinook');
    const started = session.start();
    await flush();
    runtimes[0].open();
    await started;
    const descriptor = await session.refreshDescriptor();
    expect(descriptor.localState).toEqual({ modified: false });
    session.dispose();
    expect(runtimes[0].closed).toBe(true);
    expect(session.connection()).toBeUndefined();
  });
});

describe('classifyOpenError', () => {
  const entry = demoSqliteCatalog.chinook;
  it('maps each failure kind to a state the page explains', () => {
    expect(classifyOpenError(new LocalDemoDbOpenError('download', 'HTTP 503'), entry)).toMatchObject({
      kind: 'failed',
      storage: false,
      message: expect.stringContaining('could not be downloaded'),
    });
    expect(classifyOpenError(new LocalDemoDbOpenError('integrity', 'bad sha'), entry)).toMatchObject({
      message: expect.stringContaining('checksum'),
    });
    expect(classifyOpenError(new LocalDemoDbOpenError('quota', 'x'), entry)).toMatchObject({
      storage: true,
      message: expect.stringContaining('Not enough browser storage'),
    });
    expect(classifyOpenError(new LocalDemoDbOpenError('storage', 'I/O error'), entry)).toMatchObject({
      storage: true,
      message: expect.stringContaining('could not be stored'),
    });
    expect(classifyOpenError(new LocalDemoDbOpenError('locked', 'held'), entry).kind).toBe('locked-retry');
  });

  it('does not read a message for quota: a plain error that mentions quota is an ordinary failure', () => {
    expect(classifyOpenError(new Error('quota exceeded'), entry)).toMatchObject({ kind: 'failed', storage: false });
  });
});
