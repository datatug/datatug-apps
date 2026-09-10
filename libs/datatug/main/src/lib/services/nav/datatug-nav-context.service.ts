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
import { IProjectRef } from '../../core/project-context';
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
  populateProjectBriefFromSummaryIfMissing,
} from '../../nav/nav-models';
import { ProjectContextService } from '../project/project-context.service';
import { ProjectService } from '../project/project.service';
import { EnvironmentService } from '../unsorted/environment.service';
import { IDatatugNavContext } from '../../nav/nav-models';

const reStore = /\/store\/(.+?)($|\/)/,
  reProj = /\/project\/(.+?)($|\/)/,
  reEnv = /\/env\/(.+?)(?:\/|$)/,
  reEnvDb = /\/env\/\w+\/db\/(.+?)(?:\/|$)/,
  reTable = /\/table\/(.+?)(?:\/|$)/;

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

  constructor() {
    const appContext = this.appContext;
    const projectContextService = this.projectContextService;
    this.currentProject.subscribe({
      next: (p) => {
        const projRef = projectContextService.current;
        if (
          projRef?.projectId !== p?.ref?.projectId ||
          projRef?.storeId !== p?.ref?.storeId
        ) {
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
    this.$currentProj.next(projectContext);
    if (!projectContext) {
      return;
    }
    const target = this.projectContextService.current;
    const projRef = projectContext?.ref;
    if (
      target?.storeId !== projectContext?.ref?.storeId ||
      target?.projectId !== projectContext?.ref?.projectId
    ) {
      this.projectContextService.setCurrent(projRef);
    }
    if (projectContext?.ref?.projectId) {
      this.projectService.watchProjectSummary(projRef).subscribe({
        next: (summary) => this.onProjectSummaryChanged(projRef, summary),
        error: (err) =>
          this.errorLogger.logError(
            err,
            'Navigation context failed to get project summary',
            { show: false },
          ),
      });
    }
  }

  private onProjectSummaryChanged(
    projRef: IProjectRef,
    summary?: IProjectSummary,
  ): void {
    if (!summary) {
      // this.errorLogger.logError(new Error('Returned empty project summary'),
      // 	`project: ${projectContext.brief.id} @ ${projectContext.storeId}`);
      return;
    }
    if (!summary.id) {
      summary = { ...summary, id: projRef.projectId };
    }
    const currentProj = this.$currentProj.value;
    if (currentProj?.ref.projectId === summary.id) {
      this.$currentProj.next({ ...currentProj, summary });
    }
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

  private processUrl(url: string): void {
    // console.log('DatatugNavContextService.processUrl():', url);
    try {
      this.processStore(url);
      this.processProject(url);
      this.processEnvironment(url);
      this.processEnvDb(url);
      this.processEnvDbTable(url);
    } catch (e) {
      this.errorLogger.logError(e, 'Failed to process URL');
    }
  }

  private processStore(url: string): void {
    const m = url.match(reStore);
    // console.log('processStore', url, m);
    const storeId = m && m[1];
    this.$currentStoreId.next(storeId || undefined);
  }

  private processProject(url: string): void {
    const m = url.match(reProj);
    const id = m && m[1];
    if (!id) {
      this.setCurrentProject(undefined);
      return;
    }
    const currentProject = this.$currentProj.value;
    const currentStoreId = this.$currentStoreId.value;
    if (
      !currentProject ||
      currentProject.ref.projectId !== id ||
      currentProject.ref.storeId !== currentStoreId
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
        ref: { projectId: id, storeId: currentStoreId || '' },
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
