import { describe, expect, it, vi } from 'vitest';
import {
  isRetryableOvdbRequest,
  OVDB_RETRY_DELAYS_MS,
  retryingOvdbFetch,
} from './ovdb-retrying-fetch';

const ok = () => new Response('{}', { status: 200 });
const unavailable = () =>
  new Response('{"error":{"code":"database_unavailable"}}', { status: 503 });
const DTQL =
  'https://cloud.openvaultdb.com/v1/databases/chinook-postgresql/dtql';

describe('isRetryableOvdbRequest', () => {
  it('retries reads only: GET, HEAD and the read-only POST …/dtql', () => {
    expect(isRetryableOvdbRequest('https://x.test/v1/databases/a')).toBe(true);
    expect(
      isRetryableOvdbRequest('https://x.test/v1/databases/a', {
        method: 'head',
      }),
    ).toBe(true);
    expect(isRetryableOvdbRequest(DTQL, { method: 'POST' })).toBe(true);
    expect(isRetryableOvdbRequest(new URL(DTQL), { method: 'POST' })).toBe(
      true,
    );
    expect(
      isRetryableOvdbRequest(new Request(DTQL, { method: 'POST', body: '{}' })),
    ).toBe(true);
    expect(
      isRetryableOvdbRequest('https://x.test/v1/databases/a/batch', {
        method: 'POST',
      }),
    ).toBe(false);
    expect(
      isRetryableOvdbRequest('https://x.test/v1/databases/a/reset', {
        method: 'POST',
      }),
    ).toBe(false);
    expect(
      isRetryableOvdbRequest('https://x.test/v1/databases/a/records', {
        method: 'DELETE',
      }),
    ).toBe(false);
    expect(isRetryableOvdbRequest('https://', { method: 'POST' })).toBe(false);
  });
});

describe('retryingOvdbFetch', () => {
  it('waits out a database that is still mounting, with the configured back-off', async () => {
    const base = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(ok());
    const sleep = vi.fn(async () => undefined);
    const response = await retryingOvdbFetch(base, {
      delaysMs: [10, 20, 30],
      sleep,
    })('https://x.test/v1/databases/a');
    expect(response.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it('retries a dropped connection and the edge errors 502 and 504', async () => {
    const base = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response('', { status: 504 }))
      .mockResolvedValueOnce(ok());
    const response = await retryingOvdbFetch(base, {
      delaysMs: [1, 1, 1],
      sleep: async () => undefined,
    })(DTQL, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(4);
  });

  it('gives the last answer once the retries are used up, and the last network error', async () => {
    const stillDown = vi.fn<typeof fetch>(async () => unavailable());
    const response = await retryingOvdbFetch(stillDown, {
      delaysMs: [1, 1],
      sleep: async () => undefined,
    })('https://x.test/v1/databases/a');
    expect(response.status).toBe(503);
    expect(stillDown).toHaveBeenCalledTimes(3);
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError('offline');
    });
    await expect(
      retryingOvdbFetch(offline, {
        delaysMs: [1],
        sleep: async () => undefined,
      })('https://x.test/v1/databases/a'),
    ).rejects.toThrow('offline');
    expect(offline).toHaveBeenCalledTimes(2);
  });

  it('does not retry a cancelled request, a client error or a mutation', async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = vi.fn<typeof fetch>(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(
      retryingOvdbFetch(aborted, { delaysMs: [1] })(
        'https://x.test/v1/databases/a',
        { signal: controller.signal },
      ),
    ).rejects.toThrow('aborted');
    expect(aborted).toHaveBeenCalledTimes(1);
    const missing = vi.fn<typeof fetch>(
      async () => new Response('', { status: 404 }),
    );
    expect(
      (
        await retryingOvdbFetch(missing, { delaysMs: [1] })(
          'https://x.test/v1/databases/a',
        )
      ).status,
    ).toBe(404);
    expect(missing).toHaveBeenCalledTimes(1);
    const write = vi.fn<typeof fetch>(async () => unavailable());
    expect(
      (
        await retryingOvdbFetch(write, { delaysMs: [1] })(
          'https://x.test/v1/databases/a/batch',
          { method: 'POST' },
        )
      ).status,
    ).toBe(503);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('sleeps for real by default, within roughly ten seconds in total', async () => {
    expect(OVDB_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(
      10_000,
    );
    vi.useFakeTimers();
    try {
      const base = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(unavailable())
        .mockResolvedValueOnce(ok());
      const pending = retryingOvdbFetch(base)('https://x.test/v1/databases/a');
      await vi.advanceTimersByTimeAsync(OVDB_RETRY_DELAYS_MS[0]);
      expect((await pending).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});
