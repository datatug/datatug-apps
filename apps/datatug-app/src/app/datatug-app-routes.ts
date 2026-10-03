import { inject } from '@angular/core';
import {
  CanMatchFn,
  RedirectCommand,
  Router,
  Routes,
  UrlSegment,
  UrlSegmentGroup,
  UrlTree,
} from '@angular/router';
import { PRODUCT_PROFILE } from '@datatug/product-profiles';
import { cliChatCapability } from './cli-chat-capability';
import { handoffDecision, searchOfQueryParams } from './demo-handoff-asked';
import { handoffUrlMatcher } from './demo-handoff-path';

// Task 13 (S108, spec/research/2026-09-09-layered-acl-reconciliation.md,
// datatug/datatug): the read-only worktree
// `.worktrees/datatug-apps-layered-acl-query` (5ebb264) adds `pwa/repo/:repo/
// agent/:agentId` and `agent/:agentId` routes, both loading its own
// `OpenVaultDBPageComponent`. Deliberately NOT ported — `store/http-<host>:
// <port>` (nav-models.ts's `parseDatatugStoreRef`, Task 12/15, PRs #63/#65/
// #79) is the one store-id/agent-URL convention this app supports; a second,
// competing convention is exactly what Task 15 was created to avoid. See
// `datatug-app-routes.spec.ts` for the regression guard.

// The places a hand-off from the sites lands: datatug.io's "Ask DataTug" button opens `/demo`, and the project's
// `start-chat` page (founder ruling 2026-10-03, design demo-as-github-project.md 3.1) is the confirmation page that
// takes the question after `#`. Until the live demo can answer a question, both show one holding page instead of
// failing to match any route, which opens Sentry's crash-report dialog and loses the visitor's question. No flag and
// no sign-in. demo-handoff-capture.ts explains how the question is taken out of the address bar before analytics
// starts, and which addresses may show it back (isTrustedHandoff: `/demo` and the demo project's own start-chat;
// any other repository gets neutral wording and no question). Registered ahead of the root feature routes; every
// other path is matched exactly as before.
//
// What each address gets (demo-handoff-asked.ts decides, from what index.html kept of the query):
//   - `/demo`: the page, always.
//   - `/project/github.com/<owner>/<repo>[/tree/<ref>[/<dir>…]/-]/start-chat`: the page, always (with a question
//     or without: nothing to confirm is still a page that says so).
//   - `/project/github.com/<owner>/<repo>[/tree/<ref>/-]/chat` that arrived with a question (`msg`, or `q`; the old
//     hand-off address): moved, replacing it, to the start-chat address of the same project, with no question in it.
//     Without a question it is the chat page of that project, opened at its short address like every other page of
//     it (the short project route, in the datatug-main routes). `/chat` never reads a question.
//   - the old form of a project address, and every other short address, are never hand-offs.
//
// One route with a matcher, not three `path`s: Angular's literal segments are case-sensitive, and `/Demo` must
// show the page too, as must `/demo;x=1` (the router ignores matrix parameters). demo-handoff-path.ts holds the
// rules, which index.html's inline script repeats so that the query is stripped for exactly these addresses.
//
// Only the DataTug product profile has the page: app.incidentius.com serves the same bundle and has no demo, so
// there the same addresses go to `/` (and on to that profile's home) instead of failing to match, which would
// raise NG04002, a Sentry event and the crash-report dialog. (A route guard, not a component, so product-profiles'
// rule that a component never branches on the profile's identity is not what this is.)
const demoHoldingPage = () => import('./demo-holding-page.component').then((m) => m.DemoHoldingPageComponent);

/** The hand-off page belongs to the DataTug product profile only. */
export const datatugProfileOnly = (): boolean => inject(PRODUCT_PROFILE).id === 'datatug';

/**
 * The URL tree of an address built from its decoded segments, not parsed from a string: the router's parser reads
 * `(` as the start of an outlet group and `//` as a boundary, and the serializer encodes each segment again.
 */
function urlTreeOfSegments(segments: readonly string[]): UrlTree {
  const primary = new UrlSegmentGroup(
    segments.map((segment) => new UrlSegment(segment, {})),
    {},
  );
  const root = new UrlSegmentGroup([], { primary });
  primary.parent = root;
  return new UrlTree(root, {}, null);
}

/**
 * `canMatch` of the hand-off route: under the DataTug profile the page for `/demo` and for a start-chat address, a
 * replacing redirect to start-chat for an old project chat address that arrived with a question, and no match (the
 * router goes on to the project routes) for a project chat address without one; under every other profile, the root.
 */
export const handoffOrRoot: CanMatchFn = (_route, segments) => {
  const router = inject(Router);
  if (!datatugProfileOnly()) return router.parseUrl('/');
  // The query the router has is normally empty (index.html's script took it out of the address bar before the
  // router started). It is not when the script reads the path another way than the router does: then a question in
  // it is as good as one the script stashed (demo-handoff-asked.ts).
  const decision = handoffDecision(
    segments.map((segment) => segment.path),
    undefined,
    searchOfQueryParams(router.getCurrentNavigation()?.extractedUrl.queryParams ?? {}),
  );
  if (decision.kind === 'move-to-start-chat')
    return new RedirectCommand(urlTreeOfSegments(decision.segments), { replaceUrl: true });
  return decision.kind === 'page';
};

export const routes: Routes = [
  {
    matcher: handoffUrlMatcher,
    canMatch: [handoffOrRoot],
    loadComponent: demoHoldingPage,
  },
  {
    path: 'store/:storeId/project/:projectId/chat',
    canMatch: [() => !!cliChatCapability()],
    loadComponent: () => import('./cli-chat-page.component').then((m) => m.CliChatPageComponent),
  },
  {
    path: 'chat',
    loadComponent: () => import('./cli-chat-page.component').then((m) => m.CliChatPageComponent),
  },
  {
    path: 'hello-world',
    loadChildren: () =>
      import('./hello-world-page.component').then(
        (m) => m.HelloWorldPageComponent,
      ),
  },
  {
    path: 'debug',
    loadComponent: () =>
      import('./debug-page.component').then((m) => m.DebugPageComponent),
  },
  {
    // The side menu is lazy-loaded into the named "menu" outlet in the app
    // shell, so it is code-split out of the initial bundle and the router (not
    // a static import) handles its loading.
    path: '',
    outlet: 'menu',
    loadComponent: () =>
      import('@sneat/datatug-main').then((m) => m.DatatugMenuComponent),
  },
  {
    path: '',
    loadChildren: () =>
      import('@sneat/datatug-main').then((m) => m.DatatugRoutingModule),
  },
];
