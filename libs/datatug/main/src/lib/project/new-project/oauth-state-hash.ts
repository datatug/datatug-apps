// The GitHub OAuth `state` is a server-issued CSRF value that has to survive a
// full-page redirect to github.com and back. Session storage never holds the
// value itself: it holds only a SHA-256 digest, which is enough to recognise
// the callback that belongs to a saved request and useless to anyone who
// reads the storage. The server still verifies the real state when the code
// is exchanged.

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Returns the lowercase hex SHA-256 digest of an OAuth state value. */
export async function digestOAuthState(state: string): Promise<string> {
  const bytes = new TextEncoder().encode(state);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** True when `value` has the shape of a stored state digest. */
export function isOAuthStateDigest(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value);
}

/**
 * Digests a returned state for comparison with a stored digest. Resolves to
 * `undefined` when hashing is unavailable, so callers fail closed.
 */
export async function digestReturnedOAuthState(
  state: string,
): Promise<string | undefined> {
  try {
    return await digestOAuthState(state);
  } catch {
    return undefined;
  }
}
