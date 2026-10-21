import { Provider } from '@angular/core';
import { IEnvironmentConfig } from '@sneat/core';
import {
  DatatugApiBaseUrl,
  PUBLIC_OVDB_DEV_TRANSPORT,
  PUBLIC_OVDB_LOOPBACK_MODE,
} from '@sneat/datatug-semantic';
import {
  TEST_CHECKOUT_ORIGIN,
  TEST_PREVIEW_PROJECT_ORIGIN,
} from '../app/checkout/checkout-config.mjs';
import { datatugAppEnvironmentConfig as productionConfig } from './environment.prod';
import { DATATUG_CHECKOUT_FORCE_TEST } from '../app/checkout/checkout-force-test';

// Business project preview on http://localhost:18782 (serve configuration
// `business-preview` in apps/datatug-app/project.json). DataTug API calls go
// to datatug-cloud-preview; public OVDB reads use the existing closed loopback
// proxy paired with this serve configuration. SneatApiBaseUrl keeps its normal value.

// Business checkout is TEST only in this build. Production's LIVE arm is not
// re-exported: the origin is null and LIVE is off.
export const datatugBusinessCheckoutApiOrigin: string | null =
  TEST_CHECKOUT_ORIGIN;
export const datatugBusinessCheckoutLiveApiOrigin: string | null = null;
export const datatugBusinessCheckoutLiveEnabled = false;

// A local preview sends no analytics.
export const datatugGoogleAnalyticsMeasurementId: string | undefined =
  undefined;
export { datatugDemoConfig } from './environment.prod';

// The production Firebase project, so the preview accepts the same ID tokens
// as datatug-cloud-preview. No PostHog or Sentry: a local preview must not
// send telemetry to the production projects, as the development build does not.
// No `useNgrok` and no `firebaseConfig.emulator`, so main.ts keeps
// SneatApiBaseUrl at its normal value.
export const datatugAppEnvironmentConfig: IEnvironmentConfig & {
  hostedCloudLogsEnabled: boolean;
} = {
  hostedCloudLogsEnabled: false,
  production: false,
  agents: {},
  firebaseConfig: productionConfig.firebaseConfig,
};

export const datatugEnvironmentProviders: Provider[] = [
  { provide: PUBLIC_OVDB_DEV_TRANSPORT, useValue: PUBLIC_OVDB_LOOPBACK_MODE },
  {
    provide: DatatugApiBaseUrl,
    useValue: `${TEST_PREVIEW_PROJECT_ORIGIN}/v0/`,
  },
  // Every checkout rail, Pro and Business, selects TEST in this build.
  { provide: DATATUG_CHECKOUT_FORCE_TEST, useValue: true },
];
