import {
  hashOAuthState,
  hashReturnedOAuthState,
  isOAuthStateHash,
} from './oauth-state-hash';

describe('OAuth state hash', () => {
  it('stores a SHA-256 hex hash instead of the state', async () => {
    const hash = await hashOAuthState('abc');
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(isOAuthStateHash(hash)).toBe(true);
    expect(await hashOAuthState('abc')).toBe(hash);
    expect(await hashOAuthState('abd')).not.toBe(hash);
  });

  it('recognises only hash-shaped values', () => {
    expect(isOAuthStateHash('abc')).toBe(false);
    expect(isOAuthStateHash(undefined)).toBe(false);
    expect(isOAuthStateHash('A'.repeat(64))).toBe(false);
    expect(isOAuthStateHash('a'.repeat(64))).toBe(true);
  });

  it('fails closed when hashing is unavailable', async () => {
    const subtleDigest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('insecure context'));
    expect(await hashReturnedOAuthState('abc')).toBeUndefined();
    subtleDigest.mockRestore();
  });
});
