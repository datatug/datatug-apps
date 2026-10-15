import { IPosthogSettings } from '@sneat/core';
import posthog from 'posthog-js';
import {
  checkoutPrivacyActive,
  isCheckoutAddress,
} from './app/checkout/checkout-privacy-state';
import { isLinkRoute, onLinkRoute, scrubDeep } from './app/telemetry/link-privacy';

let initialized = false;
/** The autocapture and recording settings PostHog was started with, restored when a link route is left. */
let initialAutocapture: unknown = true;
/** Whether a link route turned autocapture and recording off. */
let linkPrivacyActive = false;

type PosthogEvent = { event: string; properties: Record<string, unknown> };

/** Autocapture properties that hold element text or markup. */
const ELEMENT_TEXT_PROPERTIES = ['$elements', '$elements_chain', '$el_text'];

/**
 * REQ:ui-no-context-telemetry (Feature claude-mod-web-links): every event loses address fragments (the one-time
 * code, the record key); on a table, view, records or record page also the address query and any element text, and
 * an autocapture event is dropped there altogether.
 */
export function scrubPosthogEvent<T extends PosthogEvent | null>(event: T): T | null {
  if (!event) return event;
  const dropQuery = onLinkRoute();
  if (dropQuery && event.event === '$autocapture') return null;
  const scrubbed = scrubDeep(event, dropQuery);
  if (dropQuery && scrubbed.properties) {
    for (const key of ELEMENT_TEXT_PROPERTIES) delete scrubbed.properties[key];
  }
  return scrubbed;
}

export function registerPosthog(settings: IPosthogSettings): void {
  if (
    (window as unknown as Record<string, unknown>)[
      '__datatugOptionalTrackingDisabled'
    ] === true ||
    checkoutPrivacyActive() ||
    isCheckoutAddress(location.pathname + location.hash)
  )
    return;
  const beforeSend = settings.config?.before_send;
  initialAutocapture = settings.config?.autocapture ?? true;
  const coldLinkRoute = isLinkRoute(location.pathname);
  linkPrivacyActive = coldLinkRoute;
  posthog.init(settings.token, {
    ...settings.config,
    capture_pageview: false,
    ...(coldLinkRoute
      ? { autocapture: false, disable_session_recording: true }
      : {}),
    before_send: (raw) => {
      if (checkoutPrivacyActive()) return null;
      const event = scrubPosthogEvent(raw);
      if (!event) return null;
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

/**
 * Per-route privacy for the pages a card's link opens (REQ:ui-no-context-telemetry): entering a table, view,
 * records or record page turns autocapture and session recording off; leaving it restores autocapture as PostHog was
 * started with. Unlike {@link stopPosthogForCheckout} this is not one-way, and it never undoes the checkout switch.
 */
export function applyPosthogRoutePrivacy(pathname: string): void {
  if (!initialized) return;
  const linkRoute = isLinkRoute(pathname);
  if (linkRoute === linkPrivacyActive) return;
  linkPrivacyActive = linkRoute;
  if (linkRoute) {
    posthog.stopSessionRecording();
    posthog.set_config({ autocapture: false, disable_session_recording: true });
    return;
  }
  if (checkoutPrivacyActive()) return;
  // Recording is not restarted: no environment of this app records sessions (the navigation-timing guard in
  // demo-handoff-navigation-timing.spec.ts keeps it so), and a stopped recording stays stopped for this document.
  // With recording off, PostHog captures no request to a loopback agent on any page.
  posthog.set_config({ autocapture: initialAutocapture as boolean });
}
