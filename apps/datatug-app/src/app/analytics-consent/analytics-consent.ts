import { isLinkRoute } from '../telemetry/link-privacy';

/**
 * Google Analytics behind a consent choice (founder 2026-10-19: GA4 Consent Mode, default denied). The landing site
 * (datatug/websites) implements the same contract on the same origin and shares the storage key, so a choice made
 * on either side holds on both. Until the visitor accepts, no Google host is contacted and no cookie is set.
 *
 * Framework-free on purpose: every outside thing (window, document, storage, location) comes in through
 * {@link AnalyticsEnv}, so the unit tests drive it with plain objects.
 */

export const ANALYTICS_CONSENT_KEY = 'datatug.analytics-consent.v1';

export type AnalyticsChoice = 'granted' | 'denied';

const PAGE_TITLE = 'DataTug';

export const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js?id=';

/** What a page view of a link page (table, view, records, record, result) is reported as: never its identifiers. */
export const LINK_PAGE_PATH = '/store/:link-page';

export interface AnalyticsEnv {
  /** Throws where the browser refuses storage (private mode, blocked cookies). */
  storage(): Pick<Storage, 'getItem' | 'setItem'>;
  location(): { hostname: string; origin: string; pathname: string };
  /** The in-memory checkout latch (`checkoutPrivacyActive()`): once set, nothing is sent for this document. */
  checkoutActive(): boolean;
  /** The page's `window`, for `dataLayer`, the `ga-disable-<id>` switch and the cross-tab `storage` event. */
  window: {
    dataLayer?: unknown[];
    addEventListener(
      type: 'storage',
      listener: (event: { key: string | null }) => void,
    ): void;
    addEventListener(
      type: 'pageshow',
      listener: (event: { persisted: boolean }) => void,
    ): void;
    removeEventListener(
      type: 'storage',
      listener: (event: { key: string | null }) => void,
    ): void;
    removeEventListener(
      type: 'pageshow',
      listener: (event: { persisted: boolean }) => void,
    ): void;
  } & Record<string, unknown>;
  document: {
    cookie: string;
    referrer: string;
    head: { appendChild(node: unknown): unknown };
    createElement(tag: 'script'): { async: boolean; src: string };
  };
}

