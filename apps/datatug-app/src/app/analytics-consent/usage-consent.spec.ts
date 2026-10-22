import {
  ANALYTICS_CONSENT_KEY,
  USAGE_ANALYTICS_CONSENT_KEY,
  withUsageConsent,
  type AnalyticsChoice,
  type AnalyticsConsent,
} from './analytics-consent';

function fakeGa(stored: Record<string, string>) {
  const listeners = new Set<() => void>();
  const ga: AnalyticsConsent = {
    choice: () => stored[ANALYTICS_CONSENT_KEY] as AnalyticsChoice | undefined,
    bannerVisible: () => stored[ANALYTICS_CONSENT_KEY] === undefined,
    choose: vi.fn((next: AnalyticsChoice) => {
      stored[ANALYTICS_CONSENT_KEY] = next;
      for (const listener of [...listeners]) listener();
    }),
    pageView: vi.fn(),
    granted: () => stored[ANALYTICS_CONSENT_KEY] === 'granted',
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    start: vi.fn(),
    stop: vi.fn(),
  };
  return ga;
}

function env(stored: Record<string, string>, refuse = false) {
  const handlers: ((event: { key: string | null }) => void)[] = [];
  const state = { hostname: 'datatug.app', checkout: false };
  return {
    state,
    handlers,
    env: {
      storage: () => {
        if (refuse) throw new Error('blocked');
        return {
          getItem: (key: string) => stored[key] ?? null,
          setItem: (key: string, value: string) => void (stored[key] = value),
        };
      },
      location: () => ({
        hostname: state.hostname,
        origin: 'https://' + state.hostname,
        pathname: '/',
      }),
      checkoutActive: () => state.checkout,
      window: {
        addEventListener: (
          _type: string,
          handler: (event: { key: string | null }) => void,
        ) => handlers.push(handler),
        removeEventListener: vi.fn(),
      } as never,
    },
  };
}

describe('withUsageConsent', () => {
  it("a Google Analytics yes from the landing site never grants usage analytics; the app's own yes does", () => {
    const stored: Record<string, string> = {
      [ANALYTICS_CONSENT_KEY]: 'granted',
    };
    const ga = fakeGa(stored);
    const consent = withUsageConsent(ga, env(stored).env, true);
    expect(consent.granted()).toBe(false);
    expect(consent.bannerVisible()).toBe(true);
    consent.choose('granted');
    expect(stored[USAGE_ANALYTICS_CONSENT_KEY]).toBe('granted');
    expect(ga.choose).toHaveBeenCalledWith('granted');
    expect(consent.granted()).toBe(true);
    expect(consent.bannerVisible()).toBe(false);
  });

  it('a no on the site key (a withdrawal there) keeps usage analytics off', () => {
    const stored: Record<string, string> = {
      [ANALYTICS_CONSENT_KEY]: 'denied',
      [USAGE_ANALYTICS_CONSENT_KEY]: 'granted',
    };
    const ga = fakeGa(stored);
    const consent = withUsageConsent(ga, env(stored).env, true);
    // Reading is pure: it keeps the feature off without writing anything.
    expect(consent.granted()).toBe(false);
    expect(stored[USAGE_ANALYTICS_CONSENT_KEY]).toBe('granted');
    // Starting records the withdrawal, so a later Google Analytics yes on the site never brings PostHog back.
    consent.start();
    expect(stored[USAGE_ANALYTICS_CONSENT_KEY]).toBe('denied');
    stored[ANALYTICS_CONSENT_KEY] = 'granted';
    expect(consent.granted()).toBe(false);
    // A withdrawal while running (another tab, the site's button) is recorded on the change.
    stored[USAGE_ANALYTICS_CONSENT_KEY] = 'granted';
    ga.choose('denied');
    expect(stored[USAGE_ANALYTICS_CONSENT_KEY]).toBe('denied');
    consent.stop();
  });

  it('is off on localhost, during checkout and where usage analytics are not configured', () => {
    const stored: Record<string, string> = {
      [ANALYTICS_CONSENT_KEY]: 'granted',
      [USAGE_ANALYTICS_CONSENT_KEY]: 'granted',
    };
    const { env: e, state } = env(stored);
    const consent = withUsageConsent(fakeGa(stored), e, true);
    expect(consent.granted()).toBe(true);
    state.checkout = true;
    expect(consent.granted()).toBe(false);
    state.checkout = false;
    state.hostname = 'localhost';
    expect(consent.granted()).toBe(false);
    const off = withUsageConsent(fakeGa({}), env({}).env, false);
    off.choose('granted');
    expect(off.granted()).toBe(false);
    expect(off.bannerVisible()).toBe(false);
  });

  it('keeps the choice in memory when storage is refused, and follows other tabs', () => {
    const stored: Record<string, string> = {};
    const refused = env(stored, true);
    const consent = withUsageConsent(fakeGa(stored), refused.env, true);
    consent.start();
    const seen = vi.fn();
    const unsubscribe = consent.subscribe(seen);
    consent.choose('granted');
    expect(consent.granted()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    for (const handler of refused.handlers) {
      handler({ key: USAGE_ANALYTICS_CONSENT_KEY });
      handler({ key: null });
      handler({ key: 'other' });
    }
    expect(seen).toHaveBeenCalledTimes(3);
    unsubscribe();
    for (const handler of refused.handlers) handler({ key: null });
    expect(seen).toHaveBeenCalledTimes(3);
    consent.pageView();
    consent.stop();
    expect(consent.choice()).toBe('granted');
  });
});
