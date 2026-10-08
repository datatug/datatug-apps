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

const paths = [
  '/',
  '/project/github.com/datatug/demo',
  '/subscribe?checkout=test',
  '/pricing/return?session_id=cs_test_paid',
  '/login',
  '/login#/pricing/return?session_id=cs_test_paid',
];

it.each(paths)(
  'does not load GA or start PostHog at %s, including after navigation',
  (path) => {
    const previous = location.pathname + location.search + location.hash;
    const target = window as unknown as Record<string, unknown>;
    const saved = { ...target };
    sdk.init.mockClear();
    try {
      history.replaceState(null, '', path);
      const start = indexHtml.indexOf('<!-- DataTug launch:');
      const snippet = indexHtml
        .slice(start)
        .match(/<script>([\s\S]*?)<\/script>/)?.[1];
      if (!snippet) throw new Error('Missing launch privacy script');
      new Function('window', 'location', snippet)(window, {
        hostname: 'datatug.app',
        search: location.search,
      });
      const gaSnippet = indexHtml
        .slice(indexHtml.indexOf('<!-- Google Analytics'))
        .match(/<script>([\s\S]*?)<\/script>/)?.[1];
      if (!gaSnippet) throw new Error('Missing GA loader');
      const append = vi.fn();
      new Function('window', 'location', 'document', gaSnippet)(
        window,
        { hostname: 'datatug.app' },
        { head: { appendChild: append } },
      );
      expect(append).not.toHaveBeenCalled();
      registerPosthog({ token: 'fixture' });
      history.replaceState(null, '', '/project/github.com/datatug/demo');
      registerPosthog({ token: 'fixture' });
      expect(sdk.init).not.toHaveBeenCalled();
    } finally {
      for (const key of [
        '__datatugOptionalTrackingDisabled',
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

it('keeps identity, storage and diagnostics config while the actual analytics factory has no providers to capture events', () => {
  const config = withoutDataTugTracking(production, {
    hostname: 'datatug.app',
    queryProfile: 'incidentius',
  });
  expect(config.firebaseConfig).toEqual({
    ...production.firebaseConfig,
    measurementId: undefined,
  });
  expect(config.sentry).toBe(production.sentry);
  expect(config.posthog).toBeUndefined();
  expect(config.googleAnalytics).toBeUndefined();
  expect(production.firebaseConfig.measurementId).toBe('G-TYBDTV738R');
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
    page_path: '/pricing/return?session_id=cs_test_paid',
  });
  expect(firebase).not.toHaveBeenCalled();
  expect(sdk.init).not.toHaveBeenCalled();
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
  'preserves the other product configuration and early script choice for %j',
  (profile) => {
    expect(withoutDataTugTracking(production, profile)).toBe(production);
    const target = {};
    const snippet = indexHtml
      .slice(indexHtml.indexOf('<!-- DataTug launch:'))
      .match(/<script>([\s\S]*?)<\/script>/)?.[1];
    if (!snippet) throw new Error('Missing launch privacy script');
    new Function('window', 'location', snippet)(target, {
      hostname: profile.hostname,
      search: profile.queryProfile ? '?profile=' + profile.queryProfile : '',
    });
    expect(target).toEqual({});
  },
);
