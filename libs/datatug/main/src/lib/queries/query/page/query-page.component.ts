import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
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
  IonTitle,
  IonToolbar,
  ViewDidEnter,
} from '@ionic/angular';
import {
  EntityFieldRef,
  InvestigationContextService,
  LimitationHeaderComponent,
  QueryParameterBinding,
  RunQueryResponse,
  SemanticApiService,
  SemanticParameterRef,
  SemanticValue,
} from '@sneat/datatug-semantic';
import { IProjectRef } from '../../../core/project-context';
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
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { QueriesService } from '../../queries.service';
import { QueryContextSqlService } from '../../query-context-sql.service';
import {
  isQueryChanged,
  QueryEditorStateService,
} from '../../query-editor-state-service';
import { HttpQueryEditorComponent } from '../http-query/http-query-editor.component';

/**
 * REQ:parameter-auto-binding, REQ:no-hidden-filters (INTEGRATION.md §6) — one
 * candidate binding shown to the user before a run, regardless of whether it came
 * from the context panel's "open this applicable query" (`origin: 'selection'`,
 * carried via router state — see EnvDbTablePageComponent.onOpenQuery) or from
 * InvestigationContextService.bindingsFor() (`origin: 'context'`). Selection always
 * wins over context for the same parameter id (REQ:parameter-auto-binding). Never
 * applied to a run until the user sees it here and doesn't clear it
 * (REQ:no-hidden-filters) — see effectiveBindings().
 */
interface ResolvedParameterBinding {
  readonly parameterId: string;
  readonly entityField: EntityFieldRef;
  readonly value: SemanticValue;
  readonly label: string;
  readonly origin: 'selection' | 'context';
}

