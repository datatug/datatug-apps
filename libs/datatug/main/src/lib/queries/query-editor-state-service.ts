import { equalProjectRef } from '../core/project-context';
import {
  fromProjectQueryWire,
  toProjectQueryWire,
  UnsupportedQueryContractError,
} from './project-query-contract';
import { type ProjectQuerySave } from '../services/project/project-query-api.service';
import {
  defer,
  switchMap,
  Subscription,
  distinctUntilChanged,
  Subject,
  takeUntil,
} from 'rxjs';
import { Injectable, inject } from '@angular/core';
import {
  BehaviorSubject,
  catchError,
  map,
  Observable,
  tap,
  throwError,
} from 'rxjs';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IProjectRef } from '../core/project-context';
import { IProjectContext } from '../nav/nav-models';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { ProjectService } from '../services/project/project.service';
import { QueriesService } from './queries.service';
import { IParameterDef } from '../models/definition/parameter';
import { filter } from 'rxjs/operators';
import {
  IHttpQueryRequest,
  IQueryDef,
  ISqlQueryRequest,
  QueryType,
} from '../models/definition/query-def';
import { IQueryEditorState, IQueryState } from '../editor/models';

export const isQueryChanged = (queryState: IQueryState): boolean => {
  if (!queryState) {
    return false;
  }
  const { def } = queryState;
  if (queryState.isNew) {
    return true;
  }
  if (!def || def.title != queryState.title) {
    return true;
  }
  if (
    JSON.stringify(queryState.federation ?? def.federation) !==
    JSON.stringify(def.federation)
  ) {
    return true;
  }
  if (def.request.queryType !== queryState.request?.queryType) {
    throw new Error(
      `def.request.type !== queryState.request.type: ${def.request.queryType} !== ${queryState.request?.queryType}`,
    );
  }
  switch (queryState?.request?.queryType) {
    // S121c (Task 17, exposed by real navigation to a DTQL saved query,
    // e.g. `customer-invoices`): `QueryType.DTQL` was added by S121b
    // (query-def.ts) for `all_queries`/`get_query`'s real, server-reported
    // type, but this switch — pre-existing, untouched by S121/S121b — was
    // never updated to match, so opening ANY DTQL query fell to `default`
    // and threw "Unknown query request type: DTQL" the moment
    // `query-page.component.ts`'s `isChanged` getter read it (every
    // template render). `queries.service.ts`'s own `toQueryRequest()`
    // (S121) adapts a DTQL wire item to the exact same `{queryType, text}`
    // shape as SQL (its own comment: "SQL and DTQL alike"), so the same
    // `.text` comparison applies verbatim — grouped into the same case
    // rather than duplicated.
    case QueryType.SQL:
    case QueryType.DTQL:
      return (
        (queryState.request as ISqlQueryRequest).text !=
        (def.request as ISqlQueryRequest).text
      );
    case QueryType.HTTP:
      return (
        (queryState.request as IHttpQueryRequest).url !=
        (def.request as IHttpQueryRequest).url
      );
    default:
      throw new Error(
        'Unknown query request type: ' + queryState.request.queryType,
      );
  }
};

const $state = new BehaviorSubject<IQueryEditorState | undefined>(undefined);

let counter = 0;

// `providedIn: 'root'` (S157, follows PR #96/#115's `providedIn: 'root'`
// fix for `ProjectContextService`/`DatatugStoreGithubService`): this used
// to be a plain `@Injectable()`, provided only via
// `DatatugQueriesServicesModule`'s `providers:` array. A standalone
// component that lists that module in its own `imports` (`QueryPageComponent`,
// `QueriesPageComponent`) gets its OWN environment injector carrying a
// fresh instance — fine on its own, but `ProjectMenuComponent`'s side-menu
// "Active Queries" tab (`QueriesMenuComponent`) injects this service
// directly, without importing that module anywhere in its own ancestor
// chain (`DatatugMenuComponent`, the side menu's host, imports several
// other datatug-services modules but never this one) — so selecting that
// tab threw `NG0201: No provider found for QueryEditorStateService`
// (confirmed live, S157 founder report). Root-providing it (and removing
// it from the module's `providers:`, since a module-level entry would
// shadow the root singleton in every injector that imports the module —
// same trap #96/#115 fixed) makes it resolvable from any injector, and
// gives the menu and the query pages the ONE shared instance the "active
// queries" state is meant to be (see `queries-menu.component.ts`'s and
// `query/page/query-page.component.ts`'s own comments).
@Injectable({ providedIn: 'root' })
export class QueryEditorStateService {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly queriesService = inject(QueriesService);
  private readonly projectService = inject(ProjectService);
  readonly datatugNavContextService = inject(DatatugNavContextService);

