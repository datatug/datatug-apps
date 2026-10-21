import { inject, provideAppInitializer } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import type { IPosthogSettings } from '@sneat/core';
import {
  applyPosthogRoutePrivacy,
  scrubPosthogEvent,
} from '../../register-posthog';

/** Turns PostHog autocapture and recording off on every table, view, records and record page, and back on after. */
export function provideLinkTelemetryPrivacy() {
  return provideAppInitializer(() => {
    const router = inject(Router);
    router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        applyPosthogRoutePrivacy(event.url.split('#')[0]);
      }
    });
  });
}

/**
 * PostHog settings whose `before_send` scrubs every event first (see {@link scrubPosthogEvent}): the settings are
 * also handed to the shared analytics service, which may start PostHog without `registerPosthog()`.
 */
export function withPosthogLinkPrivacy(
  settings: IPosthogSettings,
): IPosthogSettings {
  const before = settings.config?.before_send;
  return {
    ...settings,
    config: {
      ...settings.config,
      before_send: (event) => {
        const scrubbed = scrubPosthogEvent(event);
        if (!scrubbed) return null;
        if (typeof before === 'function') return before(scrubbed);
        if (Array.isArray(before)) {
          let next: typeof scrubbed | null = scrubbed;
          for (const transform of before) {
            if (!next) break;
            next = transform(next);
          }
          return next;
        }
        return scrubbed;
      },
    },
  };
}
