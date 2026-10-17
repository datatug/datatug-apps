import { Provider } from '@angular/core';
import { IEnvironmentConfig } from '@sneat/core';
import { DatatugApiBaseUrl } from '@sneat/datatug-semantic';
import {
  TEST_CHECKOUT_ORIGIN,
  TEST_PREVIEW_PROJECT_ORIGIN,
} from '../app/checkout/checkout-config.mjs';
import { datatugAppEnvironmentConfig as productionConfig } from './environment.prod';

// Business project preview on http://localhost:18782 (serve configuration
// `business-preview` in apps/datatug-app/project.json). Only DataTug API calls
// move: they go to datatug-cloud-preview. SneatApiBaseUrl is not provided here,
// so it keeps its normal value.

// Business checkout is TEST only in this build. Production's LIVE arm is not
// re-exported: the origin is null and LIVE is off.
export const datatugBusinessCheckoutApiOrigin: string | null =
  TEST_CHECKOUT_ORIGIN;
export const datatugBusinessCheckoutLiveApiOrigin: string | null = null;
export const datatugBusinessCheckoutLiveEnabled = false;
export { datatugDemoConfig } from './environment.prod';

// The production Firebase project, so the preview accepts the same ID tokens
// as datatug-cloud-preview. No PostHog or Sentry: a local preview must not
// send telemetry to the production projects, as the development build does not.
// No `useNgrok` and no `firebaseConfig.emulator`, so main.ts keeps
// SneatApiBaseUrl at its normal value.
export const datatugAppEnvironmentConfig: IEnvironmentConfig = {
  production: false,
  agents: {},
  firebaseConfig: productionConfig.firebaseConfig,
};

export const datatugEnvironmentProviders: Provider[] = [
  {
    provide: DatatugApiBaseUrl,
    useValue: `${TEST_PREVIEW_PROJECT_ORIGIN}/v0/`,
  },
];
