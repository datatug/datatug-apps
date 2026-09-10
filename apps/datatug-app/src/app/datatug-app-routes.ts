import { Routes } from '@angular/router';

// Task 13 (S108, spec/research/2026-09-09-layered-acl-reconciliation.md,
// datatug/datatug): the read-only worktree
// `.worktrees/datatug-apps-layered-acl-query` (5ebb264) adds `pwa/repo/:repo/
// agent/:agentId` and `agent/:agentId` routes, both loading its own
// `OpenVaultDBPageComponent`. Deliberately NOT ported — `store/http-<host>:
// <port>` (nav-models.ts's `parseDatatugStoreRef`, Task 12/15, PRs #63/#65/
// #79) is the one store-id/agent-URL convention this app supports; a second,
// competing convention is exactly what Task 15 was created to avoid. See
// `datatug-app-routes.spec.ts` for the regression guard.
export const routes: Routes = [
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
