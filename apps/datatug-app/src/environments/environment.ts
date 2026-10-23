import { Provider } from '@angular/core';
import {
  PUBLIC_OVDB_DEV_TRANSPORT,
  PUBLIC_OVDB_LOOPBACK_MODE,
} from '@sneat/datatug-semantic';
import {
  IPosthogSettings,
  IEnvironmentConfig,
  IFirebaseEmulatorConfig,
} from '@sneat/core';
import type { DatatugDemoConfig } from './demo-config';

export const datatugBusinessCheckoutApiOrigin: string | null = null;
export const datatugBusinessCheckoutLiveApiOrigin: string | null = null;
export const datatugBusinessCheckoutLiveEnabled = false;

// No analytics in a development or end-to-end build.
export const datatugGoogleAnalyticsMeasurementId: string | undefined =
  undefined;

// No anonymous usage analytics (PostHog) in a development or end-to-end build.
export const datatugUsagePosthog: IPosthogSettings | undefined = undefined;

const useNgrok = window.location.hostname.includes('.ngrok.');
const useSSL = useNgrok || window.location.hostname == 'local-app.sneat.ws';
const nonSecureEmulatorHost = '127.0.0.1';

const emulator: IFirebaseEmulatorConfig = {
  authPort: useSSL ? 443 : 9099,
  authHost: useNgrok
    ? window.location.hostname
    : useSSL
      ? 'local-fb-auth.sneat.ws'
      : nonSecureEmulatorHost,
  // Keep the DataTug local stack separate from the shared DALgo emulator on 8080.
  firestorePort: useSSL ? 443 : 8180,
  firestoreHost: useNgrok
    ? window.location.hostname
    : useSSL
      ? 'local-firestore.sneat.ws'
      : nonSecureEmulatorHost,
};

export const datatugAppEnvironmentConfig: IEnvironmentConfig & {
  hostedCloudLogsEnabled: boolean;
} = {
  hostedCloudLogsEnabled: true,
  production: false,
  useNgrok,
  agents: {},
  firebaseConfig: {
    emulator,
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

// Development: the demo is on, so that its behaviours can be built and tried locally. This file is never
// deployed: every build that ships replaces it (production: environment.prod.ts, SSO e2e: environment.sso-e2e.ts).
export const datatugDemoConfig: DatatugDemoConfig = {
  enabled: true,
};

// No DataTug API override: DataTug calls use SneatApiBaseUrl, as before.
// The Business project preview build replaces this file (environment.business-preview.ts).
export const datatugEnvironmentProviders: Provider[] = [
  { provide: PUBLIC_OVDB_DEV_TRANSPORT, useValue: PUBLIC_OVDB_LOOPBACK_MODE },
];
