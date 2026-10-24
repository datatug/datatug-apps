import { afterEach, describe, expect, it } from 'vitest';
import { resetGithubTokenRejection } from './github-user-token';

afterEach(() => resetGithubTokenRejection());

import {
  DEFAULT_ANON_LIMIT_MS,
  GITHUB_ANON_LIMIT_STORAGE_KEY,
  GITHUB_CONDITIONAL_STORAGE_PREFIX,
  MAX_ANON_LIMIT_MS,
  MAX_CONDITIONAL_ENTRIES,
  MAX_CONDITIONAL_ENTRY_BYTES,
  clearStoredGithubApiMemory,
  createGithubApiMemory,
  createInPageGithubApiMemory,
} from './github-api-memory';
import { githubGet, githubRetryAt, type GithubFetch } from './github-http';

/** A Storage in memory, or one that throws on every call (blocked storage, a private window). */
function storage(blocked = false): Storage {
  const data = new Map<string, string>();
  const guard = () => {
    if (blocked) throw new DOMException('blocked', 'SecurityError');
  };
  return {
    get length() {
      guard();
      return data.size;
    },
    key: (i) => (guard(), [...data.keys()][i] ?? null),
    getItem: (k) => (guard(), data.get(k) ?? null),
    setItem: (k, v) => (guard(), void data.set(k, v)),
    removeItem: (k) => (guard(), void data.delete(k)),
    clear: () => (guard(), data.clear()),
  };
}

const API = 'https://api.github.com/repos/o/r/commits/HEAD';
const RAW = 'https://raw.githubusercontent.com/o/r/HEAD/a.json';

describe('GitHub API memory', () => {
  it('remembers the anonymous limit across page loads (another memory over the same storage)', () => {
    let now = 1_000_000;
    const local = storage();
    const first = createGithubApiMemory(
      () => local,
      () => undefined,
      () => now,
    );
    first.noteAnonymousLimit(now + 30_000);
    const second = createGithubApiMemory(
      () => local,
      () => undefined,
      () => now,
    );
    expect(second.anonymousLimitedUntil()).toBe(now + 30_000);
    now += 30_000;
    expect(second.anonymousLimitedUntil()).toBe(0);
  });

  it('never trusts a limit further ahead than one hour (a bad value or a clock moved back)', () => {
    const now = 1_000_000;
    const local = storage();
    local.setItem(
      GITHUB_ANON_LIMIT_STORAGE_KEY,
      String(now + 10 * MAX_ANON_LIMIT_MS),
    );
    expect(
      createGithubApiMemory(
        () => local,
        () => undefined,
        () => now,
      ).anonymousLimitedUntil(),
    ).toBe(0);
    local.setItem(GITHUB_ANON_LIMIT_STORAGE_KEY, 'nonsense');
    expect(
      createGithubApiMemory(
        () => local,
        () => undefined,
        () => now,
      ).anonymousLimitedUntil(),
    ).toBe(0);
    const memory = createGithubApiMemory(
      () => local,
      () => undefined,
      () => now,
    );
    memory.noteAnonymousLimit(now + 10 * MAX_ANON_LIMIT_MS);
    expect(memory.anonymousLimitedUntil()).toBe(now + MAX_ANON_LIMIT_MS);
  });

  it('works for the page when storage is blocked (a private window)', () => {
    const now = 5_000;
    const memory = createGithubApiMemory(
      () => storage(true),
      () => storage(true),
      () => now,
    );
    memory.noteAnonymousLimit(now + 1000);
    expect(memory.anonymousLimitedUntil()).toBe(now + 1000);
    memory.putConditional('user:x||u', { etag: '"e"', text: 't', bytes: 1 });
    expect(memory.getConditional('user:x||u')).toEqual({
      etag: '"e"',
      text: 't',
      bytes: 1,
    });
    expect(() => memory.dropConditional()).not.toThrow();
    expect(memory.getConditional('user:x||u')).toBeUndefined();
    // No storage at all.
    const none = createGithubApiMemory(
      () => undefined,
      () => undefined,
      () => now,
    );
    none.putConditional('k', { etag: '"e"', text: 't', bytes: 1 });
    expect(none.getConditional('k')?.text).toBe('t');
  });

  it('keeps conditional answers in the tab, reads them back on the next page load, and drops them at sign-out', () => {
    const session = storage();
    const first = createGithubApiMemory(
      () => undefined,
      () => session,
    );
    first.putConditional('user:a||u1', { etag: '"1"', text: 'one', bytes: 3 });
    first.putConditional('anonymous||u2', {
      etag: '"2"',
      text: 'two',
      bytes: 3,
    });
    const second = createGithubApiMemory(
      () => undefined,
      () => session,
    );
    expect(second.getConditional('user:a||u1')).toEqual({
      etag: '"1"',
      text: 'one',
      bytes: 3,
    });
    second.dropConditional();
    expect(
      createGithubApiMemory(
        () => undefined,
        () => session,
      ).getConditional('user:a||u1'),
    ).toBeUndefined();
    expect(second.getConditional('anonymous||u2')?.text).toBe('two');
    second.dropConditional('anonymous');
    expect(
      createGithubApiMemory(
        () => undefined,
        () => session,
      ).getConditional('anonymous||u2'),
    ).toBeUndefined();
  });

  it('ignores a damaged stored answer, one with no ETag, and one too large to keep', () => {
    const session = storage();
    session.setItem(`${GITHUB_CONDITIONAL_STORAGE_PREFIX}bad`, '{not json');
    session.setItem(
      `${GITHUB_CONDITIONAL_STORAGE_PREFIX}partial`,
      '{"etag":"x"}',
    );
    const memory = createGithubApiMemory(
      () => undefined,
      () => session,
    );
    expect(memory.getConditional('bad')).toBeUndefined();
    expect(memory.getConditional('partial')).toBeUndefined();
    memory.putConditional('noetag', { etag: '', text: 't', bytes: 1 });
    memory.putConditional('big', {
      etag: '"e"',
      text: 'x'.repeat(MAX_CONDITIONAL_ENTRY_BYTES + 1),
      bytes: 1,
    });
    expect(memory.getConditional('noetag')).toBeUndefined();
    expect(memory.getConditional('big')).toBeUndefined();
  });

  it('keeps at most a bounded number of answers, the oldest going first', () => {
    const session = storage();
    const memory = createGithubApiMemory(
      () => undefined,
      () => session,
    );
    for (let i = 0; i <= MAX_CONDITIONAL_ENTRIES; i++) {
      memory.putConditional(`k${i}`, {
        etag: `"${i}"`,
        text: String(i),
        bytes: 1,
      });
    }
    expect(memory.getConditional('k0')).toBeUndefined();
    expect(memory.getConditional(`k${MAX_CONDITIONAL_ENTRIES}`)?.text).toBe(
      String(MAX_CONDITIONAL_ENTRIES),
    );
    expect(session.length).toBeLessThanOrEqual(MAX_CONDITIONAL_ENTRIES);
  });

  it('clears what it stored in the browser (between test cases)', () => {
    globalThis.localStorage.setItem(GITHUB_ANON_LIMIT_STORAGE_KEY, '1');
    globalThis.sessionStorage.setItem(
      `${GITHUB_CONDITIONAL_STORAGE_PREFIX}k`,
      '{}',
    );
    globalThis.sessionStorage.setItem('other', 'kept');
    clearStoredGithubApiMemory();
    expect(
      globalThis.localStorage.getItem(GITHUB_ANON_LIMIT_STORAGE_KEY),
    ).toBeNull();
    expect(
      globalThis.sessionStorage.getItem(
        `${GITHUB_CONDITIONAL_STORAGE_PREFIX}k`,
      ),
    ).toBeNull();
    expect(globalThis.sessionStorage.getItem('other')).toBe('kept');
    globalThis.sessionStorage.removeItem('other');
  });
});

