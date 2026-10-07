import { readProjectApiQuery } from '../../nav/project-api-routing';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Subscription } from 'rxjs';
import { NavigationEnd, Router } from '@angular/router';
import {
  distinctUntilChanged,
  distinctUntilKeyChanged,
  filter,
  first,
  map,
  shareReplay,
  tap,
} from 'rxjs/operators';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { newRandomId } from '@sneat/random';
import { IProjectRef, equalProjectRef } from '../../core/project-context';
import {
  AppContext,
  AppContextService,
} from '../../core/services/app-context.service';
import { IProjectSummary } from '../../models/definition/project';
import {
  IEnvContext,
  IEnvDbContext,
  IEnvDbTableContext,
  IProjectContext,
  parseDatatugStoreRef,
  parseProjectUrl,
  populateProjectBriefFromSummaryIfMissing,
} from '../../nav/nav-models';
import { ProjectContextService } from '../project/project-context.service';
import { ProjectService } from '../project/project.service';
import { EnvironmentService } from '../unsorted/environment.service';
import { IDatatugNavContext } from '../../nav/nav-models';

// What follows the project in its address (`parseProjectUrl().rest`: `/env/<env>/db/<db>/table/<table>`, as typed).
const reEnv = /^\/env\/(.+?)(?:\/|$)/,
  reEnvDb = /^\/env\/\w+\/db\/(.+?)(?:\/|$)/,
  reTable = /\/table\/(.+?)(?:\/|$)/;

/** What an address names: the store, and (when it is a project address) the project and what follows it. */
interface IAddressedLocation {
  readonly storeId?: string;
  readonly projectId?: string;
  readonly spaceID?: string;
  readonly projectApi?: 'cloud' | 'local';
  readonly branch?: string;
  /** `''`, or a path starting with `/`: the page of the project, as typed. */
  readonly rest: string;
}

/** The store of a store address (`/store/<storeId>…`), or none. A project address is read by `parseProjectUrl`. */
function storeIdOfStorePath(path: string): string | undefined {
  const segments = path.split('/');
  if (segments[1] !== 'store' || !segments[2]) {
    return undefined;
  }
  try {
    return decodeURIComponent(segments[2]);
  } catch {
    return segments[2];
  }
}

