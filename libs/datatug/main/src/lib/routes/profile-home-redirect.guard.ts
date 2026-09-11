import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PRODUCT_PROFILE } from '@datatug/product-profiles';

/**
 * Guards the app root route (`path: ''`). Redirects to the active product
 * profile's declared home route (hub `product-profiles` REQ:profile-table:
 * "Adding or changing a profile MUST be a data change to that configuration
 * plus, at most, registering a new home route") — e.g. `incidentius`'s
 * `homePath: 'incidents'` sends `/` to `/incidents`, the incident list with
 * the "Houston, we've got a problem" entry point
 * (`incidents` REQ:profile-home, AC:incidentius-profile-home).
 *
 * `datatug`'s `homePath` is `''`, so this is a no-op for it — the root route
 * loads `DatatugHomePageComponent` directly, exactly as before this guard
 * existed. Reads only the profile's declarative `homePath` field, never its
 * identity, so a third profile needs no change here — only its own table
 * entry (REQ:profile-config-is-declarative).
 */
export const profileHomeRedirectGuard: CanActivateFn = () => {
  const profile = inject(PRODUCT_PROFILE);
  const router = inject(Router);
  if (profile.homePath) {
    return router.parseUrl('/' + profile.homePath);
  }
  return true;
};