  public readonly queryEditorState = $state
    .asObservable()
    .pipe(filter((state) => !!state));

  private currentProject?: IProjectContext;
  private generation = 0;
  private readonly scopeReset = new Subject<void>();
  private authSubscription?: Subscription;
  private denialSubscription?: Subscription;
  private readonly quarantinedQueries = new Map<string, IQueryState>();
  private readonly readVersions = new Map<string, number>();
  private readonly pendingSaves = new Map<
    string,
    { payload: string; request: ProjectQuerySave }
  >();

  private clearScope(): void {
    this.generation += 1;
    this.scopeReset.next();
    this.pendingSaves.clear();
    this.quarantinedQueries.clear();
    this.readVersions.clear();
    $state.next({ activeQueries: [] });
  }

  public reloadQuery(id: string): void {
    this.pendingSaves.delete(id);
    const current = this.getQueryState(id);
    if (!current) return;
    this.updateQueryState({
      id,
      queryType: QueryType.SQL,
      request: { queryType: QueryType.SQL, text: '' } as ISqlQueryRequest,
      isLoading: true,
    });
    this.loadQuery(id);
  }

  constructor() {
    const datatugNavContextService = this.datatugNavContextService;
    datatugNavContextService.currentProject.subscribe((currentProject) => {
      if (!equalProjectRef(this.currentProject?.ref, currentProject?.ref)) {
        this.authSubscription?.unsubscribe();
        this.denialSubscription?.unsubscribe();
        this.clearScope();
        if (currentProject?.ref.projectApi === 'cloud') {
          this.denialSubscription = this.queriesService
            .authorityDenied?.()
            .subscribe((denied) => {
              if (equalProjectRef(this.currentProject?.ref, denied))
                this.clearScope();
            });
          this.authSubscription = this.queriesService
            .authentication()
            .pipe(
              map((auth) =>
                JSON.stringify([
                  auth.status,
                  auth.user?.uid,
                  auth.user?.providerData?.map((p) => [p.providerId, p.uid]),
                ]),
              ),
              distinctUntilChanged(),
            )
            .subscribe(() => this.clearScope());
        }
      }
      this.currentProject = currentProject;
      if (this.currentProject?.summary) {
        $state.next(
          this.updateQuerySatesWithProj($state.value || { activeQueries: [] }),
        );
      }
    });
  }

  public getQueryState(id: string): IQueryState | undefined {
    return $state.value?.activeQueries.find((qs) => qs.id === id);
  }

  public setCurrentQuery(id: string): void {
    const newState: IQueryEditorState = $state.value
      ? {
          ...$state.value,
          currentQueryId: id,
        }
      : { currentQueryId: id, activeQueries: [] };
    $state.next(newState);
  }

  public closeQuery(query: IQueryState): void {
    this.quarantinedQueries.delete(query.id || '');
    this.pendingSaves.delete(query.id || '');
    this.readVersions.set(
      query.id || '',
      (this.readVersions.get(query.id || '') || 0) + 1,
    );
    const newState: IQueryEditorState = {
      ...$state.value,
      activeQueries:
        $state.value?.activeQueries.filter((q) => q !== query) ?? [],
    };
    $state.next(newState);
  }

