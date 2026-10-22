import {
  Injector,
  runInInjectionContext,
  type FactoryProvider,
  type Provider,
} from '@angular/core';
import type { IPosthogSettings } from '@sneat/core';
import { AnalyticsService, type IAnalyticsService } from '@sneat/core';
import type { AnalyticsConsent } from './analytics-consent';
import { ANALYTICS_CONSENT } from './analytics-consent.token';

/**
 * The shared `AnalyticsService` (PostHog and, where configured, Firebase Analytics) behind the visitor's analytics
 * consent. Until the visitor accepts, nothing is created and every call is dropped, not queued: an event raised
 * before consent is never sent later. The backends are created on the first call made with consent.
 */
export function consentGatedAnalytics(
  granted: () => boolean,
  create: () => IAnalyticsService,
): IAnalyticsService {
  let inner: IAnalyticsService | undefined;
  const live = () => (granted() ? (inner ??= create()) : undefined);
  return {
    logEvent: (name, params, options) =>
      live()?.logEvent(name, params, options),
    identify: (userID, set, setOnce) => live()?.identify(userID, set, setOnce),
    setCurrentScreen: (screen, options) =>
      live()?.setCurrentScreen(screen, options),
    // Forgetting an identity is always allowed, and only meaningful for backends that were started.
    loggedOut: () => inner?.loggedOut(),
  };
}

/** Wraps `provideSneatAnalytics(...)` so that its backends start only with consent. */
export function provideConsentGatedAnalytics(
  sneatAnalytics: Provider,
): Provider {
  const original = sneatAnalytics as FactoryProvider;
  return {
    provide: AnalyticsService,
    deps: [ANALYTICS_CONSENT, Injector],
    useFactory: (consent: AnalyticsConsent, injector: Injector) =>
      consentGatedAnalytics(
        () => consent.granted(),
        () =>
          runInInjectionContext(injector, () =>
            original.useFactory(
              ...(original.deps ?? []).map((dep) => injector.get(dep)),
            ),
          ),
      ),
  };
}

/** What following the consent needs of PostHog; `register-posthog.ts` supplies it. */
export interface PosthogConsentClient {
  start(settings: IPosthogSettings): void;
  started(): boolean;
  pause(): void;
  resume(): void;
}

/**
 * PostHog (autocapture and session recording included) runs only while the visitor has accepted analytics: no
 * consent, no PostHog at all. A grant starts it, a withdrawal opts it out for this document, a new grant opts it in.
 * Returns the unsubscribe function.
 */
export function followConsentForPosthog(
  consent: AnalyticsConsent,
  settings: IPosthogSettings | undefined,
  client: PosthogConsentClient,
): () => void {
  if (!settings) return () => undefined;
  let applied: boolean | undefined;
  const apply = () => {
    const granted = consent.granted();
    if (granted === applied) return;
    applied = granted;
    if (granted) {
      if (!client.started()) client.start(settings);
      client.resume();
    } else if (client.started()) client.pause();
  };
  const unsubscribe = consent.subscribe(apply);
  apply();
  return unsubscribe;
}
