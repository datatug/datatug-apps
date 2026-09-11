// Profile resolution (spec/features/product-profiles/README.md REQ:profile-table,
// REQ:profile-selection-is-not-authorization, in datatug/datatug).
//
// Precedence (hub REQ:profile-table, "lead assumption"): explicit configuration
// override, then hostname match, then the `datatug` default. `?profile=` is
// accepted only when the app is running in a local development configuration —
// REQ:profile-selection-is-not-authorization: "`?profile=` in particular MUST be
// inert outside local development ... so that it never becomes the thing somebody
// later tries to gate a feature on." An unrecognized hostname MUST fall back to
// `datatug` and MUST NOT fail to boot.
//
// Pure functions only — no `window`/`location` access here, so every branch is
// unit-testable without a DOM. `product-profile.token.ts` is the thin, impure
// wrapper that reads the real browser location and calls these.

import {
  DEFAULT_PRODUCT_PROFILE_ID,
  isProductProfileId,
  PRODUCT_PROFILES,
  ProductProfile,
  ProductProfileId,
} from './product-profile';

/**
 * Hostnames this build treats as a local development configuration, in which
 * `?profile=` is honored (REQ:profile-table). Mirrors the existing
 * `useNgrok`/`useSSL` heuristic `apps/datatug-app/src/environments/environment.ts`
 * already uses to distinguish a developer's machine from a real deployment,
 * rather than inventing a second convention.
 */
function isLocalDevelopmentHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '' ||
    hostname.endsWith('.local') ||
    hostname.includes('.ngrok.')
  );
}

export interface ResolveProductProfileInput {
  /** The page's current hostname (`location.hostname`). */
  readonly hostname: string;
  /** The raw `profile` query-string value, if any (`?profile=incidentius`). */
  readonly queryProfile?: string | null;
  /**
   * An explicit configuration override for a deployment that has no distinct
   * hostname of its own (REQ:profile-table). Takes precedence over both the
   * hostname match and the query parameter.
   */
  readonly override?: ProductProfileId;
}

/**
 * Resolves which profile id applies, following REQ:profile-table's precedence:
 * override, then hostname match, then the `datatug` default. `queryProfile` is
 * only honored when `hostname` names a local development configuration
 * (REQ:profile-selection-is-not-authorization) — outside that, it is inert.
 */
export function resolveProductProfileId(
  input: ResolveProductProfileInput,
): ProductProfileId {
  const { hostname, queryProfile, override } = input;

  if (override && isProductProfileId(override)) {
    return override;
  }

  if (
    isProductProfileId(queryProfile) &&
    isLocalDevelopmentHostname(hostname)
  ) {
    return queryProfile;
  }

  const byHostname = Object.values(PRODUCT_PROFILES).find((profile) =>
    profile.hostnames.includes(hostname),
  );
  if (byHostname) {
    return byHostname.id;
  }

  return DEFAULT_PRODUCT_PROFILE_ID;
}

/** Same precedence as {@link resolveProductProfileId}, returning the full
 * declarative {@link ProductProfile} record rather than just its id. */
export function resolveProductProfile(
  input: ResolveProductProfileInput,
): ProductProfile {
  return PRODUCT_PROFILES[resolveProductProfileId(input)];
}

export { isLocalDevelopmentHostname };