  openQuery(id: string): void {
    try {
      let changed = false;
      let state: IQueryEditorState = $state.value || {
        currentQueryId: id,
        activeQueries: [],
      };
      let queryState = state?.activeQueries?.find((q) => q.id === id);
      if (
        this.currentProject?.ref.projectApi === 'cloud' &&
        queryState &&
        !queryState.isNew
      ) {
        // Cached private content remains hidden until a fresh read authorizes it.
        // Retain draft + original CAS privately across transient failures; never silently rebase.
        if (queryState.def) this.quarantinedQueries.set(id, queryState);
        state = {
          ...state,
          activeQueries: state.activeQueries.filter((q) => q.id !== id),
        };
        queryState = undefined;
      }
      if (!queryState) {
        queryState = {
          id,
          queryType: QueryType.SQL,
          request: {
            queryType: QueryType.SQL,
            text: '',
          } as ISqlQueryRequest,
          isLoading: true,
        };
        state = {
          ...state,
          activeQueries: [queryState, ...(state.activeQueries || [])],
        };
        changed = true;
      }
      if (state.currentQueryId !== id) {
        state = {
          ...state,
          currentQueryId: id,
        };
        changed = true;
      }
      if (changed) {
        $state.next(this.updateQueryStatesWithEnvs(state));
      }
      if (queryState.isLoading) this.loadQuery(id);
    } catch (err) {
      this.errorLogger.logError(err, 'failed to openQuery');
    }
  }

