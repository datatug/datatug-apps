import { inject } from '@angular/core';
import {
  CanMatchFn,
  Router,
  Routes,
  UrlMatcher,
  UrlSegment,
  UrlSegmentGroup,
  UrlTree,
} from '@angular/router';
import { Location } from '@angular/common';
import { PRODUCT_PROFILE } from '@datatug/product-profiles';
import { hasOutletGroup, pathHasOutletGroup } from '@datatug/project-address';
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
//      project, or no project file there, or an outlet group: see below), or does not match so that route 2 takes
//      the address;
//   2. the project.
//
// The visitor's question (`msg`, and the old `q`) must not survive in any address these routes match: whatever the
// inline script of the app concluded about the path (it cannot read every spelling of it the way the router does),
// the first thing route 1 does is redirect to the same address without them, query and fragment otherwise kept.
// That holds for in-app navigations as well. A hand-off address (the project chat that arrived with a question) is
// never seen here: the app's hand-off route takes it first.
//
// An address with an outlet group (`…/a(b)/-/queries`, a folder called `a(b)` pasted from GitHub, or
// `…/chat(menu:x)`) is another address for the router than the one that was typed: its parser drops what follows the
// group (and, for an unnamed group, the group too). The problem page says it is not supported, instead of opening
// folder `a` silently. Matrix parameters (`…/queries;a=1`) are another spelling of an address, so the canonical
// redirect drops them.
//
// The fixed segments (`project`, `github.com`, `tree`, the first page) are read in any letter case and redirect to
// the lower-case address (`readShortGithubAddress`): the hand-off route and index.html read them so, and an address
// that either of them lets through must never reach the router's "no route matches" failure. A redirect is built
// from segments, not parsed from a string (`urlTreeOfPath`).

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

/**
 * The URL tree of a canonical path, built from its segments and not parsed from the string: the router's parser
 * reads `(` as the start of an outlet group, so a folder called `a(b)` would open another project. Each segment is
 * decoded here and the serializer encodes it again, parentheses included.
 */
export function urlTreeOfPath(
  path: string,
  queryParams: Record<string, string | string[]>,
  fragment: string | null,
): UrlTree {
  const segments = path
    .split('/')
    .slice(1)
    .map((segment) => new UrlSegment(decodeURIComponent(segment), {}));
  const primary = new UrlSegmentGroup(segments, {});
  const root = new UrlSegmentGroup([], { primary });
  primary.parent = root;
  return new UrlTree(root, { ...queryParams }, fragment);
}

/** The parameters that carry a visitor's question: the project chat's `msg`, and the old name of it, `q`. */
const QUESTION_PARAMS = ['msg', 'q'];

/**
 * The URL of this navigation without the visitor's question, in every other way as it was (path as typed, other
 * parameters, fragment); undefined when it has none, or when there is no navigation (a guard run outside one).
 */
function withoutQuestion(router: Router): UrlTree | undefined {
  const typed = router.getCurrentNavigation()?.extractedUrl;
  if (
    !typed ||
    !QUESTION_PARAMS.some((name) =>
      Object.prototype.hasOwnProperty.call(typed.queryParams, name),
    )
  ) {
    return undefined;
  }
  const kept = Object.fromEntries(
    Object.entries(typed.queryParams).filter(
      ([name]) => !QUESTION_PARAMS.includes(name),
    ),
  );
  return new UrlTree(typed.root, kept, typed.fragment);
}

/**
 * Whether the router reads the URL of this navigation as having an outlet group. A named group
 * (`…/chat(menu:x)`) is in the URL tree. An unnamed one (`…/a(b)/-/queries`) leaves nothing in it: the parser
 * drops it with the rest of the path, so only the address as typed shows it. That is the browser's own address,
 * when this navigation is the one that put it there (the first navigation of the page, Back and Forward); an
 * in-app navigation builds its URL from segments (`urlTreeOfPath`, `projectUrl`), which encode parentheses.
 */
export function urlHasOutletGroup(
  router: Router,
  location: Pick<Location, 'path'>,
): boolean {
  const typed = router.getCurrentNavigation()?.extractedUrl;
  if (!typed) {
    return false;
  }
  if (hasOutletGroup(typed.root.children['primary'])) {
    return true;
  }
  const asTyped = location.path().split(/[?#]/)[0];
  const pathOf = (tree: UrlTree): string =>
    router.serializeUrl(new UrlTree(tree.root, {}, null));
  return (
    pathHasOutletGroup(asTyped) &&
    pathOf(router.parseUrl(asTyped)) === pathOf(typed)
  );
}

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
  // The question first, before anything is asked of GitHub: the address may be kept in the address bar for as long
  // as that takes.
  const stripped = withoutQuestion(router);
  if (stripped) {
    return stripped;
  }
  const check = inject(GithubAddressCheck);
  const state = inject(GithubAddressProblemState);
  if (urlHasOutletGroup(router, inject(Location))) {
    state.problem.set({ kind: 'unsupported', reason: 'invalid-path-segment' });
    return true;
  }
  const typed = router.getCurrentNavigation()?.extractedUrl;
  const decision = await check.decide(paths(segments), {
    matrixParameters: segments.some(
      (segment) => Object.keys(segment.parameters).length > 0,
    ),
  });
  switch (decision.kind) {
    case 'redirect': {
      return urlTreeOfPath(
        decision.path,
        typed?.queryParams ?? {},
        typed?.fragment ?? null,
      );
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
