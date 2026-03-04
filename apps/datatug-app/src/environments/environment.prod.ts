import { IEnvironmentConfig } from '@sneat/core';

// TODO: Replace with DataTug-specific Firebase project config when ready.
// Currently sharing the sneat.app Firebase project (see datatug decoupling plan).
export const datatugAppEnvironmentConfig: IEnvironmentConfig = {
  production: true,
  agents: {},
  firebaseConfig: {
    projectId: 'sneat-eur3-1',
    appId: '1:588648831063:web:303af7e0c5f8a7b10d6b12',
    apiKey: 'AIzaSyCeQu1WC182yD0VHrRm4nHUxVf27fY-MLQ',
    authDomain: 'sneat.app',
    messagingSenderId: '588648831063',
    measurementId: 'G-TYBDTV738R',
  },
};
