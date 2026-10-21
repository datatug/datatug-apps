import { Provider } from '@angular/core';
import { IEnvironmentConfig } from '@sneat/core';
import type { DatatugDemoConfig } from './demo-config';

export const datatugBusinessCheckoutApiOrigin: string | null = null;
export const datatugBusinessCheckoutLiveApiOrigin: string | null = null;
export const datatugBusinessCheckoutLiveEnabled = false;

// No analytics in a development or end-to-end build.
export const datatugGoogleAnalyticsMeasurementId: string | undefined =
  undefined;

export const datatugAppEnvironmentConfig: IEnvironmentConfig & {
  hostedCloudLogsEnabled: boolean;
} = {
  hostedCloudLogsEnabled: true,
  production: false,
  useNgrok: false,
  agents: {},
  firebaseConfig: {
    emulator: {
      authHost: '127.0.0.1',
      authPort: 9099,
      firestoreHost: '127.0.0.1',
      firestorePort: 8180,
    },
    apiKey: 'emulator-does-not-need-api-key',
    // The shared, Firebase-hosted auth domain every Sneat product uses: it
    // serves Google/GitHub OAuth's /__/auth/handler, which a Cloudflare-served
    // app does NOT serve itself. Matches @sneat/app's SHARED_SNEAT_AUTH_DOMAIN
    // (and the GitHub OAuth app's registered callback).
    authDomain: 'auth.sneat.co',
    projectId: 'demo-local-sneat-app',
    appId: 'emulator-does-not-need-app-id',
    measurementId: 'G-PROVIDE_IF_NEEDED',
  },
};

// The SSO end-to-end build does not exercise the demo, and it is not the demo's own end-to-end build (that one
// serves the development configuration): OFF.
export const datatugDemoConfig: DatatugDemoConfig = {
  enabled: false,
};

// No DataTug API override: DataTug calls use SneatApiBaseUrl, as before.
// The Business project preview build replaces this file (environment.business-preview.ts).
export const datatugEnvironmentProviders: Provider[] = [];