export interface AnalyticsConsent {
  /** The stored choice; undefined while there is none. */
  choice(): AnalyticsChoice | undefined;
  /** Whether the banner is to be on screen right now. */
  bannerVisible(): boolean;
  /** Records the visitor's choice and applies it at once. */
  choose(choice: AnalyticsChoice): void;
  /** A route finished navigating (the first included): reports the page when GA is on. */
  pageView(): void;
  /**
   * Analytics may run on this page (a measurement id, not checkout, not localhost) and the visitor accepted. The one
   * gate for every analytics backend: GA here, PostHog and the shared `AnalyticsService` events too.
   */
  granted(): boolean;
  /** Called whenever the choice or the banner's visibility may have changed. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Applies a stored grant and starts following the choice of other tabs. */
  start(): void;
  stop(): void;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function parseChoice(value: string | null): AnalyticsChoice | undefined {
  return value === 'granted' || value === 'denied' ? value : undefined;
}

/** The host with its first labels cut off down to two (`app.datatug.app` -> `datatug.app`); undefined for an IP. */
function parentDomain(hostname: string): string | undefined {
  const labels = hostname.split('.');
  if (labels.length < 2 || labels.every((label) => /^\d+$/.test(label))) {
    return undefined;
  }
  return labels.slice(-2).join('.');
}

export function createAnalyticsConsent(
  env: AnalyticsEnv,
  measurementId: string | undefined,
): AnalyticsConsent {
  const listeners = new Set<() => void>();
  // The choice of this page when storage refuses to hold it.
  let memory: AnalyticsChoice | undefined;
  // GA is on: granted, allowed here, and the tag is (being) loaded.
  let enabled = false;
  let loaded = false;
  let navigated = false;
  // Scrubbed addresses of the page being shown and of the one before it, for `page_referrer`.
  let current: string | undefined;
  let previous: string | undefined;

  const disableKey = () => 'ga-disable-' + measurementId;

  function choice(): AnalyticsChoice | undefined {
    try {
      return (
        parseChoice(env.storage().getItem(ANALYTICS_CONSENT_KEY)) ?? memory
      );
    } catch {
      return memory;
    }
  }

  /** GA may run on this page at all (a measurement id, not a checkout page, not localhost). */
  function allowed(): boolean {
    return (
      !!measurementId &&
      !env.checkoutActive() &&
      !LOCAL_HOSTS.has(env.location().hostname)
    );
  }

  // gtag.js reads `arguments` objects from the data layer; an array or a rest parameter is ignored by it.
  const gtag: (...args: unknown[]) => void = function () {
    // eslint-disable-next-line prefer-rest-params
    (env.window.dataLayer as unknown[]).push(arguments);
  };

  /** Origin and path, with no query and no fragment; a link page's path is replaced by a template. */
  function scrub(origin: string, pathname: string): string {
    return origin + (isLinkRoute(pathname) ? LINK_PAGE_PATH : pathname);
  }

  function scrubbedLocation(): string {
    const { origin, pathname } = env.location();
    return scrub(origin, pathname);
  }

  /** The page before this one: the previous in-app address, else where the visitor came from (never its query). */
  function scrubbedReferrer(): string {
    if (previous !== undefined) return previous;
    // Only an absolute address names a place; a relative one would be read against this page's own.
    if (!/^[a-z][a-z\d+.-]*:/i.test(env.document.referrer)) return '';
    try {
      const { origin, pathname } = new URL(env.document.referrer);
      // `about:blank`, `data:` and the like have no origin to report.
      return origin === 'null' ? '' : scrub(origin, pathname);
    } catch {
      return '';
    }
  }

  function enable(): void {
    if (!loaded) {
      env.window.dataLayer = env.window.dataLayer || [];
      gtag('consent', 'default', {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      });
    }
    gtag('consent', 'update', { analytics_storage: 'granted' });
    if (!loaded) {
      loaded = true;
      gtag('js', new Date());
      gtag('config', measurementId, {
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        send_page_view: false,
        page_location: scrubbedLocation(),
        page_referrer: scrubbedReferrer(),
        page_title: PAGE_TITLE,
      });
      const script = env.document.createElement('script');
      script.async = true;
      script.src = GTAG_SRC + measurementId;
      env.document.head.appendChild(script);
    }
    env.window[disableKey()] = false;
  }

  function deleteCookies(): void {
    const { hostname } = env.location();
    const parent = parentDomain(hostname);
    const domains = [undefined, hostname, ...(parent ? ['.' + parent] : [])];
    for (const part of env.document.cookie.split(';')) {
      const name = part.split('=')[0].trim();
      if (name !== '_ga' && !name.startsWith('_ga_')) continue;
      for (const domain of domains) {
        env.document.cookie =
          name +
          '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' +
          (domain ? '; domain=' + domain : '');
      }
    }
  }

  function disable(): void {
    gtag('consent', 'update', { analytics_storage: 'denied' });
    env.window[disableKey()] = true;
    // Leaving for a checkout page keeps the cookies; a visitor's no removes them.
    if (choice() !== 'granted') deleteCookies();
  }

  function sync(): void {
    const want = allowed() && choice() === 'granted';
    if (want && !enabled) {
      enabled = true;
      enable();
    } else if (!want && enabled) {
      enabled = false;
      disable();
    }
  }

  function sendPageView(): void {
    const page_location = scrubbedLocation();
    const page_referrer = scrubbedReferrer();
    // The title too: auto-collected events send document.title, which on a link page names its project.
    gtag('set', { page_location, page_referrer, page_title: PAGE_TITLE });
    // A link page's view is not reported at all: only the scrubbed location rides along on its other events.
    if (!isLinkRoute(env.location().pathname)) {
      gtag('event', 'page_view', {
        page_location,
        page_referrer,
        page_title: PAGE_TITLE,
      });
    }
  }

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  /** The choice may have changed (here, or in another tab): apply it and tell the banner. */
  function refresh(): void {
    const wasEnabled = enabled;
    sync();
    if (enabled && !wasEnabled && navigated) sendPageView();
    notify();
  }

  const onStorage = (event: { key: string | null }) => {
    if (event.key === null || event.key === ANALYTICS_CONSENT_KEY) refresh();
  };
  const onPageShow = (event: { persisted: boolean }) => {
    if (event.persisted) refresh();
  };

  return {
    choice,
    bannerVisible: () => allowed() && choice() === undefined,
    choose(next) {
      const wasEnabled = enabled;
      try {
        env.storage().setItem(ANALYTICS_CONSENT_KEY, next);
        memory = undefined;
      } catch {
        memory = next;
      }
      refresh();
      // A no removes cookies an earlier visit left (memory-only accept, then reload), when GA was off on this page.
      if (next === 'denied' && !wasEnabled) deleteCookies();
    },
    pageView() {
      navigated = true;
      previous = current;
      current = scrubbedLocation();
      sync();
      if (enabled) sendPageView();
      notify();
    },
    granted: () => allowed() && choice() === 'granted',
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    start() {
      env.window.addEventListener('storage', onStorage);
      env.window.addEventListener('pageshow', onPageShow);
      sync();
      notify();
    },
    stop() {
      env.window.removeEventListener('storage', onStorage);
      env.window.removeEventListener('pageshow', onPageShow);
    },
  };
}

/**
 * The app's own consent for anonymous usage analytics (PostHog), public-demo REQ:demo-usage-analytics. Distinct from
 * {@link ANALYTICS_CONSENT_KEY}, which the landing site's Google Analytics banner also writes: a yes there names only
 * Google Analytics, so it never starts PostHog here. Only the app's banner, whose text names PostHog, writes this key.
 */
export const USAGE_ANALYTICS_CONSENT_KEY = 'datatug.usage-analytics-consent.v1';

/**
 * Google Analytics consent (`ga`, shared with the landing site) plus the app-only usage consent. `granted()` is the
 * usage gate (PostHog and usage events): it needs this app's own yes, and a no on either key (a withdrawal on the site
 * included) keeps it off. The banner shows while either choice is open; one answer records both. Without usage
 * analytics configured (`usageEnabled` false) it is `ga` unchanged, except that `granted()` is never true.
 */
export function withUsageConsent(
  ga: AnalyticsConsent,
  env: Pick<AnalyticsEnv, 'storage' | 'location' | 'checkoutActive' | 'window'>,
  usageEnabled: boolean,
  usageKey: string = USAGE_ANALYTICS_CONSENT_KEY,
): AnalyticsConsent {
  const listeners = new Set<() => void>();
  let memory: AnalyticsChoice | undefined;

  function usageChoice(): AnalyticsChoice | undefined {
    try {
      return parseChoice(env.storage().getItem(usageKey)) ?? memory;
    } catch {
      return memory;
    }
  }

  const usageAllowed = () =>
    usageEnabled &&
    !env.checkoutActive() &&
    !LOCAL_HOSTS.has(env.location().hostname);

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const onStorage = (event: { key: string | null }) => {
    if (event.key === null || event.key === usageKey) notify();
  };

  return {
    choice: ga.choice,
    bannerVisible: () =>
      ga.bannerVisible() || (usageAllowed() && usageChoice() === undefined),
    choose(next) {
      if (usageEnabled) {
        try {
          env.storage().setItem(usageKey, next);
          memory = undefined;
        } catch {
          memory = next;
        }
      }
      // GA applies its own key and tells every subscriber, this one's included.
      ga.choose(next);
    },
    pageView: ga.pageView,
    granted: () =>
      usageAllowed() && usageChoice() === 'granted' && ga.choice() !== 'denied',
    subscribe(listener) {
      listeners.add(listener);
      const unsubscribe = ga.subscribe(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
    start() {
      env.window.addEventListener('storage', onStorage);
      ga.start();
    },
    stop() {
      env.window.removeEventListener('storage', onStorage);
      ga.stop();
    },
  };
}
