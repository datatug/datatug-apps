import { InjectionToken, inject } from '@angular/core';
import { DatatugApiBaseUrl } from './datatug-api-base-url.token';

/**
 * Ordered base URLs of the DataTug API: the primary first, then the fallbacks
 * (for example `https://api.datatug.app/v0/` then `https://api2.datatug.app/v0/`).
 * Each URL ends with `/`.
 *
 * With one URL (the default: `[DatatugApiBaseUrl]`) the client behaves exactly
 * as it did before failover existed. Provide two or more URLs to turn failover
 * on; see `apps/datatug-app/README.md`, "DataTug API failover".
 */
export const DatatugApiBaseUrls = new InjectionToken<readonly string[]>(
  'DatatugApiBaseUrls',
  {
    providedIn: 'root',
    factory: () => [inject(DatatugApiBaseUrl)],
  },
);

/** Tuning of the DataTug API failover. Only read when there are 2+ base URLs. */
export interface DatatugApiFailoverConfig {
  /** Minutes the fallback stays preferred after a failover, before the primary is probed again. */
  readonly breakerMinutes: number;
  /**
   * Milliseconds to wait for a GET/HEAD answer from a base URL when another base URL is
   * still untried. 0 disables the timeout. Never applied to the last untried base URL,
   * and never to POST/PUT/PATCH/DELETE (a timeout does not prove the server did not act).
   */
  readonly primaryTimeoutMs: number;
  /** Same as `primaryTimeoutMs`, for the endpoints in `slowEndpointPrefixes`. */
  readonly slowEndpointTimeoutMs: number;
  /** Endpoint prefixes (without the base URL) whose GETs may legitimately run long. */
  readonly slowEndpointPrefixes: readonly string[];
}

export const DEFAULT_DATATUG_API_FAILOVER_CONFIG: DatatugApiFailoverConfig = {
  breakerMinutes: 5,
  // Cold Cloud Run starts and normal reads finish within a few seconds; a hung primary is
  // abandoned after 8s. Hard-down primaries (DNS, TLS, connect, Cloudflare 52x) fail faster.
  primaryTimeoutMs: 8_000,
  slowEndpointTimeoutMs: 60_000,
  slowEndpointPrefixes: [
    'datatug/detective/',
    'datatug/exec/',
    'datatug/queries/run_query',
    'datatug/session-context/detective',
    'datatug/projects/query_activity_context',
  ],
};

export const DatatugApiFailoverConfig =
  new InjectionToken<DatatugApiFailoverConfig>('DatatugApiFailoverConfig', {
    providedIn: 'root',
    factory: () => DEFAULT_DATATUG_API_FAILOVER_CONFIG,
  });
