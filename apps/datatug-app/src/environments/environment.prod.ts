import { Provider } from '@angular/core';
import { IEnvironmentConfig } from '@sneat/core';
import type { DatatugDemoConfig } from './demo-config';
import { TEST_CHECKOUT_ORIGIN } from '../app/checkout/checkout-config.mjs';
import { authDomainOfLocation } from './auth-domain';
import { signInMethodOfLocation } from './sign-in-method';

// TEST uses its isolated host. LIVE uses the verified production API origin.
export const datatugBusinessCheckoutApiOrigin: string | null =
  TEST_CHECKOUT_ORIGIN;
export const datatugBusinessCheckoutLiveApiOrigin: string | null =
  'https://api.sneat.cloud';
export const datatugBusinessCheckoutLiveEnabled = true;

export const DATATUG_SAME_ORIGIN_AUTH_BY_DEFAULT = false;

// Shared Sneat identity pool — `sneat-eur3-1` — used by every Sneat product
// (consumer + business). This is permanent per the 2026-06-09 single-identity
// decision: datatug.app authenticates here, NOT against a separate project.
// See sneat-apps/docs/superpowers/specs/2026-06-09-single-identity-addendum.md
export const datatugAppEnvironmentConfig: IEnvironmentConfig & {
  hostedCloudLogsEnabled: boolean;
} = {
  // The backend's nonempty ALLOWED_UIDS list remains the access authority;
  // the app uses its authenticated list endpoint to expose the pilot UI.
  hostedCloudLogsEnabled: true,
  signInMethod: signInMethodOfLocation(),
  production: true,
  agents: {},
  firebaseConfig: {
    projectId: 'sneat-eur3-1',
    appId: '1:588648831063:web:303af7e0c5f8a7b10d6b12',
    apiKey: 'AIzaSyCeQu1WC182yD0VHrRm4nHUxVf27fY-MLQ',
    // Where OAuth sign-in (Google/GitHub/Microsoft) runs: `auth.sneat.co`, the shared Firebase-hosted domain, or
    // `datatug.app` itself (Cloudflare proxies /__/auth/* to Firebase, sneat-sites infra/firebase-auth-proxy), which
    // is first-party and so reliable in browsers that partition cross-site storage. See auth-domain.ts.
    // DATATUG_SAME_ORIGIN_AUTH_BY_DEFAULT is the one-line switch: flip it to `true` only after the founder steps in
    // docs/auth-domain.md are done (datatug.app released from its old Firebase Hosting project, authorized domain,
    // OAuth redirect URIs). Until then `https://datatug.app/login?authDomain=same-origin` tries it in one browser.
    authDomain: authDomainOfLocation(
      location,
      DATATUG_SAME_ORIGIN_AUTH_BY_DEFAULT,
    ),
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

// No DataTug API override: DataTug calls use SneatApiBaseUrl, as before.
// To turn on DataTug API failover, add (and update environment.providers.spec.ts):
//   { provide: DatatugApiBaseUrls, useValue: ['https://api.datatug.app/v0/', 'https://api2.datatug.app/v0/'] }
// See "DataTug API failover" in apps/datatug-app/README.md.
// The Business project preview build replaces this file (environment.business-preview.ts).
export const datatugEnvironmentProviders: Provider[] = [];
