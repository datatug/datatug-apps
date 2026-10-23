// A generic SHA-256 helper. The GitHub sign-in flows use it so that session
// storage never holds the server-issued OAuth `state` across the redirect to
// github.com: only its SHA-256 hash is stored, which is enough to recognise
// the callback that belongs to a saved request and useless to anyone who
// reads the storage. The server still verifies the real state when the code
// is exchanged.

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Returns the lowercase hex SHA-256 hash of `text`. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hashBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hashBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** True when `value` has the shape of a hex SHA-256 hash. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value);
}

/**
 * The hex SHA-256 hash of `text`, or `undefined` when hashing is unavailable,
 * so a caller comparing hashes fails closed.
 */
export async function sha256HexOrUndefined(
  text: string,
): Promise<string | undefined> {
  try {
    return await sha256Hex(text);
  } catch {
    return undefined;
  }
}
