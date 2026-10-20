import {
  HttpClient,
  HttpErrorResponse,
  HttpHandler,
  HttpHeaders,
} from '@angular/common/http';
import { IAnalyticsService } from '@sneat/core';
import type { DatatugApiFailoverConfig } from '@sneat/datatug-semantic';
import {
  Observable,
  TimeoutError,
  catchError,
  defer,
  tap,
  throwError,
  timeout,
} from 'rxjs';

/** Why an attempt on one base URL was given up. Carries no URL and no user data. */
export type DatatugApiFailoverReason = 'network' | 'timeout' | `status ${number}`;

/** Narrow logging surface, so the client needs neither Angular nor a concrete logger. */
export interface DatatugApiFailoverLog {
  warn(...v: unknown[]): void;
}

const idempotentMethods = new Set(['GET', 'HEAD']);

// Cloudflare 520-523 and 525-526 are edge-to-origin failures. 524 (origin accepted the
// connection but did not answer in time) is deliberately absent: the origin may have acted.
const retryableIdempotentStatuses = new Set([
  502, 503, 504, 520, 521, 522, 523, 525, 526,
]);
// Only the Cloudflare statuses that prove the request never reached the application.
// Status 0 is NOT in this set: a browser reports every response without CORS headers as
// status 0, and that includes Cloudflare 520/524 and Google 500/504 sent after the origin
// acted, and a connection dropped after the body was sent. A write retries on status 0 only
// when it carries an Idempotency-Key header (the server must then deduplicate it).
const retryableNonIdempotentStatuses = new Set([521, 522, 523]);

/** Header a caller sets to opt a write into a retry on status 0. */
export const DATATUG_IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** True when the request options carry a non-empty Idempotency-Key header. */
export function hasIdempotencyKey(options: {
  headers?: HttpHeaders | Record<string, string | string[]>;
}): boolean {
  const headers = options.headers;
  if (headers instanceof HttpHeaders) {
    return !!headers.get(DATATUG_IDEMPOTENCY_KEY_HEADER);
  }
  const name = DATATUG_IDEMPOTENCY_KEY_HEADER.toLowerCase();
  return Object.entries(headers ?? {}).some(
    ([key, value]) => key.toLowerCase() === name && value.length > 0,
  );
}

/**
 * Decides whether a failed attempt may be repeated on the next base URL, and says why.
 * Returns null when the error must reach the caller (4xx, app 5xx, 524, non-HTTP errors).
 */
export function datatugApiFailoverReason(
  method: string,
  error: unknown,
  idempotencyKey = false,
): DatatugApiFailoverReason | null {
  const idempotent = idempotentMethods.has(method.toUpperCase());
  if (error instanceof TimeoutError) {
    // Timeouts are only ever armed on idempotent requests.
    return idempotent ? 'timeout' : null;
  }
  if (!(error instanceof HttpErrorResponse)) {
    return null;
  }
  if (error.status === 0) {
    return idempotent || idempotencyKey ? 'network' : null;
  }
  const retryable = idempotent
    ? retryableIdempotentStatuses
    : retryableNonIdempotentStatuses;
  return retryable.has(error.status) ? `status ${error.status}` : null;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl, 'http://localhost').host;
  } catch {
    return 'unknown';
  }
}

/**
 * HttpClient that sends every request, built against `baseUrls[0]`, to the currently
 * preferred base URL and repeats it on the next one when the failure is safe to repeat.
 * Headers (including Authorization), params and body travel unchanged, so a request on the
 * fallback is the same request. It only rewrites the base URL: `SneatApiService` is untouched.
 *
 * Circuit breaker, in memory for the page session: after a request succeeded on a fallback
 * after a failure on an earlier base URL, the fallback is preferred for `breakerMinutes`.
 * Then the next GET/HEAD probes the primary first and switches back when the probe answers.
 * Only a deliberate probe (or a request that already failed on the fallback) switches back:
 * a late answer from a request that left for the primary before the failover does not.
 * Non-idempotent requests never probe; they keep using the preferred base URL.
 */
export class DatatugApiFailoverHttpClient extends HttpClient {
  private preferred = 0;
  private holdUntil = 0;

