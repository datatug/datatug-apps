import {
  digestOAuthState,
  digestReturnedOAuthState,
  isOAuthStateDigest,
} from './oauth-state-digest';

describe('OAuth state digest', () => {
  it('stores a SHA-256 hex digest instead of the state', async () => {
    const digest = await digestOAuthState('abc');
    expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(isOAuthStateDigest(digest)).toBe(true);
    expect(await digestOAuthState('abc')).toBe(digest);
    expect(await digestOAuthState('abd')).not.toBe(digest);
  });

  it('recognises only digest-shaped values', () => {
    expect(isOAuthStateDigest('abc')).toBe(false);
    expect(isOAuthStateDigest(undefined)).toBe(false);
    expect(isOAuthStateDigest('A'.repeat(64))).toBe(false);
    expect(isOAuthStateDigest('a'.repeat(64))).toBe(true);
  });

  it('fails closed when hashing is unavailable', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('insecure context'));
    expect(await digestReturnedOAuthState('abc')).toBeUndefined();
    digest.mockRestore();
  });
});
