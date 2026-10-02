import { inject } from '@angular/core';
import {
  CanMatchFn,
  Router,
  Routes,
  UrlMatcher,
  UrlSegment,
} from '@angular/router';
import { PRODUCT_PROFILE } from '@datatug/product-profiles';
import {
  GithubAddressCheck,
  GithubAddressProblemState,
  readShortGithubAddress,
} from './github-project-address-check';
import {
  routingParamProjectId,
  routingParamStoreId,
} from '../core/datatug-routing-params';

// The short project route (design `demo-as-github-project.md` 3.3, 3.4, 3.4a):
//   /project/github.com/<owner>/<repo>[/tree/<ref>[/<dir>…]][/-/<page>…]
// opens the same project pages as `/store/github.com/project/<repo>@<owner>@<dir>/<page>` (which keeps working,
// with no redirect, until the held task G-A1d). A matcher consumes the project locator and supplies the two
// positional parameters every page and tracker already reads (`storeId`, `projectId`); the project pages are its
// children, unchanged. Only the DataTug product profile has it: the other profiles do not match it at all, as
// before this route existed.
//
// Two routes share the address, in this order:
//   1. the address check (github-project-address-check.ts), which matches every `/project/github.com/…` address
//      and either redirects to the canonical spelling, or says there is a problem (an address that cannot be a
//      project, or no project file there), or does not match so that route 2 takes the address;
//   2. the project.

const paths = (segments: readonly UrlSegment[]): string[] =>
  segments.map((segment) => segment.path);

/** Consumes the locator of a project at its short address, and supplies `storeId` and `projectId` (canonical). */
export const githubProjectMatcher: UrlMatcher = (segments) => {
  const address = readShortGithubAddress(paths(segments));
  if (address.kind !== 'project') {
    return null;
  }
  return {
    consumed: segments.slice(0, address.locatorLength),
    posParams: {
      [routingParamStoreId]: new UrlSegment(address.parts.storeId, {}),
      [routingParamProjectId]: new UrlSegment(address.parts.projectId, {}),
    },
  };
};

/** Consumes every `/project/github.com/…` address, whole: whether it is a project or not is the check's to say. */
export const githubAddressMatcher: UrlMatcher = (segments) =>
  readShortGithubAddress(paths(segments)).kind === 'not-short-github'
    ? null
    : { consumed: segments };

/** The short route belongs to the DataTug product profile only. */
export const datatugProfileForShortRoute = (): boolean =>
  inject(PRODUCT_PROFILE).id === 'datatug';

/**
 * `canMatch` of the address route. True when the page to show is the problem page (it has been told which problem);
 * a UrlTree for the canonical spelling; false when the address is a project that the project route should open.
 */
export const githubAddressCanMatch: CanMatchFn = async (_route, segments) => {
  if (!datatugProfileForShortRoute()) {
    return false;
  }
  const router = inject(Router);
  const check = inject(GithubAddressCheck);
  const state = inject(GithubAddressProblemState);
  const typed = router.getCurrentNavigation()?.extractedUrl;
  const decision = await check.decide(paths(segments));
  switch (decision.kind) {
    case 'redirect': {
      const target = router.parseUrl(decision.path);
      target.queryParams = { ...(typed?.queryParams ?? {}) };
      target.fragment = typed?.fragment ?? null;
      return target;
    }
    case 'problem':
      state.problem.set(decision.problem);
      return true;
    default:
      return false;
  }
};

export const githubProjectRoutes: Routes = [
  {
    matcher: githubAddressMatcher,
    canMatch: [githubAddressCanMatch],
    loadComponent: () =>
      import('./github-address-problem-page.component').then(
        (m) => m.GithubAddressProblemPageComponent,
      ),
  },
  {
    matcher: githubProjectMatcher,
    canMatch: [datatugProfileForShortRoute],
    loadChildren: () =>
      import('./datatug-routing-proj').then(
        (m) => m.DatatugProjectRoutingModule,
      ),
  },
];
