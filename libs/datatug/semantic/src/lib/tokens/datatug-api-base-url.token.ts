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

/**
 * The DataTug API base URL of the dedicated TEST project preview
 * (datatug-cloud-preview, europe-west1). `DatatugApiService` compares the
 * injected `DatatugApiBaseUrl` with it to keep identity calls on the normal API.
 * The app's `TEST_PREVIEW_PROJECT_ORIGIN + '/v0/'` must equal it; a spec in the
 * app pins that, so the two cannot drift apart when the service moves.
 */
export const DATATUG_TEST_PREVIEW_API_BASE_URL =
  'https://datatug-cloud-preview-354fvnqbaa-ew.a.run.app/v0/';
