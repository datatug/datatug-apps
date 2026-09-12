// The declarative product-profile table (spec/features/product-profiles/README.md
// REQ:profile-table, REQ:profile-config-is-declarative, in datatug/datatug).
//
// One build of `apps/datatug-app` serves several product shells — today `datatug`
// and `incidentius`; `dashboardius` is a planned third profile (see the hub
// Feature's roadmap) that this table is deliberately shaped to add as a pure data
// change: a new `ProductProfileId` union member plus a new `PRODUCT_PROFILES` entry,
// never a new branch in shared component code (REQ:profile-config-is-declarative:
// "A component MAY read a profile token ... but MUST NOT branch on the profile
// identity to change behaviour"). This scaffold slice builds only `datatug` and
// `incidentius` — no Dashboardius profile is registered here, and the
// three-profile AC (`AC:one-build-serves-both-profiles`) is not claimed.

/**
 * Every product-profile id this build knows about. Extending this union (e.g.
 * adding `'dashboardius'`) is the "data change" REQ:profile-config-is-declarative
 * describes — it must be paired with a new {@link PRODUCT_PROFILES} entry and, at
 * most, registering that profile's home route; no existing profile's behaviour
 * changes.
 */
export type ProductProfileId = 'datatug' | 'incidentius';

/**
 * One product profile's declarative presentation data. A profile changes what a
 * user sees first and nothing else (hub Summary) — nothing here ever influences
 * authorization (REQ:profile-selection-is-not-authorization) or which data is
 * reachable (REQ:no-profile-private-data).
 */
export interface ProductProfile {
  /** Stable identifier — matches its key in {@link PRODUCT_PROFILES}. */
  readonly id: ProductProfileId;

  /** Brand name shown in the app shell's header/side-menu title. */
  readonly brandName: string;

  /**
   * True when this profile's brand has no registered domain / is not yet a
   * generally available surface (hub REQ:brand-and-domain-honesty — founder,
   * 2026-09-11: "keep with planned label"). The shell renders an explicit
   * "Planned" label next to the brand name whenever this is true, and no domain
   * is claimed anywhere in copy for such a profile.
   */
  readonly planned?: boolean;

  /**
   * Path (relative to the app root, no leading slash) this profile's home route
   * redirects to. Empty string means the root route itself (`/`) is the home
   * page — no redirect. Non-empty means `/` redirects to `/${homePath}` (see
   * `profile-home-redirect.guard.ts` in `@sneat/datatug-main`), which is the "at
   * most, registering a new home route" a new profile needs alongside its table
   * entry.
   */
  readonly homePath: string;

  /**
   * Wording for this profile's primary entry point (hub REQ:profile-table's
   * table row "Primary entry point"). For `incidentius` this is the founder's
   * own words (vision §23): "Houston, we've got a problem".
   */
  readonly entryPointLabel: string;

  /**
   * Whether the side menu always carries an *Incidents* item, with or without a
   * project open, and regardless of any feature flag or project setting (hub
   * REQ:profile-table, founder 2026-09-11, verbatim: "DataTug app should always
   * have Incidents menu item in side menu."). Fixed `true` for `datatug`; other
   * profiles decide their own value here — `incidentius` doesn't need a
   * redundant menu shortcut to the page that is already its home.
   */
  readonly showIncidentsMenuItem: boolean;

  /**
   * Exact hostnames that select this profile (REQ:profile-table: "A profile
   * MUST be selected by hostname"). Empty means this profile is never chosen by
   * hostname alone — reachable only through the configuration override or, in a
   * local development configuration, `?profile=`. Incidentius uses the exact
   * app hostname from the approved split-domain layout; its apex remains the
   * separate landing page.
   */
  readonly hostnames: readonly string[];
}

/**
 * The declarative profile table (REQ:profile-table). Adding `dashboardius` later
 * is exactly: add `'dashboardius'` to {@link ProductProfileId} and add a
 * `dashboardius` entry here — see this file's header comment.
 */
export const PRODUCT_PROFILES: Readonly<
  Record<ProductProfileId, ProductProfile>
> = Object.freeze({
  datatug: Object.freeze({
    id: 'datatug',
    brandName: 'DataTug.app',
    homePath: '',
    entryPointLabel: 'Open a project',
    showIncidentsMenuItem: true,
    hostnames: ['datatug.app'],
  }),
  incidentius: Object.freeze({
    id: 'incidentius',
    brandName: 'Incidentius',
    homePath: 'incidents',
    entryPointLabel: "Houston, we've got a problem",
    showIncidentsMenuItem: false,
    hostnames: ['app.incidentius.com'],
  }),
});

/** Precedence's last resort (REQ:profile-table): an unrecognized hostname MUST
 * fall back to `datatug` and MUST NOT fail to boot. */
export const DEFAULT_PRODUCT_PROFILE_ID: ProductProfileId = 'datatug';

/** Narrows an arbitrary string (e.g. from a query parameter or a configuration
 * value) to a known {@link ProductProfileId}, or `undefined` if it names no
 * registered profile. */
export function isProductProfileId(
  value: string | null | undefined,
): value is ProductProfileId {
  return !!value && Object.prototype.hasOwnProperty.call(PRODUCT_PROFILES, value);
}
