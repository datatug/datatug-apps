import { IEnvironmentConfig } from '@sneat/core';

export const datatugAppEnvironmentConfig: IEnvironmentConfig = {
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
