import { projectMeaningsRoutes } from '../meanings/meanings-routes';
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
import { SessionWorkspaceService } from '../session-context/session-workspace.service';
import { admitSessionWorkspace } from '../session-context/session-route.guard';
import { hostedCloudLogsAccessGuard } from '../pages/my/cloud-logs/hosted-cloud-logs-access.service';
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
  { path: 'native-check-status/:recoveryId', loadComponent: () => import('../session-context/session-detective-recovery.component').then(m => m.SessionDetectiveRecoveryComponent) },
  { path: 'store/:storeId/native-check-status/:recoveryId', loadComponent: () => import('../session-context/session-detective-recovery.component').then(m => m.SessionDetectiveRecoveryComponent) },

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
    path: 'my/cloud-logs/recovery',
    loadComponent: () =>
      import('../pages/my/cloud-logs/cloud-logs-auth-recovery-page.component').then(
        (m) => m.CloudLogsAuthRecoveryPageComponent,
      ),
  },
  {
    path: 'my/cloud-logs',
    canActivate: [hostedCloudLogsAccessGuard],
    loadComponent: () =>
      import('../pages/my/cloud-logs/cloud-logs-page.component').then(
        (m) => m.CloudLogsPageComponent,
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
  // Space-owned projects include private hosted Incidents.
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
          (segments.length === 7 &&
            ['overview', 'quick-search', 'tags', 'queries', 'checks', 'detective', 'incidents', 'shipping', 'boards', 'board', 'meanings'].includes(
              segments[6].path,
            )) ||
          (segments.length === 8 && segments[6].path === 'meanings' && ['new-entity', 'entity', 'new-field', 'field'].includes(segments[7].path)) ||
          (segments.length === 8 && segments[6].path === 'boards' && segments[7].path === 'new') ||
          (segments.length === 8 && segments[6].path === 'board' && /^[A-Za-z0-9_-]{1,128}$/.test(segments[7].path)) ||
          (segments.length === 8 &&
            ['checks', 'detective', 'incidents', 'search-schema'].includes(segments[6].path) &&
            /^[A-Za-z0-9_-]+$/.test(segments[7].path)) ||
          (segments.length === 9 &&
            segments[6].path === 'incidents' &&
            /^[A-Za-z0-9_-]+$/.test(segments[7].path) &&
            /^[A-Za-z0-9_-]+$/.test(segments[8].path)) ||
          (segments.length === 9 &&
            segments[6].path === 'detective' &&
            segments[7].path === 'scenario' &&
            /^[A-Za-z0-9_-]+$/.test(segments[8].path)) ||
          (segments.length === 8 &&
            segments[6].path === 'query' &&
            /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(segments[7].path)) ||
          (segments[6]?.path === 'sessions' && (segments.length === 7 ||
            (/^[A-Za-z0-9_-]{1,128}$/.test(segments[7]?.path ?? '') &&
              (segments.length === 8 || (segments.length === 9 && ['overview', 'queries', 'invoice-overview', 'invoice-explorer', 'composer', 'checks', 'detective'].includes(segments[8].path)) ||
                (segments.length === 10 && ['query', 'checks', 'detective'].includes(segments[8].path) && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(segments[9].path))))))),
    ],
    children: [
      {path: 'quick-search', loadComponent: () => import('../quick-search/quick-search-page.component').then(m => m.QuickSearchPageComponent)},
      {path: 'tags', data: {discovery: true}, loadComponent: () => import('../quick-search/quick-search-page.component').then(m => m.QuickSearchPageComponent)},
      {path: 'search-schema/:dbModelId', data: {schemaDetail: true}, loadComponent: () => import('../quick-search/quick-search-page.component').then(m => m.QuickSearchPageComponent)},
      ...projectMeaningsRoutes,
      ...['', 'overview'].map((path) => ({
        path,
        loadComponent: () =>
          import('../pages/signed-in/project/project-page.component').then(
            (m) => m.ProjectPageComponent,
          ),
      })),
      {
        path: 'shipping',
        loadComponent: () => import('../shipping/shipping-workspace.component').then((m) => m.ShippingWorkspaceComponent),
      },
      {
        path: 'boards/new', data: { createBoard: true },
        loadComponent: () => import('../board/ui/pages/board/board-page.component').then((m) => m.BoardPageComponent),
      },
      {
        path: 'board/:board',
        loadComponent: () => import('../board/ui/pages/board/board-page.component').then((m) => m.BoardPageComponent),
      },
      { path: 'board', pathMatch: 'full', redirectTo: 'boards' },
      {
        path: 'boards',
        loadComponent: () => import('../board/ui/pages/boards/boards-page.component').then((m) => m.BoardsPageComponent),
      },
      {
        path: 'sessions', providers: [SessionWorkspaceService],
        loadComponent: () => import('../session-context/session-workspace-shell.component').then((m) => m.SessionWorkspaceShellComponent),
        children: [{ path: ':sessionId', canActivateChild: [admitSessionWorkspace], children: [
          { path: '', pathMatch: 'full', redirectTo: 'overview' },
          { path: 'overview', loadComponent: () => import('../pages/signed-in/project/project-page.component').then((m) => m.ProjectPageComponent) },
          { path: 'queries', loadComponent: () => import('../queries/queries/queries-page.component').then((m) => m.QueriesPageComponent) },
          { path: 'invoice-overview', loadComponent: () => import('../session-context/invoice-dashboard.component').then((m) => m.InvoiceDashboardComponent) },
          { path: 'invoice-explorer', loadComponent: () => import('../session-context/invoice-explorer.component').then((m) => m.InvoiceExplorerComponent) },
          { path: 'checks', loadComponent: () => import('../detective/checks-page.component').then(m => m.ChecksPageComponent) },
          { path: 'checks/:checkId', loadComponent: () => import('../detective/checks-page.component').then(m => m.ChecksPageComponent) },
          { path: 'detective', loadComponent: () => import('../detective/cases-page.component').then(m => m.CasesPageComponent) },
          { path: 'detective/:caseId', loadComponent: () => import('../detective/cases-page.component').then(m => m.CasesPageComponent) },
          { path: 'composer', loadComponent: () => import('../session-context/session-composer.component').then((m) => m.SessionComposerComponent) },
          { path: 'query', children: [{ path: ':queryId', loadComponent: () => import('../queries/query/page/query-page.component').then((m) => m.QueryPageComponent) }] },
        ] }],
      },
      {
        path: 'incidents',
        ...SNEAT_AUTH_GUARDS,
        children: [
          { path: '', pathMatch: 'full', data: { incidentMode: 'list' }, loadComponent: () => import('../detective/hosted-incidents-page.component').then(m => m.HostedIncidentsPageComponent) },
          { path: 'new', data: { incidentMode: 'new' }, loadComponent: () => import('../detective/hosted-incidents-page.component').then(m => m.HostedIncidentsPageComponent) },
          { path: ':incidentStoreId/:incidentId', data: { incidentMode: 'detail' }, loadComponent: () => import('../detective/hosted-incidents-page.component').then(m => m.HostedIncidentsPageComponent) },
        ],
      },
      {
        path: 'queries',
        loadComponent: () =>
          import('../queries/queries/queries-page.component').then(
            (m) => m.QueriesPageComponent,
          ),
      },
      {
        path: 'checks',
        children: [
          {
            path: '',
            loadComponent: () =>
              import('../detective/checks-page.component').then(
                (m) => m.ChecksPageComponent,
              ),
          },
          {
            path: ':checkId',
            loadComponent: () =>
              import('../detective/checks-page.component').then(
                (m) => m.ChecksPageComponent,
              ),
          },
        ],
      },
      {
        path: 'detective',
        children: [
          {
            path: 'scenarios/:scenarioId',
            loadComponent: () =>
              import('../detective/public-scenarios-page.component').then(
                (m) => m.PublicScenariosPageComponent,
              ),
          },
          {
            path: 'scenario/:scenarioId',
            loadComponent: () =>
              import('../detective/scenario-detail-page.component').then(
                (m) => m.ScenarioDetailPageComponent,
              ),
          },
          {
            path: '',
            loadComponent: () =>
              import('../detective/cases-page.component').then(
                (m) => m.CasesPageComponent,
              ),
          },
          {
            path: ':caseId',
            loadComponent: () =>
              import('../detective/cases-page.component').then(
                (m) => m.CasesPageComponent,
              ),
          },
        ],
      },
      {
        path: 'query',
        children: [
          {
            path: ':queryId',
            loadComponent: () =>
              import('../queries/query/page/query-page.component').then(
                (m) => m.QueryPageComponent,
              ),
          },
        ],
      },
    ],
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
