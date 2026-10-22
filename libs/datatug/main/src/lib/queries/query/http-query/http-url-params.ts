import type { IHttpHeader } from '../../../models/definition/query-def';

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Encodes a query-string part but keeps {{template}} braces readable. */
function encodePart(value: string): string {
  return encodeURIComponent(value).replace(/%7B/gi, '{').replace(/%7D/gi, '}');
}

function splitUrl(url: string): { base: string; query: string; hash: string } {
  const hashAt = url.indexOf('#');
  const hash = hashAt < 0 ? '' : url.slice(hashAt);
  const rest = hashAt < 0 ? url : url.slice(0, hashAt);
  const queryAt = rest.indexOf('?');
  return queryAt < 0
    ? { base: rest, query: '', hash }
    : { base: rest.slice(0, queryAt), query: rest.slice(queryAt + 1), hash };
}

/** The query-string pairs of a URL, decoded, in order. */
export function parseUrlParams(url: string): IHttpHeader[] {
  const { query } = splitUrl(url);
  if (!query) return [];
  return query
    .split('&')
    .filter((pair) => pair !== '')
    .map((pair) => {
      const eq = pair.indexOf('=');
      return eq < 0
        ? { name: safeDecode(pair), value: '' }
        : {
            name: safeDecode(pair.slice(0, eq)),
            value: safeDecode(pair.slice(eq + 1)),
          };
    });
}

/** Rewrites the URL's query string from the pairs; rows with no name are skipped. */
export function withUrlParams(
  url: string,
  params: readonly IHttpHeader[],
): string {
  const { base, hash } = splitUrl(url);
  const pairs = params
    .filter((p) => p.name !== '')
    .map((p) => `${encodePart(p.name)}=${encodePart(p.value)}`);
  return base + (pairs.length ? '?' + pairs.join('&') : '') + hash;
}
