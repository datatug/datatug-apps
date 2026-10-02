import { afterEach, describe, expect, it, vi } from 'vitest';

import { ManualTimers } from './github-fake-backend.test';
import {
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
        forgetResolved: () => Promise.resolve(),
      },
      timers.set,
    );
    expect(await store.getFile(KEY, 'f')).toEqual({ text: 'x', bytes: 1 });
    expect(await store.getResolved('o/r@HEAD')).toEqual({ sha: 's', at: 1 });
    await store.putFile(KEY, 'f', { text: 'x', bytes: 1 });
    await store.putResolved('o/r@HEAD', { sha: 's', at: 1 });
    await store.forgetResolved('o/r');
    expect(timers.delays).toEqual(Array(5).fill(GITHUB_STORE_TIMEOUT_MS));
    expect(timers.count).toBe(0);
  });

  it('a call that does not answer in time gives the empty answer, and the store is off for the rest of the visit', async () => {
    const timers = new ManualTimers();
    const { store: inner, calls } = spyStore(
      () => new Promise(() => undefined),
    );
    const store = guardGithubFileStore(inner, timers.set);

    const first = store.getResolved('o/r@HEAD');
    const second = store.getFile(KEY, 'f'); // asked at the same time
    expect(timers.count).toBe(2);
    timers.fireAll();
    expect(await first).toBeUndefined();
    expect(await second).toBeUndefined();

    // Off: not asked, no timer.
    expect(await store.getFile(KEY, 'g')).toBeUndefined();
    await store.putFile(KEY, 'g', { text: 'x', bytes: 1 });
    await store.putResolved('o/r@HEAD', { sha: 's', at: 1 });
    await store.forgetResolved('o/r');
    expect(await store.getResolved('o/r@HEAD')).toBeUndefined();
    expect(calls).toEqual(['getResolved', 'getFile']);
    expect(timers.count).toBe(0);
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
