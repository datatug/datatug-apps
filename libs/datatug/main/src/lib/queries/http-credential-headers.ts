import type { IHttpQueryRequest } from '../models/definition/query-def';
import { httpMethodAllowsBody } from './http-request-rules';

/**
 * Header names that carry credentials. Mirrors datatug-core's
 * `IsCredentialHTTPHeader` (pkg/datatug/query.go): such headers may be used for
 * a run but are never saved.
 */
export const CREDENTIAL_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-amz-security-token',
]);

export const CREDENTIAL_HEADER_FRAGMENTS: readonly string[] = [
  'token',
  'secret',
  'password',
  'api-key',
  'apikey',
];

export function isCredentialHttpHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (CREDENTIAL_HEADER_NAMES.has(lower)) return true;
  return CREDENTIAL_HEADER_FRAGMENTS.some((fragment) =>
    lower.includes(fragment),
  );
}

/** The headers that may be saved: names are trimmed; credential-named and unnamed rows are dropped. */
export function savableHttpHeaders<T extends { readonly name: string }>(
  headers: readonly T[] | undefined,
): T[] {
  return (headers ?? [])
    .filter((h) => h.name.trim() !== '' && !isCredentialHttpHeader(h.name))
    .map((h) => ({ ...h, name: h.name.trim() }));
}

/**
 * The request as it is saved: credential headers stripped, names trimmed, and
 * no body for a method that carries none. Applied on every save path.
 */
export function savableHttpRequest<T extends { readonly queryType: unknown }>(
  request: T,
): T {
  if (request.queryType !== 'HTTP') return request;
  const http = request as unknown as IHttpQueryRequest;
  const { body, ...rest } = http;
  const headers = savableHttpHeaders(http.headers);
  return {
    ...rest,
    ...(headers.length ? { headers } : { headers: undefined }),
    ...(body && httpMethodAllowsBody(http.method) ? { body } : {}),
  } as unknown as T;
}
