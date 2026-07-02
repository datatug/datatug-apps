import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SNEAT_AUTH_GUARDS } from '@sneat/auth-core';
import { routingParamSpaceId, routingParamStoreId } from '../core/datatug-routing-params';

export const datatugRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../pages/home/datatug-home-page.component').then(
        (m) => m.DatatugHomePageComponent,
      ),
  },
  {
    path: 'my',
    ...SNEAT_AUTH_GUARDS,
    loadComponent: () =>
      import('../pages/my/page/datatug-my-page.component').then(
        (m) => m.DatatugMyPageComponent,
      ),
  },
  {
    // Read-only "explore my raw data" transparency viewer, rooted at
    // `/spaces/{spaceId}` (see space-explorer-page.component.ts). The
    // spaceId is a route param for this first slice — a "my spaces" list
    // isn't wired up in datatug-apps yet (see
    // backstage/docs/roadmaps/datatug-transparency-explorer.md §6).
    path: 'explore/:' + routingParamSpaceId,
    ...SNEAT_AUTH_GUARDS,
    loadComponent: () =>
      import(
        '../pages/signed-in/space-explorer/space-explorer-page.component'
      ).then((m) => m.SpaceExplorerPageComponent),
  },
  {
    // Read-only "explore my GitHub vault" transparency viewer — the
    // inGitDB/GitHub sibling of the `explore/:spaceId` route above (see
    // vault-explorer-page.component.ts). The repo/branch/token are entered
    // on the page itself, so there are no route params.
    path: 'explore-vault',
    ...SNEAT_AUTH_GUARDS,
    loadComponent: () =>
      import(
        '../pages/signed-in/vault-explorer/vault-explorer-page.component'
      ).then((m) => m.VaultExplorerPageComponent),
  },
  {
    path: 'signed-out',
    pathMatch: 'full',
    redirectTo: '/',
  },
  {
    path: 'store/:' + routingParamStoreId,
    loadChildren: () =>
      import('./datatug-routing-store').then(
        (m) => m.DatatugStoreRoutingModule,
      ),
    // ...canLoad(),
  },
  {
    path: 'agent',
    redirectTo: '/',
  },
];

@NgModule({
  imports: [RouterModule.forChild(datatugRoutes)],
})
export class DatatugRoutingModule {}
