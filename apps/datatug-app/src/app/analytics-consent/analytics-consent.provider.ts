import {
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import type { IPosthogSettings } from '@sneat/core';
import {
  pausePosthogForConsent,
  posthogStarted,
  registerPosthog,
  resumePosthogForConsent,
} from '../../register-posthog';
import { ANALYTICS_CONSENT } from './analytics-consent.token';
import {
  followConsentForPosthog,
  type PosthogConsentClient,
} from './consent-gated-analytics';
import { NavigationEnd, Router } from '@angular/router';
import { checkoutPrivacyActive } from '../checkout/checkout-privacy-state';
import {
  createAnalyticsConsent,
  withUsageConsent,
  type AnalyticsEnv,
} from './analytics-consent';
import {
  bannerText,
  mountAnalyticsConsentBanner,
} from './analytics-consent-banner';

export function browserAnalyticsEnv(win: Window = window): AnalyticsEnv {
  return {
    storage: () => win.localStorage,
    location: () => win.location,
    checkoutActive: checkoutPrivacyActive,
    window: win as unknown as AnalyticsEnv['window'],
    document: win.document,
  };
}

export const POSTHOG_CONSENT_CLIENT: PosthogConsentClient = {
  start: registerPosthog,
  started: posthogStarted,
  pause: pausePosthogForConsent,
  resume: resumePosthogForConsent,
};

/**
 * Starts Google Analytics behind the visitor's consent. `measurementId` is undefined where there is nothing to
 * measure (development builds, the Incidentius profile): nothing is shown or loaded then. After the router exists,
 * so that the first NavigationEnd is seen and every later one is a page view. PostHog follows the same choice: it
 * starts only after the visitor accepts, and stops capturing when they withdraw.
 */
export function provideAnalyticsConsent(
  measurementId: string | undefined,
  posthog?: IPosthogSettings,
  posthogClient: PosthogConsentClient = POSTHOG_CONSENT_CLIENT,
) {
  return makeEnvironmentProviders([
    {
      provide: ANALYTICS_CONSENT,
      // PostHog never follows the site's Google Analytics key: it has its own (withUsageConsent).
      useFactory: () => {
        const env = browserAnalyticsEnv();
        return withUsageConsent(
          createAnalyticsConsent(env, measurementId),
          env,
          !!posthog,
        );
      },
    },
    provideAppInitializer(() => {
      const router = inject(Router);
      const consent = inject(ANALYTICS_CONSENT);
      consent.start();
      followConsentForPosthog(consent, posthog, posthogClient);
      mountAnalyticsConsentBanner(
        consent,
        document,
        window,
        bannerText(!!posthog),
      );
      router.events.subscribe((event) => {
        if (event instanceof NavigationEnd) consent.pageView();
      });
    }),
  ]);
}