describe('githubRetryAt', () => {
  const now = 1_000_000;
  it('reads the reset time when nothing remains', () => {
    const headers = new Headers({
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '2000',
    });
    expect(githubRetryAt(headers, now)).toBe(2_000_000);
  });
  it('waits at least a second for a reset already past', () => {
    const headers = new Headers({
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1',
    });
    expect(githubRetryAt(headers, now)).toBe(now + 1000);
  });
  it('reads Retry-After (a secondary limit)', () => {
    expect(githubRetryAt(new Headers({ 'retry-after': '30' }), now)).toBe(
      now + 30_000,
    );
    expect(githubRetryAt(new Headers({ 'retry-after': '0' }), now)).toBe(
      now + 1000,
    );
  });
  it('names no time when GitHub does not (or calls remain: a block, not the limit)', () => {
    expect(githubRetryAt(new Headers(), now)).toBeUndefined();
    expect(
      githubRetryAt(
        new Headers({
          'x-ratelimit-remaining': '12',
          'x-ratelimit-reset': '2000',
        }),
        now,
      ),
    ).toBeUndefined();
    expect(
      githubRetryAt(new Headers({ 'retry-after': 'soon' }), now),
    ).toBeUndefined();
  });
});

describe('githubGet with the API memory', () => {
  function recorder(answer: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn: GithubFetch = async (url, init) => {
      calls.push({ url, init });
      return answer(url, init);
    };
    return { calls, fetchFn };
  }
  const header = (init: RequestInit, name: string) =>
    (init.headers as Record<string, string> | undefined)?.[name];

  it('makes no anonymous call while GitHub is known to refuse them, and answers as GitHub would', async () => {
    let now = 1_000_000;
    const memory = createInPageGithubApiMemory(() => now);
    const { calls, fetchFn } = recorder(
      () =>
        new Response('limit', {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String((now + 600_000) / 1000),
          },
        }),
    );
    const options = { maxBytes: 100, memory, now: () => now };
    expect(await githubGet(fetchFn, API, options)).toEqual({
      kind: 'refused',
      status: 403,
      retryAt: now + 600_000,
    });
    expect(await githubGet(fetchFn, API, options)).toEqual({
      kind: 'refused',
      status: 403,
      retryAt: now + 600_000,
    });
    expect(calls).toHaveLength(1);
    now += 600_000;
    await githubGet(fetchFn, API, options);
    expect(calls).toHaveLength(2);
  });

  it('waits a minute after a refusal that names no time', async () => {
    const now = 1_000_000;
    const memory = createInPageGithubApiMemory(() => now);
    const { fetchFn } = recorder(() => new Response('', { status: 429 }));
    await githubGet(fetchFn, API, { maxBytes: 100, memory, now: () => now });
    expect(memory.anonymousLimitedUntil()).toBe(now + DEFAULT_ANON_LIMIT_MS);
  });

  it('never stops a call to the file host, nor a call with a token', async () => {
    const now = 1_000_000;
    const memory = createInPageGithubApiMemory(() => now);
    memory.noteAnonymousLimit(now + 60_000);
    const { calls, fetchFn } = recorder(() => new Response('ok'));
    expect(
      (await githubGet(fetchFn, RAW, { maxBytes: 100, memory, now: () => now }))
        .kind,
    ).toBe('ok');
    expect(
      (
        await githubGet(fetchFn, API, {
          maxBytes: 100,
          memory,
          now: () => now,
          token: 't',
        })
      ).kind,
    ).toBe('ok');
    expect(calls).toHaveLength(2);
  });

  it('a refused token call does not stop anonymous calls', async () => {
    const now = 1_000_000;
    const memory = createInPageGithubApiMemory(() => now);
    const { fetchFn } = recorder(() => new Response('', { status: 403 }));
    await githubGet(fetchFn, API, {
      maxBytes: 100,
      memory,
      now: () => now,
      token: 't',
    });
    expect(memory.anonymousLimitedUntil()).toBe(0);
  });

  it('asks again with If-None-Match when signed in, and serves the kept answer on a 304', async () => {
    const memory = createInPageGithubApiMemory();
    const { calls, fetchFn } = recorder((_url, init) =>
      header(init, 'If-None-Match') === '"v1"'
        ? new Response(null, { status: 304 })
        : new Response('sha-1', { headers: { ETag: '"v1"' } }),
    );
    const options = {
      maxBytes: 100,
      memory,
      token: 'tok',
      accept: 'application/vnd.github.sha',
    };
    expect(await githubGet(fetchFn, API, options)).toEqual({
      kind: 'ok',
      text: 'sha-1',
      bytes: 5,
    });
    expect(await githubGet(fetchFn, API, options)).toEqual({
      kind: 'ok',
      text: 'sha-1',
      bytes: 5,
    });
    expect(calls.map((c) => header(c.init, 'If-None-Match'))).toEqual([
      undefined,
      '"v1"',
    ]);
    expect(
      calls.every((c) => header(c.init, 'Authorization') === 'Bearer tok'),
    ).toBe(true);
  });

  it('replaces the kept answer when GitHub sends a new one', async () => {
    const memory = createInPageGithubApiMemory();
    let version = 1;
    const { fetchFn } = recorder((_url, init) =>
      header(init, 'If-None-Match') === `"v${version}"`
        ? new Response(null, { status: 304 })
        : new Response(`sha-${version}`, {
            headers: { ETag: `"v${version}"` },
          }),
    );
    const options = { maxBytes: 100, memory, token: 'tok' };
    await githubGet(fetchFn, API, options);
    version = 2;
    expect(await githubGet(fetchFn, API, options)).toEqual({
      kind: 'ok',
      text: 'sha-2',
      bytes: 5,
    });
    expect(await githubGet(fetchFn, API, options)).toEqual({
      kind: 'ok',
      text: 'sha-2',
      bytes: 5,
    });
  });

  it('never makes an anonymous call conditional (an anonymous 304 is counted like a 200)', async () => {
    const memory = createInPageGithubApiMemory();
    const { calls, fetchFn } = recorder(
      () => new Response('sha', { headers: { ETag: '"v"' } }),
    );
    await githubGet(fetchFn, API, { maxBytes: 100, memory });
    await githubGet(fetchFn, API, { maxBytes: 100, memory });
    expect(calls.map((c) => header(c.init, 'If-None-Match'))).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('a 304 with nothing kept is not an answer', async () => {
    const { fetchFn } = recorder(() => new Response(null, { status: 304 }));
    expect(
      await githubGet(fetchFn, API, { maxBytes: 100, token: 'tok' }),
    ).toEqual({ kind: 'down', status: 304 });
  });

  it('drops what a refused token kept and goes on anonymously', async () => {
    const memory = createInPageGithubApiMemory();
    memory.putConditional('user:x||k', { etag: '"e"', text: 't', bytes: 1 });
    const { calls, fetchFn } = recorder((_url, init) =>
      header(init, 'Authorization')
        ? new Response('', { status: 401 })
        : new Response('anon'),
    );
    const out = await githubGet(fetchFn, API, {
      maxBytes: 100,
      memory,
      token: 'expired-token',
    });
    expect(out).toEqual({ kind: 'ok', text: 'anon', bytes: 4 });
    expect(calls).toHaveLength(2);
  });
});
