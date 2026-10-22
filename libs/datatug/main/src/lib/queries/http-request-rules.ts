import type { IHttpQueryRequest } from '../models/definition/query-def';

/** Mirrors datatug-core `MaxQueryHTTPHeaders` (pkg/datatug/query_http.go). */
export const MAX_HTTP_HEADERS = 50;

/** Methods that may carry a body: mirrors core `HTTPMethodAllowsBody` (OPTIONS has none). */
const BODY_METHODS: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

export function httpMethodAllowsBody(method: string | undefined): boolean {
  return BODY_METHODS.includes((method ?? 'GET').toUpperCase());
}

const TOKEN_CHARS = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

/** True when `name` is a non-empty RFC 7230 token (mirrors core `IsHTTPToken`). */
export function isHttpToken(name: string): boolean {
  return TOKEN_CHARS.test(name);
}

/** The first reason an HTTP request cannot be saved, or undefined when it can. */
export function httpRequestSaveProblem(
  request: Pick<IHttpQueryRequest, 'headers'>,
): string | undefined {
  const named = (request.headers ?? []).filter((h) => h.name.trim() !== '');
  const bad = named.find((h) => !isHttpToken(h.name.trim()));
  if (bad)
    return `Header name "${bad.name.trim()}" is not valid: use letters, digits and !#$%&'*+-.^_\`|~ only.`;
  if (named.length > MAX_HTTP_HEADERS)
    return `A query can have at most ${MAX_HTTP_HEADERS} headers.`;
  return undefined;
}

/** True for an absolute http(s) URL with a host. */
export function isAbsoluteHttpUrl(url: string): boolean {
  // A scheme check first: some runtimes resolve a relative URL against the page origin.
  if (!/^https?:\/\/[^/?#\s]/i.test(url.trim())) return false;
  try {
    const parsed = new URL(url.trim());
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname !== ''
    );
  } catch {
    return false;
  }
}

export const ABSOLUTE_URL_MESSAGE =
  'Enter an absolute URL starting with http:// or https://.';

const BROWSER_FORBIDDEN_HEADERS: ReadonlySet<string> = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);

/** True for a header name a browser `fetch` refuses to set. */
export function isBrowserForbiddenHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return (
    BROWSER_FORBIDDEN_HEADERS.has(lower) ||
    lower.startsWith('sec-') ||
    lower.startsWith('proxy-')
  );
}
