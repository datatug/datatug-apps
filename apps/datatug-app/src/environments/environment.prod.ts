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
  // TODO: Replace PostHog with a DataTug-specific project when ready.
  // Currently sharing the sneat.app PostHog project (see datatug decoupling plan).
  posthog: {
    token: 'phc_YBZyRpV92s1kC0D4vYjEQiWhVjK7U9vfyi9vh2jfbsD',
    config: {
      api_host: 'https://eu.i.posthog.com',
      person_profiles: 'identified_only',
    },
  },
  // DataTug-specific Sentry project (sneat-eu org, EU/Germany region).
  sentry: {
    dsn: 'https://0ef31fd33eade94c7b5d66ed23e4228c@o4511531361370112.ingest.de.sentry.io/4511531364450384',
  },
};
