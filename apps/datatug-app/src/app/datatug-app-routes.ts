import { inject } from '@angular/core';
import { Router, Routes, UrlTree } from '@angular/router';
import { PRODUCT_PROFILE } from '@datatug/product-profiles';
import { cliChatCapability } from './cli-chat-capability';
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

// The places a hand-off from the sites lands: datatug.io's "Ask DataTug" button opens `/demo`, and the project
// chat's `?msg=` is the shape the hand-off is moving to. Until the live demo can answer a question, they show one
// holding page instead of failing to match any route, which opens Sentry's crash-report dialog and loses the
// visitor's question. No flag and no sign-in. demo-handoff-capture.ts explains how the question is taken out of
// the address bar before analytics starts, and which addresses may show it back (isEchoTrusted: `/demo` and the
// demo project's own chat; any other repository gets neutral wording and no question). Registered ahead of the
// root feature routes; every other path is matched exactly as before.
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

/** `canMatch` of the hand-off route: matches under the DataTug profile, sends every other profile to the root. */
export const handoffOrRoot = (): boolean | UrlTree => datatugProfileOnly() || inject(Router).parseUrl('/');

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
