// Isolated local-only Firebase identities and Firestore data for the hosted Watch journey.
export * from './environment.sso-e2e';
import { datatugAppEnvironmentConfig as base } from './environment.sso-e2e';
import { DatatugApiBaseUrl } from '@sneat/datatug-semantic';
export const datatugAppEnvironmentConfig = {
  ...base,
  firebaseConfig: {
    ...base.firebaseConfig,
    emulator: {
      authHost: '127.0.0.1',
      authPort: 18288,
      firestoreHost: '127.0.0.1',
      firestorePort: 18289,
    },
  },
};
export const datatugEnvironmentProviders = [
  { provide: DatatugApiBaseUrl, useValue: 'http://127.0.0.1:18290/v0/' },
];