  private loadQuery(id: string): void {
    const generation = this.generation;
    const onCompleted = (def?: IQueryDef) => {
      if (generation !== this.generation) return;
      const activeQuery = $state.value?.activeQueries.find((q) => q.id === id);
      if (!activeQuery) {
        return;
      }
      // Captured before `isLoading` gets forced to `false` two lines below:
      // `true` only for the very first `onCompleted()` after `openQuery()`
      // seeded the placeholder (see the S121c comment just below) — used by
      // this method's own `request` swap-in check, since a SQL query's real
      // `def.request.queryType` is `'SQL'`, identical to that placeholder's
      // hard-coded `queryType: QueryType.SQL` default (S136: confirmed live,
      // opening a legacy `.sql.json` saved query — `def.request.text` (the
      // real SQL body, correctly fetched over the wire) never replaced the
      // placeholder's `text: ''`, because the S121c fix below only swaps in
      // `def.request` when `queryType` DIFFERS from the placeholder's,
      // leaving every SQL-type query's body permanently blank; DTQL/HTTP
      // queries were fine only because their real type differs from the
      // SQL placeholder's).
      const wasLoading = activeQuery.isLoading;
      let state: IQueryState = {
        ...activeQuery,
        isLoading: false,
      };
      if (def) {
        state = { ...state, def };
      }
      // S121c (Task 17, exposed by real navigation to a non-SQL saved
      // query): `openQuery()` above always seeds a brand-new `queryState`
      // with a hard-coded `{ queryType: QueryType.SQL, text: '' }`
      // placeholder `request`, before `def` (the real loaded query, of
      // whatever actual type) arrives here. The ORIGINAL condition only
      // adopted `def.request` when the placeholder's `text` was still
      // `undefined` — which it never is (the placeholder sets `text: ''`,
      // not `undefined`), so `state.request` stayed stuck on the SQL
      // placeholder forever, for every query type. `isQueryChanged()`
      // (this file, above) then throws `def.request.type !==
      // queryState.request.type: <real type> !== SQL` the first time
      // anything reads it (query-page.component.ts's own `hasChanges`
      // getter, evaluated by its template), which aborts that component's
      // render — reproduced live opening `customer-invoices` (DTQL) and
      // `country-facts` (HTTP): Title/Folder/Parameters never populate,
      // console shows exactly that thrown error. A SQL query never
      // surfaced this because its placeholder type already matched. Fix:
      // adopt `def.request` whenever its `queryType` doesn't yet match the
      // current `state.request`'s, OR this is the first load regardless of
      // type (`wasLoading`, S136's own follow-up fix above — the original
      // `queryType`-only check left every SQL query's body permanently
      // blank, since a real SQL query's type matches the placeholder's) —
      // true exactly once, on this first real load, for every query type;
      // once synced, a later edit changes `state.request`'s own fields but
      // not its `queryType`, and `wasLoading` is only ever true here once,
      // so this never fires again and never clobbers in-progress user
      // edits.
      if (wasLoading || state.request?.queryType !== def?.request?.queryType) {
        state = { ...state, request: def?.request };
      }
      if (state.title === undefined) {
        state = { ...state, title: def?.title };
      }
      state = this.updateQueryStateWithEnvs(state);
      if (!state.targetDbModel) {
        state = {
          ...state,
          targetDbModel: def?.dbModel
            ? this.currentProject?.summary?.dbModels?.find(
                (m) => m.id === def.dbModel,
              )
            : this.currentProject?.summary?.dbModels?.length === 1
              ? this.currentProject?.summary?.dbModels[0]
              : undefined,
        };
      }
      this.updateQueryState(state);
    };
    if (this.currentProject) {
      const currentProject = this.currentProject;
      if (currentProject.ref.projectApi) {
        const readVersion = (this.readVersions.get(id) || 0) + 1;
        this.readVersions.set(id, readVersion);
        this.queriesService
          .getRevision(currentProject.ref, id)
          .pipe(
            map((result) => ({
              result,
              def: fromProjectQueryWire(result.query),
            })),
            takeUntil(this.scopeReset),
          )
          .subscribe({
            next: ({ result, def }) => {
              if (
                generation !== this.generation ||
                this.readVersions.get(id) !== readVersion
              )
                return;
              const cached = this.quarantinedQueries.get(id);
              if (cached) {
                this.quarantinedQueries.delete(id);
                this.updateQueryState({
                  ...cached,
                  isLoading: false,
                  saveError: undefined,
                  saveSupported:
                    result.saveSupported !== false &&
                    cached.saveSupported !== false,
                });
                return;
              }
              onCompleted(def);
              const state = this.getQueryState(id);
              if (state)
                this.updateQueryState({
                  ...state,
                  revision: result.revision,
                  branchHead: result.branchHead,
                  saveSupported: result.saveSupported !== false,
                  saveError:
                    result.saveSupported === false
                      ? 'This legacy query can be read, but the current save API cannot preserve all its fields.'
                      : undefined,
                });
            },
            error: (error) => {
              if (
                generation !== this.generation ||
                this.readVersions.get(id) !== readVersion
              )
                return;
              if (
                currentProject.ref.projectApi === 'cloud' &&
                [401, 403].includes(error?.status)
              ) {
                this.clearScope();
                return;
              }
              const state = this.getQueryState(id);
              if (state)
                this.updateQueryState({
                  ...state,
                  isLoading: false,
                  saveError:
                    'The query could not be loaded. Any unsaved draft is retained until access can be checked; try opening it again.',
                });
            },
          });
        return;
      }
      // `id` here may be a bare id (`customer-invoices`) or, as of
      // datatug-cli#219, the folder-qualified id `queries/applicable`'s
      // `Candidate.queryId` now returns (`customers/customer-invoices`).
      // `ProjectItemService.getProjItem()` passes it through `HttpClient`'s
      // plain-object `params`, whose default `HttpUrlEncodingCodec`
      // deliberately un-escapes `%2F` back to a literal `/` (a documented
      // Angular quirk) — so the folder-qualified id reaches the server as
      // `query=customers/customer-invoices`, a literal `/` inside the query
      // *component* of the URL, which is valid per RFC 3986 and exactly what
      // `get_query` (datatug-cli#219) now parses — no extra encoding needed
      // here.
      this.queriesService.getQuery(currentProject.ref, id).subscribe({
        next: (def) => onCompleted(def),
        // `GET /datatug/queries/get_query?...&query=<id>` used to 500 for every
        // query in a folder when given only the *bare* id (datatug-core's
        // fsQueriesStore.LoadQuery split `id` on `/` to derive folder+item, so a
        // bare id like "customer-invoices" resolved to no folder and looked
        // directly under `queries/`, never `queries/<folder>/`). datatug-cli#219
        // fixes `get_query` to also accept the folder-qualified id (see comment
        // above), so this primary call now succeeds for it too — but this
        // fallback stays: it's still load-bearing for any other `get_query`
        // failure (server not yet on #219, network hiccup, a genuinely bare id
        // for a query that server-side still can't resolve, etc). `GET
        // /datatug/projects/project_full`'s response embeds each query's
        // FULL definition (parameters included) directly under
        // `queries.folders[].items[]`, keyed by that same bare id under its
        // folder's own id — `findQueryInProjectFull()` matches either form of
        // `id` against that shape. Falling back to it here (only on a
        // `get_query` error, so an id that already works — e.g. a
        // flat/unfoldered query — is unaffected) fixes AC:bound-from-selection
        // / AC:context-carries without depending on a server change (lane S92,
        // journey J2/J3) — confirmed live: this exact 500 blocked every query
        // this demo project has.
        error: () =>
          this.loadQueryFromProjectFull(currentProject, id, onCompleted),
      });
    }
  }

