// The GitHub OAuth `state` is a server-issued CSRF value that has to survive a
// full-page redirect to github.com and back. Session storage never holds the
// value itself: it holds only a SHA-256 hash, which is enough to recognise
// the callback that belongs to a saved request and useless to anyone who
// reads the storage. The server still verifies the real state when the code
// is exchanged.

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Returns the lowercase hex SHA-256 hash of an OAuth state value. */
export async function hashOAuthState(state: string): Promise<string> {
  const bytes = new TextEncoder().encode(state);
  const hashBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hashBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** True when `value` has the shape of a stored state hash. */
export function isOAuthStateHash(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value);
}

/**
 * Hashes a returned state for comparison with a stored hash. Resolves to
 * `undefined` when hashing is unavailable, so callers fail closed.
 */
export async function hashReturnedOAuthState(
  state: string,
): Promise<string | undefined> {
  try {
    return await hashOAuthState(state);
  } catch {
    return undefined;
  }
}
