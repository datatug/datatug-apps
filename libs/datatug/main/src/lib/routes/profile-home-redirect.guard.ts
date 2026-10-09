import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PRODUCT_PROFILE } from '@datatug/product-profiles';

/**
 * The path of the DataTug start page (`DatatugHomePageComponent`). The `datatug`
 * profile's `homePath` names it (`@datatug/product-profiles`), so `/` ends on
 * `/home` there; a profile whose `homePath` names anything else never shows this
 * page (see {@link profileStartPageGuard}).
 */
export const START_PAGE_PATH = 'home';

/**
 * Guards the app root route (`path: ''`). Redirects to the active product
 * profile's declared home route (hub `product-profiles` REQ:profile-table:
 * "Adding or changing a profile MUST be a data change to that configuration
 * plus, at most, registering a new home route") — e.g. `incidentius`'s
 * `homePath: 'incidents'` sends `/` to `/incidents`, the incident list with
 * the "Houston, we've got a problem" entry point
 * (`incidents` REQ:profile-home, AC:incidentius-profile-home), and `datatug`'s
 * `homePath: 'home'` sends `/` to `/home`, its start page.
 *
 * An empty `homePath` would make the root route itself the home page, so the
 * guard lets it through — no registered profile does this today. Reads only the
 * profile's declarative `homePath` field, never its identity, so a third profile
 * needs no change here — only its own table entry
 * (REQ:profile-config-is-declarative).
 */
export const profileHomeRedirectGuard: CanActivateFn = () => {
  const profile = inject(PRODUCT_PROFILE);
  const router = inject(Router);
  if (profile.homePath) {
    return router.parseUrl('/' + profile.homePath);
  }
  return true;
};

/**
 * Guards the start page's own route (`path: START_PAGE_PATH`): the page opens
 * only for a profile whose `homePath` names it. Any other profile gets its own
 * home instead — `/home` under `incidentius` goes to `/incidents`, never to the
 * DataTug start page. Reads only `homePath`, never the profile's identity.
 *
 * With an empty `homePath` the redirect target is `/`, whose route shows the
 * start page (see {@link profileHomeRedirectGuard}), so this never loops.
 */
export const profileStartPageGuard: CanActivateFn = () => {
  const profile = inject(PRODUCT_PROFILE);
  if (profile.homePath === START_PAGE_PATH) {
    return true;
  }
  return inject(Router).parseUrl('/' + profile.homePath);
};