  /** Minimal shape of what `GET /datatug/projects/project_full` actually
   * embeds per query item — `IProjectFull` (models/definition/project.ts)
   * doesn't yet declare this (a separate, pre-existing contract gap, not
   * fixed here: that interface predates the server's current `project_full`
   * response and several other callers read it too — out of this stream's
   * scope). Deliberately narrow: only the fields `updateBindings()` and this
   * method's own `onCompleted` adapter actually read.
   *
   * `id` may be either the bare item id (`customer-invoices`, the only form
   * this app used to see) or the folder-qualified id `queries/applicable`'s
   * `Candidate.queryId` now returns as of datatug-cli#219
   * (`customers/customer-invoices`) — items here are still keyed by their
   * own bare id, grouped under a `folder.id` (e.g. `customers`), so a
   * folder-qualified id is matched by joining the two back together. */
  private static findQueryInProjectFull(
    full: unknown,
    id: string,
  ): IQueryDef | undefined {
    const folders = (
      full as {
        queries?: {
          folders?: readonly {
            id?: string;
            items?: readonly {
              id: string;
              title?: string;
              type?: string;
              text?: string;
              parameters?: readonly IParameterDef[];
            }[];
          }[];
        };
      }
    )?.queries?.folders;
    for (const folder of folders ?? []) {
      const item = folder.items?.find(
        (i) => i.id === id || (folder.id && `${folder.id}/${i.id}` === id),
      );
      if (item) {
        return {
          id: item.id,
          title: item.title ?? item.id,
          request: {
            queryType: QueryType.SQL,
            text: item.text ?? '',
          } as ISqlQueryRequest,
          parameters: item.parameters as IParameterDef[] | undefined,
        };
      }
    }
    return undefined;
  }

  private loadQueryFromProjectFull(
    project: IProjectContext,
    id: string,
    onCompleted: (def?: IQueryDef) => void,
  ): void {
    this.projectService.getFull(project.ref).subscribe({
      next: (full) =>
        onCompleted(QueryEditorStateService.findQueryInProjectFull(full, id)),
      error: (err) => {
        this.errorLogger.logError(
          err,
          `Failed to load query[${id}] from project_full fallback`,
        );
        onCompleted();
      },
    });
  }

  public newQuery(queryState: IQueryState): IQueryState {
    if (!queryState.title) {
      for (;;) {
        counter += 1;
        const title = `Query #${counter}`;
        if (!$state.value?.activeQueries?.find((q) => q.title === title)) {
          queryState = { ...queryState, title };
          break;
        }
      }
    }
    queryState = this.updateQueryStateWithEnvs(queryState);
    {
      const state: IQueryEditorState = {
        currentQueryId: queryState.id,
        activeQueries: [...($state.value?.activeQueries || []), queryState],
      };
      $state.next(state);
    }
    return queryState;
  }

  private updateQuerySatesWithProj(
    state: IQueryEditorState,
  ): IQueryEditorState {
    state = this.updateQueryStatesWithEnvs(state);
    if (!this.currentProject) {
      return state;
    }
    const projDbModels = this.currentProject.summary?.dbModels;
    if (projDbModels?.length === 1) {
      state = {
        ...state,
        activeQueries: state.activeQueries.map((q) =>
          q.def && !q.def.dbModel
            ? { ...q, targetDbModel: projDbModels[0] }
            : q,
        ),
      };
    }
    return state;
  }

  private updateQueryStatesWithEnvs(
    state: IQueryEditorState,
  ): IQueryEditorState {
    const { activeQueries } = state;
    if (!activeQueries?.length) {
      return state;
    }
    state = {
      ...state,
      activeQueries: activeQueries.map(this.updateQueryStateWithEnvs),
    };
    return state;
  }

