// Injectable profile tokens (spec/features/product-profiles/README.md
// REQ:profile-config-is-declarative: "Profile resolution MUST happen once at
// application bootstrap and be exposed as an injectable token ... so tests can
// instantiate any profile without a hostname and a screen can be rendered under
// every profile token that build serves in one test run.").

import { inject, InjectionToken } from '@angular/core';
import { ProductProfile, ProductProfileId } from './product-profile';
import { resolveProductProfile } from './resolve-product-profile';

/**
 * Explicit configuration override for a deployment that has no distinct
 * hostname of its own (REQ:profile-table). Defaults to `undefined`, meaning
 * resolution falls through to the hostname match / `datatug` default. No app
 * in this workspace provides a value for this today — `apps/datatug-app` has
 * no distinct Incidentius hostname yet (hub REQ:brand-and-domain-honesty) — a
 * future dedicated deployment sets it via
 * `{ provide: PRODUCT_PROFILE_OVERRIDE, useValue: 'incidentius' }` in that
 * build's own bootstrap providers, with no change to this library.
 */
export const PRODUCT_PROFILE_OVERRIDE = new InjectionToken<
  ProductProfileId | undefined
>('PRODUCT_PROFILE_OVERRIDE', {
  providedIn: 'root',
  factory: () => undefined,
});

/**
 * The resolved {@link ProductProfile} for the running app. Resolved once (on
 * first injection — Angular's root injector caches the value) from
 * {@link PRODUCT_PROFILE_OVERRIDE}, `location.hostname` and the `profile` query
 * parameter, using the exact precedence `resolveProductProfile` implements. No
 * explicit provider is required at bootstrap — every consumer can
 * `inject(PRODUCT_PROFILE)` directly — but a test can trivially render any
 * profile without a hostname by overriding this token directly:
 *
 * ```ts
 * TestBed.configureTestingModule({
 *   providers: [{ provide: PRODUCT_PROFILE, useValue: PRODUCT_PROFILES.incidentius }],
 * });
 * ```
 */
export const PRODUCT_PROFILE = new InjectionToken<ProductProfile>(
  'PRODUCT_PROFILE',
  {
    providedIn: 'root',
    factory: (): ProductProfile => {
      const override = inject(PRODUCT_PROFILE_OVERRIDE, { optional: true });
      const hasLocation = typeof location !== 'undefined';
      const hostname = hasLocation ? location.hostname : '';
      const queryProfile = hasLocation
        ? new URLSearchParams(location.search).get('profile')
        : null;
      return resolveProductProfile({
        hostname,
        queryProfile,
        override: override ?? undefined,
      });
    },
  },
);
