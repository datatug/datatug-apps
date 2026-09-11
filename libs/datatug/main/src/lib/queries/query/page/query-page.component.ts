import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { ErrorLogger, IErrorLogger, STORE_ID_GITHUB_COM, STORE_TYPE_GITHUB } from '@sneat/core';

const isGithubStoreId = (storeId?: string): boolean =>
  storeId === STORE_ID_GITHUB_COM || storeId === STORE_TYPE_GITHUB;

/** Shown instead of ever calling `SemanticApiService.runQuery()` for a
 * GitHub-store project — there is no CLI agent to execute against (founder
 * ruling 2026-09-11, deliverable 2: "an explicit, friendly notice with the
 * command to run, not a thrown error"). */
export const GITHUB_QUERY_RUN_MESSAGE =
  'This project is browsed read-only from GitHub — running a query needs a DataTug agent. Clone the repo and run `datatug serve --project <path>` to execute it.';
import { RandomIdService } from '@sneat/random';
import { distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonMenuButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  IonTextarea,
  IonToolbar,
  ViewDidEnter,
} from '@ionic/angular';
import {
  AgentContextService,
  AvailableSnapshot,
  Binding,
  BindingParameterRef,
  CandidateTarget,
  displayTypedValue,
  ExecutionBindingOrigin,
  Fact,
  hasBlockingBindings,
  InvestigationContextService,
  isBindingRunnable,
  LimitationHeaderComponent,
  ResolvedBinding,
  resolveBindings,
  RunQueryRequest,
  RunQueryResponse,
  SemanticApiService,
  tryDecodeErrorEnvelope,
  TypedValue,
} from '@sneat/datatug-semantic';
import { IProjectRef } from '../../../core/project-context';
import { DatatugCoreModule } from '../../../core/datatug-core.module';
import {
  IQueryEditorState,
  IQueryEnvState,
  IQueryState,
} from '../../../editor/models';
import { Coordinator } from '../../../executor/coordinator';
import {
  IEnvDbServer,
  IEnvironmentSummary,
} from '../../../models/definition/environments';
import { IParameter } from '../../../models/definition/parameter';
import {
  IQueryDef,
  ISqlQueryRequest,
  QueryType,
} from '../../../models/definition/query-def';
import {
  IProjectContext,
  newProjectContextFromRef,
} from '../../../nav/nav-models';
import { ProjectTracker } from '../../../services/nav/contexts/project.tracker';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import { DatatugExecutorModule } from '../../../executor/datatug-executor.module';
import { DatatugQueriesServicesModule } from '../../datatug-queries-services.module';
import { QueriesService } from '../../queries.service';
import { QueryContextSqlService } from '../../query-context-sql.service';
import {
  isQueryChanged,
  QueryEditorStateService,
} from '../../query-editor-state-service';
import { HttpQueryEditorComponent } from '../http-query/http-query-editor.component';
import { SneatDatatugPageTitleComponent } from '../../../components/page-title/sneat-datatug-page-title.component';

/** The exact pair of disagreeing values a confirmed conflict was confirmed for — see
 * `confirmConflict()`'s own comment on why a confirmation is invalidated (not silently
 * reused) if the underlying facts change to a *different* conflicting pair. */
interface ConfirmedConflict {
  readonly selectionValue: TypedValue;
  readonly contextValue: TypedValue;
}

function typedValuesEqual(a: TypedValue, b: TypedValue): boolean {
  return a.type === b.type && a.value === b.value;
}

/** Writes `next` into `sig` only if it differs from the current value per `equal` —
 * see `updateBindings()`'s own comment on why an unconditional `.set()` inside an
 * `effect()` is unsafe here. */
function setIfChanged<T>(
  sig: { (): T; set: (value: T) => void },
  next: T,
  equal: (a: T, b: T) => boolean,
): void {
  if (!equal(sig(), next)) {
    sig.set(next);
  }
}

function resolvedBindingEqual(a: ResolvedBinding, b: ResolvedBinding): boolean {
  if (
    a.parameterId !== b.parameterId ||
    a.origin !== b.origin ||
    a.blocked !== b.blocked ||
    a.meta?.entity !== b.meta?.entity ||
    a.meta?.field !== b.meta?.field
  ) {
    return false;
  }
  if ((a.value === undefined) !== (b.value === undefined)) {
    return false;
  }
  if (a.value && b.value && !typedValuesEqual(a.value, b.value)) {
    return false;
  }
  const aAmb = a.ambiguousValues ?? [];
  const bAmb = b.ambiguousValues ?? [];
  if (
    aAmb.length !== bAmb.length ||
    aAmb.some((v, i) => !typedValuesEqual(v, bAmb[i]))
  ) {
    return false;
  }
  if ((a.conflict === undefined) !== (b.conflict === undefined)) {
    return false;
  }
  if (
    a.conflict &&
    b.conflict &&
    (!typedValuesEqual(a.conflict.selectionValue, b.conflict.selectionValue) ||
      !typedValuesEqual(a.conflict.contextValue, b.conflict.contextValue))
  ) {
    return false;
  }
  return true;
}

function bindingsEqual(
  a: readonly ResolvedBinding[],
  b: readonly ResolvedBinding[],
): boolean {
  return (
    a.length === b.length && a.every((binding, i) => resolvedBindingEqual(binding, b[i]))
  );
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  return a.size === b.size && [...a].every((v) => b.has(v));
}

function mapsEqual<K, V>(
  a: ReadonlyMap<K, V>,
  b: ReadonlyMap<K, V>,
  valueEqual: (x: V, y: V) => boolean = (x, y) => x === y,
): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [key, value] of a) {
    if (!b.has(key) || !valueEqual(value, b.get(key) as V)) {
      return false;
    }
  }
  return true;
}

/** Naive `FROM`/`JOIN` table-name scan — deliberately NOT `SqlParser`
 * (`services/unsorted/sql-parser.ts`): that parser's own `reFrom` regex
 * requires a schema-qualified `schema.table` reference (mandatory `(\w+)\.`
 * before the table name), so an unqualified `FROM Artist` — exactly what
 * demo-project-1's own `artists_with_albums.sql` writes — never matches it
 * at all (confirmed by reading that regex; out of scope to change here, it
 * backs `QueryContextSqlService`'s live-catalog join-suggestion feature
 * elsewhere). This scan is display-only (used by
 * {@link extractLinkedEntityNames}'s own fallback below) and intentionally
 * schema-optional. */
