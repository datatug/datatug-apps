import type { IHttpHeader } from '../../../models/definition/query-def';

/** Query strings decode `+` as a space. */
function decodeQueryPart(value: string): string {
  const spaced = value.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

/** Encodes a query-string part but keeps {{template}} braces and `/` readable. */
function encodePart(value: string): string {
  return encodeURIComponent(value)
    .replace(/%7B/gi, '{')
    .replace(/%7D/gi, '}')
    .replace(/%2F/gi, '/');
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

interface IRawPair {
  readonly raw: string;
  readonly name: string;
  readonly value: string;
}

function rawPairs(query: string): IRawPair[] {
  if (!query) return [];
  return query
    .split('&')
    .filter((raw) => raw !== '')
    .map((raw) => {
      const eq = raw.indexOf('=');
      return eq < 0
        ? { raw, name: decodeQueryPart(raw), value: '' }
        : {
            raw,
            name: decodeQueryPart(raw.slice(0, eq)),
            value: decodeQueryPart(raw.slice(eq + 1)),
          };
    });
}

/** The query-string pairs of a URL, decoded (`+` is a space), in order. */
export function parseUrlParams(url: string): IHttpHeader[] {
  return rawPairs(splitUrl(url).query).map(({ name, value }) => ({
    name,
    value,
  }));
}

/**
 * Rewrites the URL's query string from the pairs. A pair that still decodes to
 * an existing one keeps its original encoding; only edited pairs are
 * re-encoded. Rows with no name stay in the editor but are left out of the URL.
 */
export function withUrlParams(
  url: string,
  params: readonly IHttpHeader[],
): string {
  const { base, query, hash } = splitUrl(url);
  const existing = rawPairs(query);
  let from = 0;
  const pairs = params
    .filter((p) => p.name !== '')
    .map((p) => {
      for (let i = from; i < existing.length; i++) {
        if (existing[i].name === p.name && existing[i].value === p.value) {
          from = i + 1;
          return existing[i].raw;
        }
      }
      return `${encodePart(p.name)}=${encodePart(p.value)}`;
    });
  return base + (pairs.length ? '?' + pairs.join('&') : '') + hash;
}
