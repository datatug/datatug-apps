import { TestBed } from '@angular/core/testing';
import {
  AnalyticsService,
  ErrorLogger,
  SNEAT_FIREBASE_ANALYTICS,
} from '@sneat/core';
import { provideSneatAnalytics } from '@sneat/logging';
import {
  datatugAppEnvironmentConfig as production,
  datatugGoogleAnalyticsMeasurementId,
} from './environments/environment.prod';
import { datatugGoogleAnalyticsMeasurementId as developmentMeasurementId } from './environments/environment';
import { datatugGoogleAnalyticsMeasurementId as previewMeasurementId } from './environments/environment.business-preview';
import { datatugGoogleAnalyticsMeasurementId as ssoMeasurementId } from './environments/environment.sso-e2e';
import {
  dataTugGoogleAnalyticsId,
  withoutDataTugTracking,
} from './launch-tracking';
import { registerPosthog } from './register-posthog';
import indexHtml from './index.html?raw';
import mainSource from './main.ts?raw';

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  stopSessionRecording: vi.fn(),
  set_config: vi.fn(),
}));
vi.mock('posthog-js', () => ({ default: sdk }));

// [path, is a checkout address]. DataTug's own GA property is only held back from a checkout address here: anywhere
// else it waits for the visitor's consent (app/analytics-consent), which the module's own spec covers.
const paths: [string, boolean][] = [
  ['/', false],
  ['/project/github.com/datatug/demo', false],
  ['/subscribe?checkout=test', true],
  ['/pricing/return?session_id=cs_test_paid', true],
  ['/login', false],
  ['/checkout/sign-in?plan=pro&period=monthly&checkout=test', true],
  ['/subscriptions?checkout=test', true],
  ['/subscriptions/billing_one?checkout=test', true],
  [
    '/subscriptions/billing_one/transfer?checkout=test&requestId=transfer_one',
    true,
  ],
  ['/sso?returnTo=%2Fsubscriptions%3Fcheckout%3Dtest', true],
  ['/login#/pricing/return?session_id=cs_test_paid', true],
];

it.each(paths)(
  'loads no Google tag on its own and starts no PostHog at %s, including after navigation',
  (path, checkout) => {
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
      const checkoutSnippet = indexHtml
        .slice(indexHtml.indexOf('<!-- Checkout privacy'))
        .match(/<script>([\s\S]*?)<\/script>/)?.[1];
      if (!checkoutSnippet) throw new Error('Missing checkout privacy script');
      new Function('window', 'location', checkoutSnippet)(window, location);
      expect(target['ga-disable-G-DESWRP39RY']).toBe(
        checkout ? true : undefined,
      );
      expect(target['ga-disable-G-SNF2R7PDY7']).toBe(true);
      expect(target['__datatugOptionalTrackingDisabled']).toBe(true);
      expect(append).not.toHaveBeenCalled();
      registerPosthog({ token: 'fixture' });
      history.replaceState(null, '', '/project/github.com/datatug/demo');
      registerPosthog({ token: 'fixture' });
      expect(sdk.init).not.toHaveBeenCalled();
    } finally {
      for (const key of [
        '__datatugOptionalTrackingDisabled',
        '__datatugCheckoutPrivacy',
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
  expect(mainSource).toMatch(/withoutDataTugTracking\(\s*environmentConfig,/);
  expect(mainSource).toContain(
    'provideSneatAuthenticatedProviders(datatugAppEnvironmentConfig)',
  );
  expect(mainSource).toContain(
    'provideSneatAnalytics(datatugAppEnvironmentConfig)',
  );
  expect(mainSource).toContain('useValue: datatugAppEnvironmentConfig');
});

describe('the DataTug measurement id for the consent banner', () => {
  it('is the DataTug property in the production build and absent from development builds', () => {
    expect(datatugGoogleAnalyticsMeasurementId).toBe('G-DESWRP39RY');
    expect(developmentMeasurementId).toBeUndefined();
    expect(previewMeasurementId).toBeUndefined();
    expect(ssoMeasurementId).toBeUndefined();
    // Never the Sneat property, which stays in the Firebase config only to be stripped.
    expect(datatugGoogleAnalyticsMeasurementId).not.toBe('G-TYBDTV738R');
  });

  it('is handed over for the DataTug profile only', () => {
    expect(
      dataTugGoogleAnalyticsId('G-DESWRP39RY', { hostname: 'datatug.app' }),
    ).toBe('G-DESWRP39RY');
    expect(
      dataTugGoogleAnalyticsId('G-DESWRP39RY', {
        hostname: 'app.incidentius.com',
      }),
    ).toBeUndefined();
    expect(
      dataTugGoogleAnalyticsId('G-DESWRP39RY', {
        hostname: 'localhost',
        queryProfile: 'incidentius',
      }),
    ).toBeUndefined();
  });

  it('is started from main.ts through the consent provider', () => {
    expect(mainSource).toContain('provideAnalyticsConsent(');
    expect(mainSource).toContain('datatugGoogleAnalyticsMeasurementId');
  });
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
