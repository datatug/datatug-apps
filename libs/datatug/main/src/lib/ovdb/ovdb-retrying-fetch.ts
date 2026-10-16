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
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= delays.length;
      try {
        const response = await base(input, init);
        if (last || !RETRIED_STATUSES.has(response.status)) return response;
      } catch (error) {
        // A cancelled request stays cancelled; a dropped connection is retried.
        if (last || init?.signal?.aborted) throw error;
      }
      await sleep(delays[attempt]);
    }
  };
}
