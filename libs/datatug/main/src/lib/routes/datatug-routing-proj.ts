import { RouterModule, Routes } from '@angular/router';
import { NgModule } from '@angular/core';
import { ENABLE_EMPTY_SHELL_PAGES } from '../core/feature-flags';
import {
  routingParamBoard,
  routingParamDbCatalogId,
  routingParamDbModelId,
  routingParamDbServerId,
  routingParamDriver,
  routingParamEntityId,
  routingParamEnvironmentId,
  routingParamServerType,
} from '../core/datatug-routing-params';

// The empty-shell pages (Widgets, Tags, Resources, DB models, Diff) — see
// `ENABLE_EMPTY_SHELL_PAGES`. Left out of `datatugProjectRoutes` entirely
// while the flag is off, so there is no route for a user (or a stale link)
// to land on. "Variables" used to be here too; it now has a real screen
// (`InvestigationContextPageComponent`, plan task 9 — REQ:context-basket)
// and moved to the always-present list below.
const emptyShellProjectRoutes: Routes = [
  {
    path: 'widgets',
    loadComponent: () =>
      import('../pages/signed-in/widgets/widgets-page.component').then(
        (m) => m.WidgetsPageComponent,
      ),
  },
  {
    path: 'tags',
    loadComponent: () =>
      import('../pages/signed-in/tags/tags-page.component').then(
        (m) => m.TagsPageComponent,
      ),
  },
  {
    path: 'dbmodel/:' + routingParamDbModelId,
    loadComponent: () =>
      import('../pages/signed-in/db-schema/db-model-page.component').then(
        (m) => m.DbModelPageComponent,
      ),
  },
  {
    path: 'dbmodel',
    redirectTo: 'dbmodels',
  },
  {
    path: 'dbmodels',
    loadComponent: () =>
      import('../pages/signed-in/db-schemas/db-models-page.component').then(
        (m) => m.DbModelsPageComponent,
      ),
  },
  {
    path: 'resources',
    loadComponent: () =>
      import('../pages/signed-in/resources/resources-page.component').then(
        (m) => m.ResourcesPageComponent,
      ),
  },
  {
    path: 'diff',
    loadComponent: () =>
      import('../pages/signed-in/diff/diff-page.component').then(
        (m) => m.DiffPageComponent,
      ),
  },
];

