import { Injectable, inject } from '@angular/core';
import { NavController } from '@ionic/angular';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import {
  IProjBoard,
  IProjEntity,
  IProjEnv,
} from '../../models/definition/project';
import { IQueryDef } from '../../models/definition/query-def';
import {
  getStoreId,
  IDatatugStoreContext,
  IProjectContext,
  ProjectPage,
  tryProjectUrl,
} from '../../nav/nav-models';
import { IProjectRef, isValidProjectRef } from '../../core/project-context';
import { projectPageHref } from '../../nav/project-page-href';
import { IStoreRef, storeRefToId } from '@sneat/core';

type NavigationOptions = NonNullable<
  Parameters<NavController['navigateRoot']>[1]
>;

export type ProjectTopLevelPage =
  | 'chat'
  | 'demo-db-sandbox'
  | 'overview'
  | 'boards'
  | 'dbmodels'
  | 'entities'
  | 'environments'
  | 'servers'
  | 'queries'
  | 'public-data'
  | 'query'
  | 'tags'
  | 'variables'
  | 'widgets';

// `providedIn: 'root'` — the app has multiple sibling `<router-outlet>`s
// (the side menu is a *named* outlet, not an ancestor of the routed page
// outlet — see `apps/datatug-app/src/app/datatug-app.component.html`), so a
// feature-module-scoped provider is only available to whichever routed page
// component happens to import that module itself. Several page components
// injected this service without doing so and crashed with
// `NullInjectorError: No provider for DatatugNavService` (e.g. navigating to
// a project's "queries" tab) — see
// `spec/research/2026-09-09-web-ui-audit.md`. Root-providing it fixes every
// route uniformly; its dependencies (`NavController`, `ErrorLogger`) are
// both already provided at the application root.
@Injectable({ providedIn: 'root' })
export class DatatugNavService {
  private readonly nav = inject(NavController);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);

  goStore(store: IDatatugStoreContext): void {
    if (!store?.ref) {
      throw new Error('store.ref is a required parameter');
    }
    // `storeRefToId()` (`@sneat/core`) returns an `'agent'` ref's `.url`
    // verbatim — and since the `parseDatatugStoreRef` fix, that `.url` is a
    // genuine `scheme://host:port` URL (e.g. from a `"http-localhost:8989"`
    // id). Route segments must stay in the app's dash-prefixed canonical
    // id form (`"http-localhost:8989"`), or `['store', storeId]` below
    // produces a broken multi-segment path (`/store/http://localhost:8989`).
    // `getStoreId()` (this app's `nav-models.ts`) is the inverse of that
    // `://` conversion, and is a no-op passthrough for every other ref
    // type/form — see its use in `projectPageUrl()`/`goTable()` below.
    const storeId = getStoreId(storeRefToId(store.ref));
    const options: NavigationOptions | undefined = store.brief
      ? { state: { store } }
      : undefined;
    this.navRoot(
      ['store', storeId],
      'Failed to navigate to store page',
      options,
    );
  }

  goProject(project?: IProjectContext, page?: ProjectTopLevelPage): void {
    // console.log('DatatugNavService.goProject()', project, page);
    const storeRef: IStoreRef | undefined = project?.store?.ref;
    const storeId: string =
      storeRef?.id || project?.ref?.storeId || storeRef?.type || '';
    if (!project?.ref.projectId) {
      return;
    }
    const errMessage = 'Failed to navigate to project page ' + page;
    const url = this.addressOf({ ...project.ref, storeId }, page, errMessage);
    if (url === undefined) {
      return;
    }
    const options: NavigationOptions | undefined = project.brief
      ? { state: { project } }
      : undefined;
    this.navRoot(url, errMessage, options);
  }

  goEnvironment(
    project?: IProjectContext,
    projEnv?: IProjEnv,
    envId?: string,
  ): void {
    if (!project) {
      return;
    }
    const errMessage = 'Failed to navigate to environment page';
    const id = projEnv?.id || envId;
    const url = this.addressOf(
      project.ref,
      id ? ['env', id] : 'env',
      errMessage,
    );
    if (url === undefined) {
      return;
    }
    this.navForward(url, { state: { project, projEnv } }, errMessage);
  }

  // goCatalog: env/:envId/db/:catalogId (EnvDbPageComponent — the catalog
  // overview page one level above goTable()'s own /table/<type> route).
  // Nothing navigated here before Task 17 item B.1 (S121) — the environment
  // page's own "databases" section either didn't exist or its click handler
  // was commented out (`// goDb(envDb)`, environment-page.component.ts).
  goCatalog(project: IProjectContext, envId: string, catalogId: string): void {
    const errMessage = 'Failed to navigate to catalog page';
    const url = this.addressOf(
      project.ref,
      ['env', envId, 'db', catalogId],
      errMessage,
    );
    if (url === undefined) {
      return;
    }
    this.navForward(url, { state: { project } }, errMessage);
  }

  goEntity(
    project: IProjectContext,
    projEntity: IProjEntity,
    entityId?: string,
  ): void {
    if (!project) {
      return;
    }
    const errMessage = 'Failed to navigate to entity page';
    const id = projEntity?.id || entityId;
    const url = this.addressOf(
      project.ref,
      id ? ['entity', id] : 'entity',
      errMessage,
    );
    if (url === undefined) {
      return;
    }
    this.navForward(url, { state: { project, projEntity } }, errMessage);
  }

  goQuery(
    project: IProjectContext,
    query: IQueryDef,
    action?: 'execute' | 'edit' | 'create',
  ): void {
    // console.log('goQuery', query.id);
    // The id is its own page segment — `projectUrl()` writes a segment
    // `encodeURIComponent()`ed, which is required once a query's id can be
    // folder-qualified (e.g. `customers/customer-invoices`, per
    // `queries/applicable`'s `Candidate.queryId` contract, datatug-cli#219):
    // without an id segment here at all, the built URL (`.../project/<id>/query`)
    // never matched the registered `query/:queryId` route
    // (`datatug-routing-proj.ts`), so this navigation 404'd for every id, not
    // only a folder-qualified one.
    const errMessage = 'Failed to navigate to query page';
    const url = this.addressOf(
      project.ref,
      query.id ? ['query', query.id] : 'query',
      errMessage,
    );
    if (url === undefined) {
      return;
    }
    this.navForward(
      url,
      {
        state: {
          project,
          query,
          action,
        },
        queryParams: {
          id: query.id,
          ...(project.ref.projectApi
            ? { projectApi: project.ref.projectApi, branch: project.ref.branch }
            : {}),
        },
      },
      errMessage,
    );
  }

  goBoard(
    project: IProjectContext,
    projBoard: IProjBoard,
    boardId?: string,
  ): void {
    const errMessage = 'Failed to navigate to board page';
    const id = projBoard?.id || boardId;
    const url = this.addressOf(
      project.ref,
      id ? ['board', id] : 'board',
      errMessage,
    );
    if (url === undefined) {
      return;
    }
    this.navForward(url, { state: { project, projBoard } }, errMessage);
  }

  /**
   * The address of a project page (`name`, and the item `id` as one segment): for a link in a template. A project
   * with no exact address (`tryProjectUrl` refuses its id) has no page to link to: the root.
   */
  public projectPageUrl(c: IProjectRef, name: string, id?: string): string {
    return projectPageHref(c, id ? [name, id] : [name]);
  }

  /**
   * The one address of a project page, from `projectUrl()`'s rules (design `demo-as-github-project.md` 3.4: the
   * short form for a GitHub project, `/store/<storeId>/project/<projectId>` for every other store). When the project
   * has no exact address nothing is navigated: the failure is logged, and `undefined` returned.
   */
  private addressOf(
    ref: IProjectRef,
    page: ProjectPage | undefined,
    errMessage: string,
  ): string | undefined {
    const url = tryProjectUrl(ref, page);
    if (typeof url === 'string') {
      return url;
    }
    this.errorLogger.logError(
      new Error(`no exact address for the project (${url.reason})`),
      errMessage,
    );
    return undefined;
  }

  goProjPage(
    projPage: string,
    project?: IProjectContext,
    state?: Record<string, unknown>,
  ): void {
    if (!project) {
      throw new Error('project is a required parameter');
    }
    if (!isValidProjectRef(project.ref)) {
      throw new Error('project.ref is a required parameter');
    }
    state = { ...state, project };
    const errMessage = 'Failed to navigate to project page: ' + projPage;
    const url = this.addressOf(project.ref, projPage, errMessage);
    if (url === undefined) {
      return;
    }
    this.navForward(url, { state }, errMessage);
  }

  goTable(to: IDbObjectNavParams): void {
    // Was missing the leading 'store', <storeId> segment entirely (and encoded the
    // store id as `<projectId>@<storeId>` under a bare 'project' segment instead of
    // the actual registered route shape below) — so this never matched
    // `datatugRoutes` (`store/:storeId/project/:projectId/env/:environmentId/db/
    // :dbCatalogId/table/:tableType`, see datatug-routing*.ts) and both
    // EnvDbPageComponent's row click and EnvDbTablePageComponent's foreign-key link
    // click silently no-op'd. Found by S10's journey e2e (see e2e/journey/README.md
    // "Known gap"); fixed here since both call sites share this one method.
    const errMessage = 'Failed to navigate to environment table page';
    const url = this.addressOf(
      to.project.ref,
      ['env', to.env, 'db', to.db, 'table', `${to.schema}.${to.name}`],
      errMessage,
    );
    if (url === undefined) {
      return;
    }
    this.navRoot(url, errMessage);
  }

  private navRoot(
    url: string[] | string,
    errMessage: string,
    options?: NavigationOptions,
  ): void {
    // console.log('navRoot', url);
    this.nav
      .navigateRoot(url, options)
      .catch((err) => this.errorLogger.logError(err, errMessage));
  }

  private navForward(
    url: string[] | string,
    options: NavigationOptions,
    errMessage: string,
  ): void {
    // console.log('navForward()', url, options);
    this.nav
      .navigateForward(url, options)
      .catch(this.errorLogger.logErrorHandler(errMessage));
  }
}

export interface IDbObjectNavParams {
  project: IProjectContext;
  env: string;
  db: string;
  schema: string;
  name: string;
}
