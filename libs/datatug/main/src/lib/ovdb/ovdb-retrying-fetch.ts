// A fetch for a hosted (remote) OVDB server that waits out a database that is still mounting.
//
// cloud.openvaultdb.com mounts its Neon-backed PostgreSQL databases lazily: a cold start can take several
// seconds, and while a mount is pending the server answers `503 database_unavailable` (also 502/504 from the
// edge, or a dropped connection). Only reads are retried — GET/HEAD and the read-only `POST …/dtql` — so a
// mutation is never sent twice; everything else passes through untouched.

export interface OvdbRetryOptions {
  /** Waits before the 1st, 2nd, … retry. The number of retries is the length. */
  readonly delaysMs?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
  /** Called before each wait while the server reports a PostgreSQL edition as still mounting. */
  readonly onWaking?: (info: { readonly attempt: number; readonly waitMs: number }) => void;
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

function retryAfterMs(response: Response): number {
  const raw = response.headers.get('Retry-After');
  const seconds = raw === null ? NaN : Number(raw.trim());
  const ms = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : PENDING_DEFAULT_WAIT_MS;
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

export function retryingOvdbFetch(
  base: typeof globalThis.fetch,
  options: OvdbRetryOptions = {},
): typeof globalThis.fetch {
  const delays = options.delaysMs ?? OVDB_RETRY_DELAYS_MS;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return async (input, init) => {
    if (!isRetryableOvdbRequest(input, init)) return base(input, init);
    let pendingWaited = 0;
    let pendingRetries = 0;
    const pendingBudget = options.pendingBudgetMs ?? OVDB_PENDING_BUDGET_MS;
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= delays.length;
      try {
        const response = await base(input, init);
        if (response.status === 503 && (await isPendingMount(response))) {
          // The server said when to come back: honour Retry-After, within a bounded total.
          const waitMs = retryAfterMs(response);
          if (
            pendingRetries >= PENDING_MAX_RETRIES ||
            pendingWaited + waitMs > pendingBudget ||
            init?.signal?.aborted
          )
            return response;
          pendingRetries++;
          pendingWaited += waitMs;
          options.onWaking?.({ attempt: pendingRetries, waitMs });
          await sleep(waitMs);
          // A pending mount does not use up the short back-off used for other transient errors.
          attempt--;
          continue;
        }
        if (last || !RETRIED_STATUSES.has(response.status)) return response;
      } catch (error) {
        // A cancelled request stays cancelled; a dropped connection is retried.
        if (last || init?.signal?.aborted) throw error;
      }
      await sleep(delays[attempt]);
    }
  };
}
