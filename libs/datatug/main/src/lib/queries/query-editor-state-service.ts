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
  if (!def || def.title != queryState.title) {
    return true;
  }
  if (def.request.queryType !== queryState.request?.queryType) {
    throw new Error(
      `def.request.type !== queryState.request.type: ${def.request.queryType} !== ${queryState.request?.queryType}`,
    );
  }
  switch (queryState?.request?.queryType) {
    case QueryType.SQL:
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

@Injectable()
export class QueryEditorStateService {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly queriesService = inject(QueriesService);
  private readonly projectService = inject(ProjectService);
  readonly datatugNavContextService = inject(DatatugNavContextService);

  public readonly queryEditorState = $state
    .asObservable()
    .pipe(filter((state) => !!state));

  private currentProject?: IProjectContext;

  constructor() {
    const datatugNavContextService = this.datatugNavContextService;
    datatugNavContextService.currentProject.subscribe((currentProject) => {
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
    const newState: IQueryEditorState = {
      ...$state.value,
      activeQueries:
        $state.value?.activeQueries.filter((q) => q !== query) ?? [],
    };
    $state.next(newState);
  }

  openQuery(id: string): void {
    console.log(
      `QueryEditorStateService.openQuery(${id})`,
      this.currentProject,
    );
    try {
      let changed = false;
      let state: IQueryEditorState = $state.value || {
        currentQueryId: id,
        activeQueries: [],
      };
      let queryState = state?.activeQueries?.find((q) => q.id === id);
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
        this.loadQuery(id);
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
    } catch (err) {
      this.errorLogger.logError(err, 'failed to openQuery');
    }
  }

  private loadQuery(id: string): void {
    const onCompleted = (def?: IQueryDef) => {
      const activeQuery = $state.value?.activeQueries.find((q) => q.id === id);
      if (!activeQuery) {
        return;
      }
      let state: IQueryState = {
        ...activeQuery,
        isLoading: false,
      };
      if (def) {
        state = { ...state, def };
      }
      if (
        state.request?.queryType === QueryType.SQL &&
        (state.request as ISqlQueryRequest).text === undefined
      ) {
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
    if ($state.value) {
      const state: IQueryEditorState = {
        currentQueryId: queryState.id,
        activeQueries: [...($state.value.activeQueries || []), queryState],
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
    console.log(
      'updateQueryStatesWithEnvs',
      state.activeQueries,
      this.currentProject?.summary?.environments,
    );
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
    if (projectRef.projectId !== this.currentProject.ref.projectId) {
      return throwError(
        () =>
          'An attempt to save a query after current project have been changed',
      );
    }
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
        request: queryState.request,
      };
      const result = this.queriesService.updateQuery(projectRef, query).pipe(
        tap((value: IQueryDef) => {
          const queryState = this.getQueryState(query.id);
          if (!queryState) {
            return throwError(() => `no state for query with id=${query.id}`);
          }
          this.updateQueryState({
            ...queryState,
            def: value,
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
}