@Component({
  selector: 'sneat-datatug-sql-editor',
  templateUrl: './query-page.component.html',
  imports: [
    FormsModule,
    HttpQueryEditorComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonTitle,
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
  private readonly selectionBindings: readonly QueryParameterBinding[];
  public readonly bindings = signal<readonly ResolvedParameterBinding[]>([]);
  private readonly clearedParamIds = signal<ReadonlySet<string>>(new Set());
  /** What actually gets sent on a run — cleared bindings are never silently
   * resurrected (REQ:no-hidden-filters). */
  public readonly effectiveBindings = computed(() =>
    this.bindings().filter((b) => !this.clearedParamIds().has(b.parameterId)),
  );
  public readonly running = signal(false);
  public readonly runError = signal<string | undefined>(undefined);
  public readonly runResult = signal<RunQueryResponse | undefined>(undefined);

  constructor() {
    // REQ:applicable-queries / INTEGRATION.md §3 — EnvDbTablePageComponent.onOpenQuery
    // carries the context panel's resolved bindings (selection wins over context,
    // REQ:parameter-auto-binding) via router state, since this shared library
    // deliberately doesn't depend on @angular/router. MUST run before
    // trackQueryState(): queryEditorState can emit synchronously (a BehaviorSubject
    // in the real QueryEditorStateService — an of()-backed test double, always), and
    // its handler calls updateBindings(), which reads this.selectionBindings.
    // Reading it before assignment threw inside that handler's try/catch, so
    // `bindings` silently never got set at all — caught by this component's own
    // unit tests, not by inspection.
    this.selectionBindings =
      (history.state.bindings as readonly QueryParameterBinding[] | undefined) || [];

    this.trackQueryState();
    const query = history.state.query as IQueryDef;
    if (query) {
      this.setQuery(query);
    }

    this.trackCurrentEnv();
    this.trackCurrentProject();
    this.trackQueryParams();
    this.trackProject();
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
      if (this.queryState.environments && !this.queryState.activeEnv) {
        this.setActiveEnv(this.queryState.environments[0].id);
      }
      if (queryState.activeEnv?.id && queryState.activeEnv.id !== this.envId) {
        this.envId = queryState?.activeEnv.id;
        this.datatugNavContextService.setCurrentEnvironment(this.envId);
      }
      this.updateBindings();
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

        const envId = queryParams.get('env');
        if (envId) {
          this.setActiveEnv(envId);
        }

        let queryId = queryParams.get('id');
        const isNew = !queryId;
        if (isNew) {
          queryId = this.randomIdService.newRandomId();
          queryId = '' + (this.editorState?.activeQueries?.length || 1);
        }
        this.setQueryId(queryId, isNew);
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
   * REQ:parameter-auto-binding (INTEGRATION.md §6) — resolves a candidate binding for
   * every semantic parameter of the current query: the context panel's selection
   * (router state, set once in the constructor) first, then
   * InvestigationContextService.bindingsFor() for whatever selection didn't cover.
   * Never applies anything — see effectiveBindings() and clearBinding() for the
   * REQ:no-hidden-filters half (the user must see and can clear/override every
   * binding before a run).
   */
  private updateBindings(): void {
    const parameterDefs = this.queryState.def?.parameters || [];
    const semanticParams: SemanticParameterRef[] = parameterDefs
      .filter((p) => !!p.meta)
      .map((p) => ({ id: p.id, meta: p.meta }));
    if (!semanticParams.length) {
      this.bindings.set([]);
      return;
    }
    const contextBindings = this.investigationContext.bindingsFor(semanticParams);
    const resolved: ResolvedParameterBinding[] = [];
    for (const param of semanticParams) {
      const selection = this.selectionBindings.find(
        (b) => b.parameterId === param.id,
      );
      if (selection) {
        resolved.push({
          parameterId: selection.parameterId,
          entityField: { entity: selection.entity, field: selection.field },
          value: selection.value,
          label: `${selection.entity}.${selection.field} = ${selection.value}`,
          origin: 'selection',
        });
        continue;
      }
      const contextMatch = contextBindings.find((b) => b.parameterId === param.id);
      if (contextMatch) {
        resolved.push({
          parameterId: contextMatch.parameterId,
          entityField: contextMatch.entityField,
          value: contextMatch.value,
          label: contextMatch.label,
          origin: 'context',
        });
      }
    }
    this.bindings.set(resolved);
    // Dropping a parameter (e.g. switching to a query with different params)
    // shouldn't leave a stale clear behind for a parameterId that no longer applies,
    // but a still-applicable one the user explicitly cleared should stay cleared.
    const resolvedIds = new Set(resolved.map((b) => b.parameterId));
    const stillCleared = new Set(
      [...this.clearedParamIds()].filter((id) => resolvedIds.has(id)),
    );
    this.clearedParamIds.set(stillCleared);
  }

  /** REQ:no-hidden-filters — the user clears (or, by not clearing, implicitly
   * confirms) every auto-bound parameter before it's ever sent on a run. */
  public clearBinding(parameterId: string): void {
    this.clearedParamIds.set(new Set([...this.clearedParamIds(), parameterId]));
  }

  /** REQ:parameter-auto-binding, REQ:no-hidden-filters, REQ:limitation-visible
   * (INTEGRATION.md §5-6) — runs the query through SemanticApiService (never a
   * browser-built query) with only the bindings the user has actually seen and not
   * cleared, then renders limitations and the applied-bindings list from the
   * response so nothing is a hidden filter. */
  public runQuery(): void {
    const projectId = this.project?.ref.projectId;
    const queryId = this.queryId;
    if (!projectId || !queryId) {
      return;
    }
    this.running.set(true);
    this.runError.set(undefined);
    const parameters: Record<string, SemanticValue> = {};
    for (const binding of this.effectiveBindings()) {
      parameters[binding.parameterId] = binding.value;
    }
    this.semanticApi
      .runQuery({ project: projectId, queryId, parameters })
      .subscribe({
        next: (response) => {
          this.runResult.set(response);
          this.running.set(false);
        },
        error: (err) => {
          this.runError.set(
            err?.message ? String(err.message) : 'Failed to run the query',
          );
          this.running.set(false);
          this.errorLogger.logError(err, 'Failed to run query');
        },
      });
  }
}
