import {
  ANALYTICS_CONSENT_KEY,
  createAnalyticsConsent,
  GTAG_SRC,
  LINK_PAGE_PATH,
  type AnalyticsEnv,
} from './analytics-consent';

const ID = 'G-DESWRP39RY';
const COOKIE_EXPIRY = 'expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';

interface Fixture {
  env: AnalyticsEnv;
  store: Map<string, string>;
  win: Record<string, unknown> & { dataLayer?: unknown[] };
  appended: { async: boolean; src: string }[];
  cookieWrites: string[];
  page: { hostname: string; origin: string; pathname: string };
  state: {
    checkout: boolean;
    referrer: string;
    storageBroken: 'read' | 'write' | 'both' | false;
  };
  /** Fires the `storage` event of another tab. */
  otherTab(key: string | null, value?: string): void;
  /** Fires a browser `pageshow` event, as when a frozen page returns from the back-forward cache. */
  restore(persisted?: boolean): void;
}

function fixture(
  page = {
    hostname: 'datatug.app',
    origin: 'https://datatug.app',
    pathname: '/',
  },
): Fixture {
  const store = new Map<string, string>();
  const handlers = new Map<string, Set<(event: never) => void>>();
  const appended: { async: boolean; src: string }[] = [];
  const cookieWrites: string[] = [];
  const state: Fixture['state'] = {
    checkout: false,
    referrer: '',
    storageBroken: false,
  };
  const win = {
    addEventListener: (type: string, handler: never) => {
      let listeners = handlers.get(type);
      if (!listeners) handlers.set(type, (listeners = new Set()));
      listeners.add(handler);
    },
    removeEventListener: (type: string, handler: never) =>
      handlers.get(type)?.delete(handler),
  } as unknown as Fixture['win'];
  const env: AnalyticsEnv = {
    storage: () => {
      const broken = state.storageBroken;
      if (broken === 'both') throw new Error('storage blocked');
      return {
        getItem: (key) => {
          if (broken === 'read') throw new Error('read blocked');
          return store.get(key) ?? null;
        },
        setItem: (key, value) => {
          if (broken === 'write') throw new Error('quota');
          store.set(key, value);
        },
      };
    },
    location: () => page,
    checkoutActive: () => state.checkout,
    window: win as unknown as AnalyticsEnv['window'],
    document: {
      get cookie() {
        return '_ga=GA1.1.1; _ga_ABC123=GS2.1; _gid=1; other=2; flag';
      },
      get referrer() {
        return state.referrer;
      },
      set cookie(value: string) {
        cookieWrites.push(value);
      },
      head: { appendChild: (node) => appended.push(node as never) },
      createElement: () => ({ async: false, src: '' }),
    },
  };
  return {
    env,
    store,
    win,
    appended,
    cookieWrites,
    page,
    state,
    otherTab(key, value) {
      if (key !== null && value !== undefined) store.set(key, value);
      else if (key !== null) store.delete(key);
      for (const handler of [...(handlers.get('storage') ?? [])]) {
        handler({ key } as never);
      }
    },
    restore(persisted = true) {
      for (const handler of [...(handlers.get('pageshow') ?? [])]) {
        handler({ persisted } as never);
      }
    },
  };
}

/** The data layer as gtag.js reads it: each entry an `arguments` object, shown here as an array. */
const calls = (f: Fixture) =>
  (f.win.dataLayer ?? []).map((entry) =>
    Array.from(entry as ArrayLike<unknown>),
  );

const gtagCalls = (f: Fixture) =>
  calls(f).map((entry) => (entry[0] === 'js' ? ['js'] : entry));

