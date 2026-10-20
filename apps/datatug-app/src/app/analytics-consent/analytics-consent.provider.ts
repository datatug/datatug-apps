import { inject, provideAppInitializer } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { checkoutPrivacyActive } from '../checkout/checkout-privacy-state';
import { createAnalyticsConsent, type AnalyticsEnv } from './analytics-consent';
import { mountAnalyticsConsentBanner } from './analytics-consent-banner';

export function browserAnalyticsEnv(win: Window = window): AnalyticsEnv {
  return {
    storage: () => win.localStorage,
    location: () => win.location,
    checkoutActive: checkoutPrivacyActive,
    window: win as unknown as AnalyticsEnv['window'],
    document: win.document,
  };
}

/**
 * Starts Google Analytics behind the visitor's consent. `measurementId` is undefined where there is nothing to
 * measure (development builds, the Incidentius profile): nothing is shown or loaded then. After the router exists,
 * so that the first NavigationEnd is seen and every later one is a page view.
 */
export function provideAnalyticsConsent(measurementId: string | undefined) {
  return provideAppInitializer(() => {
    const router = inject(Router);
    const consent = createAnalyticsConsent(
      browserAnalyticsEnv(),
      measurementId,
    );
    consent.start();
    mountAnalyticsConsentBanner(consent, document, window);
    router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) consent.pageView();
    });
  });
}
