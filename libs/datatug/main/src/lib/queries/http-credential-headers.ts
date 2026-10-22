/**
 * Header names that carry credentials. Mirrors datatug-core's
 * `IsCredentialHTTPHeader` (pkg/datatug/query.go): such headers may be used for
 * a run but are never saved.
 */
const CREDENTIAL_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-amz-security-token',
]);

const CREDENTIAL_HEADER_FRAGMENTS: readonly string[] = [
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

/** The headers that may be saved: credential-named and unnamed rows are dropped. */
export function savableHttpHeaders<T extends { readonly name: string }>(
  headers: readonly T[] | undefined,
): T[] {
  return (headers ?? []).filter(
    (h) => h.name.trim() !== '' && !isCredentialHttpHeader(h.name),
  );
}
