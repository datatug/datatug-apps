import { inject, provideAppInitializer } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { stopPosthogForCheckout } from '../../register-posthog';
import { disableCheckoutAnalytics } from './checkout-privacy-state';
export {
  CHECKOUT_GA_IDS,
  CHECKOUT_PRIVACY_FLAG,
  isCheckoutAddress,
  disableCheckoutAnalytics,
} from './checkout-privacy-state';

export function provideCheckoutAnalyticsPrivacy() {
  return provideAppInitializer(() => {
    const router = inject(Router);
    const target = window as unknown as Record<string, unknown>;
    disableCheckoutAnalytics(location.pathname + location.hash, target);
    router.events.subscribe((event) => {
      if (!(event instanceof NavigationStart)) return;
      disableCheckoutAnalytics(event.url, target);
      if (target['__datatugCheckoutPrivacy'] === true) stopPosthogForCheckout();
    });
  });
}