const FROM_JOIN_TABLE_RE = /\b(?:FROM|JOIN)\s+([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?/gi;

/** Distinct entity/collection names a query definition references — the
 * "linked entities/collections" the founder's ruling (S155, 2026-09-10)
 * says the query page must show. Primary source: `parameters[].meta.entity`
 * and `recordsets[].columns[].meta.entity` (`IEntityFieldRef`) — every
 * typed/DTQL query in demo-project-1 (e.g. `customer-invoices`) carries
 * this directly on its `.query.json` definition file, no parsing needed.
 * Falls back to a naive FROM/JOIN table-name scan of the query's own SQL
 * text ({@link FROM_JOIN_TABLE_RE}) only when NO metadata entity was found
 * at all — the legacy `<id>.sql.json` shape (e.g. `artists_with_albums`)
 * carries no `parameters`/`recordsets` whatsoever (confirmed against the
 * real demo file: `{"title": "Artists with albums"}`, nothing else), so
 * without this fallback that query would show no linked entities at all
 * despite its SQL text plainly naming `Artist`/`Album`. Never applied to a
 * non-SQL request (DTQL's own body is YAML, not SQL — parsing it as SQL
 * would be meaningless; every DTQL query in this demo already has metadata
 * anyway) or when metadata already yielded at least one name (metadata is
 * the more precise source, never silently supplemented by a text guess). */
export function extractLinkedEntityNames(
  def: IQueryDef | undefined,
): readonly string[] {
  if (!def) {
    return [];
  }
  const names = new Set<string>();
  def.parameters?.forEach((p) => {
    if (p.meta?.entity) {
      names.add(p.meta.entity);
    }
  });
  def.recordsets?.forEach((rs) => {
    rs.columns?.forEach((c) => {
      if (c.meta?.entity) {
        names.add(c.meta.entity);
      }
    });
  });
  if (names.size === 0 && def.request?.queryType === QueryType.SQL) {
    const text = (def.request as ISqlQueryRequest).text;
    if (text) {
      FROM_JOIN_TABLE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = FROM_JOIN_TABLE_RE.exec(text))) {
        names.add(m[2] || m[1]);
      }
    }
  }
  return [...names].sort();
}

