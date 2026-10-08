import { IPosthogSettings } from '@sneat/core';
import posthog from 'posthog-js';
import {
  checkoutPrivacyActive,
  isCheckoutAddress,
} from './app/checkout/checkout-privacy-state';

let initialized = false;

export function registerPosthog(settings: IPosthogSettings): void {
  if (checkoutPrivacyActive() || isCheckoutAddress(location.pathname)) return;
  const beforeSend = settings.config?.before_send;
  posthog.init(settings.token, {
    ...settings.config,
    capture_pageview: false,
    before_send: (event) => {
      if (checkoutPrivacyActive()) return null;
      if (typeof beforeSend === 'function') return beforeSend(event);
      if (Array.isArray(beforeSend)) {
        let next: typeof event | null = event;
        for (const transform of beforeSend) {
          if (!next) break;
          next = transform(next);
        }
        return next;
      }
      return event;
    },
  });
  initialized = true;
}

/** Stop recording and drop captures before checkout history changes; no persisted opt-out. */
export function stopPosthogForCheckout(): void {
  if (!initialized) return;
  posthog.stopSessionRecording();
  posthog.set_config({
    autocapture: false,
    disable_session_recording: true,
    capture_pageview: false,
  });
}
