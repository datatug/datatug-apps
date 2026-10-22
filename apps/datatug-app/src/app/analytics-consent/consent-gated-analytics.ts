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
 * The shared `AnalyticsService` of DataTug behind the visitor's analytics consent, and anonymous. Until `granted()`,
 * nothing is created and every call is dropped, not queued: an event raised before consent is never sent later.
 * The backends are created on the first call made with consent. Usage analytics are never linked to a signed-in
 * identity (public-demo REQ:demo-usage-analytics): `identify` (Sneat calls it on every sign-in) is never forwarded,
 * and neither is `setCurrentScreen`; only events go through, and PostHog's `before_send` keeps the closed list.
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
    identify: () => undefined,
    setCurrentScreen: () => undefined,
    // Forgetting is always allowed (a fresh anonymous id), and only meaningful for backends that were started.
    loggedOut: () => inner?.loggedOut(),
  };
}

/**
 * Wraps `provideSneatAnalytics(...)` so that its backends start only with consent, and only once `ready()` (PostHog
 * started by register-posthog.ts with the app's settings), so that Sneat's own PostHog loader never is the first to
 * call `posthog.init`.
 */
export function provideConsentGatedAnalytics(
  sneatAnalytics: Provider,
  ready: () => boolean = () => true,
): Provider {
  const original = sneatAnalytics as FactoryProvider;
  return {
    provide: AnalyticsService,
    deps: [ANALYTICS_CONSENT, Injector],
    useFactory: (consent: AnalyticsConsent, injector: Injector) =>
      consentGatedAnalytics(
        () => consent.granted() && ready(),
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
