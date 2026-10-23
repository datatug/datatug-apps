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

describe('retryingOvdbFetch while a PostgreSQL edition is mounting', () => {
  const pending = (retryAfter: string | null = '30') =>
    new Response(
      '{"error":{"code":"database_unavailable","message":"This PostgreSQL edition is not available right now (pending)."}}',
      {
        status: 503,
        headers: retryAfter === null ? {} : { 'Retry-After': retryAfter },
      },
    );
  const URL_ = 'https://x.test/v1/databases/a';

  it('honours Retry-After on a pending 503 and succeeds once mounted, using fake timers', async () => {
    vi.useFakeTimers();
    try {
      const base = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(pending())
        .mockResolvedValueOnce(pending())
        .mockResolvedValueOnce(pending())
        .mockResolvedValueOnce(ok());
      const waking = vi.fn();
      const result = retryingOvdbFetch(base, { onWaking: waking })(URL_);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(base).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(base).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect((await result).status).toBe(200);
      expect(base).toHaveBeenCalledTimes(4);
      expect(waking.mock.calls.map(([info]) => info)).toEqual([
        { attempt: 1, waitMs: 30_000 },
        { attempt: 2, waitMs: 30_000 },
        { attempt: 3, waitMs: 30_000 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops within the total budget and returns the 503 so Try again is shown', async () => {
    vi.useFakeTimers();
    try {
      const base = vi.fn<typeof fetch>(async () => pending());
      const result = retryingOvdbFetch(base)(URL_);
      await vi.advanceTimersByTimeAsync(110_000);
      const response = await result;
      expect(response.status).toBe(503);
      // 110 s budget / 30 s waits: 3 waits, 4 requests. Never a hammering loop.
      expect(base).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a floor between retries and bounds the request count when Retry-After is tiny', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const base = vi.fn<typeof fetch>(async () => pending('0'));
    const response = await retryingOvdbFetch(base, { sleep })(URL_);
    expect(response.status).toBe(503);
    expect(sleep.mock.calls.every(([ms]) => ms >= 2_000)).toBe(true);
    expect(base.mock.calls.length).toBeLessThanOrEqual(13);
  });

  it('uses a default wait without Retry-After and leaves other 503s on the short back-off', async () => {
    const sleep = vi.fn(async () => undefined);
    const base = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(pending(null))
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(ok());
    const response = await retryingOvdbFetch(base, { sleep, delaysMs: [5, 5] })(
      URL_,
    );
    expect(response.status).toBe(200);
    expect(sleep.mock.calls).toEqual([[10_000], [5]]);
  });

  it('reads an HTTP-date Retry-After, ignores a malformed one, and caps a huge one', async () => {
    const waits = async (retryAfter: string): Promise<number[]> => {
      const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
      const base = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(pending(retryAfter))
        .mockResolvedValueOnce(ok());
      await retryingOvdbFetch(base, { sleep })(URL_);
      return sleep.mock.calls.map(([ms]) => ms);
    };
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-23T10:00:00Z'));
      expect(await waits('Fri, 23 Oct 2026 10:00:12 GMT')).toEqual([12_000]);
      expect(await waits('Fri, 23 Oct 2026 09:00:00 GMT')).toEqual([2_000]);
    } finally {
      vi.useRealTimers();
    }
    expect(await waits('soon-ish')).toEqual([10_000]);
    expect(await waits('-5')).toEqual([10_000]);
    expect(await waits('999999')).toEqual([30_000]);
  });

  it('ends a wait at once when the request is aborted, clearing the timer', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const base = vi.fn<typeof fetch>(async () => pending());
      const result = retryingOvdbFetch(base, { signal: controller.signal })(
        URL_,
      );
      const settled = result.then(
        () => 'resolved',
        (error: unknown) => (error as Error).name,
      );
      await vi.advanceTimersByTimeAsync(1_000);
      expect(vi.getTimerCount()).toBe(1);
      controller.abort();
      expect(await settled).toBe('AbortError');
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(200_000);
      expect(base).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a throw from onWaking or from the wait as a dropped connection', async () => {
    const base = vi.fn<typeof fetch>(async () => pending());
    const boom = new Error('onWaking failed');
    await expect(
      retryingOvdbFetch(base, {
        onWaking: () => {
          throw boom;
        },
        sleep: async () => undefined,
      })(URL_),
    ).rejects.toBe(boom);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('retries 429 with its Retry-After and 408 shortly, a bounded number of times, apart from the pending wait', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const throttled = (status: number, retryAfter?: string) =>
      new Response('', {
        status,
        headers: retryAfter ? { 'Retry-After': retryAfter } : {},
      });
    const base = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(throttled(429, '7'))
      .mockResolvedValueOnce(throttled(408))
      .mockResolvedValueOnce(throttled(429, '7'))
      .mockResolvedValueOnce(ok());
    const response = await retryingOvdbFetch(base, { sleep })(URL_);
    expect(response.status).toBe(429);
    expect(base).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[7_000], [500]]);
  });
});
