import { afterEach, describe, expect, it, vi } from 'vitest';

import { ManualTimers } from './github-fake-backend.test';
import {
  GITHUB_STORE_OPEN_TIMEOUT_MS,
  GITHUB_STORE_TIMEOUT_MS,
  guardGithubFileStore,
  setGithubTimer,
  type IGithubFileStore,
} from './github-file-store-api';

const KEY = 'o/r@' + 'a'.repeat(40);

/** A store whose every call is a spy answering what the test says. */
function spyStore(answer: () => Promise<unknown>) {
  const calls: string[] = [];
  const call = (name: string) => () => {
    calls.push(name);
    return answer();
  };
  const store = {
    getFile: call('getFile'),
    putFile: call('putFile'),
    getResolved: call('getResolved'),
    putResolved: call('putResolved'),
    dropResolved: call('dropResolved'),
    forgetResolved: call('forgetResolved'),
  } as unknown as IGithubFileStore;
  return { store, calls };
}

describe('guardGithubFileStore (a cache that does not answer is no cache)', () => {
  afterEach(() => vi.useRealTimers());

  it('passes the answers through, and cancels its timer', async () => {
    const timers = new ManualTimers();
    const store = guardGithubFileStore(
      {
        getFile: () => Promise.resolve({ text: 'x', bytes: 1 }),
        putFile: () => Promise.resolve(),
        getResolved: () => Promise.resolve({ sha: 's', at: 1 }),
        putResolved: () => Promise.resolve(),
        dropResolved: () => Promise.resolve(),
        forgetResolved: () => Promise.resolve(),
      },
      timers.set,
    );
    expect(await store.getFile(KEY, 'f')).toEqual({ text: 'x', bytes: 1 });
    expect(await store.getResolved('o/r@HEAD')).toEqual({ sha: 's', at: 1 });
    await store.putFile(KEY, 'f', { text: 'x', bytes: 1 });
    await store.putResolved('o/r@HEAD', { sha: 's', at: 1 });
    await store.dropResolved('o/r@HEAD');
    await store.forgetResolved('o/r');
    // Every call waits the same; the first also starts the limit of the opening, cancelled when it answers.
    expect(timers.delays).toEqual([
      GITHUB_STORE_TIMEOUT_MS,
      GITHUB_STORE_OPEN_TIMEOUT_MS,
      ...Array(5).fill(GITHUB_STORE_TIMEOUT_MS),
    ]);
    expect(timers.count).toBe(0);
  });

  it('a first call that does not answer in time gives the empty answer; the calls after it are not made until the store answers', async () => {
    const timers = new ManualTimers();
    const { store: inner, calls } = spyStore(
      () => new Promise(() => undefined),
    );
    const store = guardGithubFileStore(inner, timers.set);

    const first = store.getResolved('o/r@HEAD');
    const second = store.getFile(KEY, 'f'); // asked at the same time
    expect(timers.count).toBe(3); // two waits, and the one limit of the opening
    timers.fireWith(GITHUB_STORE_TIMEOUT_MS);
    expect(await first).toBeUndefined();
    expect(await second).toBeUndefined();

    // Paused: not asked, no timer, no wait.
    expect(await store.getFile(KEY, 'g')).toBeUndefined();
    await store.putFile(KEY, 'g', { text: 'x', bytes: 1 });
    await store.putResolved('o/r@HEAD', { sha: 's', at: 1 });
    expect(await store.getResolved('o/r@HEAD')).toBeUndefined();
    expect(calls).toEqual(['getResolved', 'getFile']);
    expect(timers.count).toBe(1); // the limit of the opening
  });

  it('a late answer of the first call switches the cache back on for the calls after it, and is not applied to the read that gave up', async () => {
    const timers = new ManualTimers();
    const answers: ((v: unknown) => void)[] = [];
    let slow = true;
    const { store: inner, calls } = spyStore(() =>
      slow
        ? new Promise((resolve) => answers.push(resolve))
        : Promise.resolve({ text: 'cached', bytes: 6 }),
    );
    const store = guardGithubFileStore(inner, timers.set);

    const read = store.getFile(KEY, 'f');
    timers.fireWith(GITHUB_STORE_TIMEOUT_MS);
    expect(await read).toBeUndefined();
    expect(await store.getFile(KEY, 'g')).toBeUndefined(); // paused: not asked

    slow = false;
    answers[0]({ text: 'late', bytes: 4 }); // the database opened, a moment too late for the first read
    await Promise.resolve();
    await Promise.resolve();
    expect(await read).toBeUndefined();
    expect(timers.count).toBe(0); // the limit of the opening was cancelled by the answer

    expect(await store.getFile(KEY, 'h')).toEqual({ text: 'cached', bytes: 6 });
    expect(calls).toEqual(['getFile', 'getFile']);
  });

  it('a first call that does not answer within the limit of the opening: the cache is off for the rest of the visit, and a later answer changes nothing', async () => {
    const timers = new ManualTimers();
    let answer: (v: unknown) => void = () => undefined;
    const { store: inner, calls } = spyStore(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const store = guardGithubFileStore(inner, timers.set);

    const read = store.getResolved('o/r@HEAD');
    timers.fireWith(GITHUB_STORE_TIMEOUT_MS);
    await read;
    timers.fireWith(GITHUB_STORE_OPEN_TIMEOUT_MS);
    answer({ sha: 's', at: 1 });
    await Promise.resolve();
    await Promise.resolve();

    expect(await store.getResolved('o/r@HEAD')).toBeUndefined();
    expect(calls).toEqual(['getResolved']);
  });

  it('the limit of the opening is longer than the wait of a read', () => {
    expect(GITHUB_STORE_OPEN_TIMEOUT_MS).toBeGreaterThan(
      GITHUB_STORE_TIMEOUT_MS,
    );
    expect(GITHUB_STORE_OPEN_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });

  it('a store that has answered and then does not answer in time is off for the rest of the visit, and a late answer does not turn it on', async () => {
    const timers = new ManualTimers();
    let hang = false;
    let answer: (v: unknown) => void = () => undefined;
    const { store: inner, calls } = spyStore(() =>
      hang
        ? new Promise((resolve) => (answer = resolve))
        : Promise.resolve(undefined),
    );
    const store = guardGithubFileStore(inner, timers.set);
    await store.getFile(KEY, 'works');

    hang = true;
    const read = store.getFile(KEY, 'f');
    timers.fireAll();
    expect(await read).toBeUndefined();
    answer({ text: 'late', bytes: 4 });
    await Promise.resolve();
    await Promise.resolve();

    expect(await store.getFile(KEY, 'g')).toBeUndefined();
    expect(await store.getResolved('o/r@HEAD')).toBeUndefined();
    expect(calls).toEqual(['getFile', 'getFile']);
  });

  it('the deletion of remembered answers is attempted whatever the state of the cache, with the same wait', async () => {
    const timers = new ManualTimers();
    const { store: inner, calls } = spyStore(
      () => new Promise(() => undefined),
    );
    const store = guardGithubFileStore(inner, timers.set);
    const read = store.getFile(KEY, 'f');
    timers.fireAll(); // paused, then given up on
    await read;

    const dropped = store.dropResolved('o/r@HEAD');
    const forgotten = store.forgetResolved('o/r');
    expect(calls).toEqual(['getFile', 'dropResolved', 'forgetResolved']);
    expect(timers.count).toBe(2);
    timers.fireAll();
    expect(await dropped).toBeUndefined();
    expect(await forgotten).toBeUndefined();
    // The others are still not made.
    expect(await store.getFile(KEY, 'g')).toBeUndefined();
    expect(calls).toHaveLength(3);
  });

  it('a call that fails, even by throwing, is an empty answer; the store stays on', async () => {
    const timers = new ManualTimers();
    let n = 0;
    const store = guardGithubFileStore(
      {
        getFile: () => {
          n++;
          if (n === 1) {
            throw new Error('sync');
          }
          return n === 2
            ? Promise.reject(new Error('async'))
            : Promise.resolve({ text: 'ok', bytes: 2 });
        },
        putFile: () => Promise.resolve(),
        getResolved: () => Promise.resolve(undefined),
        putResolved: () => Promise.resolve(),
        dropResolved: () => Promise.resolve(),
        forgetResolved: () => Promise.resolve(),
      },
      timers.set,
    );
    expect(await store.getFile(KEY, 'f')).toBeUndefined();
    expect(await store.getFile(KEY, 'f')).toBeUndefined();
    expect(await store.getFile(KEY, 'f')).toEqual({ text: 'ok', bytes: 2 });
    expect(timers.count).toBe(0);
  });

  it('an answer that arrives after the time is ignored', async () => {
    const timers = new ManualTimers();
    let answer: (v: unknown) => void = () => undefined;
    const { store: inner } = spyStore(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const store = guardGithubFileStore(inner, timers.set);
    const pending = store.getFile(KEY, 'f');
    timers.fireAll();
    answer({ text: 'late', bytes: 4 });
    expect(await pending).toBeUndefined();
  });

  it('uses real timers by default, 2 seconds at the most', async () => {
    expect(GITHUB_STORE_TIMEOUT_MS).toBeLessThanOrEqual(2000);
    vi.useFakeTimers();
    const { store: inner } = spyStore(() => new Promise(() => undefined));
    const store = guardGithubFileStore(inner);
    let settled = false;
    const read = store.getFile(KEY, 'f').then((v) => {
      settled = true;
      return v;
    });
    await vi.advanceTimersByTimeAsync(GITHUB_STORE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await read).toBeUndefined();
  });
});

describe('setGithubTimer', () => {
  afterEach(() => vi.useRealTimers());

  it('fires once after the delay, unless cancelled', async () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    setGithubTimer(() => fired.push('a'), 10);
    const cancel = setGithubTimer(() => fired.push('b'), 10);
    cancel();
    await vi.advanceTimersByTimeAsync(10);
    expect(fired).toEqual(['a']);
  });
});