/** The path of a URL as typed (`https://host/a/b?x#y` and `/a/b?x#y` both give `/a/b`). */
function pathOf(url: string): string {
  return /^(?:[a-z][a-z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)/i.exec(url)?.[1] ?? '';
}

/**
 * Whether the URL's first path segment is `project`: the short address of a GitHub project,
 * `/project/github.com/<owner>/<repo>…` (design `demo-as-github-project.md` 3.4), or the hand-off address
 * `/project/github.com/<owner>/<repo>/chat` that datatug-app's holding page answers. No route of this app starts
 * with `project` other than those (the routes that carry a store start `/store/<id>/`), so such an address names
 * a store, project, environment or table only when a project route has opened it (see `legacyShapeOf`), whatever its
 * owner or repository is called: a repository called `store`, `env` or `table` must not be read as one. Matrix
 * parameters, letter case and percent-encoding are ignored, as the router ignores them.
 */
function startsWithProjectSegment(url: string): boolean {
  let first = pathOf(url).split('/')[1]?.split(/[;(]/)[0] ?? '';
  try {
    first = decodeURIComponent(first);
  } catch {
    // Keep the raw segment.
  }
  return first.toLowerCase() === 'project';
}

// `providedIn: 'root'` — this holds the single URL-derived nav state for the
// whole app; a module-listed provider hands every importing standalone
// component its own copy, each running its own NavigationEnd subscription,
// letting "menu current project" desync from "page current project" (two
// instances confirmed live on one project page). Every dependency injected
// below must stay root-resolvable too, or this constructor throws.
@Injectable({ providedIn: 'root' })
export class DatatugNavContextService {
  private readonly appContext = inject(AppContextService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly router = inject(Router);
  private readonly projectService = inject(ProjectService);
  private readonly envService = inject(EnvironmentService);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);

  readonly id = newRandomId({ len: 5 });
  private readonly $currentContext = new BehaviorSubject<IDatatugNavContext>(
    {},
  );
  public readonly currentContext = this.$currentContext.asObservable();

  private readonly $currentStoreId = new BehaviorSubject<string | undefined>(
    undefined,
  );
  public readonly currentStoreId = this.$currentStoreId
    .asObservable()
    .pipe(distinctUntilChanged());

  private readonly $currentProj = new BehaviorSubject<
    IProjectContext | undefined
  >(undefined);
  public readonly currentProject = this.$currentProj
    .asObservable()
    .pipe(map(populateProjectBriefFromSummaryIfMissing), shareReplay(1));

  private readonly $currentFolder = new BehaviorSubject<string | undefined>(
    undefined,
  );
  public readonly currentFolder = this.$currentFolder.asObservable();

  private readonly $currentEnv = new BehaviorSubject<IEnvContext | undefined>(
    undefined,
  );
  public readonly currentEnv = this.$currentEnv.asObservable().pipe(
    distinctUntilChanged((x, y) => (!x && !y) || x?.id === y?.id),
    tap((v) => console.log('currentEnv changed:', v)),
  );

  private readonly $currentEnvDb = new BehaviorSubject<
    IEnvDbContext | undefined
  >(undefined);
  public readonly currentEnvDb = this.$currentEnvDb.asObservable();

  private readonly $currentEnvDbTable = new BehaviorSubject<
    IEnvDbTableContext | undefined
  >(undefined);
  public readonly currentEnvDbTable = this.$currentEnvDbTable.asObservable();

  private navEndSubscription: Subscription;
  private projectSummarySubscription?: Subscription;

  constructor() {
    const appContext = this.appContext;
    const projectContextService = this.projectContextService;
    this.currentProject.subscribe({
      next: (p) => {
        const projRef = projectContextService.current;
        if (!equalProjectRef(projRef, p?.ref)) {
          projectContextService.setCurrent(p?.ref);
        }
      },
      error: this.errorLogger.logErrorHandler(
        'DatatugNavContextService failed to retrieve current project',
      ),
    });
    this.navEndSubscription = appContext.currentApp
      .pipe(
        filter((a): a is AppContext => !!a),
        distinctUntilKeyChanged('appCode'),
      )
      .subscribe((app) => {
        if (app?.appCode !== 'datatug') {
          if (this.navEndSubscription) {
            this.navEndSubscription.unsubscribe();
          }
          return;
        }
        if (this.navEndSubscription) {
          return;
        }
        console.log(
          'DatatugNavContextService.constructor() => app:',
          app.appCode,
        );
        this.processUrl(location.href);
        this.navEndSubscription = this.router.events
          .pipe(
            filter((val) => val instanceof NavigationEnd),
            map((val) => val as NavigationEnd),
            distinctUntilKeyChanged('urlAfterRedirects'),
          )
          .subscribe({
            next: (val) => {
              // console.log('DatatugNavContextService.constructor() => NavigationEnd:', val);
              this.processUrl(val.urlAfterRedirects);
            },
            error: (err) =>
              this.errorLogger.logError(err, 'Failed to process router event'),
          });
      });
  }

  public setCurrentProject(projectContext?: IProjectContext): void {
    // console.log('DatatugNavContextService.setCurrentProject()', projectContext);
    if (projectContext?.summary && !projectContext.summary.id) {
      this.errorLogger.logError(
        new Error('attempt to set current project with no ID'),
      );
      return;
    }
    if (projectContext) {
      this.$currentStoreId.next(projectContext?.ref.storeId);
    }
    this.projectSummarySubscription?.unsubscribe();
    this.$currentProj.next(projectContext);
    if (!projectContext) {
      return;
    }
    const target = this.projectContextService.current;
    const projRef = projectContext?.ref;
    if (!equalProjectRef(target, projectContext.ref)) {
      this.projectContextService.setCurrent(projRef);
    }
    if (projectContext?.ref?.projectId) {
      this.projectSummarySubscription = this.projectService
        .watchProjectSummary(projRef)
        .subscribe({
          next: (summary) => this.onProjectSummaryChanged(projRef, summary),
          error: (err) => {
            this.onProjectSummaryChanged(projRef, undefined);
            this.errorLogger.logError(
              err,
              'Navigation context failed to get project summary',
              { show: false },
            );
          },
        });
    }
  }

  private onProjectSummaryChanged(
    projRef: IProjectRef,
    summary?: IProjectSummary,
  ): void {
    const currentProj = this.$currentProj.value;
    if (!currentProj || !equalProjectRef(currentProj.ref, projRef)) return;
    if (!summary) {
      this.$currentProj.next({
        ref: currentProj.ref,
        store: currentProj.store,
      });
      return;
    }
    if (!summary.id) summary = { ...summary, id: projRef.projectId };
    this.$currentProj.next({
      ...currentProj,
      ...(projRef.spaceID !== undefined ? { brief: undefined } : {}),
      summary,
    });
  }

  public setCurrentEnvironment(id?: string): void {
    // console.log('DatatugNavContextService.setCurrentEnvironment()', id);
    if (id) {
      this.persistLastEnvId(id);
    }
    if (this.$currentEnv.value?.id === id) {
      return;
    }
    const envContext: IEnvContext | undefined = id
      ? {
          id,
          brief: this.$currentProj.value?.summary?.environments?.find(
            (env) => env.id === id,
          ),
        }
      : undefined;

    if (id && this.$currentProj.value?.ref) {
      this.envService.getEnvSummary(this.$currentProj.value.ref, id).subscribe({
        next: (envSummary) => {
          if (!envSummary) {
            this.errorLogger.logError(
              'API returned nothing for environmentId=' + id,
            );
            return;
          }
          if (this.$currentEnv.value?.id === envSummary.id) {
            this.$currentEnv.next({
              ...envContext,
              id: envContext?.id || '',
              summary: envSummary,
            });
          }
        },
        error: this.errorLogger.logErrorHandler('failed to get env summary'),
      });
    }
    this.$currentEnv.next(envContext || undefined);
    //}
  }

  /**
   * What a URL names: its store, project and the page after the project. A short GitHub address that the short project route has
   * opened (the router state has its `storeId` and `projectId`, so a hand-off address that shows the holding page is
   * not one) names its project and page as the old form of it does. Any other `/project/…` address names no store,
   * project, environment or table (the hand-off address `/project/github.com/<owner>/<repo>/chat` has no store: resolving
   * one used to throw "storeId is a required parameter", logged as an error toast), and all of them clear.
   * `parseProjectUrl` is the one reader of both shapes.
   */
  private locationOf(rawUrl: string): IAddressedLocation {
    const path = pathOf(rawUrl);
    const parsed = parseProjectUrl(path);
    if (startsWithProjectSegment(rawUrl)) {
      if (parsed.ok) {
        let leaf = this.router.routerState?.snapshot?.root;
        while (leaf?.firstChild) {
          leaf = leaf.firstChild;
        }
        if (
          leaf?.paramMap.get('projectId') === parsed.projectId &&
          leaf.paramMap.get('storeId') === parsed.storeId
        ) {
          return parsed;
        }
      }
      return { rest: '' };
    }
    return parsed.ok ? parsed : { storeId: storeIdOfStorePath(path), rest: '' };
  }

  private processUrl(rawUrl: string): void {
    // console.log('DatatugNavContextService.processUrl():', url);
    let where: IAddressedLocation;
    try {
      where = {
        ...this.locationOf(rawUrl),
        ...readProjectApiQuery(
          new URL(rawUrl, 'https://datatug.app').searchParams,
        ),
      };
    } catch {
      this.setCurrentProject(undefined);
      return;
    }
    try {
      this.processStore(where);
      this.processProject(where);
      if (where.spaceID !== undefined) {
        this.$currentEnv.next(undefined);
        this.$currentEnvDb.next(undefined);
        this.$currentEnvDbTable.next(undefined);
        return;
      }
      this.processEnvironment(where.rest);
      this.processEnvDb(where.rest);
      this.processEnvDbTable(where.rest);
    } catch (e) {
      this.errorLogger.logError(e, 'Failed to process URL');
    }
  }

  private processStore(where: IAddressedLocation): void {
    this.$currentStoreId.next(where.storeId || undefined);
  }

  private processProject(where: IAddressedLocation): void {
    const id = where.projectId;
    if (!id) {
      this.setCurrentProject(undefined);
      return;
    }
    const currentProject = this.$currentProj.value;
    const currentStoreId = this.$currentStoreId.value;
    if (
      !currentProject ||
      currentProject.ref.projectId !== id ||
      currentProject.ref.storeId !== currentStoreId ||
      currentProject.ref.spaceID !== where.spaceID ||
      currentProject.ref.projectApi !== where.projectApi ||
      currentProject.ref.branch !== where.branch
    ) {
      // let storeType: DatatugProjStoreType;
      // if (currentStoreId === STORE_ID_GITHUB_COM) {
      // 	storeType = STORE_TYPE_GITHUB;
      // } else {
      // 	storeType = 'agent';
      // }
      const projectContext: IProjectContext = {
        // brief: {access: undefined, title: undefined},
        store: { ref: parseDatatugStoreRef(currentStoreId) },
        ref: {
          projectId: id,
          ...(where.projectApi
            ? { projectApi: where.projectApi, branch: where.branch }
            : {}),
          storeId: currentStoreId || '',
          ...(where.spaceID !== undefined ? { spaceID: where.spaceID } : {}),
        },
      };
      this.setCurrentProject(projectContext);
    }
  }

  private processEnvironment(url: string): void {
    const m = url.match(reEnv);
    const id = m && m[1];
    if (id) {
      this.setCurrentEnvironment(id);
    } else if (!location.search.includes('env=')) {
      // No `/env/:id` path segment and no `?env=` query param — a query
      // page reached without either (the context panel's "open a query"
      // hand-off, or a direct/reloaded navigation to `/query/:id`) has no
      // way to name its own environment in the URL at all, yet still needs
      // one: `InvestigationContextService`'s basket is scoped by
      // `{agentUrl, project, environment, securityContextId}`, so clearing
      // to `undefined` here opens an always-empty scope — the "Customer.ID
      // · from context" binding a value was already added under (on an
      // `/env/local/...` page) can never be found this way, even though the
      // basket itself is still sitting in sessionStorage under the *real*
      // environment. Falling back to the last environment this store+project
      // actually resolved (also sessionStorage-persisted, survives a full
      // reload the same way the basket itself does) instead of clearing
      // keeps that basket reachable — confirmed live, journey J3, lane S92.
      // A project with no prior environment at all (nothing ever
      // persisted) still clears to `undefined`, unchanged from before.
      this.setCurrentEnvironment(this.lastPersistedEnvId());
    }
    // console.log('processEnvironment', id);
  }

  /** `sessionStorage` key for the last environment id resolved for the
   * current store+project — `undefined` (skip persistence/lookup entirely)
   * until both are known, so this can never key state to the wrong
   * store/project. `sessionStorage` (not `localStorage`) matches
   * `InvestigationContextService`'s own per-tab, per-scope persistence
   * choice (api-contract.md: "a new tab starts without another tab's
   * context") — the whole point is to survive a reload within this tab,
   * never to carry across tabs. */
  private lastEnvStorageKey(): string | undefined {
    if (this.$currentProj.value?.ref.spaceID !== undefined) return undefined;
    const storeId = this.$currentStoreId.value;
    const projectId = this.$currentProj.value?.ref.projectId;
    if (!storeId || !projectId) {
      return undefined;
    }
    return `datatug:lastEnv:${storeId}:${projectId}`;
  }

  private persistLastEnvId(id: string): void {
    const key = this.lastEnvStorageKey();
    if (!key) {
      return;
    }
    try {
      sessionStorage.setItem(key, id);
    } catch {
      // sessionStorage unavailable (private mode, SSR, full quota) — the
      // in-memory current-env state still works for this page load, it
      // just won't survive a reload. Same tolerance
      // InvestigationContextService's own persist()/restore() apply.
    }
  }

  private lastPersistedEnvId(): string | undefined {
    const key = this.lastEnvStorageKey();
    if (!key) {
      return undefined;
    }
    try {
      return sessionStorage.getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private processEnvDb(url: string): void {
    const m = url.match(reEnvDb);
    const id = m && m[1];
    // console.log('processEnvDb', id);
    if (this.$currentEnvDb.value?.id !== id) {
      this.$currentEnvDb.next({ id: id || '' });
    }
  }

  private processEnvDbTable(url: string): void {
    const m = url.match(reTable);
    const id = m && m[1];
    // console.log('processEnvDbTable', id);
    if (!id) {
      if (this.$currentEnvDbTable.value) {
        this.$currentEnvDbTable.next(undefined);
      }
      return;
    }
    const currentTable = this.$currentEnvDbTable.value;

    // eslint-disable-next-line prefer-const
    let [schema, name] = id.split('.');
    if (!name) {
      name = schema;
    }
    const project = this.$currentProj.value;
    if (currentTable?.name !== name || currentTable?.schema !== schema) {
      this.$currentEnvDbTable.next({ name, schema });
      this.projectService
        .getFull(project?.ref || { projectId: '', storeId: '' })
        .pipe(first())
        .subscribe({
          next: (p) => {
            try {
              if (
                this.$currentEnvDbTable.value?.name !== name ||
                this.$currentEnvDbTable.value?.schema !== schema
              ) {
                return; // TODO(help-wanted): Do it with a pipe operator that cancels subscription when table changes
              }
              const envId = this.$currentEnv.value?.id;
              const env = p.environments?.find((e) => e.id === envId);
              if (!env) {
                this.errorLogger.logError('unknown environment: ' + envId);
                return;
              }
              // const dbId = this.$currentEnvDb.value?.id;
              // const database = env.databases.find(db => db.id === dbId)
              // if (!database) {
              // 	this.errorLoggerService.logError('unknown db: ' + dbId);
              // 	return;
              // }
              // const meta = database.tables.find(t => t.name === name && t.schema === schema);
              // this.$currentEnvDbTable.next({...currentTable, meta, name: meta.name, schema: meta.schema});
            } catch (e) {
              this.errorLogger.logError(
                e,
                'Failed to process project to get table meta',
              );
            }
          },
          error: (err) =>
            this.errorLogger.logError(err, 'Failed to load project'),
        });
    }
  }
}
