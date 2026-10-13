import { TestBed } from '@angular/core/testing';
import {
  AnalyticsService,
  ErrorLogger,
  SNEAT_FIREBASE_ANALYTICS,
} from '@sneat/core';
import { provideSneatAnalytics } from '@sneat/logging';
import { datatugAppEnvironmentConfig as production } from './environments/environment.prod';
import { withoutDataTugTracking } from './launch-tracking';
import { registerPosthog } from './register-posthog';
import indexHtml from './index.html?raw';
import mainSource from './main.ts?raw';

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  stopSessionRecording: vi.fn(),
  set_config: vi.fn(),
}));
vi.mock('posthog-js', () => ({ default: sdk }));

const checkoutPaths = [
  '/subscribe?checkout=test',
  '/pricing/return?session_id=cs_test_paid',
  '/login#/pricing/return?session_id=cs_test_paid',
];

const standardPaths = [
  '/',
  '/project/github.com/datatug/demo',
  '/login',
];

it.each(checkoutPaths)(
  'suppresses GA and PostHog on checkout route %s',
  (path) => {
    const previous = location.pathname + location.search + location.hash;
    const target = window as unknown as Record<string, unknown>;
    const saved = { ...target };
    sdk.init.mockClear();
    try {
      history.replaceState(null, '', path);
      const checkoutStart = indexHtml.indexOf('<!-- Checkout privacy:');
      const checkoutSnippet = indexHtml
        .slice(checkoutStart)
        .match(/<script>([\s\S]*?)<\/script>/)?.[1];
      if (!checkoutSnippet) throw new Error('Missing checkout privacy script');
      new Function('window', 'location', checkoutSnippet)(window, {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      });
      expect(target['__datatugCheckoutPrivacy']).toBe(true);

      const gaSnippet = indexHtml
        .slice(indexHtml.indexOf('<!-- Google Analytics'))
        .match(/<script>([\s\S]*?)<\/script>/)?.[1];
      if (!gaSnippet) throw new Error('Missing GA loader');
      const append = vi.fn();
      new Function('window', 'location', 'document', gaSnippet)(
        window,
        { hostname: 'datatug.app', pathname: location.pathname, origin: 'https://datatug.app' },
        { head: { appendChild: append } },
      );
      expect(append).not.toHaveBeenCalled();
      registerPosthog({ token: 'fixture' });
      expect(sdk.init).not.toHaveBeenCalled();
    } finally {
      for (const key of [
        '__datatugCheckoutPrivacy',
        '__datatugOptionalTrackingDisabled',
        'ga-disable-G-DESWRP39RY',
        'ga-disable-G-SNF2R7PDY7',
        'ga-disable-G-TYBDTV738R',
        'ga-disable-G-PROVIDE_IF_NEEDED',
      ]) {
        if (saved[key] === undefined) delete target[key];
        else target[key] = saved[key];
      }
      history.replaceState(null, '', previous);
    }
  },
);

it.each(standardPaths)(
  'loads GA (G-DESWRP39RY) and initializes PostHog on standard route %s',
  (path) => {
    const previous = location.pathname + location.search + location.hash;
    const target = window as unknown as Record<string, unknown>;
    const saved = { ...target };
    sdk.init.mockClear();
    try {
      history.replaceState(null, '', path);
      const checkoutStart = indexHtml.indexOf('<!-- Checkout privacy:');
      const checkoutSnippet = indexHtml
        .slice(checkoutStart)
        .match(/<script>([\s\S]*?)<\/script>/)?.[1];
      if (!checkoutSnippet) throw new Error('Missing checkout privacy script');
      new Function('window', 'location', checkoutSnippet)(window, {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      });
      expect(target['__datatugCheckoutPrivacy']).toBeUndefined();

      const gaSnippet = indexHtml
        .slice(indexHtml.indexOf('<!-- Google Analytics'))
        .match(/<script>([\s\S]*?)<\/script>/)?.[1];
      if (!gaSnippet) throw new Error('Missing GA loader');
      let appendedElement: { src?: string } | null = null;
      const append = vi.fn((el) => {
        appendedElement = el;
      });
      new Function('window', 'location', 'document', gaSnippet)(
        window,
        { hostname: 'datatug.app', pathname: location.pathname, origin: 'https://datatug.app' },
        { head: { appendChild: append }, createElement: () => ({}) },
      );
      expect(append).toHaveBeenCalled();
      expect(appendedElement?.src).toContain('G-DESWRP39RY');

      if (production.posthog) {
        registerPosthog(production.posthog);
        expect(sdk.init).toHaveBeenCalledWith(
          production.posthog.token,
          expect.objectContaining({ api_host: 'https://eu.i.posthog.com' }),
        );
      }
    } finally {
      for (const key of [
        '__datatugCheckoutPrivacy',
        '__datatugOptionalTrackingDisabled',
        'ga-disable-G-DESWRP39RY',
        'ga-disable-G-SNF2R7PDY7',
        'ga-disable-G-TYBDTV738R',
        'ga-disable-G-PROVIDE_IF_NEEDED',
      ]) {
        if (saved[key] === undefined) delete target[key];
        else target[key] = saved[key];
      }
      history.replaceState(null, '', previous);
    }
  },
);

it('keeps PostHog and GA for DataTug while stripping shared Sneat Firebase analytics measurementId', () => {
  const config = withoutDataTugTracking(production, {
    hostname: 'datatug.app',
    queryProfile: 'incidentius',
  });
  expect(config.firebaseConfig).toEqual({
    ...production.firebaseConfig,
    measurementId: undefined,
  });
  expect(config.sentry).toBe(production.sentry);
  expect(config.posthog).toEqual(production.posthog);
  expect(config.googleAnalytics).toEqual(production.googleAnalytics);
  expect(production.firebaseConfig.measurementId).toBe('G-TYBDTV738R');
  expect(production.googleAnalytics?.measurementId).toBe('G-DESWRP39RY');
  expect(production.posthog?.token).toBe(
    'phc_YBZyRpV92s1kC0D4vYjEQiWhVjK7U9vfyi9vh2jfbsD',
  );

  const firebase = vi.fn(() => {
    throw new Error('Firebase Analytics initialized');
  });
  TestBed.configureTestingModule({
    providers: [
      provideSneatAnalytics(config),
      { provide: ErrorLogger, useValue: { logError: vi.fn() } },
      { provide: SNEAT_FIREBASE_ANALYTICS, useFactory: firebase },
    ],
  });
  const analytics = TestBed.inject(AnalyticsService);
  analytics.logEvent('$pageview', {
    page_path: '/project/github.com/datatug/demo',
  });
  expect(firebase).not.toHaveBeenCalled();

  // The same sanitized object reaches auth/Firebase, analytics and EnvConfig consumers.
  expect(mainSource).toContain('withoutDataTugTracking(environmentConfig');
  expect(mainSource).toContain(
    'provideSneatAuthenticatedProviders(datatugAppEnvironmentConfig)',
  );
  expect(mainSource).toContain(
    'provideSneatAnalytics(datatugAppEnvironmentConfig)',
  );
  expect(mainSource).toContain('useValue: datatugAppEnvironmentConfig');
});

it.each([
  { hostname: 'app.incidentius.com' },
  { hostname: 'localhost', queryProfile: 'incidentius' },
])(
  'preserves the other product configuration for %j',
  (profile) => {
    expect(withoutDataTugTracking(production, profile)).toBe(production);
  },
);
