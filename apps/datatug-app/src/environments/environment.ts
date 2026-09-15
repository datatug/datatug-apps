import { IEnvironmentConfig, IFirebaseEmulatorConfig } from '@sneat/core';

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
  firestorePort: useSSL ? 443 : 8080,
  firestoreHost: useNgrok
    ? window.location.hostname
    : useSSL
      ? 'local-firestore.sneat.ws'
      : nonSecureEmulatorHost,
};

export const datatugAppEnvironmentConfig: IEnvironmentConfig = {
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