export const datatugProjectRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../pages/signed-in/project/project-page.component').then(
        (m) => m.ProjectPageComponent,
      ),
  },
  {
    // The side menu's "Overview" item (project-menu-top.component.ts,
    // ProjectTopLevelPage 'overview') navigates here via
    // `DatatugNavService.goProjPage('overview', project)`, which always
    // appends a page segment — there is no "navigate to project root, no
    // segment" special case, and none of goProjPage's other 8 callers need
    // one either, so this route (not a nav-service special case) is the
    // uniform fix: every ProjectTopLevelPage.path now has a matching route
    // segment of the same name, same as boards/entities/environments/etc.
    // Without it, clicking Overview 404'd with NG04002 (founder report,
    // 2026-09-11) — there was no route at all for the 'overview' segment.
    // Points at the same ProjectPageComponent as '' (and 'project' below)
    // so Overview's content is identical to the project root either way.
    path: 'overview',
    loadComponent: () =>
      import('../pages/signed-in/project/project-page.component').then(
        (m) => m.ProjectPageComponent,
      ),
  },
  {
    path: 'board/:' + routingParamBoard,
    loadComponent: () =>
      import('../board/ui/pages/board/board-page.component').then(
        (m) => m.BoardPageComponent,
      ),
  },
  {
    path: 'board',
    redirectTo: 'boards',
  },
  {
    path: 'boards',
    loadComponent: () =>
      import('../board/ui/pages/boards/boards-page.component').then(
        (m) => m.BoardsPageComponent,
      ),
  },
  {
    path: 'entities',
    loadComponent: () =>
      import('../pages/signed-in/entities/entities-page.component').then(
        (m) => m.EntitiesPageComponent,
      ),
  },
  {
    path: 'new-entity',
    loadComponent: () =>
      import('../pages/signed-in/entity-edit/entity-edit-page.component').then(
        (m) => m.EntityEditPageComponent,
      ),
  },
  {
    path: 'environments',
    loadComponent: () =>
      import('../pages/signed-in/environments/environments-page.component').then(
        (m) => m.EnvironmentsPageComponent,
      ),
  },
  {
    path: 'env',
    redirectTo: 'environments',
  },
  {
    path: 'project',
    loadComponent: () =>
      import('../pages/signed-in/project/project-page.component').then(
        (m) => m.ProjectPageComponent,
      ),
  },
  {
    path: 'entity/:' + routingParamEntityId,
    loadComponent: () =>
      import('../pages/signed-in/entity/entity-page.component').then(
        (m) => m.EntityPageComponent,
      ),
  },
  {
    path: 'entity',
    redirectTo: 'entities',
  },
  {
    path: 'env/:' + routingParamEnvironmentId,
    loadChildren: () =>
      import('./datatug-routing-proj-env').then(
        (m) => m.DatatugProjEnvRoutingModule,
      ),
  },
  {
    // S158 (NG04002 on the founder's own reported URL, production build
    // ed66c71) — a query id can be folder-qualified (`artists/artists_with_
    // albums`, datatug-cli#219) and `DatatugNavService.goQuery()` already
    // `encodeURIComponent()`s it into ONE path segment (`%2F`) before an
    // in-app `router.navigate([...])` call, which is safe: Angular's Router
    // takes that array of segments directly and never re-parses a URL
    // string, so `%2F` survives regardless of what the browser does. A cold
    // top-level navigation straight to that same URL string — pasting or
    // opening the founder's link, not an in-app click — is not safe the
    // same way: this app's own Cloudflare Workers Assets config
    // (`wrangler.jsonc`, `not_found_handling: "single-page-application"`,
    // unchanged since 2026-06-08 — confirmed via `wrangler dev` +
    // `curl -v`, long before this bug was ever reported) 307-redirects
    // such a request to a CANONICALIZED path that has already decoded
    // `%2F` back into a literal `/`, splitting the id into TWO real path
    // segments before Angular's router ever sees the URL — reproduced
    // locally with no Cloudflare/browser involvement at all by requesting
    // `query/artists/artists_with_albums` directly. A single `:queryId`
    // param (exactly one segment) can never match that shape, hence
    // NG04002 ("cannot match any routes"). This has always been true here —
    // confirmed unchanged all the way back past `a7eaf10` — so this is not
    // something any single commit introduced; it just took a
    // folder-qualified query id in a directly-loaded (not clicked-through)
    // URL to expose it.
    //
    // `QueryPageComponent` never reads this path segment's value anyway —
    // `trackQueryParams()` resolves the real id exclusively from the `?id=`
    // query-string param, where a literal `/` is unambiguous RFC 3986
    // query-component syntax and survives every hop (browser, CDN
    // redirect, HttpClient) intact. So the route only needs to MATCH,
    // regardless of how many real segments the id ends up split across — a
    // wildcard child of the literal 'query' segment does that (1..N
    // trailing segments), where `query/:queryId` only ever matched exactly
    // 1.
    path: 'query',
    children: [
      {
        path: '**',
        loadComponent: () =>
          import('../queries/query/page/query-page.component').then(
            (m) => m.QueryPageComponent,
          ),
      },
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
    path: 'servers',
    loadComponent: () =>
      import('../pages/signed-in/servers/servers-page.component').then(
        (m) => m.ServersPageComponent,
      ),
  },
  {
    // e.g. "db/sqlserver/localhost/AdventureWorks" for MS SQL Server
    path: `server/${routingParamServerType}/:${routingParamDriver}/:${routingParamDbServerId}/:${routingParamDbCatalogId}`,
    loadChildren: () =>
      import('./datatug-routing-proj-db-catalog').then(
        (m) => m.DatatugRoutingProjDbCatalog,
      ),
  },
  {
    // REQ:context-basket (plan task 9) — the former "Variables" empty-shell
    // page; now a real screen (InvestigationContextPageComponent), so it is
    // NOT gated behind ENABLE_EMPTY_SHELL_PAGES like its former siblings.
    path: 'variables',
    loadComponent: () =>
      import(
        '../pages/signed-in/investigation-context/investigation-context-page.component'
      ).then((m) => m.InvestigationContextPageComponent),
  },
  ...(ENABLE_EMPTY_SHELL_PAGES ? emptyShellProjectRoutes : []),
];

@NgModule({
  imports: [RouterModule.forChild(datatugProjectRoutes)],
  exports: [RouterModule],
})
export class DatatugProjectRoutingModule {}
