/**
 * Request headers for a live `route.fetch()` that the browser's own page request is replaced by.
 *
 * The page asks for `accept-encoding: gzip, deflate, br, zstd`. Playwright's `route.fetch()` decodes gzip, deflate and brotli
 * but NOT zstd, and `route.fulfill({ response })` hands the browser the raw bytes under the original `content-encoding`.
 * Once the live edge (Cloudflare in front of cloud.openvaultdb.com) answers with zstd, Firefox receives zstd bytes it takes
 * as already decoded and fails with "JSON.parse: unexpected character at line 1 column 1" (Chromium happens to cope). So a
 * passed-through request must advertise only encodings Playwright decodes.
 */
const DECODABLE = 'gzip, deflate, br';

export function playwrightDecodableHeaders(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const rest = Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => name.toLowerCase() !== 'accept-encoding',
    ),
  );
  return { ...rest, 'accept-encoding': DECODABLE };
}
