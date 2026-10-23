import {
  sha256Hex,
  sha256HexOrUndefined,
  isSha256Hex,
} from './sha256-hex';

describe('SHA-256 hex', () => {
  it('stores a SHA-256 hex hash instead of the state', async () => {
    const hash = await sha256Hex('abc');
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(isSha256Hex(hash)).toBe(true);
    expect(await sha256Hex('abc')).toBe(hash);
    expect(await sha256Hex('abd')).not.toBe(hash);
  });

  it('recognises only hash-shaped values', () => {
    expect(isSha256Hex('abc')).toBe(false);
    expect(isSha256Hex(undefined)).toBe(false);
    expect(isSha256Hex('A'.repeat(64))).toBe(false);
    expect(isSha256Hex('a'.repeat(64))).toBe(true);
  });

  it('fails closed when hashing is unavailable', async () => {
    const subtleDigest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('insecure context'));
    expect(await sha256HexOrUndefined('abc')).toBeUndefined();
    subtleDigest.mockRestore();
  });
});
