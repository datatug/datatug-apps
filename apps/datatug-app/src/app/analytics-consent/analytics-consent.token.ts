import { InjectionToken } from '@angular/core';
import type { AnalyticsConsent } from './analytics-consent';

/** This document's one analytics consent controller (`provideAnalyticsConsent`). */
export const ANALYTICS_CONSENT = new InjectionToken<AnalyticsConsent>(
  'analytics consent',
);
