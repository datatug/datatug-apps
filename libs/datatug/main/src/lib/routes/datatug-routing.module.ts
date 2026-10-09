import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SNEAT_AUTH_GUARDS } from '@sneat/auth-core';
import {
  routingParamIncidentId,
  routingParamSpaceId,
  routingParamStoreId,
} from '../core/datatug-routing-params';
import { githubProjectRoutes } from './github-project-routes';
import { isSharedProjectRef } from '../core/project-context';
import {
  profileHomeRedirectGuard,
  profileStartPageGuard,
  START_PAGE_PATH,
} from './profile-home-redirect.guard';

const loadDatatugHomePage = () =>
  import('../pages/home/datatug-home-page.component').then(
    (m) => m.DatatugHomePageComponent,
  );

export const datatugRoutes: Routes = [
  {
    path: 'new-project',
    loadComponent: () =>
      import('../project/new-project/new-project-form.component').then(
        (m) => m.NewProjectFormComponent,
      ),
  },
  {
    path: 'github/callback',
    loadComponent: () =>
      import('../project/new-project/github-authorization-page.component').then(
        (m) => m.GithubAuthorizationPageComponent,
      ),
  },
  {
    // The app root. It shows nothing itself: the guard sends `/` to the active
    // product profile's home route (`homePath`; `datatug` -> `/home`,
    // `incidentius` -> `/incidents` — see `profile-home-redirect.guard.ts`,
    // hub `product-profiles` REQ:profile-table). A full page load of `/` on
    // datatug.app is answered by the landing page, not by this app, which is
    // why the start page has the address below. The component stays here only
    // for a profile with an empty `homePath` (none registered today), whose
    // home page is the root itself.
    path: '',
    canActivate: [profileHomeRedirectGuard],
    loadComponent: loadDatatugHomePage,
  },
  {
    // The DataTug start page, at an address that survives a refresh. Only a
    // profile whose `homePath` is `home` (`datatug`) shows it; under any other
    // profile `profileStartPageGuard` sends `/home` to that profile's own home.
    path: START_PAGE_PATH,
    canActivate: [profileStartPageGuard],
    loadComponent: loadDatatugHomePage,
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
    path:
      'incidents/:' +
      routingParamStoreId +
      '/:' +
      routingParamIncidentId +
      '/record',
    loadComponent: () =>
      import('../pages/incidents/record/incident-resolution-record-page.component').then(
        (m) => m.IncidentResolutionRecordPageComponent,
      ),
  },
  {
    // Deep-linkable by IncidentRef (`storeId`/`incidentId`) rather than
    // ambient nav context, so a link produced under one profile opens
    // identically under another (AC:deep-link-works-in-other-profile).
    path: 'incidents/:' + routingParamStoreId + '/:' + routingParamIncidentId,
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
      import('../pages/signed-in/space-explorer/space-explorer-page.component').then(
        (m) => m.SpaceExplorerPageComponent,
      ),
  },
  {
    // Read-only "explore my GitHub vault" transparency viewer — the
    // inGitDB/GitHub sibling of the `explore/:spaceId` route above (see
    // vault-explorer-page.component.ts). The repo/branch/token are entered
    // on the page itself, so there are no route params.
    path: 'explore-vault',
    ...SNEAT_AUTH_GUARDS,
    loadComponent: () =>
      import('../pages/signed-in/vault-explorer/vault-explorer-page.component').then(
        (m) => m.VaultExplorerPageComponent,
      ),
  },
  {
    path: 'signed-out',
    pathMatch: 'full',
    redirectTo: '/',
  },
  // Metadata only: no reuse of the private project's child query/write routes.
  {
    path: 'space/:spaceId/store/:storeId/project/:projectId',
    canMatch: [
      (_route, segments) =>
        segments.every((s) => Object.keys(s.parameters).length === 0) &&
        isSharedProjectRef({
          spaceID: segments[1]?.path,
          storeId: segments[3]?.path,
          projectId: segments[5]?.path,
        }) &&
        (segments.length === 6 ||
          (segments.length === 7 && segments[6].path === 'overview')),
    ],
    children: ['', 'overview'].map((path) => ({
      path,
      loadComponent: () =>
        import('../pages/signed-in/project/project-page.component').then(
          (m) => m.ProjectPageComponent,
        ),
    })),
  },
  // The short address of a GitHub project: `/project/github.com/<owner>/<repo>…` (design
  // `demo-as-github-project.md` 3.4). Matched by matchers, not paths; the old `store/…` form below is unchanged.
  ...githubProjectRoutes,
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
