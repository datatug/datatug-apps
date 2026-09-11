import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SNEAT_AUTH_GUARDS } from '@sneat/auth-core';
import {
  routingParamIncidentId,
  routingParamSpaceId,
  routingParamStoreId,
} from '../core/datatug-routing-params';
import { profileHomeRedirectGuard } from './profile-home-redirect.guard';

export const datatugRoutes: Routes = [
  {
    // The active product profile's home route may not be this one — see
    // `profile-home-redirect.guard.ts` (hub `product-profiles`
    // REQ:profile-table). Under the `datatug` profile (empty `homePath`)
    // the guard is a no-op and this still loads DatatugHomePageComponent
    // directly, exactly as before the guard existed.
    path: '',
    canActivate: [profileHomeRedirectGuard],
    loadComponent: () =>
      import('../pages/home/datatug-home-page.component').then(
        (m) => m.DatatugHomePageComponent,
      ),
  },
  {
    // The incident list — `incidentius` profile home (redirected here by
    // the guard above) and, under `datatug`, the side menu's always-present
    // *Incidents* item (hub `incidents` REQ:profile-home). One route, one
    // component, reachable from every profile (REQ:no-profile-private-data).
    path: 'incidents',
    loadComponent: () =>
      import('../pages/incidents/list/incident-list-page.component').then(
        (m) => m.IncidentListPageComponent,
      ),
  },
  {
    // "Houston, we've got a problem" (vision §23; hub REQ:houston-creation).
    path: 'incidents/new',
    loadComponent: () =>
      import('../pages/incidents/create/incident-create-page.component').then(
        (m) => m.IncidentCreatePageComponent,
      ),
  },
  {
    // Deep-linkable by IncidentRef (`storeId`/`incidentId`) rather than
    // ambient nav context, so a link produced under one profile opens
    // identically under another (AC:deep-link-works-in-other-profile).
    path:
      'incidents/:' + routingParamStoreId + '/:' + routingParamIncidentId,
    loadComponent: () =>
      import('../pages/incidents/detail/incident-detail-page.component').then(
        (m) => m.IncidentDetailPageComponent,
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