describe('analytics consent', () => {
  describe('before any choice', () => {
    it('shows the banner and contacts no Google host', () => {
      const f = fixture();
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.pageView();
      expect(consent.choice()).toBeUndefined();
      expect(consent.bannerVisible()).toBe(true);
      expect(f.win.dataLayer).toBeUndefined();
      expect(f.appended).toEqual([]);
      expect(f.cookieWrites).toEqual([]);
      expect(f.win['ga-disable-' + ID]).toBeUndefined();
    });

    it.each(['yes', 'GRANTED', '', 'true'])(
      'counts the stored value %j as no choice',
      (value) => {
        const f = fixture();
        f.store.set(ANALYTICS_CONSENT_KEY, value);
        const consent = createAnalyticsConsent(f.env, ID);
        consent.start();
        expect(consent.choice()).toBeUndefined();
        expect(consent.bannerVisible()).toBe(true);
        expect(f.appended).toEqual([]);
      },
    );
  });

  describe('a stored grant', () => {
    it('loads in the contract order: consent default, update, js, config, one script, ga-disable cleared', () => {
      const f = fixture();
      f.win['ga-disable-' + ID] = true;
      f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      expect(consent.bannerVisible()).toBe(false);
      expect(gtagCalls(f)).toEqual([
        [
          'consent',
          'default',
          {
            analytics_storage: 'denied',
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
          },
        ],
        ['consent', 'update', { analytics_storage: 'granted' }],
        ['js'],
        [
          'config',
          ID,
          {
            allow_google_signals: false,
            allow_ad_personalization_signals: false,
            send_page_view: false,
            page_location: 'https://datatug.app/',
            page_referrer: '',
            page_title: 'DataTug',
          },
        ],
      ]);
      expect(calls(f)[2][1]).toBeInstanceOf(Date);
      expect(f.appended).toEqual([{ async: true, src: GTAG_SRC + ID }]);
      expect(GTAG_SRC + ID).toBe(
        'https://www.googletagmanager.com/gtag/js?id=G-DESWRP39RY',
      );
      expect(f.win['ga-disable-' + ID]).toBe(false);
    });

    it('keeps an existing data layer and loads the tag once however many pages follow', () => {
      const f = fixture();
      const existing = ['earlier'];
      f.win.dataLayer = existing;
      f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.start();
      f.page.pathname = '/project/github.com/datatug/demo';
      consent.pageView();
      f.page.pathname = '/demo';
      consent.pageView();
      expect(f.win.dataLayer).toBe(existing);
      expect(existing[0]).toBe('earlier');
      expect(f.appended).toHaveLength(1);
    });

    it('reports each navigation, the first included, with the scrubbed location and the page title', () => {
      const f = fixture({
        hostname: 'datatug.app',
        origin: 'https://datatug.app',
        pathname: '/project/github.com/datatug/demo',
      });
      f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
      f.state.referrer = 'https://www.google.com/search?q=secret#frag';
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      const before = calls(f).length;
      consent.pageView();
      f.page.pathname = '/demo';
      consent.pageView();
      const first = {
        page_location: 'https://datatug.app/project/github.com/datatug/demo',
        page_referrer: 'https://www.google.com/search',
      };
      const second = {
        page_location: 'https://datatug.app/demo',
        page_referrer: 'https://datatug.app/project/github.com/datatug/demo',
      };
      expect(calls(f).slice(before)).toEqual([
        ['set', { ...first, page_title: 'DataTug' }],
        ['event', 'page_view', { ...first, page_title: 'DataTug' }],
        ['set', { ...second, page_title: 'DataTug' }],
        ['event', 'page_view', { ...second, page_title: 'DataTug' }],
      ]);
    });

    it('never reports the query or the fragment', () => {
      const f = fixture();
      f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
      // The environment's location has them; only origin and pathname are ever read.
      Object.assign(f.page, { search: '?q=secret', hash: '#code=secret' });
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.pageView();
      expect(JSON.stringify(calls(f))).not.toContain('secret');
    });
  });

  describe('granted(): the gate every analytics backend shares', () => {
    it('is true only for a grant on a page where analytics may run', () => {
      const f = fixture();
      const consent = createAnalyticsConsent(f.env, ID);
      expect(consent.granted()).toBe(false);
      consent.choose('denied');
      expect(consent.granted()).toBe(false);
      consent.choose('granted');
      expect(consent.granted()).toBe(true);
      f.state.checkout = true;
      expect(consent.granted()).toBe(false);
      f.state.checkout = false;
      f.page.hostname = 'localhost';
      expect(consent.granted()).toBe(false);
      expect(createAnalyticsConsent(fixture().env, undefined).granted()).toBe(
        false,
      );
    });
  });

  describe('choosing in the banner', () => {
    it('accept: stores it, loads the tag and reports the page the visitor is on, once', () => {
      const f = fixture();
      const consent = createAnalyticsConsent(f.env, ID);
      const listener = vi.fn();
      consent.subscribe(listener);
      consent.start();
      consent.pageView();
      expect(f.appended).toEqual([]);
      listener.mockClear();
      consent.choose('granted');
      expect(f.store.get(ANALYTICS_CONSENT_KEY)).toBe('granted');
      expect(f.appended).toHaveLength(1);
      expect(calls(f).filter((entry) => entry[0] === 'event')).toEqual([
        [
          'event',
          'page_view',
          {
            page_location: 'https://datatug.app/',
            page_referrer: '',
            page_title: 'DataTug',
          },
        ],
      ]);
      expect(consent.bannerVisible()).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('accept before the first navigation: the first NavigationEnd carries the page view', () => {
      const f = fixture();
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.choose('granted');
      expect(calls(f).some((entry) => entry[0] === 'event')).toBe(false);
      consent.pageView();
      expect(calls(f).filter((entry) => entry[0] === 'event')).toHaveLength(1);
    });

    it('reject: stores it, hides the banner and contacts no Google host', () => {
      const f = fixture();
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.choose('denied');
      consent.pageView();
      expect(f.store.get(ANALYTICS_CONSENT_KEY)).toBe('denied');
      expect(consent.bannerVisible()).toBe(false);
      expect(f.win.dataLayer).toBeUndefined();
      expect(f.appended).toEqual([]);
      // Cookies an earlier visit left are removed even though GA never ran on this page.
      expect(f.cookieWrites).toHaveLength(6);
      expect(f.cookieWrites[0]).toBe(`_ga=; ${COOKIE_EXPIRY}`);
    });

    it('a no after a memory-only accept and a reload still deletes the cookies, once per cookie and domain', () => {
      const f = fixture();
      f.state.storageBroken = 'both';
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.choose('denied');
      expect(f.cookieWrites).toHaveLength(6);
      const before = f.cookieWrites.length;
      consent.choose('granted');
      consent.choose('denied');
      // Withdrawing a live GA deletes once, in disable(), not twice.
      expect(f.cookieWrites.length - before).toBe(6);
    });

    it('withdrawal: consent update, ga-disable and the _ga cookies deleted on the host and its parent domain', () => {
      const f = fixture({
        hostname: 'app.datatug.app',
        origin: 'https://app.datatug.app',
        pathname: '/',
      });
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.choose('granted');
      const loaded = calls(f).length;
      consent.choose('denied');
      expect(calls(f).slice(loaded)).toEqual([
        ['consent', 'update', { analytics_storage: 'denied' }],
      ]);
      expect(f.win['ga-disable-' + ID]).toBe(true);
      const expire = (name: string, domain = '') =>
        `${name}=; ${COOKIE_EXPIRY}${domain && '; domain=' + domain}`;
      expect(f.cookieWrites).toEqual([
        expire('_ga'),
        expire('_ga', 'app.datatug.app'),
        expire('_ga', '.datatug.app'),
        expire('_ga_ABC123'),
        expire('_ga_ABC123', 'app.datatug.app'),
        expire('_ga_ABC123', '.datatug.app'),
      ]);
      // Later pages send nothing.
      const after = calls(f).length;
      consent.pageView();
      expect(calls(f)).toHaveLength(after);
      expect(f.appended).toHaveLength(1);
    });

    it.each([
      ['an address of one label', 'intranet', ['intranet']],
      ['an IP address', '10.0.0.5', ['10.0.0.5']],
    ])(
      'deletes cookies for %s without a parent domain',
      (_label, hostname, domains) => {
        const f = fixture({
          hostname,
          origin: 'http://' + hostname,
          pathname: '/',
        });
        const consent = createAnalyticsConsent(f.env, ID);
        consent.start();
        consent.choose('granted');
        consent.choose('denied');
        const written = f.cookieWrites.filter((write) =>
          write.startsWith('_ga='),
        );
        expect(written).toEqual([
          `_ga=; ${COOKIE_EXPIRY}`,
          `_ga=; ${COOKIE_EXPIRY}; domain=${domains[0]}`,
        ]);
      },
    );

    it('accepting again after a withdrawal reuses the loaded tag', () => {
      const f = fixture();
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.pageView();
      consent.choose('granted');
      consent.choose('denied');
      const before = calls(f).length;
      consent.choose('granted');
      expect(f.appended).toHaveLength(1);
      expect(f.win['ga-disable-' + ID]).toBe(false);
      expect(calls(f).slice(before)).toEqual([
        ['consent', 'update', { analytics_storage: 'granted' }],
        [
          'set',
          {
            page_location: 'https://datatug.app/',
            page_referrer: '',
            page_title: 'DataTug',
          },
        ],
        [
          'event',
          'page_view',
          {
            page_location: 'https://datatug.app/',
            page_referrer: '',
            page_title: 'DataTug',
          },
        ],
      ]);
    });
  });

  describe('storage that throws', () => {
    it.each(['read', 'both'] as const)(
      'treats a refusal on %s as no choice: banner shown, GA never loaded',
      (broken) => {
        const f = fixture();
        f.state.storageBroken = broken;
        const consent = createAnalyticsConsent(f.env, ID);
        consent.start();
        consent.pageView();
        expect(consent.choice()).toBeUndefined();
        expect(consent.bannerVisible()).toBe(true);
        expect(f.win.dataLayer).toBeUndefined();
        expect(f.appended).toEqual([]);
      },
    );

    it.each(['write', 'both'] as const)(
      'holds an accepted choice in memory for this page when storage refuses on %s',
      (broken) => {
        const f = fixture();
        f.state.storageBroken = broken;
        const consent = createAnalyticsConsent(f.env, ID);
        consent.start();
        consent.pageView();
        consent.choose('granted');
        expect(consent.choice()).toBe('granted');
        expect(consent.bannerVisible()).toBe(false);
        expect(f.appended).toHaveLength(1);
        consent.choose('denied');
        expect(consent.choice()).toBe('denied');
        expect(f.win['ga-disable-' + ID]).toBe(true);
        expect(f.cookieWrites.length).toBeGreaterThan(0);
      },
    );

    it('prefers what storage holds once it works again', () => {
      const f = fixture();
      f.state.storageBroken = 'write';
      const consent = createAnalyticsConsent(f.env, ID);
      consent.choose('granted');
      f.state.storageBroken = false;
      consent.choose('denied');
      expect(consent.choice()).toBe('denied');
    });
  });

  describe('other tabs', () => {
    it('a grant elsewhere loads GA here, a denial elsewhere disables it', () => {
      const f = fixture();
      const consent = createAnalyticsConsent(f.env, ID);
      const listener = vi.fn();
      consent.subscribe(listener);
      consent.start();
      consent.pageView();
      f.otherTab(ANALYTICS_CONSENT_KEY, 'granted');
      expect(f.appended).toHaveLength(1);
      expect(consent.bannerVisible()).toBe(false);
      expect(listener).toHaveBeenCalled();
      f.otherTab(ANALYTICS_CONSENT_KEY, 'denied');
      expect(f.win['ga-disable-' + ID]).toBe(true);
      expect(f.cookieWrites.length).toBeGreaterThan(0);
    });

    it('a cleared choice (key removed, or the whole storage cleared) stops GA and shows the banner again', () => {
      const f = fixture();
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.choose('granted');
      f.otherTab(ANALYTICS_CONSENT_KEY);
      expect(f.win['ga-disable-' + ID]).toBe(true);
      expect(consent.bannerVisible()).toBe(true);
      f.otherTab(ANALYTICS_CONSENT_KEY, 'granted');
      expect(f.win['ga-disable-' + ID]).toBe(false);
      f.store.delete(ANALYTICS_CONSENT_KEY);
      f.otherTab(null);
      expect(f.win['ga-disable-' + ID]).toBe(true);
    });

    it('ignores other keys, and everything after stop()', () => {
      const f = fixture();
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
      f.otherTab('something-else', 'x');
      expect(f.appended).toEqual([]);
      consent.stop();
      f.otherTab(ANALYTICS_CONSENT_KEY, 'granted');
      expect(f.appended).toEqual([]);
    });

    it('unsubscribed listeners are not called', () => {
      const f = fixture();
      const consent = createAnalyticsConsent(f.env, ID);
      const listener = vi.fn();
      consent.subscribe(listener)();
      consent.start();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('back-forward cache restoration', () => {
    it('loads a grant made while frozen and reports the restored page once', () => {
      const f = fixture();
      const consent = createAnalyticsConsent(f.env, ID);
      const bannerState = vi.fn();
      consent.subscribe(() => bannerState(consent.bannerVisible()));
      consent.start();
      consent.pageView();

      f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
      f.restore();

      expect(consent.choice()).toBe('granted');
      expect(f.appended).toHaveLength(1);
      expect(bannerState).toHaveBeenLastCalledWith(false);
      expect(calls(f).filter((entry) => entry[0] === 'event')).toHaveLength(1);
    });

    it('updates the banner for a frozen denial and shows it again after a frozen clear', () => {
      const f = fixture();
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.pageView();
      const bannerState = vi.fn();
      consent.subscribe(() => bannerState(consent.bannerVisible()));

      f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
      f.restore();
      expect(consent.bannerVisible()).toBe(false);
      expect(bannerState).toHaveBeenLastCalledWith(false);

      f.store.set(ANALYTICS_CONSENT_KEY, 'denied');
      f.restore();
      expect(consent.choice()).toBe('denied');
      expect(f.win['ga-disable-' + ID]).toBe(true);
      expect(consent.bannerVisible()).toBe(false);
      expect(bannerState).toHaveBeenLastCalledWith(false);

      f.store.delete(ANALYTICS_CONSENT_KEY);
      f.restore();
      expect(consent.choice()).toBeUndefined();
      expect(consent.bannerVisible()).toBe(true);
      expect(bannerState).toHaveBeenLastCalledWith(true);
    });

    it('does not report another page view when the restored choice is unchanged', () => {
      const f = fixture();
      f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.pageView();
      const before = calls(f).filter((entry) => entry[0] === 'event').length;

      f.restore();

      expect(calls(f).filter((entry) => entry[0] === 'event')).toHaveLength(
        before,
      );
      expect(f.appended).toHaveLength(1);
    });

    it('keeps a memory-only choice while storage remains unavailable', () => {
      const f = fixture();
      f.state.storageBroken = 'both';
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.choose('granted');
      f.restore();

      expect(consent.choice()).toBe('granted');
      expect(consent.bannerVisible()).toBe(false);
      expect(f.appended).toHaveLength(1);
    });

    it('removes the pageshow listener on stop', () => {
      const f = fixture();
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.stop();
      f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
      f.restore();

      expect(f.appended).toEqual([]);
    });
  });

  describe('where GA never runs, even with consent', () => {
    it.each(['localhost', '127.0.0.1', '[::1]', '::1'])(
      'on %s: no banner, no tag',
      (hostname) => {
        const f = fixture({
          hostname,
          origin: 'http://' + hostname,
          pathname: '/',
        });
        f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
        const consent = createAnalyticsConsent(f.env, ID);
        consent.start();
        consent.pageView();
        consent.choose('granted');
        expect(consent.bannerVisible()).toBe(false);
        expect(f.win.dataLayer).toBeUndefined();
        expect(f.appended).toEqual([]);
      },
    );

    it('without a measurement id (development builds, the Incidentius profile): no banner, no tag', () => {
      const f = fixture();
      f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
      const consent = createAnalyticsConsent(f.env, undefined);
      consent.start();
      consent.pageView();
      expect(consent.bannerVisible()).toBe(false);
      expect(f.win.dataLayer).toBeUndefined();
      expect(f.appended).toEqual([]);
    });

    it('on a checkout page: no banner, no tag, and no consent write', () => {
      const f = fixture();
      f.state.checkout = true;
      f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.pageView();
      expect(consent.bannerVisible()).toBe(false);
      expect(f.win.dataLayer).toBeUndefined();
      expect(f.appended).toEqual([]);
    });

    it('navigating into checkout after a grant stops reporting, keeps the cookies and removes the banner', () => {
      const f = fixture();
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.pageView();
      consent.choose('granted');
      const before = calls(f).length;
      f.state.checkout = true;
      f.page.pathname = '/subscribe';
      consent.pageView();
      expect(calls(f).slice(before)).toEqual([
        ['consent', 'update', { analytics_storage: 'denied' }],
      ]);
      expect(f.win['ga-disable-' + ID]).toBe(true);
      expect(f.cookieWrites).toEqual([]);
      expect(consent.choice()).toBe('granted');
    });

    it('navigating into checkout while the banner is open removes it', () => {
      const f = fixture();
      const consent = createAnalyticsConsent(f.env, ID);
      const listener = vi.fn(() => consent.bannerVisible());
      consent.subscribe(listener);
      consent.start();
      f.state.checkout = true;
      consent.pageView();
      expect(listener).toHaveLastReturnedWith(false);
    });

    it.each([
      '/store/agent1/project/p1/env/e1/db/d1/table/orders',
      '/store/agent1/project/p1/env/e1/db/d1/view/v1/records',
      '/store/agent1/project/p1/env/e1/db/d1/table/orders/record',
      '/store/agent1/result/r-secret-1',
      '/store/agent1/project/p1/query',
    ])(
      'on the link page %s: a route template, never its identifiers, and no page view',
      (pathname) => {
        const f = fixture({
          hostname: 'datatug.app',
          origin: 'https://datatug.app',
          pathname,
        });
        f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
        f.state.referrer = 'https://datatug.app' + pathname + '?x=secret#pk=1';
        const consent = createAnalyticsConsent(f.env, ID);
        consent.start();
        consent.pageView();
        const location = 'https://datatug.app' + LINK_PAGE_PATH;
        expect(
          calls(f).find((entry) => entry[0] === 'config')?.[2],
        ).toMatchObject({
          page_location: location,
          page_referrer: location,
          page_title: 'DataTug',
        });
        expect(calls(f).filter((entry) => entry[0] === 'event')).toEqual([]);
        expect(calls(f).at(-1)).toEqual([
          'set',
          {
            page_location: location,
            page_referrer: location,
            page_title: 'DataTug',
          },
        ]);
        expect(JSON.stringify(calls(f))).not.toMatch(/agent1|orders|secret/);
      },
    );

    it("a link page the visitor just left is the next page's referrer only as a template", () => {
      const f = fixture({
        hostname: 'datatug.app',
        origin: 'https://datatug.app',
        pathname: '/store/agent1/result/r-secret-1',
      });
      f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
      const consent = createAnalyticsConsent(f.env, ID);
      consent.start();
      consent.pageView();
      f.page.pathname = '/demo';
      consent.pageView();
      expect(calls(f).filter((entry) => entry[0] === 'event')).toEqual([
        [
          'event',
          'page_view',
          {
            page_location: 'https://datatug.app/demo',
            page_referrer: 'https://datatug.app' + LINK_PAGE_PATH,
            page_title: 'DataTug',
          },
        ],
      ]);
      expect(JSON.stringify(calls(f))).not.toMatch(/agent1|secret/);
    });

    it.each(['not an address', '', 'about:blank'])(
      'a referrer of %j is sent as an empty string',
      (referrer) => {
        const f = fixture();
        f.state.referrer = referrer;
        f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
        const consent = createAnalyticsConsent(f.env, ID);
        consent.start();
        consent.pageView();
        expect(
          calls(f).find((entry) => entry[0] === 'event')?.[2],
        ).toMatchObject({ page_referrer: '' });
      },
    );

    it('a referrer the browser cannot parse is sent as an empty string', () => {
      vi.stubGlobal(
        'URL',
        vi.fn(() => {
          throw new TypeError('Invalid URL');
        }),
      );
      try {
        const f = fixture();
        f.state.referrer = 'https://';
        f.store.set(ANALYTICS_CONSENT_KEY, 'granted');
        const consent = createAnalyticsConsent(f.env, ID);
        consent.start();
        expect(
          calls(f).find((entry) => entry[0] === 'config')?.[2],
        ).toMatchObject({ page_referrer: '' });
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
