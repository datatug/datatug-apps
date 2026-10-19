// Shared HTTP rules for every script that touches the live DemoDB hosts (*.demodb.dev) or downloads fixtures.
//
// The demodb.dev Cloudflare zone is rate limited. After the 2026-10-16 incident (about 25,500 requests for one file in a
// day, then HTTP 429 for the whole zone) the rules are:
//   - one request per URL: there is no retry loop here, on purpose;
//   - a rate-limit answer (HTTP 429, or a Cloudflare block page: see isRateLimited) stops the whole script at once with a
//     clear message. Retrying a rate limit only prolongs the outage.
import { isRateLimited } from '../apps/datatug-app/e2e/helpers/demodb-guard-state.ts';

export class RateLimitedError extends Error {
  constructor(url, status, retryAfter) {
    const host = new URL(url).host;
    super(
      `HTTP ${status} from ${host} (${url})${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}. ` +
        `${host} is rate limiting or blocking this client. Stopping now: not retrying, not trying other files. ` +
        'Wait for the limit to clear (see the Retry-After header) and run again; do not loop.',
    );
    this.name = 'RateLimitedError';
  }
}
/** Old name, kept for callers that import it. */
export const DemodbRateLimitedError = RateLimitedError;

let requests = 0;

/** Number of network requests this process has made through `fetchOnce`. */
export const requestCount = () => requests;

/** One request with no retry. Throws `RateLimitedError` on HTTP 429 or a Cloudflare block page. */
export async function fetchOnce(url, init) {
  requests += 1;
  const response = await fetch(url, init);
  const headers = Object.fromEntries(response.headers.entries());
  const suspect = response.status === 429 || [403, 503].includes(response.status) || response.status >= 520;
  const text = suspect && response.status !== 429 ? (await response.clone().text()).slice(0, 4096) : '';
  if (suspect && isRateLimited(response.status, headers, text)) {
    throw new RateLimitedError(String(url), response.status, response.headers.get('retry-after'));
  }
  return response;
}

/** Prints the message and exits 3 for a rate limit; returns for any other error (the caller reports it). */
export function exitOnRateLimit(error) {
  if (error instanceof RateLimitedError) {
    console.error(`::error title=rate limited::${error.message}`);
    console.error(error.message);
    process.exit(3);
  }
}
