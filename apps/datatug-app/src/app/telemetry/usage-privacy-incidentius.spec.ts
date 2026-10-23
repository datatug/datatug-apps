// PostHog keeps the `fetch` it finds when it is imported: the recorder must be in place first.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(url: unknown, init?: unknown) => Promise<Response>>(
    async () => new Response('{"status":1}', { status: 200 }),
  );
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
});
import {
  ApplicationInitStatus,
  provideZonelessChangeDetection,
  type FactoryProvider,
  type Injector,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideSneatAnalytics } from '@sneat/logging';
import type { IEnvironmentConfig } from '@sneat/core';
import posthog from 'posthog-js';
import { BANNER_TEXT_USAGE_ONLY } from '../analytics-consent/analytics-consent-banner';
import { provideAnalyticsConsent } from '../analytics-consent/analytics-consent.provider';
import { ANALYTICS_CONSENT } from '../analytics-consent/analytics-consent.token';
import { consentGatedAnalytics } from '../analytics-consent/consent-gated-analytics';
import {
  usageConsentKey,
  withAnonymousUsageTracking,
} from '../../launch-tracking';
import { posthogStarted } from '../../register-posthog';
import { withPosthogLinkPrivacy } from './link-telemetry-privacy';

/**
 * Founder 2026-10-22, "Fix incidentius": app.incidentius.com runs PostHog under the same constraints as DataTug, end to
 * end through the real SDK and the app's own consent provider: nothing on the network before a yes in its own banner,
 * a no keeps it off, no identify, and no campaign parameter, click id or user id in what is sent.
 */
const LANDING =
  'https://app.incidentius.com/incidents?utm_source=news-letter&utm_campaign=launch-oct&gclid=GCLID-123&fbclid=FBCLID-456';
const INCIDENTIUS = { hostname: 'app.incidentius.com', queryProfile: null };
const UID = 'firebase-uid-zz9';

async function wire(): Promise<string> {
  const out: string[] = [];
  for (const [url, init] of fetchMock.mock.calls) {
    out.push(String(url));
    const body = (init as RequestInit | undefined)?.body;
    if (typeof body === 'string') out.push(decodeURIComponent(body));
    else if (body instanceof Blob) out.push(await body.text());
  }
  return out.join('\n');
}

// Incidentius's configuration as main.ts builds it: its own (shared sneat.app) key, identified_only and a Firebase
// measurement id in the environment, all overridden.
const config = withAnonymousUsageTracking(
  {
    production: true,
    firebaseConfig: { projectId: 'p', measurementId: 'G-TYBDTV738R' },
    googleAnalytics: { measurementId: 'G-SHARED' },
    posthog: {
      token: 'phc_shared_test',
      config: {
        api_host: 'https://eu.i.posthog.com',
        person_profiles: 'identified_only',
        api_transport: 'fetch',
        request_batching: false,
        disable_compression: true,
        disable_external_dependency_loading: true, // happy-dom cannot load scripts
        opt_out_useragent_filter: true, // the test browser identifies as a bot
      },
    },
  } as unknown as IEnvironmentConfig,
  INCIDENTIUS,
  undefined,
);
const settings = config.posthog
  ? withPosthogLinkPrivacy(config.posthog)
  : undefined;

async function boot() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([{ path: '**', children: [] }]),
      provideAnalyticsConsent(undefined, settings, undefined, {
        usageConsentKey: usageConsentKey(INCIDENTIUS),
        bannerCopy: BANNER_TEXT_USAGE_ONLY,
      }),
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  return TestBed.inject(ANALYTICS_CONSENT);
}

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

describe('Incidentius analytics', () => {
  it('uses no shared GA or Firebase Analytics, and an anonymous PostHog with its own consent key', () => {
    expect(config.googleAnalytics).toBeUndefined();
    expect(config.firebaseConfig.measurementId).toBeUndefined();
    expect(config.posthog?.token).toBe('phc_shared_test');
    expect(config.posthog?.config).toMatchObject({
      person_profiles: 'never',
      autocapture: false,
      disable_session_recording: true,
      capture_pageleave: false,
      save_campaign_params: false,
      mask_personal_data_properties: true,
    });
    expect(usageConsentKey(INCIDENTIUS)).toBe(
      'incidentius.usage-analytics-consent.v1',
    );
  });

  it('sends nothing before a yes, nothing after a no, and only anonymous closed-list events after a yes', async () => {
    (
      window as unknown as { happyDOM?: { setURL(url: string): void } }
    ).happyDOM?.setURL(LANDING);
    localStorage.clear();

    // A no keeps it off.
    let consent = await boot();
    expect(document.body.textContent).toContain(BANNER_TEXT_USAGE_ONLY);
    expect(posthogStarted()).toBe(false);
    consent.choose('denied');
    expect(posthogStarted()).toBe(false);
    expect(localStorage.getItem('incidentius.usage-analytics-consent.v1')).toBe(
      'denied',
    );
    TestBed.resetTestingModule();
    consent = await boot();
    expect(consent.bannerVisible()).toBe(false);
    expect(posthogStarted()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    // No answer yet: still nothing.
    localStorage.clear();
    consent = await boot();
    expect(consent.bannerVisible()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    // A yes starts it; Sneat's identify on sign-in never reaches PostHog.
    consent.choose('granted');
    expect(posthogStarted()).toBe(true);
    const sneat = provideSneatAnalytics(config) as FactoryProvider;
    const analytics = consentGatedAnalytics(
      () => consent.granted() && posthogStarted(),
      () =>
        sneat.useFactory({ logError: vi.fn() }, {
          get: () => null,
        } as unknown as Injector),
    );
    analytics.identify(UID);
    analytics.logEvent('$pageview', { page_path: '/incidents?utm_source=x' });
    analytics.logEvent('act_page_viewed', {
      page: 'incidents',
      project: 'other',
    });
    posthog.identify(UID, { email: 'a@example.com' });
    await vi.waitFor(
      async () => expect(await wire()).toContain('act_page_viewed'),
      { timeout: 5000 },
    );
    const body = await wire();
    for (const secret of [
      UID,
      'a@example.com',
      'utm_',
      'news-letter',
      'gclid',
      'GCLID-123',
      'fbclid',
      'FBCLID-456',
      '$referrer',
    ])
      expect(body).not.toContain(secret);
    expect(body).not.toMatch(/"event":"\$identify"/u);
    expect(body).toContain('"$process_person_profile":false');
  });
});
