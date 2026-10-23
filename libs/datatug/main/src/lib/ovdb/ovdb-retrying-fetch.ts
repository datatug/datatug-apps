import { abortableWait } from './abortable-wait';

// A fetch for a hosted (remote) OVDB server that waits out a database that is still mounting.
//
// cloud.openvaultdb.com mounts its Neon-backed PostgreSQL databases lazily: a cold start can take several
// seconds, and while a mount is pending the server answers `503 database_unavailable` (also 502/504 from the
// edge, or a dropped connection). Only reads are retried — GET/HEAD and the read-only `POST …/dtql` — so a
// mutation is never sent twice; everything else passes through untouched.

export interface OvdbRetryOptions {
  /** Waits before the 1st, 2nd, … retry. The number of retries is the length. */
  readonly delaysMs?: readonly number[];
  /** Replaces the abortable wait (tests). Receives the signal so an abort ends the wait at once. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Ends every request and every wait of this fetch, now and later (a retry or a closed page). */
  readonly signal?: AbortSignal;
  /** Called before each wait while the server reports a PostgreSQL edition as still mounting. */
  readonly onWaking?: (info: {
    readonly attempt: number;
    readonly waitMs: number;
  }) => void;
  /** Total time allowed for a pending mount. Defaults to {@link OVDB_PENDING_BUDGET_MS}. */
  readonly pendingBudgetMs?: number;
}

/** A cold instance mounts its PostgreSQL editions in up to about 90 s; allow a little more. */
export const OVDB_PENDING_BUDGET_MS = 110_000;
/** Never wait less than this between pending retries (no hammering), nor more than the cap. */
const PENDING_MIN_WAIT_MS = 2_000;
const PENDING_MAX_WAIT_MS = 30_000;
const PENDING_DEFAULT_WAIT_MS = 10_000;
/** Hard bound on the number of extra requests during a pending mount. */
const PENDING_MAX_RETRIES = 12;

/** Delay-seconds or an HTTP-date; anything else (or a negative/NaN value) falls back to the default wait. */
function retryAfterMs(response: Response, now = Date.now()): number {
  const raw = response.headers.get('Retry-After')?.trim() ?? '';
  let ms = PENDING_DEFAULT_WAIT_MS;
  if (/^\d+(\.\d+)?$/.test(raw)) ms = Number(raw) * 1000;
  else if (/^[A-Za-z]{3}, /.test(raw)) {
    const date = Date.parse(raw);
    if (Number.isFinite(date)) ms = Math.max(0, date - now);
  }
  return Math.min(PENDING_MAX_WAIT_MS, Math.max(PENDING_MIN_WAIT_MS, ms));
}

/** `503 database_unavailable` whose message says the edition is still `(pending)` its mount. */
async function isPendingMount(response: Response): Promise<boolean> {
  if (response.status !== 503) return false;
  try {
    const body = (await response.clone().json()) as {
      error?: { code?: unknown; message?: unknown };
    };
    return (
      body.error?.code === 'database_unavailable' &&
      typeof body.error.message === 'string' &&
      /pending/i.test(body.error.message)
    );
  } catch {
    return false;
  }
}

/** Roughly 10 s in total: longer than a cold start (about 6 s), short enough to tell the user. */
export const OVDB_RETRY_DELAYS_MS: readonly number[] = [500, 1500, 3000, 5000];

/** A timed-out (408) or rate-limited (429) read is retried a couple of times, apart from the pending-mount wait. */
const THROTTLE_STATUSES: ReadonlySet<number> = new Set([408, 429]);
const THROTTLE_MAX_RETRIES = 2;
const THROTTLE_408_WAIT_MS = 500;

const RETRIED_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (
    init?.method ??
    (typeof input === 'object' && 'method' in input ? input.method : 'GET')
  ).toUpperCase();
}

/** Whether a request only reads, so sending it again is safe. */
export function isRetryableOvdbRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): boolean {
  const method = requestMethod(input, init);
  if (method === 'GET' || method === 'HEAD') return true;
  if (method !== 'POST') return false;
  try {
    return new URL(requestUrl(input)).pathname.endsWith('/dtql');
  } catch {
    return false;
  }
}

/** Marks a fetch that already waits out transient and pending-mount answers, so callers need not retry again. */
export const SELF_RETRYING_FETCH = Symbol('ovdbSelfRetryingFetch');

export function isSelfRetryingFetch(fetcher: typeof globalThis.fetch): boolean {
  return (
    (fetcher as { [SELF_RETRYING_FETCH]?: true })[SELF_RETRYING_FETCH] === true
  );
}

export function retryingOvdbFetch(
  base: typeof globalThis.fetch,
  options: OvdbRetryOptions = {},
): typeof globalThis.fetch {
  const delays = options.delaysMs ?? OVDB_RETRY_DELAYS_MS;
  const pendingBudget = options.pendingBudgetMs ?? OVDB_PENDING_BUDGET_MS;
  const retrying: typeof globalThis.fetch = async (input, init) => {
    if (!isRetryableOvdbRequest(input, init)) return base(input, init);
    const signals = [init?.signal, options.signal].filter(
      (item): item is AbortSignal => !!item,
    );
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    const sleep = (ms: number): Promise<void> =>
      options.sleep
        ? signal
          ? options.sleep(ms, signal)
          : options.sleep(ms)
        : abortableWait(ms, signal);
    const request: RequestInit | undefined = signal
      ? { ...init, signal }
      : init;
    let pendingWaited = 0;
    let pendingRetries = 0;
    let throttleRetries = 0;
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= delays.length;
      let waitMs: number;
      let waking: { attempt: number; waitMs: number } | undefined;
      try {
        const response = await base(input, request);
        if (response.status === 503 && (await isPendingMount(response))) {
          // The server said when to come back: honour Retry-After, within a bounded total.
          waitMs = retryAfterMs(response);
          if (
            pendingRetries >= PENDING_MAX_RETRIES ||
            pendingWaited + waitMs > pendingBudget
          )
            return response;
          pendingRetries++;
          pendingWaited += waitMs;
          // A pending mount does not use up the short back-off used for other transient errors.
          attempt--;
          waking = { attempt: pendingRetries, waitMs };
        } else if (
          THROTTLE_STATUSES.has(response.status) &&
          throttleRetries < THROTTLE_MAX_RETRIES
        ) {
          throttleRetries++;
          attempt--;
          waitMs =
            response.status === 429
              ? retryAfterMs(response)
              : THROTTLE_408_WAIT_MS;
        } else {
          if (last || !RETRIED_STATUSES.has(response.status)) return response;
          waitMs = delays[attempt];
        }
      } catch (error) {
        // A cancelled request stays cancelled; a dropped connection is retried.
        if (last || signal?.aborted) throw error;
        waitMs = delays[attempt];
      }
      // Outside the try: a throw from the wait or from onWaking is not a dropped connection.
      if (waking) options.onWaking?.(waking);
      await sleep(waitMs);
    }
  };
  (retrying as { [SELF_RETRYING_FETCH]?: true })[SELF_RETRYING_FETCH] = true;
  return retrying;
}
