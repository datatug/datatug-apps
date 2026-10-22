import {
  inject,
  InjectionToken,
  provideZonelessChangeDetection,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AnalyticsService, type IAnalyticsService } from '@sneat/core';
import type { AnalyticsConsent } from './analytics-consent';
import { ANALYTICS_CONSENT } from './analytics-consent.token';
import {
  consentGatedAnalytics,
  followConsentForPosthog,
  provideConsentGatedAnalytics,
  type PosthogConsentClient,
} from './consent-gated-analytics';

function backend(): IAnalyticsService &
  Record<string, ReturnType<typeof vi.fn>> {
  return {
    logEvent: vi.fn(),
    identify: vi.fn(),
    setCurrentScreen: vi.fn(),
    loggedOut: vi.fn(),
  };
}

function fakeConsent(initial = false) {
  let granted = initial;
  const listeners = new Set<() => void>();
  const consent = {
    granted: () => granted,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  } as unknown as AnalyticsConsent;
  return {
    consent,
    set(value: boolean) {
      granted = value;
      for (const listener of [...listeners]) listener();
    },
    listeners,
  };
}

describe('consentGatedAnalytics', () => {
  it('creates nothing and drops every call until consent, then forwards without replaying earlier events', () => {
    let granted = false;
    const inner = backend();
    const create = vi.fn(() => inner);
    const analytics = consentGatedAnalytics(() => granted, create);
    analytics.logEvent('walkthrough_chapter_entered', { chapter_id: 'find' });
    analytics.identify('u1');
    analytics.setCurrentScreen('home');
    analytics.loggedOut();
    expect(create).not.toHaveBeenCalled();
    granted = true;
    analytics.logEvent('walkthrough_chapter_completed', { chapter_id: 'find' });
    analytics.identify('u1', { a: 1 }, { b: 2 });
    analytics.setCurrentScreen('home', { global: true });
    analytics.loggedOut();
    expect(create).toHaveBeenCalledOnce();
    expect(inner.logEvent.mock.calls).toEqual([
      ['walkthrough_chapter_completed', { chapter_id: 'find' }, undefined],
    ]);
    expect(inner.identify).toHaveBeenCalledWith('u1', { a: 1 }, { b: 2 });
    expect(inner.setCurrentScreen).toHaveBeenCalledWith('home', {
      global: true,
    });
    expect(inner.loggedOut).toHaveBeenCalledOnce();
    granted = false;
    analytics.logEvent('walkthrough_reset', {});
    analytics.loggedOut();
    expect(inner.logEvent).toHaveBeenCalledOnce();
    expect(inner.loggedOut).toHaveBeenCalledTimes(2);
  });
});

describe('provideConsentGatedAnalytics', () => {
  const DEP = new InjectionToken<string>('dep');
  afterEach(() => TestBed.resetTestingModule());

  it('builds the original backends lazily, in an injection context, with their own deps', () => {
    const consent = fakeConsent();
    const inner = backend();
    const factory = vi.fn((dep: string) => {
      expect(inject(DEP)).toBe(dep);
      return inner;
    });
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: DEP, useValue: 'dep-value' },
        { provide: ANALYTICS_CONSENT, useValue: consent.consent },
        provideConsentGatedAnalytics({
          provide: AnalyticsService,
          deps: [DEP],
          useFactory: factory,
        }),
      ],
    });
    const analytics = TestBed.inject(AnalyticsService);
    analytics.logEvent('signin_prompted', { reason: 'evidence-link' });
    expect(factory).not.toHaveBeenCalled();
    consent.set(true);
    analytics.logEvent('signin_completed', { reason: 'evidence-link' });
    expect(factory).toHaveBeenCalledWith('dep-value');
    expect(inner.logEvent).toHaveBeenCalledWith(
      'signin_completed',
      { reason: 'evidence-link' },
      undefined,
    );
  });

  it('accepts an original factory without deps', () => {
    const consent = fakeConsent(true);
    const inner = backend();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ANALYTICS_CONSENT, useValue: consent.consent },
        provideConsentGatedAnalytics({
          provide: AnalyticsService,
          useFactory: () => inner,
        }),
      ],
    });
    TestBed.inject(AnalyticsService).setCurrentScreen('x');
    expect(inner.setCurrentScreen).toHaveBeenCalledWith('x', undefined);
  });
});

describe('followConsentForPosthog', () => {
  function client(started = false) {
    const state = { started };
    const fake: PosthogConsentClient &
      Record<string, ReturnType<typeof vi.fn>> = {
      start: vi.fn(() => {
        state.started = true;
      }),
      started: vi.fn(() => state.started),
      pause: vi.fn(),
      resume: vi.fn(),
    };
    return fake;
  }
  const settings = { token: 'public-fixture' };

  it('does nothing at all without PostHog settings', () => {
    const consent = fakeConsent(true);
    const posthog = client();
    const stop = followConsentForPosthog(consent.consent, undefined, posthog);
    stop();
    expect(posthog.start).not.toHaveBeenCalled();
    expect(consent.listeners.size).toBe(0);
  });

  it('starts PostHog only after a grant, pauses on withdrawal and resumes on a new grant', () => {
    const consent = fakeConsent(false);
    const posthog = client();
    const stop = followConsentForPosthog(consent.consent, settings, posthog);
    expect(posthog.start).not.toHaveBeenCalled();
    expect(posthog.pause).not.toHaveBeenCalled();
    consent.set(true);
    consent.set(true);
    expect(posthog.start).toHaveBeenCalledExactlyOnceWith(settings);
    expect(posthog.resume).toHaveBeenCalledOnce();
    consent.set(false);
    expect(posthog.pause).toHaveBeenCalledOnce();
    consent.set(true);
    expect(posthog.start).toHaveBeenCalledOnce();
    expect(posthog.resume).toHaveBeenCalledTimes(2);
    stop();
    consent.set(false);
    expect(posthog.pause).toHaveBeenCalledOnce();
  });

  it('starts at once for a stored grant', () => {
    const posthog = client();
    followConsentForPosthog(fakeConsent(true).consent, settings, posthog);
    expect(posthog.start).toHaveBeenCalledOnce();
  });
});
