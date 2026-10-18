import {
  AUTH_DOMAIN_STORAGE_KEY,
  authDomainOfLocation,
  resolveAuthDomain,
  SHARED_AUTH_DOMAIN,
} from './auth-domain';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

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

describe('resolveAuthDomain', () => {
  it('keeps the shared domain on a host that has no /__/auth proxy (app.incidentius.com, previews)', () => {
    for (const hostname of ['app.incidentius.com', 'datatug-apps.pages.dev']) {
      expect(
        resolveAuthDomain({
          hostname,
          search: '?authDomain=same-origin',
          sameOriginByDefault: true,
        }),
      ).toBe(SHARED_AUTH_DOMAIN);
    }
  });

  it('uses the shared domain on datatug.app until the same-origin default is switched on', () => {
    expect(
      resolveAuthDomain({
        hostname: 'datatug.app',
        search: '',
        sameOriginByDefault: false,
      }),
    ).toBe('auth.sneat.co');
  });

  it('uses datatug.app itself once the same-origin default is switched on', () => {
    expect(
      resolveAuthDomain({
        hostname: 'datatug.app',
        search: '',
        sameOriginByDefault: true,
      }),
    ).toBe('datatug.app');
  });

  it('?authDomain=same-origin opts one browser in and remembers it for the redirect return', () => {
    const storage = memoryStorage();
    expect(
      resolveAuthDomain({
        hostname: 'datatug.app',
        search: '?authDomain=same-origin',
        sameOriginByDefault: false,
        storage,
      }),
    ).toBe('datatug.app');
    expect(storage.data.get(AUTH_DOMAIN_STORAGE_KEY)).toBe('same-origin');
    expect(
      resolveAuthDomain({
        hostname: 'datatug.app',
        search: '',
        sameOriginByDefault: false,
        storage,
      }),
    ).toBe('datatug.app');
  });

  it('?authDomain=shared opts one browser out of a same-origin default', () => {
    const storage = memoryStorage();
    expect(
      resolveAuthDomain({
        hostname: 'datatug.app',
        search: '?authDomain=shared',
        sameOriginByDefault: true,
        storage,
      }),
    ).toBe('auth.sneat.co');
    expect(
      resolveAuthDomain({
        hostname: 'datatug.app',
        search: '',
        sameOriginByDefault: true,
        storage,
      }),
    ).toBe('auth.sneat.co');
  });

  it('?authDomain=default forgets the remembered choice', () => {
    const storage = memoryStorage({ [AUTH_DOMAIN_STORAGE_KEY]: 'same-origin' });
    expect(
      resolveAuthDomain({
        hostname: 'datatug.app',
        search: '?authDomain=default',
        sameOriginByDefault: false,
        storage,
      }),
    ).toBe('auth.sneat.co');
    expect(storage.data.has(AUTH_DOMAIN_STORAGE_KEY)).toBe(false);
  });

  it('ignores any other parameter value, and any other stored value', () => {
    const storage = memoryStorage({
      [AUTH_DOMAIN_STORAGE_KEY]: 'evil.example',
    });
    expect(
      resolveAuthDomain({
        hostname: 'datatug.app',
        search: '?authDomain=evil.example',
        sameOriginByDefault: false,
        storage,
      }),
    ).toBe('auth.sneat.co');
    expect(storage.data.get(AUTH_DOMAIN_STORAGE_KEY)).toBe('evil.example');
  });

  it('still resolves when storage is blocked or absent', () => {
    expect(
      resolveAuthDomain({
        hostname: 'datatug.app',
        search: '?authDomain=same-origin',
        sameOriginByDefault: false,
        storage: blockedStorage,
      }),
    ).toBe('datatug.app');
    expect(
      resolveAuthDomain({
        hostname: 'datatug.app',
        search: '',
        sameOriginByDefault: true,
        storage: blockedStorage,
      }),
    ).toBe('datatug.app');
    expect(
      resolveAuthDomain({
        hostname: 'datatug.app',
        search: '?authDomain=default',
        sameOriginByDefault: false,
        storage: blockedStorage,
      }),
    ).toBe('auth.sneat.co');
    expect(
      resolveAuthDomain({
        hostname: 'datatug.app',
        search: '',
        sameOriginByDefault: false,
      }),
    ).toBe('auth.sneat.co');
  });
});

describe('authDomainOfLocation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('reads the page address and the browser localStorage', () => {
    expect(
      authDomainOfLocation(
        { hostname: 'datatug.app', search: '?authDomain=same-origin' },
        false,
      ),
    ).toBe('datatug.app');
    expect(localStorage.getItem(AUTH_DOMAIN_STORAGE_KEY)).toBe('same-origin');
    expect(
      authDomainOfLocation(
        { hostname: 'app.incidentius.com', search: '' },
        true,
      ),
    ).toBe('auth.sneat.co');
  });

  it('survives a localStorage getter that throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(
      authDomainOfLocation({ hostname: 'datatug.app', search: '' }, true),
    ).toBe('datatug.app');
  });
});