  constructor(
    handler: HttpHandler,
    private readonly baseUrls: readonly string[],
    private readonly config: DatatugApiFailoverConfig,
    private readonly log?: DatatugApiFailoverLog,
    private readonly analytics?: IAnalyticsService | null,
    private readonly now: () => number = Date.now,
  ) {
    super(handler);
  }

  // The overloads of HttpClient.request are all funnelled through this signature.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override request(first: any, url?: any, options: any = {}): any {
    // Passed through untouched: a prepared HttpRequest, a URL outside the primary base, and
    // the raw event stream (observe: 'events'), where "the host answered" has no single moment.
    if (
      typeof first !== 'string' ||
      typeof url !== 'string' ||
      !url.startsWith(this.baseUrls[0]) ||
      options.observe === 'events'
    ) {
      return super.request(first, url, options);
    }
    const method = first.toUpperCase();
    const endpoint = url.slice(this.baseUrls[0].length);
    const key = hasIdempotencyKey(options);
    return defer(() => {
      const probe =
        this.preferred !== 0 &&
        idempotentMethods.has(method) &&
        this.now() >= this.holdUntil;
      return this.attempt(
        method,
        endpoint,
        options,
        key,
        this.attemptOrder(probe ? 0 : this.preferred),
        probe,
        0,
      );
    });
  }

  private attemptOrder(start: number): number[] {
    return [
      start,
      ...this.baseUrls.map((_, i) => i).filter((i) => i !== start),
    ];
  }

  private timeoutFor(method: string, endpoint: string): number {
    if (!idempotentMethods.has(method)) {
      return 0;
    }
    return this.config.slowEndpointPrefixes.some((p) => endpoint.startsWith(p))
      ? this.config.slowEndpointTimeoutMs
      : this.config.primaryTimeoutMs;
  }

  private attempt(
    method: string,
    endpoint: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    idempotencyKey: boolean,
    order: readonly number[],
    probe: boolean,
    failedCount: number,
  ): Observable<unknown> {
    const [index, ...rest] = order;
    const timeoutMs = this.timeoutFor(method, endpoint);
    let call = super.request(
      method,
      this.baseUrls[index] + endpoint,
      options,
    ) as Observable<unknown>;
    if (rest.length > 0 && timeoutMs > 0) {
      call = call.pipe(timeout({ first: timeoutMs }));
    }
    const markAnswered = () =>
      this.hostAnswered(index, failedCount > 0, probe);
    return call.pipe(
      // One value per request (body or full response), so the host answered exactly once.
      tap({ next: markAnswered }),
      catchError((error: unknown) => {
        const reason = datatugApiFailoverReason(method, error, idempotencyKey);
        if (reason === null) {
          // The host answered; the answer is just not a success. Keep it.
          markAnswered();
          return throwError(() => error);
        }
        if (rest.length === 0) {
          return throwError(() => error);
        }
        this.logFailover(method, index, rest[0], reason);
        return this.attempt(
          method,
          endpoint,
          options,
          idempotencyKey,
          rest,
          probe,
          failedCount + 1,
        );
      }),
    );
  }

  private hostAnswered(
    index: number,
    afterFailure: boolean,
    probe: boolean,
  ): void {
    if (index === 0) {
      // A late answer from a request that left before the failover must not undo it.
      if (probe || afterFailure) {
        this.preferred = 0;
      }
    } else if (afterFailure) {
      this.preferred = index;
      this.holdUntil = this.now() + this.config.breakerMinutes * 60_000;
    }
  }

  private logFailover(
    method: string,
    from: number,
    to: number,
    reason: DatatugApiFailoverReason,
  ): void {
    // Hosts only: never the endpoint, the query string or the body.
    const detail = {
      method,
      fromHost: hostOf(this.baseUrls[from]),
      toHost: hostOf(this.baseUrls[to]),
      reason,
    };
    this.log?.warn('DataTug API failover', detail);
    try {
      this.analytics?.logEvent('datatug_api_failover', detail);
    } catch {
      // Telemetry must never break an API call.
    }
  }
}
