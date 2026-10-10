import { IEnvironmentConfig } from '@sneat/core';
import type { DatatugDemoConfig } from './demo-config';
import { TEST_CHECKOUT_ORIGIN } from '../app/checkout/checkout-config.mjs';

// TEST uses its isolated host. LIVE uses the app's trusted API origin, but
// remains closed until the Business provider and access path are verified.
export const datatugBusinessCheckoutApiOrigin: string | null =
  TEST_CHECKOUT_ORIGIN;
export const datatugBusinessCheckoutLiveApiOrigin: string | null = null;
export const datatugBusinessCheckoutLiveEnabled = false;

// Shared Sneat identity pool — `sneat-eur3-1` — used by every Sneat product
// (consumer + business). This is permanent per the 2026-06-09 single-identity
// decision: datatug.app authenticates here, NOT against a separate project.
// See sneat-apps/docs/superpowers/specs/2026-06-09-single-identity-addendum.md
export const datatugAppEnvironmentConfig: IEnvironmentConfig = {
  production: true,
  agents: {},
  firebaseConfig: {
    projectId: 'sneat-eur3-1',
    appId: '1:588648831063:web:303af7e0c5f8a7b10d6b12',
    apiKey: 'AIzaSyCeQu1WC182yD0VHrRm4nHUxVf27fY-MLQ',
    // The shared, Firebase-hosted auth domain every Sneat product uses: it
    // serves Google/GitHub OAuth's /__/auth/handler, which a Cloudflare-served
    // app does NOT serve itself. Matches @sneat/app's SHARED_SNEAT_AUTH_DOMAIN
    // (and the GitHub OAuth app's registered callback).
    authDomain: 'auth.sneat.co',
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

// Production: OFF. The one-line decision that turns the demo on for everyone is task D-ON of
// datatug/backstage docs/design/demo-as-github-project.md (8.0): a pull request setting this to `true`, opened and landed only
// after the founder's yes. A browser can still opt in or out for itself (isDemoEnabled(), src/app/demo-flag.ts).
export const datatugDemoConfig: DatatugDemoConfig = {
  enabled: false,
};
