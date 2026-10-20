import {
  HttpClient,
  HttpErrorResponse,
  HttpHandler,
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
// Only the statuses that prove the request never reached the application. A browser also
// reports status 0 for Cloudflare error pages that carry no CORS headers; see README.
const retryableNonIdempotentStatuses = new Set([521, 522, 523]);

/**
 * Decides whether a failed attempt may be repeated on the next base URL, and says why.
 * Returns null when the error must reach the caller (4xx, app 5xx, 524, non-HTTP errors).
 */
export function datatugApiFailoverReason(
  method: string,
  error: unknown,
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
    return 'network';
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
 * Then the next GET/HEAD probes the primary first and switches back when it answers.
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
    return defer(() =>
      this.attempt(method, endpoint, options, this.attemptOrder(method), 0),
    );
  }

  private attemptOrder(method: string): number[] {
    const probePrimary =
      this.preferred !== 0 &&
      idempotentMethods.has(method) &&
      this.now() >= this.holdUntil;
    const start = probePrimary ? 0 : this.preferred;
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
    order: readonly number[],
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
    const markAnswered = () => this.hostAnswered(index, failedCount > 0);
    return call.pipe(
      // One value per request (body or full response), so the host answered exactly once.
      tap({ next: markAnswered }),
      catchError((error: unknown) => {
        const reason = datatugApiFailoverReason(method, error);
        if (reason === null) {
          // The host answered; the answer is just not a success. Keep it.
          markAnswered();
          return throwError(() => error);
        }
        if (rest.length === 0) {
          return throwError(() => error);
        }
        this.logFailover(method, index, rest[0], reason);
        return this.attempt(method, endpoint, options, rest, failedCount + 1);
      }),
    );
  }

  private hostAnswered(index: number, afterFailure: boolean): void {
    if (index === 0) {
      this.preferred = 0;
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
