import { InjectionToken } from '@angular/core';
/** One document lifetime; never storage, telemetry, router state or an authenticated transport. */
export const POSTMORTEM_SHARE_TOKEN = new InjectionToken<string>(
  'public report capability',
);
