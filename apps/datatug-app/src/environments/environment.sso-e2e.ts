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
    authDomain: 'sneat.app',
    projectId: 'demo-local-sneat-app',
    appId: 'emulator-does-not-need-app-id',
    measurementId: 'G-PROVIDE_IF_NEEDED',
  },
};
