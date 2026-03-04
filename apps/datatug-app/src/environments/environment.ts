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
    authDomain: 'sneat.app',
    projectId: 'demo-local-sneat-app',
    appId: 'emulator-does-not-need-app-id',
    measurementId: 'G-PROVIDE_IF_NEEDED',
  },
};