  private readonly updateQueryStateWithEnvs = (
    queryState: IQueryState,
  ): IQueryState => ({
    ...queryState,
    environments:
      this.currentProject?.summary?.environments?.map((env) => {
        const qEnv = queryState.environments?.find(
          (qEnv) => qEnv.id === env.id,
        );
        if (!qEnv) {
          return env;
        }
        return qEnv;
      }) ?? queryState.environments,
  });

  updateQueryState(queryState: IQueryState): void {
    if (!$state.value) {
      return;
    }
    $state.next({
      ...$state.value,
      activeQueries: $state.value?.activeQueries.map((q) =>
        q.id === queryState.id ? queryState : q,
      ),
    });
  }

  saveQuery(
    queryState: IQueryState,
    projectRef: IProjectRef,
  ): Observable<void> {
    if (!this.currentProject) {
      return throwError(() => 'no current project');
    }
    if (!equalProjectRef(projectRef, this.currentProject.ref)) {
      return throwError(
        () =>
          'An attempt to save a query after current project have been changed',
      );
    }
    if (projectRef.projectApi)
      return this.saveCommonQuery(queryState, projectRef);
    const { id } = queryState;
    if (!id) {
      return throwError(() => 'queryState.id is not set');
    }
    const setIsSavingToFalse = () => {
      const state = this.getQueryState(id);
      if (!state) {
        return;
      }
      if (state.isSaving) {
        this.updateQueryState({
          ...state,
          isSaving: false,
        });
      }
    };
    try {
      this.updateQueryState({
        ...queryState,
        isSaving: true,
      });
      if (!queryState.request) {
        return throwError(() => 'query state has no request');
      }
      if (!queryState.def?.id) {
        return throwError(() => `queryState.def.id is not defined`);
      }
      const query: IQueryDef = {
        ...queryState.def,
        ...(queryState.title !== undefined ? { title: queryState.title } : {}),
        request: queryState.request,
        federation: queryState.federation ?? queryState.def.federation,
      };
      const saveQuery = queryState.isNew
        ? this.queriesService.createQuery(projectRef, query)
        : this.queriesService.updateQuery(projectRef, query);
      const result = saveQuery.pipe(
        tap((value: IQueryDef) => {
          const currentState = this.getQueryState(query.id);
          if (!currentState) {
            return throwError(() => `no state for query with id=${query.id}`);
          }
          const requestChangedDuringSave =
            JSON.stringify(currentState.request) !==
            JSON.stringify(query.request);
          const titleChangedDuringSave = currentState.title !== query.title;
          const federationChangedDuringSave =
            JSON.stringify(
              currentState.federation ?? currentState.def?.federation,
            ) !== JSON.stringify(query.federation);
          this.updateQueryState({
            ...currentState,
            def: value,
            title: titleChangedDuringSave ? currentState.title : value.title,
            request: requestChangedDuringSave
              ? currentState.request
              : value.request,
            federation: federationChangedDuringSave
              ? currentState.federation
              : value.federation,
            isNew: false,
          });
          setIsSavingToFalse();
          return value;
        }),
        catchError((err) => {
          setIsSavingToFalse();
          this.errorLogger.logError(err, 'Failed to save query');
          throw err;
        }),
        map(() => void 0),
      );
      return result;
    } catch (e) {
      setIsSavingToFalse();
      return throwError(e);
    }
  }
  private publishCommonQueryState(state: IQueryState): void {
    if (state.id && this.quarantinedQueries.has(state.id))
      this.quarantinedQueries.set(state.id, state);
    else this.updateQueryState(state);
  }

