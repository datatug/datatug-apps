import {
  SIGN_IN_METHOD_STORAGE_KEY,
  resolveSignInMethod,
  signInMethodOfLocation,
} from './sign-in-method';

describe('per-browser Firebase sign-in method', () => {
  let values: Map<string, string>;
  let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

  beforeEach(() => {
    values = new Map();
    storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
      removeItem: (key) => void values.delete(key),
    };
  });

  it('defaults to popup in SSR without reading browser globals', () => {
    expect(signInMethodOfLocation(undefined)).toBe('popup');
  });

  it('opts this browser into redirect and remembers it for Firebase redirect return', () => {
    expect(
      resolveSignInMethod({
        search: '?checkout=test&signInMethod=redirect',
        storage,
      }),
    ).toBe('redirect');
    expect(values.get(SIGN_IN_METHOD_STORAGE_KEY)).toBe('redirect');
    expect(resolveSignInMethod({ search: '?checkout=test', storage })).toBe(
      'redirect',
    );
  });

  it('allows popup to be explicitly restored and clears the choice with default', () => {
    resolveSignInMethod({ search: '?signInMethod=redirect', storage });
    expect(
      resolveSignInMethod({ search: '?signInMethod=popup', storage }),
    ).toBe('popup');
    expect(values.get(SIGN_IN_METHOD_STORAGE_KEY)).toBe('popup');
    expect(
      resolveSignInMethod({
        search: '?checkout=test&signInMethod=default',
        storage,
      }),
    ).toBe('popup');
    expect(values.has(SIGN_IN_METHOD_STORAGE_KEY)).toBe(false);
  });

  it('ignores invalid query and stored values', () => {
    values.set(SIGN_IN_METHOD_STORAGE_KEY, 'redirect;evil');
    expect(
      resolveSignInMethod({
        search: '?signInMethod=https://evil.example',
        storage,
      }),
    ).toBe('popup');
    expect(values.get(SIGN_IN_METHOD_STORAGE_KEY)).toBe('redirect;evil');
  });

  it('falls back to popup when browser storage is unavailable', () => {
    const blockedStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(
      resolveSignInMethod({
        search: '?signInMethod=redirect',
        storage: blockedStorage,
      }),
    ).toBe('redirect');
    expect(resolveSignInMethod({ search: '', storage: blockedStorage })).toBe(
      'popup',
    );
  });
});
