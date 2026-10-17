import { InjectionToken, inject } from '@angular/core';
import { DefaultSneatAppApiBaseUrl, SneatApiBaseUrl } from '@sneat/api';

/**
 * Base URL of the DataTug API (`datatug/*` endpoints). It only mirrors
 * `SneatApiBaseUrl`: the same origin as today, unless a build provides a
 * different one (the Business project preview serve configuration does).
 *
 * It lives in this library, not in datatug-main, because the app's environment
 * files provide it and those are imported eagerly, while datatug-main is lazy.
 */
export const DatatugApiBaseUrl = new InjectionToken<string>(
  'DatatugApiBaseUrl',
  {
    providedIn: 'root',
    factory: () =>
      inject(SneatApiBaseUrl, { optional: true }) ?? DefaultSneatAppApiBaseUrl,
  },
);