  private saveCommonQuery(
    queryState: IQueryState,
    ref: IProjectRef,
  ): Observable<void> {
    if (
      queryState.id &&
      (
        this.quarantinedQueries.get(queryState.id) ??
        this.getQueryState(queryState.id)
      )?.isSaving
    )
      return throwError(() => new Error('A save is already in progress.'));
    return defer(() => {
      const id = queryState.id;
      if (queryState.saveSupported === false)
        throw new Error(
          'This query cannot be saved losslessly by the current API.',
        );
      if (!id || !queryState.def || !queryState.request || !ref.branch)
        throw new Error('Load a query and select its branch before saving.');
      const generation = this.generation;
      const query = toProjectQueryWire(
        {
          ...queryState.def,
          title: queryState.title,
          request: queryState.request,
          federation: queryState.federation ?? queryState.def.federation,
        },
        id,
      );
      const payload = JSON.stringify({
        branch: ref.branch,
        query,
        isNew: !!queryState.isNew,
        revision: queryState.revision,
      });
      const prior = this.pendingSaves.get(id);
      // An ambiguous response may already have committed. Preserve its operation for an unchanged retry.
      // A changed draft obtains a new operation and retains the original CAS preconditions.
      const request =
        prior?.payload === payload
          ? prior.request
          : {
              operationId: crypto.randomUUID(),
              branch: ref.branch,
              query,
              ...(queryState.isNew
                ? { ifNoneMatch: true as const }
                : { ifMatch: queryState.revision }),
              expectedBranchHead: queryState.branchHead,
            };
      if (!queryState.isNew && !queryState.revision)
        throw new Error(
          'Reload this query to obtain its revision before saving.',
        );
      this.pendingSaves.set(id, { payload, request });
      this.updateQueryState({
        ...queryState,
        isSaving: true,
        saveError: undefined,
      });
      return this.queriesService.capabilities(ref).pipe(
        switchMap((capabilities) => {
          if (generation !== this.generation)
            throw new Error('Project scope changed during save.');
          if (!capabilities.querySave)
            throw new Error(
              'This project does not currently allow saving queries.',
            );
          if (request.expectedBranchHead)
            return this.queriesService.saveRevision(ref, request);
          return this.queriesService.branches(ref).pipe(
            switchMap((list) => {
              if (generation !== this.generation)
                throw new Error('Project scope changed during save.');
              const branch = list.branches.find(
                (branch) => branch.name === ref.branch,
              );
              if (
                !branch ||
                (list.currentBranch && list.currentBranch !== ref.branch)
              )
                throw new Error(
                  'The selected branch is unavailable or is not the current local branch.',
                );
              const frozen = { ...request, expectedBranchHead: branch.head };
              this.pendingSaves.set(id, { payload, request: frozen });
              return this.queriesService.saveRevision(ref, frozen);
            }),
          );
        }),
        tap((result) => {
          if (generation !== this.generation) return;
          const current =
            this.quarantinedQueries.get(id) ?? this.getQueryState(id);
          if (!current) return;
          const def = fromProjectQueryWire(result.query);
          this.pendingSaves.delete(id);
          this.publishCommonQueryState({
            ...current,
            def,
            revision: result.revision,
            branchHead: result.branchHead,
            isNew: false,
            isSaving: false,
            saveError: undefined,
            title:
              current.title === queryState.title ? def.title : current.title,
            request:
              JSON.stringify(current.request) ===
              JSON.stringify(queryState.request)
                ? def.request
                : current.request,
            federation:
              JSON.stringify(current.federation ?? current.def?.federation) ===
              JSON.stringify(
                queryState.federation ?? queryState.def?.federation,
              )
                ? def.federation
                : current.federation,
          });
        }),
        map(() => void 0),
        catchError((error) => {
          if (generation === this.generation) {
            const current =
              this.quarantinedQueries.get(id) ?? this.getQueryState(id);
            if (current)
              this.publishCommonQueryState({
                ...current,
                isSaving: false,
                saveError:
                  error?.status === 409 || error?.status === 412
                    ? 'The saved query or branch changed. Your draft is preserved. Reload only when you are ready to discard it.'
                    : 'The query was not confirmed saved. Your draft is preserved. Retry the same draft, or reload to inspect the saved revision.',
              });
          }
          return throwError(() => error);
        }),
      );
    }).pipe(
      takeUntil(this.scopeReset),
      catchError((error) => {
        const current = queryState.id && this.getQueryState(queryState.id);
        if (current && equalProjectRef(ref, this.currentProject?.ref))
          this.updateQueryState({
            ...current,
            isSaving: false,
            saveError:
              error instanceof UnsupportedQueryContractError
                ? error.message
                : (current.saveError ??
                  'The query could not be saved. Your draft is preserved. Reload its revision or check project access before retrying.'),
          });
        return throwError(() => error);
      }),
    );
  }
}
