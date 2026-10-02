import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  githubGet,
  isAllowedGithubUrl,
  readBodyLimited,
  type GithubFetch,
} from './github-http';

const RAW = 'https://raw.githubusercontent.com/o/r/HEAD/a.json';

/** A response whose body is a stream of `chunks` of `size` bytes, that counts what was pulled and whether it was cancelled. */
function streamOf(chunks: number, size: number, init?: ResponseInit) {
  const state = { pulled: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= chunks) {
        controller.close();
        return;
      }
      state.pulled++;
      controller.enqueue(new Uint8Array(size).fill(97));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { state, response: new Response(body, init) };
}

describe('githubGet', () => {
  afterEach(() => vi.useRealTimers());

  it('sends no credentials and refuses a redirect, and says so to the caller who asked to tell one from an outage', async () => {
    const calls: RequestInit[] = [];
    const fetchFn: GithubFetch = async (_url, init) => {
      calls.push(init);
      return new Response('ok');
    };
    await githubGet(fetchFn, RAW, { maxBytes: 10 });
    await githubGet(fetchFn, RAW, {
      maxBytes: 10,
      detectMoved: true,
      accept: 'application/vnd.github.sha',
    });
    expect(
      calls.map((c) => [c.credentials, c.redirect, c.referrerPolicy, c.method]),
    ).toEqual([
      ['omit', 'error', 'no-referrer', 'GET'],
      ['omit', 'manual', 'no-referrer', 'GET'],
    ]);
    expect(calls[0].headers).toBeUndefined();
    expect(calls[1].headers).toEqual({ Accept: 'application/vnd.github.sha' });
  });

  it('hands fetch the address that was checked, as the URL parser reads it, not the string it was given', async () => {
    const urls: string[] = [];
    const fetchFn: GithubFetch = async (url) => {
      urls.push(url);
      return new Response('ok');
    };
    await githubGet(
      fetchFn,
      'https://RAW.GithubUserContent.com:443/o/r/HEAD/a b.json?x=1#frag',
      { maxBytes: 10 },
    );
    expect(urls).toEqual([
      'https://raw.githubusercontent.com/o/r/HEAD/a%20b.json?x=1#frag',
    ]);
  });

  it.each([
    [301, true, { kind: 'moved' }],
    [302, true, { kind: 'moved' }],
    [307, true, { kind: 'moved' }],
    [301, false, { kind: 'down', status: 301 }],
    [404, false, { kind: 'missing', status: 404 }],
    [409, false, { kind: 'missing', status: 409 }],
    [410, false, { kind: 'missing', status: 410 }],
    [422, false, { kind: 'missing', status: 422 }],
    [403, false, { kind: 'refused', status: 403 }],
    [429, false, { kind: 'refused', status: 429 }],
    [500, false, { kind: 'down', status: 500 }],
    [503, false, { kind: 'down', status: 503 }],
    [400, false, { kind: 'down', status: 400 }],
    [199, false, { kind: 'down', status: 199 }],
  ])(
    'maps a %i (detectMoved: %s) to %j',
    async (status, detectMoved, expected) => {
      const outcome = await githubGet(
        async () => new Response('x', { status }),
        RAW,
        {
          maxBytes: 10,
          detectMoved,
        },
      );
      expect(outcome).toEqual(expected);
    },
  );

  it('an opaque redirect (what a browser hands back for redirect: "manual") is a redirect', async () => {
    const opaque = {
      type: 'opaqueredirect',
      status: 0,
      body: null,
    } as unknown as Response;
    expect(
      await githubGet(async () => opaque, RAW, {
        maxBytes: 10,
        detectMoved: true,
      }),
    ).toEqual({ kind: 'moved' });
    expect(await githubGet(async () => opaque, RAW, { maxBytes: 10 })).toEqual({
      kind: 'down',
      status: 0,
    });
  });

  it('a fetch that throws (offline, a refused redirect, a CORS failure) is down, never an exception', async () => {
    expect(
      await githubGet(
        async () => Promise.reject(new TypeError('Failed to fetch')),
        RAW,
        { maxBytes: 10 },
      ),
    ).toEqual({ kind: 'down' });
  });

  it('counts the bytes as they arrive and cancels the transfer past the cap, whatever the headers say', async () => {
    // 100 chunks of 1 KB would be 100 KB; the cap is 3 KB; the header claims 10 bytes.
    const { state, response } = streamOf(100, 1024, {
      headers: { 'content-length': '10' },
    });
    const outcome = await githubGet(async () => response, RAW, {
      maxBytes: 3 * 1024,
    });
    expect(outcome).toEqual({ kind: 'too-large' });
    expect(state.cancelled).toBe(true);
    // It stopped reading right after the cap: not the whole body.
    expect(state.pulled).toBeLessThan(10);
  });

  it('accepts a body of exactly the cap and refuses one byte more', async () => {
    const exact = await githubGet(async () => streamOf(3, 1024).response, RAW, {
      maxBytes: 3 * 1024,
    });
    expect(exact).toMatchObject({ kind: 'ok', bytes: 3 * 1024 });
    const over = await githubGet(async () => streamOf(3, 1024).response, RAW, {
      maxBytes: 3 * 1024 - 1,
    });
    expect(over).toEqual({ kind: 'too-large' });
  });

  it('counts bytes, not characters (a 3-byte character is 3)', async () => {
    const euro = '€'.repeat(10);
    expect(
      await githubGet(async () => new Response(euro), RAW, { maxBytes: 30 }),
    ).toEqual({
      kind: 'ok',
      text: euro,
      bytes: 30,
    });
    expect(
      await githubGet(async () => new Response(euro), RAW, { maxBytes: 29 }),
    ).toEqual({ kind: 'too-large' });
  });

  it('refuses a body with no stream by its length too', async () => {
    const buffered = {
      status: 200,
      type: 'basic',
      body: null,
      arrayBuffer: async () => new ArrayBuffer(11),
    } as unknown as Response;
    expect(await readBodyLimited(buffered, 10)).toBe('too-large');
    expect(
      await readBodyLimited(
        {
          ...buffered,
          arrayBuffer: async () => new ArrayBuffer(10),
        } as unknown as Response,
        10,
      ),
    ).toMatchObject({
      bytes: 10,
    });
  });

  it('decodes UTF-8 across chunk boundaries and drops a byte order mark', async () => {
    const bytes = new TextEncoder().encode('﻿{"é":"€"}');
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          // Split in the middle of the two multi-byte characters.
          controller.enqueue(bytes.slice(0, 6));
          controller.enqueue(bytes.slice(6, 10));
          controller.enqueue(bytes.slice(10));
          controller.close();
        },
      }),
    );
    expect(
      await githubGet(async () => response, RAW, { maxBytes: 100 }),
    ).toMatchObject({
      kind: 'ok',
      text: '{"é":"€"}',
    });
  });

  it('gives up on a host that does not answer, and on a body that never ends', async () => {
    vi.useFakeTimers();
    const hang: GithubFetch = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        ),
      );
    const pending = githubGet(hang, RAW, { maxBytes: 10, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toEqual({ kind: 'down' });

    // The head of the response arrives, the body never ends: what a real fetch does on abort is to error the stream.
    const slow: GithubFetch = (_url, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init.signal?.addEventListener('abort', () =>
                controller.error(new Error('aborted')),
              );
            },
          }),
        ),
      );
    const pendingBody = githubGet(slow, RAW, { maxBytes: 10, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pendingBody).toEqual({ kind: 'down' });
  });

  it('does not call out to any host but the three, nor over http, nor with a user name', async () => {
    const fetchFn = vi.fn(async () => new Response('x'));
    for (const url of [
      'http://raw.githubusercontent.com/o/r/HEAD/a',
      'https://localhost/a',
      'https://127.0.0.1/a',
      'https://[::1]/a',
      'https://192.168.0.1/a',
      'https://evil.example/a',
      'https://raw.githubusercontent.com.evil.example/a',
      'https://user:pw@raw.githubusercontent.com/a',
      'https://raw.githubusercontent.com:8443/a',
      'https://api.github.com@evil.example/a',
      'not a url',
      '',
    ]) {
      expect(await githubGet(fetchFn, url, { maxBytes: 10 }), url).toEqual({
        kind: 'down',
      });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('isAllowedGithubUrl', () => {
  it.each([
    ['https://api.github.com/repos/o/r/commits/HEAD', true],
    ['https://raw.githubusercontent.com/o/r/HEAD/a', true],
    ['https://cdn.jsdelivr.net/gh/o/r@sha/a', true],
    ['https://data.jsdelivr.com/v1/packages/gh/o/r@sha', false],
    ['https://github.com/o/r', false],
    ['https://RAW.GITHUBUSERCONTENT.COM/o/r/HEAD/a', true],
  ])('%s -> %s', (url, expected) => {
    expect(isAllowedGithubUrl(url)).toBe(expected);
  });
});
