// Shared HTTP rules for every script that touches the live DemoDB hosts (*.demodb.dev).
//
// The demodb.dev Cloudflare zone is rate limited. After the 2026-10-16 incident (about 25,500 requests for one file
// in a day, then HTTP 429 for the whole zone) the rules are:
//   - one request per URL: there is no retry loop here, on purpose;
//   - HTTP 429 stops the whole script at once with a clear message. Retrying a rate limit only prolongs the outage.

export class DemodbRateLimitedError extends Error {
  constructor(url, retryAfter) {
    super(
      `HTTP 429 from ${url}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}. ` +
        'The DemoDB zone is rate limiting this client. Stopping now: not retrying, not trying other files. ' +
        'Wait for the limit to clear (see the Retry-After header) and run again; do not loop.',
    );
    this.name = 'DemodbRateLimitedError';
  }
}

let requests = 0;

/** Number of network requests this process has made through `fetchOnce`. */
export const requestCount = () => requests;

/** One GET (or other method) with no retry. Throws `DemodbRateLimitedError` on HTTP 429. */
export async function fetchOnce(url, init) {
  requests += 1;
  const response = await fetch(url, init);
  if (response.status === 429) {
    throw new DemodbRateLimitedError(url, response.headers.get('retry-after'));
  }
  return response;
}

/** Prints the message and exits 3 for a rate limit; rethrows anything else. */
export function exitOnRateLimit(error) {
  if (error instanceof DemodbRateLimitedError) {
    console.error(`::error title=demodb.dev rate limited::${error.message}`);
    console.error(error.message);
    process.exit(3);
  }
  throw error;
}
