function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, stableValue(object[key])]));
  }
  return value;
}

/** Content identity for client-observed output. It does not claim a server artifact exists. */
export async function sessionResultFingerprint(value: unknown): Promise<string> {
  const encoded = JSON.stringify(stableValue(value));
  if (encoded === undefined) throw new Error('The query result cannot be fingerprinted.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256-${hex}`;
}