@Component({
  selector: 'sneat-datatug-sql-editor',
  templateUrl: './query-page.component.html',
  imports: [
    // DatatugNavContextService and EnvironmentService are now
    // providedIn: 'root' (nav-context-root-singletons); QueriesService,
    // QueryContextSqlService, QueryEditorStateService and Coordinator
    // (all injected below too) are still plain @Injectable(), provided by
    // these modules. `query/:queryId` is a sibling
    // of the bare '' route (routes/datatug-routing-proj.ts), not a child of
    // ProjectPageComponent, so this page never inherited them — the same
    // NG0201 class `EnvDbTablePageComponent` and `DatatugStorePageComponent`
    // were already fixed for. Lane S79's static sweep added the four
    // DatatugServices*Module below, but never caught that
    // DatatugNavContextService's OWN constructor also needs AppContextService
    // (DatatugCoreModule, not any of the four) — a static sweep can't see a
    // transitive DI gap like that; only actually constructing the component
    // does. Confirmed live: even with DatatugUserService fixed
    // (providedIn: 'root', lane S79) and the four modules below present, a
    // real navigation to `/query/:id` (the context panel's "open a query"
    // hand-off) still threw `NG0201: No provider found for
    // \`AppContextService\`. Source: Standalone[_QueryPageComponent]`, one
    // level deeper than the RandomIdService gap this same stream also fixed
    // (main.ts) — found only once RandomIdService stopped masking it
    // (lane S92, journey J2/J3).
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesUnsortedModule,
    DatatugQueriesServicesModule,
    DatatugExecutorModule,
    FormsModule,
    HttpQueryEditorComponent,
    SneatDatatugPageTitleComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonButton,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonItem,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonIcon,
    IonLabel,
    IonList,
    IonListHeader,
    IonBadge,
    IonSpinner,
    IonText,
    IonTextarea,
    LimitationHeaderComponent,
  ],
})
export class QueryPageComponent implements OnDestroy, ViewDidEnter {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly randomIdService = inject(RandomIdService);
  private readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly queryContextSqlService = inject(QueryContextSqlService);
  private readonly queriesService = inject(QueriesService);
  private readonly semanticApi = inject(SemanticApiService);
  private readonly agentContext = inject(AgentContextService);
  private readonly investigationContext = inject(InvestigationContextService);
  private readonly coordinator = inject(Coordinator);
  private readonly queryEditorStateService = inject(QueryEditorStateService);
  private readonly envService = inject(EnvironmentService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  public project?: IProjectContext;

  public showQueryBuilder?: boolean;
  public editorTab: 'text' | 'builder' = 'text';

  public parameters?: IParameter[];

  public editorState?: IQueryEditorState = undefined;
  public queryState: IQueryState = {
    id: '',
    queryType: QueryType.SQL,
    request: {
      queryType: QueryType.SQL,
      text: '',
    } as ISqlQueryRequest,
  };

  public get activeEnv(): IQueryEnvState | undefined {
    return this.queryState?.activeEnv;
  }

  public get queryId(): string | undefined {
    return this.queryState?.id;
  }

  public queryFolderPath = '';
  public envId?: string;
  public envDbServerId?: string;
  // noinspection SqlDialectInspection,SqlNoDataSourceInspection
  public environments?: readonly IQueryEnvState[];

  private readonly destroyed = new Subject<void>();

  // REQ:parameter-auto-binding, REQ:no-hidden-filters (INTEGRATION.md §6). Signals,
  // not plain fields, per this repo's zoneless-ready convention (AGENTS.md).
  private readonly selectionBindings: readonly Binding[];
  /** Task 15 item 3 — every semantic parameter's resolved binding, via
   * `binding-resolver.ts`'s precedence engine (explicit user edit > selection >
   * context > default; ambiguous/conflict/missing-required block Run). */
  public readonly bindings = signal<readonly ResolvedBinding[]>([]);
  private readonly clearedParamIds = signal<ReadonlySet<string>>(new Set());
  /** Parameter ids where the user has explicitly confirmed a shown
   * selection-vs-context conflict — keyed by the EXACT pair of values confirmed, so a
   * later change to a *different* conflicting pair is never silently treated as
   * already-confirmed (api-contract.md "an already-open query never rebinds
   * silently"). */
  private readonly confirmedConflicts = signal<
    ReadonlyMap<string, ConfirmedConflict>
  >(new Map());
  /** Bindings actually visible in the Parameters card — anything with a value or a
   * block reason; a still-empty optional parameter renders nothing (unchanged from
   * the pre-Task-15 behavior). */
  public readonly visibleBindings = computed(() =>
    this.bindings().filter((b) => b.value !== undefined || b.blocked),
  );
  /** What actually gets sent on a run — cleared, ambiguous, unconfirmed-conflict and
   * missing-required bindings are never silently sent (REQ:no-hidden-filters). */
  public readonly effectiveBindings = computed(() =>
    this.bindings().filter(isBindingRunnable),
  );
  /** `true` when at least one parameter is ambiguous, conflicted or a missing
   * required value — Run must be disabled and the reason shown (REQ:no-hidden-filters,
   * AC:typed-context-isolation "conflict blocks an unconfirmed run"). */
  public readonly hasBlockedBindings = computed(() =>
    hasBlockingBindings(this.bindings()),
  );
  public readonly running = signal(false);
  public readonly accessBlockers = signal<readonly string[]>([]);
  public readonly runError = signal<string | undefined>(undefined);
  public readonly runResult = signal<RunQueryResponse | undefined>(undefined);

  /** The resolved definition backing the CURRENT `queryState` — a dedicated
   * signal, deliberately NOT read straight off `queryState.def` (a plain
   * field written from inside `onQueryEditorStateChanged()`'s `.subscribe()`
   * callback, this file's own pre-existing zoneless-allowlist entry): a
   * signal write notifies Angular's zoneless scheduler directly, so the
   * query-text/linked-entities display below (new, S155) reliably repaints
   * once the query finishes loading — including the direct-URL-load path
   * (no in-app click, no router `state`) that founder ruling 2026-09-10
   * reproduced, where the fetch genuinely completes asynchronously after
   * this component's first render. See AGENTS.md's "Change detection &
   * state" section. */
  public readonly queryDef = signal<IQueryDef | undefined>(undefined);

  /** SQL/DTQL body text for the current query, for the `editor=text` panel
   * below — `undefined` for an HTTP query (no text-shaped `request`) or
   * before the query has loaded. */
  public readonly queryBodyText = computed(() => {
    const request = this.queryDef()?.request;
    return request && request.queryType !== QueryType.HTTP
      ? (request as ISqlQueryRequest).text
      : undefined;
  });

  /** Entity/collection names this query references — see
   * {@link extractLinkedEntityNames}'s own doc comment. */
  public readonly linkedEntities = computed(() =>
    extractLinkedEntityNames(this.queryDef()),
  );

  /** api-contract.md "needs-target"/`TARGET_REQUIRED` — authorized eligible targets,
   * populated either from the Candidate the context panel opened this query with, or from
   * a `TARGET_REQUIRED` error's `error.targets` on a run attempt. Never leaks a hidden
   * source: only ever set from one of those two authorized responses. */
  public readonly availableTargets = signal<readonly CandidateTarget[]>([]);
  public readonly selectedSource = signal<string | undefined>(undefined);

  /** api-contract.md "Bounded lookups and HTTP" — a live run failed with
   * `SOURCE_UNAVAILABLE`; the user must explicitly choose a labeled snapshot (never a
   * silent fallback) via {@link runSnapshot}. */
  public readonly sourceUnavailable = signal(false);
  /** LEAD ASSUMPTION 2026-09-10 (`AvailableSnapshot`'s own doc comment,
   * `@sneat/datatug-semantic`) — the ONE recorded snapshot named on a `SOURCE_UNAVAILABLE`
   * error's sibling `details.availableSnapshots`, when the server reported one; `undefined`
   * means no recorded fixture exists for this query, so {@link runSnapshot} has nothing to
   * offer and the template must not render the action at all. Cleared on every new run
   * attempt (never stale across a live retry). */
  public readonly availableSnapshot = signal<AvailableSnapshot | undefined>(undefined);
  private lastRequest?: RunQueryRequest;
  private lastRequestScope?: { project: string; environment: string; securityContextId: string };

  constructor() {
    // REQ:applicable-queries / INTEGRATION.md §3 — EnvDbTablePageComponent.onOpenQuery
    // carries the context panel's resolved Candidate bindings/targets (selection wins
    // over context, REQ:parameter-auto-binding) via router state, since this shared
    // library deliberately doesn't depend on @angular/router. MUST run before
    // trackQueryState(): queryEditorState can emit synchronously (a BehaviorSubject
    // in the real QueryEditorStateService — an of()-backed test double, always), and
    // its handler calls updateBindings(), which reads this.selectionBindings.
    // Reading it before assignment threw inside that handler's try/catch, so
    // `bindings` silently never got set at all — caught by this component's own
    // unit tests, not by inspection.
    this.selectionBindings = (history.state.bindings as readonly Binding[] | undefined) || [];
    this.availableTargets.set(
      (history.state.targets as readonly CandidateTarget[] | undefined) || [],
    );
    this.selectedSource.set(history.state.selectedSource as string | undefined);

    this.trackQueryState();
    const query = history.state.query as IQueryDef;
    if (query) {
      this.setQuery(query);
    }

    this.trackCurrentEnv();
    this.trackCurrentProject();
    this.trackQueryParams();
    this.trackProject();

    // Task 15 item 2/4 — reactive to the agent's securityContextId (a real signal)
    // and the Investigation Context's enabled items (also a signal): switches this
    // scope's own basket before recomputing bindings, and recomputes bindings whenever
    // the context changes underneath an already-open query page (a *changed*
    // conflict is never silently rebound — see confirmConflict()'s own comment).
    // project/envId are this component's own plain (non-signal) tracked fields, kept
    // in sync imperatively wherever they change (trackCurrentProject/trackCurrentEnv/
    // envChanged/setActiveEnv all call syncScopeAndBindings() too) — reading their
    // current value here is safe even though they aren't themselves tracked
    // dependencies of this effect.
    effect(() => {
      this.agentContext.securityContextId();
      this.investigationContext.items();
      this.syncScopeAndBindings();
    });
  }

  /** Switches (or opens) the Investigation Context basket for the CURRENT
   * project/environment/securityContextId, then recomputes every parameter's
   * resolved binding — the single place both concerns happen together, called from
   * every place this component's tracked project/env/securityContextId can change. */
  private syncScopeAndBindings(): void {
    const projectId = this.project?.ref.projectId;
    const environment = this.envId;
    const securityContextId = this.agentContext.securityContextId();
    if (projectId && environment && securityContextId) {
      this.investigationContext.setScope({ project: projectId, environment, securityContextId });
    }
    this.updateBindings();
  }

  ionViewDidEnter(): void {
    try {
      this.updateUrl(); // If called in constructor breaks back button
    } catch (e) {
      this.errorLogger.logError(e, 'Failed to process ionViewDidEnter event');
    }
  }

  private readonly onQueryEditorStateChanged = (
    editorState?: IQueryEditorState,
  ): void => {
    try {
      this.editorState = editorState;
      if (!editorState?.currentQueryId) {
        return;
      }
      const queryState = editorState.activeQueries.find(
        (qs) => qs.id === editorState.currentQueryId,
      );
      if (!queryState) {
        return;
      }
      this.queryState = queryState;
      // Signal write (zoneless-safe, unlike the plain-field write just
      // above) — see `queryDef`'s own doc comment.
      this.queryDef.set(queryState.def);
      if (this.queryState.environments && !this.queryState.activeEnv) {
        this.setActiveEnv(this.queryState.environments[0].id);
      }
      if (queryState.activeEnv?.id && queryState.activeEnv.id !== this.envId) {
        this.envId = queryState?.activeEnv.id;
        this.datatugNavContextService.setCurrentEnvironment(this.envId);
      }
      this.syncScopeAndBindings();
    } catch (e) {
      this.errorLogger.logError(
        e,
        'Failed to process query editor state change',
      );
    }
  };

  ngOnDestroy(): void {
    if (this.destroyed) {
      this.destroyed.next();
      this.destroyed.complete();
    }
  }

  public onParametersChanged(parameters: IParameter[]): void {
    this.parameters = parameters;
  }

  private trackQueryState(): void {
    this.queryEditorStateService.queryEditorState
      .pipe(distinctUntilChanged())
      .subscribe({
        next: this.onQueryEditorStateChanged,
        error: this.errorLogger.logErrorHandler(
          'Failed to get query editor stage',
        ),
      });
  }

  private trackCurrentEnv(): void {
    this.datatugNavContextService.currentEnv
      .pipe(takeUntil(this.destroyed))
      .subscribe((currentEnv) => {
        try {
          if (!currentEnv) {
            return;
          }
          const { id } = currentEnv;
          if (!id) {
            return;
          }
          this.envId = id;

          let activeEnv = this.queryState.environments?.find(
            (env) => env.id === id,
          ) || {
            id,
            summary: currentEnv.summary,
          };
          if (!activeEnv.summary && currentEnv.summary) {
            activeEnv = { ...activeEnv, summary: currentEnv.summary };
          }
          let environments: readonly IQueryEnvState[] = this.queryState
            .environments || [activeEnv];
          if (!environments.find((item) => item.id == id)) {
            environments = [...environments, activeEnv];
          }
          this.updateQueryState({
            ...this.queryState,
            activeEnv,
            environments,
          });
          this.syncScopeAndBindings();
        } catch (e) {
          this.errorLogger.logError(
            e,
            'Failed to process change of current environment',
          );
        }
      });
  }

  private updateQueryState(queryState: IQueryState): void {
    this.queryEditorStateService.updateQueryState(queryState);
  }

  private trackCurrentProject(): void {
    this.datatugNavContextService.currentProject
      .pipe(takeUntil(this.destroyed))
      .subscribe((currentProject) => {
        if (
          !currentProject ||
          (this.project?.ref.projectId === currentProject.ref.projectId &&
            this.project?.ref.storeId === currentProject.ref.storeId &&
            this.project?.summary?.environments?.length ===
              currentProject.summary?.environments?.length)
        ) {
          return; // TODO: cleanup query state?
        }
        this.project = currentProject;
        this.syncScopeAndBindings();
        const summary = currentProject?.summary;
        if (!summary) {
          return;
        }
      });
  }

  private setActiveEnv(envId: string): void {
    try {
      if (!envId) {
        this.errorLogger.logError(
          'An attempt to set active environment to: ' + envId,
        );
        return;
      }
      const queryState = this.queryId && this.getQueryState(this.queryId);
      if (!queryState) {
        this.errorLogger.logError(
          'An attempt to set unknown env as an active one: ' + envId,
        );
        return;
      }
      const activeEnv = queryState.environments?.find(
        (env) => env.id === envId,
      ) || {
        id: envId,
        parameters: this.parameters && [...this.parameters],
      };
      if (queryState.activeEnv !== activeEnv) {
        this.updateQueryState({
          ...queryState,
          activeEnv,
          environments: queryState.environments || [activeEnv],
        });
      }
      if (!activeEnv.summary) {
        // Potentially can be duplicate calls if user changes env back and forth before response comes back
        if (this.project) {
          this.getEnvData(this.project.ref, envId);
        }
      }
    } catch (e) {
      this.errorLogger.logError(e, 'Failed to set active environment');
    }
  }

  private getEnvData(projRef: IProjectRef, envId: string): void {
    const queryId = this.queryId;

    if (queryId) {
      this.envService
        .getEnvSummary(projRef, envId)
        .pipe(takeUntil(this.destroyed))
        .subscribe({
          next: (envSummary) =>
            this.onEnvSummaryReceived(queryId, envId, envSummary),
          error: this.errorLogger.logErrorHandler('Failed to get env summary'),
        });
    }
  }

  private onEnvSummaryReceived(
    queryId: string,
    envId: string,
    envSummary: IEnvironmentSummary,
  ): void {
    if (!envSummary) {
      this.errorLogger.logError(
        'getEnvSummary returned nothing for envId=' + envId,
      );
      return;
    }
    const queryState = this.getQueryState(queryId);
    if (!queryState) {
      // The query has been closed since execution requested.
      // A 100% proper way would be TODO: takeUntil(IQueryState.destroyed:Observable<void>)
      return;
    }
    const queryEnv = queryState.environments?.find((env) => env.id == envId);
    if (!queryEnv) {
      // Can't see how it is possible but just in case
      this.errorLogger.logError(
        'received env details for unknown environment: ' + envSummary.id,
      );
      return;
    }
    if (!this.queryState.activeEnv) {
      return;
    }
    let envState: IQueryEnvState = {
      ...this.queryState.activeEnv,
      summary: envSummary,
    };
    if (envSummary.dbServers?.length) {
      const envDbServer = envSummary.dbServers[0];
      envState = {
        ...envState,
        dbServer: envDbServer,
        dbServerId: this.getDbServerId(envDbServer),
        catalogId: envDbServer.catalogs?.length
          ? envDbServer.catalogs[0]
          : undefined,
      };
    }
    if (queryId) {
      const queryState = this.getQueryState(queryId);
      this.updateEnvState(envState, queryState);
    }
  }

  public getDbServerId(dbServer: IEnvDbServer): string {
    return `${dbServer.driver}:${dbServer.host}`;
  }

  private trackQueryParams(): void {
    this.route.queryParamMap.subscribe({
      next: (queryParams) => {
        console.log(
          'QueryPageComponent.trackQueryParams(): queryParams:',
          queryParams,
        );

        // `id` BEFORE `env` (S155 fix — was the other way round): on a
        // direct/reloaded navigation carrying both `?id=...&env=...` (the
        // founder's own reproduction URL), `setQueryId()` below opens the
        // query state SYNCHRONOUSLY — `QueryEditorStateService.openQuery()`
        // pushes a new `BehaviorSubject` value that this component's own
        // `trackQueryState()` subscription (constructor, runs before this
        // method) observes synchronously too, so `this.queryState`/
        // `this.queryId` are already the real id by the time `setActiveEnv()`
        // runs just below. The old order called `setActiveEnv(envId)` FIRST,
        // while `this.queryId` was still `''` (the component's own initial
        // placeholder) — `setActiveEnv()`'s own `getQueryState(this.queryId)`
        // then found nothing and logged a user-visible "Something went
        // wrong: An attempt to set unknown env as an active one: local" toast
        // on every load of that URL (confirmed live), silently dropping the
        // `env=` query param in the process (`local` was never actually set
        // as the active environment for a direct URL load, only a click-
        // through from within the app already had a matching `queryState`
        // by the time `env` was applied).
        let queryId = queryParams.get('id');
        const isNew = !queryId;
        if (isNew) {
          queryId = this.randomIdService.newRandomId();
          queryId = '' + (this.editorState?.activeQueries?.length || 1);
        }
        this.setQueryId(queryId, isNew);

        const envId = queryParams.get('env');
        if (envId) {
          this.setActiveEnv(envId);
        }
      },
    });
  }

  private onProjRefChanged = (ref: IProjectRef) => {
    const prevProject = this.project;
    this.project = newProjectContextFromRef(ref);
    if (
      this.queryId &&
      (ref.projectId !== prevProject?.ref?.projectId ||
        ref.storeId !== prevProject?.ref?.storeId)
    ) {
      // this.loadQuery();
    }
  };

  private trackProject(): void {
    const projectTracker = new ProjectTracker(this.destroyed, this.route);
    projectTracker.projectRef.subscribe({
      next: this.onProjRefChanged,
      error: this.errorLogger.logErrorHandler(
        'Failed to track project ref from activated router',
      ),
    });
  }

  private setQueryId(id?: string | null, isNew = false): void {
    if (this.queryId === id) {
      return;
    }
    if (!id) {
      this.queryFolderPath = '';
      return;
    }
    const i = id.lastIndexOf('/');
    if (i >= 0) {
      this.queryFolderPath = id.substring(0, i);
    }
    if (!isNew) {
      this.queryEditorStateService.openQuery(id);
    }
  }

  private setQuery(query: IQueryDef): void {
    const queryState: IQueryState = this.getQueryState(query.id) || {
      id: query.id,
      queryType: query.request.queryType,
      title: query.title,
      request: query.request,
      def: query,
    };
    this.updateQueryState(
      queryState.def === query
        ? queryState
        : {
            ...queryState,
            isNew: false,
            queryType: query.request.queryType,
            def: query,
            request: {
              queryType: query.request.queryType,
              text: (query.request as ISqlQueryRequest).text,
            } as ISqlQueryRequest,
          },
    );
  }

  public get isChanged(): boolean {
    return isQueryChanged(this.queryState);
  }

  serverChanged(event: CustomEvent): void {
    if (event.detail.value === this.activeEnv?.dbServerId) {
      return;
    }
    if (!this.activeEnv) {
      return;
    }
    const envState: IQueryEnvState = {
      ...this.activeEnv,
      dbServerId: this.envDbServerId,
    };
    this.updateEnvState(envState, this.queryState);
  }

  catalogChanged(event: CustomEvent): void {
    console.log(
      'catalogChanged',
      event.detail.value,
      this.activeEnv?.catalogId,
    );
    if (event.detail.value === this.activeEnv?.catalogId) {
      return;
    }
    if (this.activeEnv) {
      this.updateEnvState(
        {
          ...this.activeEnv,
          catalogId: event.detail.value,
        },
        this.queryState,
      );
    }
  }

  envChanged(event: CustomEvent): void {
    const { value } = event.detail;
    const activeEnv = this.queryState?.environments?.find(
      (v) => v.id === value,
    );
    this.updateQueryState({
      ...this.queryState,
      activeEnv,
    });
    if (this.project && this.activeEnv && !this.activeEnv.summary) {
      this.getEnvData(this.project.ref, this.activeEnv.id);
    }
    this.updateUrl();
  }

  editorTabChanged(): void {
    this.updateUrl();
  }

  public queryTitleChanged(event: Event): void {
    const ce = event as CustomEvent;
    this.queryState = {
      ...this.queryState,
      title: ce.detail.value || '',
    };
    this.queryEditorStateService.updateQueryState(this.queryState);
  }

  updateUrl(): void {
    // TODO: make sure not clashes with SqlQueryEditComponent
    const queryParams: Params = {
      id: this.queryId,
      editor: this.editorTab,
      env: this.queryState.activeEnv?.id,
    };
    this.router
      .navigate([], {
        // preserveFragment: true,
        replaceUrl: true,
        relativeTo: this.route,
        queryParams,
        queryParamsHandling: 'merge', // remove to replace all query params by provided
      })
      .catch(
        this.errorLogger.logErrorHandler('Failed to change query parameter'),
      );
  }

  private getQueryState(id: string): IQueryState | undefined {
    return this.queryEditorStateService.getQueryState(id);
  }

  private updateEnvState(
    envState: IQueryEnvState,
    queryState?: IQueryState,
  ): IQueryEnvState | undefined {
    if (!envState.id) {
      throw new Error('!envState.id');
    }
    if (!queryState) {
      return undefined;
    }
    if (queryState.activeEnv?.id == envState.id) {
      queryState = { ...queryState, activeEnv: envState };
    }
    queryState = {
      ...queryState,
      environments: queryState.environments?.map((env) =>
        env.id === envState.id ? envState : env,
      ),
    };
    this.updateQueryState(queryState);
    return envState;
  }

  public saveChanges(): void {
    if (!this.isChanged) {
      alert('Query does not require saving as is not changed yet');
      return;
    }
    if (this.project) {
      this.queryEditorStateService
        .saveQuery(this.queryState, this.project.ref)
        .subscribe({
          error: this.errorLogger.logErrorHandler('Failed to save query'),
        });
    }
  }

  /**
   * REQ:parameter-auto-binding (INTEGRATION.md §6), Task 15 item 3 — resolves every
   * semantic parameter's binding through `binding-resolver.ts`'s precedence engine:
   * the context panel's selection (router state, set once in the constructor) first,
   * then the Investigation Context's *enabled* facts, then a declared default. More
   * than one distinct typed value within a tier is `ambiguous`; a selection that
   * disagrees with a different context value is `conflict-unconfirmed` until
   * {@link confirmConflict}. Never applies anything — see effectiveBindings() and
   * clearBinding() for the REQ:no-hidden-filters half (the user must see and can
   * clear/override every binding before a run).
   */
  private updateBindings(): void {
    const parameterDefs = this.queryState.def?.parameters || [];
    const parameters: BindingParameterRef[] = parameterDefs
      .filter((p) => !!p.meta)
      .map((p) => ({ id: p.id, meta: p.meta, required: p.isRequired }));
    if (!parameters.length) {
      this.bindings.set([]);
      this.clearedParamIds.set(new Set());
      this.confirmedConflicts.set(new Map());
      return;
    }
    const selectionFacts = this.buildSelectionFacts(parameters);
    const contextFacts = this.investigationContext.items().filter((i) => i.enabled);
    const clearedParamIds = this.clearedParamIds();

    // First pass with no confirmations, to discover the CURRENT conflict pair (if
    // any) per parameter — a stale confirmation for a *different* pair must not carry
    // over silently.
    const discovery = resolveBindings({
      parameters,
      selectionFacts,
      contextFacts,
      clearedParamIds,
    });
    const confirmedNow = new Set<string>();
    for (const binding of discovery) {
      if (binding.blocked !== 'conflict-unconfirmed' || !binding.conflict) {
        continue;
      }
      const stored = this.confirmedConflicts().get(binding.parameterId);
      if (
        stored &&
        typedValuesEqual(stored.selectionValue, binding.conflict.selectionValue) &&
        typedValuesEqual(stored.contextValue, binding.conflict.contextValue)
      ) {
        confirmedNow.add(binding.parameterId);
      }
    }
    const resolved = confirmedNow.size
      ? resolveBindings({
          parameters,
          selectionFacts,
          contextFacts,
          clearedParamIds,
          confirmedConflicts: confirmedNow,
        })
      : discovery;

    // Signal writes are skipped when the new value is equivalent to the current one
    // (deep-equal, not just a fresh array/Set/Map reference) — this method runs inside
    // a reactive `effect()` (see the constructor), and an unconditional `.set()` on
    // every run — even with unchanged content — repeatedly invalidates this component's
    // own signal graph and never lets Angular's change-detection loop reach a fixed
    // point (observed directly: a real infinite `detectChangesInViewWhileDirty` loop in
    // this component's own tests once `investigationContext.items()` started changing).
    setIfChanged(this.bindings, resolved, bindingsEqual);

    // Dropping a parameter (e.g. switching to a query with different params)
    // shouldn't leave a stale clear/confirmation behind for a parameterId that no
    // longer applies, but a still-applicable one the user explicitly cleared/confirmed
    // should stay that way.
    const resolvedIds = new Set(resolved.map((b) => b.parameterId));
    setIfChanged(
      this.clearedParamIds,
      new Set([...clearedParamIds].filter((id) => resolvedIds.has(id))),
      setsEqual,
    );
    setIfChanged(
      this.confirmedConflicts,
      new Map([...this.confirmedConflicts()].filter(([id]) => resolvedIds.has(id))),
      (a, b) =>
        mapsEqual(
          a,
          b,
          (x, y) =>
            typedValuesEqual(x.selectionValue, y.selectionValue) &&
            typedValuesEqual(x.contextValue, y.contextValue),
        ),
    );
  }

  /** Wraps the context panel's resolved selection `Binding[]` (router state,
   * parameterId + value only) as {@link Fact}s keyed by each parameter's own
   * `meta.entity`/`meta.field` — `binding-resolver.ts` matches candidates by field, not
   * parameterId (api-contract.md: "Binding has no entity/field; the server already
   * knows them from the query def"). */
  private buildSelectionFacts(parameters: readonly BindingParameterRef[]): Fact[] {
    const facts: Fact[] = [];
    for (const selection of this.selectionBindings) {
      const param = parameters.find((p) => p.id === selection.parameterId);
      if (!param?.meta) {
        continue;
      }
      facts.push({
        id: `selection:${selection.parameterId}`,
        entity: param.meta.entity,
        field: param.meta.field,
        value: selection.value,
        origin: 'selection',
        enabled: true,
      });
    }
    return facts;
  }

  /** REQ:no-hidden-filters — the user clears (or, by not clearing, implicitly
   * confirms) every auto-bound parameter before it's ever sent on a run. */
  public clearBinding(parameterId: string): void {
    this.clearedParamIds.set(new Set([...this.clearedParamIds(), parameterId]));
    this.updateBindings();
  }

  /** api-contract.md "Selection overriding a different context value is shown as an
   * explicit conflict requiring confirmation" — accepts the selection value for THIS
   * exact conflicting pair. A later change to a *different* context/selection pair for
   * the same parameter is never silently treated as already-confirmed (see
   * {@link updateBindings}'s discovery pass). */
  public confirmConflict(parameterId: string): void {
    const current = this.bindings().find((b) => b.parameterId === parameterId);
    if (current?.blocked !== 'conflict-unconfirmed' || !current.conflict) {
      return;
    }
    this.confirmedConflicts.set(
      new Map(this.confirmedConflicts()).set(parameterId, current.conflict),
    );
    this.updateBindings();
  }

  /** `"Customer.ID"` — the parameter's meta, for the Parameters card heading. */
  protected bindingFieldLabel(binding: ResolvedBinding): string {
    return binding.meta ? `${binding.meta.entity}.${binding.meta.field}` : binding.parameterId;
  }

  /** AC:bound-from-selection literal wording — `"5 · from selection"` /
   * `"5 · from context"` / `"5 · from default"` / `"5 · your edit"`. */
  protected bindingValueLabel(binding: ResolvedBinding): string {
    if (binding.value === undefined) {
      return '';
    }
    const origin = binding.origin === 'user' ? 'your edit' : `from ${binding.origin}`;
    return `${displayTypedValue(binding.value)} · ${origin}`;
  }

  /** AC:typed-context-isolation — ">1 distinct typed value" rendered for an
   * `ambiguous` block. */
  protected ambiguousValuesLabel(binding: ResolvedBinding): string {
    return (binding.ambiguousValues ?? []).map(displayTypedValue).join(', ');
  }

  /** "Selection overriding a different context value is shown as an explicit conflict
   * requiring confirmation" — the two disagreeing values for a `conflict-unconfirmed`
   * block. */
  protected conflictLabel(binding: ResolvedBinding): string {
    if (!binding.conflict) {
      return '';
    }
    return `selection ${displayTypedValue(binding.conflict.selectionValue)} vs context ${displayTypedValue(binding.conflict.contextValue)}`;
  }

  /** Renders one `Result.bindingsApplied` entry (a wire {@link Binding}: parameterId +
   * value only) for the results header — entity/field come from this query's own
   * parameter definition, same lookup {@link updateBindings} uses. */
  protected appliedBindingLabel(binding: Binding): string {
    const meta = this.queryState.def?.parameters?.find(
      (p) => p.id === binding.parameterId,
    )?.meta;
    const name = meta ? `${meta.entity}.${meta.field}` : binding.parameterId;
    return `${name} = ${displayTypedValue(binding.value)}`;
  }

  /** REQ:parameter-auto-binding correction (2026-09-09 handoff): "Client-origin claims
   * appeared to be server provenance... do not describe a client-supplied
   * selection/context origin as server-attested evidence." Renders the exact distinction
   * the appendix requires (`originEvidence`), not just `origin`. */
  protected appliedBindingProvenance(binding: Binding): string {
    return binding.originEvidence === 'server-default'
      ? `${binding.origin} · server default`
      : `${binding.origin} · client-reported`;
  }

  protected chooseTarget(source: string): void {
    this.selectedSource.set(source);
  }

  /** Grid-adapter unwrap at the template edge (plan Task 12 item 3) — bound as a field so
   * the template can call it directly. */
  protected readonly displayValue = displayTypedValue;

  /** REQ:parameter-auto-binding, REQ:no-hidden-filters, REQ:limitation-visible
   * (INTEGRATION.md §5-6) — runs the query through SemanticApiService (never a
   * browser-built query) with only the bindings the user has actually seen and not
   * cleared, then renders limitations and the applied-bindings list from the
   * response so nothing is a hidden filter. Every call carries the current
   * project/environment/securityContextId Scope and, per api-contract.md, the exact
   * bindingOrigins for the submitted parameter keys — display provenance only, never
   * authorization. */
  public runQuery(): void {
    const projectId = this.project?.ref.projectId;
    const queryId = this.queryId;
    if (!projectId || !queryId) {
      return;
    }
    // Checked before requiring `environment`/`securityContextId` below: a
    // GitHub-store project has no live agent connection, so
    // `agentContext.securityContextId()` never resolves for one — the old
    // ordering (both checked in the same combined `if`) made this GitHub
    // guard dead code, silently no-op'ing "Run" instead of showing
    // `GITHUB_QUERY_RUN_MESSAGE` (confirmed live, S136: clicking "Run" on a
    // GitHub-store query did nothing at all — no message, no thrown error,
    // just nothing — for deliverable 2, "an explicit, friendly notice...
    // not a thrown error").
    if (isGithubStoreId(this.project?.ref.storeId)) {
      this.runError.set(GITHUB_QUERY_RUN_MESSAGE);
      return;
    }
    const environment = this.envId;
    const securityContextId = this.agentContext.securityContextId();
    if (!environment || !securityContextId) {
      return;
    }
    // REQ:no-hidden-filters, AC:typed-context-isolation "conflict blocks an
    // unconfirmed run" — an ambiguous, unconfirmed-conflict or missing-required
    // parameter stops Run entirely rather than silently omitting it.
    if (this.hasBlockedBindings()) {
      this.runError.set(
        'Resolve every ambiguous, conflicting or required parameter before running.',
      );
      return;
    }
    this.running.set(true);
    this.runError.set(undefined);
    this.accessBlockers.set([]);
    this.sourceUnavailable.set(false);
    this.availableSnapshot.set(undefined);
    const parameters: Record<string, TypedValue> = {};
    const bindingOrigins: ExecutionBindingOrigin[] = [];
    for (const binding of this.effectiveBindings()) {
      // isBindingRunnable() (effectiveBindings' own filter) guarantees `value` is set.
      parameters[binding.parameterId] = binding.value as TypedValue;
      bindingOrigins.push({
        parameterId: binding.parameterId,
        // The resolver's 'user' origin (an explicit edit) maps to the wire contract's
        // 'manual' bucket — api-contract.md's BindingOrigin has no 'user' case; a
        // client-entered value that isn't from selection/context IS what the appendix
        // calls 'manual'.
        origin: binding.origin === 'user' ? 'manual' : (binding.origin ?? 'default'),
      });
    }
    this.executeQuery(
      {
        project: projectId,
        environment,
        securityContextId,
        queryId,
        source: this.selectedSource(),
        parameters,
        bindingOrigins,
        mode: 'live',
      },
      { project: projectId, environment, securityContextId },
    );
  }

  /** api-contract.md "Bounded lookups and HTTP" — the user's explicit choice to view a
   * recorded snapshot after a live `SOURCE_UNAVAILABLE` failure; never automatic. Reuses
   * the same request the live attempt sent, flipping `mode` AND naming the exact
   * `snapshotId` the server itself reported on the failed live attempt
   * (`availableSnapshot()`, `handleRunError`) — never fabricated or guessed client-side;
   * a request with no known snapshot id is refused rather than sent with an empty one
   * (the server's own `req.Validate()` would reject that anyway). */
  public runSnapshot(): void {
    const snapshot = this.availableSnapshot();
    if (!this.lastRequest || !this.lastRequestScope || !snapshot) {
      return;
    }
    this.running.set(true);
    this.runError.set(undefined);
    this.accessBlockers.set([]);
    this.sourceUnavailable.set(false);
    this.executeQuery(
      { ...this.lastRequest, mode: 'snapshot', snapshotId: snapshot.snapshotId },
      this.lastRequestScope,
    );
  }

  private executeQuery(
    request: RunQueryRequest,
    requestScope: { project: string; environment: string; securityContextId: string },
  ): void {
    this.lastRequest = request;
    this.lastRequestScope = requestScope;
    this.semanticApi.runQuery(request).subscribe({
      next: (response) => {
        // Task 15 item 4 — discard a late response for a scope the user has since left
        // (project/environment/principal switch mid-flight): api-contract.md "late
        // responses from another scope are discarded".
        if (!this.investigationContext.isCurrentScope(requestScope)) {
          return;
        }
        this.runResult.set(response);
        this.running.set(false);
      },
      error: (err: unknown) => this.handleRunError(err, request, requestScope),
    });
  }

  private handleRunError(
    err: unknown,
    request: RunQueryRequest,
    requestScope: { project: string; environment: string; securityContextId: string },
  ): void {
    if (!this.investigationContext.isCurrentScope(requestScope)) {
      // Late error response for a scope we've already left.
      return;
    }
    this.running.set(false);
    const envelope =
      err instanceof HttpErrorResponse ? tryDecodeErrorEnvelope(err.error) : undefined;
    this.accessBlockers.set(
      envelope?.details?.authorization?.blockers.map(
        (b) => `${b.layerId ?? 'source'}: ${b.code}`,
      ) ?? [],
    );
    if (envelope?.error.code === 'TARGET_REQUIRED' && envelope.error.targets) {
      // Same authorized selector the context panel's needs-target Candidate renders —
      // never a hidden source (api-contract.md: "TARGET_REQUIRED errors return the same
      // authorized target options in error.targets, never hidden source IDs").
      this.availableTargets.set(envelope.error.targets);
      this.runError.set('This query needs a target — choose one below and run again.');
      return;
    }
    if (envelope?.error.code === 'SOURCE_UNAVAILABLE' && request.mode === 'live') {
      this.sourceUnavailable.set(true);
      // LEAD ASSUMPTION 2026-09-10 (AvailableSnapshot's own doc comment) — exactly one
      // entry for Phase 1, or none when this query has no recorded fixture at all; the
      // template renders the "Use recorded snapshot" action only when this is set.
      this.availableSnapshot.set(envelope.details?.availableSnapshots?.[0]);
      this.runError.set('This source is unavailable right now.');
      return;
    }
    if (envelope?.error.code === 'STALE_CONTEXT') {
      // Old-principal facts must not survive a principal/policy-session change
      // (api-contract.md "Scope and identity"); Task 15 owns full reactive retry.
      this.investigationContext.clear();
      this.agentContext.refresh().subscribe({ error: () => undefined });
      this.runError.set('Your session changed — context was cleared, please retry.');
      return;
    }
    this.runError.set(envelope?.error.message ?? this.extractErrorMessage(err));
    this.errorLogger.logError(err, 'Failed to run query');
  }

  /** Renders an RFC3339 instant (`ResultProvenance.observedAt`, `AvailableSnapshot.
   * recordedAt`) as a plain calendar date for the result header / snapshot-action label —
   * "snapshot · recorded <date>" (api-contract.md), never the full timestamp, matching
   * datatug-cli's own `provenanceLine` CLI-output convention (`2006-01-02`). Falls back to
   * the raw string for a value that somehow isn't parseable, rather than throwing. */
  protected formatRecordedDate(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
  }

  private extractErrorMessage(err: unknown): string {
    const message = (err as { message?: unknown } | undefined)?.message;
    return message ? String(message) : 'Failed to run the query';
  }
}
