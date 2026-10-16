import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  ActivatedRouteSnapshot,
  Router,
} from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonLabel,
  IonMenuButton,
  IonSegment,
  IonSegmentButton,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import {
  AgentContextService,
  DATATUG_AGENT_BASE_URL,
  RunQueryResponse,
  SemanticApiService,
  tryDecodeErrorEnvelope,
} from '@sneat/datatug-semantic';
import { AgGridAngular } from 'ag-grid-angular';
import {
  AllCommunityModule,
  ColDef,
  ModuleRegistry,
  RowClickedEvent,
} from 'ag-grid-community';
import {
  Subject,
  Subscription,
  catchError,
  combineLatest,
  map,
  of,
  switchMap,
  take,
} from 'rxjs';
import {
  routingParamResultId,
  routingParamStoreId,
} from '../../core/datatug-routing-params';
import { AuthorCurrentRowComponent } from '../../queries/query/page/author-current-row.component';
import { parseDatatugStoreRef } from '../../nav/nav-models';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';
import { ProjectService } from '../../services/project/project.service';
import { linkBackHref } from '../link-route';
import { agentBaseUrl } from '../../services/repo/agent-url';
import {
  AgentLinkApiService,
  LinkProblem,
  LinkProblemError,
} from '../agent-link-api.service';
import { LinkProblemComponent } from '../link-problem/link-problem.component';
import {
  RERUN_LIMIT,
  ROW_QUERY_PARAM,
  RESULT_VIEWS,
  ResultMeta,
  ResultRecordset,
  ResultView,
  StoredResult,
  VIEW_QUERY_PARAM,
  cellText,
  decodeRecordset,
  rerunBlocker,
  rerunRequest,
  resultDbIds,
  resultRow,
  resultView,
  validResultId,
} from './query-result';
import { ResultListsComponent } from './result-lists.component';

ModuleRegistry.registerModules([AllCommunityModule]);

type ResultState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly result: StoredResult }
  | { readonly kind: 'problem'; readonly problem: LinkProblem };

/** "Run again": nothing yet, a run in flight, its fresh rows, or the agent's refusal as it worded it. */
type RerunState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | {
      readonly kind: 'fresh';
      readonly recordset: ResultRecordset;
      readonly ranAt: string;
      readonly truncated: boolean;
    }
  | { readonly kind: 'error'; readonly text: string };

type GridRow = Record<string, string>;

/** A parameter of the route or of one of its ancestors (the store id is a parameter of `store/:storeId`). */
function routeParam(
  route: ActivatedRouteSnapshot,
  key: string,
): string | undefined {
  for (const r of [...(route.pathFromRoot ?? []), route].reverse()) {
    const value = r.paramMap?.get(key);
    if (value) return value;
  }
  return undefined;
}

/** Whether the store is a local agent (`http-127.0.0.1:<port>`, `localhost:<port>`, `[::1]`). */
export function isLoopbackStore(storeId: string): boolean {
  return /^(?:https?-)?(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(
    storeId,
  );
}

const VIEW_LABELS: Record<ResultView, string> = {
  table: 'Table',
  record: 'Record',
  columns: 'Columns',
  sources: 'Sources',
  related: 'Related',
};

/** The agent's own error as it worded it: `CODE: message`, or a plain line when it gave none. */
export function rerunErrorText(err: unknown): string {
  const envelope =
    err instanceof HttpErrorResponse
      ? tryDecodeErrorEnvelope(err.error)
      : undefined;
  if (envelope) return `${envelope.error.code}: ${envelope.error.message}`;
  // An error body the strict contract decoder does not take is still shown as the agent worded it.
  const body =
    err instanceof HttpErrorResponse
      ? (err.error as { error?: { code?: unknown; message?: unknown } } | null)
      : null;
  const code = typeof body?.error?.code === 'string' ? body.error.code : '';
  const message =
    typeof body?.error?.message === 'string' ? body.error.message : '';
  if (code || message) return [code, message].filter(Boolean).join(': ');
  if (err instanceof HttpErrorResponse && err.status === 0)
    return 'The DataTug agent could not be reached.';
  if (err instanceof HttpErrorResponse && err.status === 401) {
    return 'The agent no longer accepts this page. Press Check again on the card in Claude Code for a fresh link.';
  }
  return 'The DataTug agent could not run the query.';
}

/**
 * A query result stored by `datatug query run --result-id`, opened from the "Open in DataTug" link of the Claude
 * Code card: `store/<agent>/result/<id>?view=<view>[&row=<n>]`. The result is read once from the agent
 * (`GET results/<id>`); the Table, Record, Columns, Sources and Related views are drawn from that answer, and the
 * view and row follow the address. The page runs a query only when "Run again" is pressed, through the query page's
 * own `exec/run_query` call, and never sends a write.
 */
@Component({
  selector: 'sneat-datatug-query-result-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonTitle,
    IonContent,
    IonCard,
    IonCardContent,
    IonText,
    IonButton,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    AgGridAngular,
    AuthorCurrentRowComponent,
    LinkProblemComponent,
    ResultListsComponent,
  ],
  providers: [
    // The run goes to the agent of this page's store, whatever page the app was started on.
    SemanticApiService,
    {
      provide: DATATUG_AGENT_BASE_URL,
      useFactory: () =>
        agentBaseUrl(
          routeParam(inject(ActivatedRoute).snapshot, routingParamStoreId) ??
            '',
        ),
    },
  ],
  templateUrl: './query-result.page.html',
  styleUrls: ['../agent-link-page.scss', './query-result.page.scss'],
})
export class QueryResultPageComponent {
  private readonly api = inject(AgentLinkApiService);
  private readonly semanticApi = inject(SemanticApiService);
  // Looked up on the press only: the service reads the agent's identity as soon as it is created.
  private readonly injector = inject(Injector);
  private readonly agentBase = inject(DATATUG_AGENT_BASE_URL);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navContext = inject(DatatugNavContextService);
  private readonly projectService = inject(ProjectService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reload$ = new Subject<void>();
  private projectSubscription?: Subscription;
  private rerunSubscription?: Subscription;

  readonly views = RESULT_VIEWS;
  readonly viewLabels = VIEW_LABELS;
  readonly rerunLimit = RERUN_LIMIT;
  readonly storeId = signal('');
  /** Where Back goes with no history: the project of the result when it is selected, else the store's page. */
  readonly backHref = signal('/');
  readonly state = signal<ResultState>({ kind: 'loading' });
  readonly view = signal<ResultView>('table');
  readonly row = signal(1);
  readonly rerun = signal<RerunState>({ kind: 'idle' });

  readonly result = computed(() => {
    const s = this.state();
    return s.kind === 'loaded' ? s.result : undefined;
  });
  /** The rows shown: the fresh rows of "Run again" when there are any, else the saved ones. */
  readonly recordset = computed<ResultRecordset | undefined>(() => {
    const r = this.rerun();
    return r.kind === 'fresh' ? r.recordset : this.result()?.recordset;
  });
  readonly rerunBlocker = computed(() => {
    const result = this.result();
    return result ? rerunBlocker(result.meta) : undefined;
  });
  readonly listView = computed(() => {
    const v = this.view();
    return v === 'columns' || v === 'sources' || v === 'related'
      ? v
      : undefined;
  });
  readonly gridColumns = computed<ColDef<GridRow>[]>(() =>
    (this.recordset()?.columns ?? []).map((c, i) => ({
      colId: `c${i}`,
      field: `c${i}`,
      headerName: c.name,
      sortable: false,
      minWidth: 120,
    })),
  );
  readonly gridRows = computed<GridRow[]>(() =>
    (this.recordset()?.rows ?? []).map((row) =>
      Object.fromEntries(row.map((cell, i) => [`c${i}`, cellText(cell)])),
    ),
  );
  readonly gridDefaultColDef: ColDef<GridRow> = {
    initialFlex: 1,
    resizable: true,
  };
  readonly gridNoRows =
    '<span class="ag-overlay-no-rows-center">No rows.</span>';
  readonly totalRows = computed(() => this.recordset()?.rows.length ?? 0);
  readonly currentRow = computed(() => this.recordset()?.rows[this.row() - 1]);
  /** Whether the shown rows are all there are: false when the saved result or the fresh run was cut short. */
  readonly totalKnown = computed(() => {
    const r = this.rerun();
    if (r.kind === 'fresh') return !r.truncated;
    return !this.result()?.meta.rows.hasMore;
  });

  constructor() {
    combineLatest([this.route.paramMap, this.reload$])
      .pipe(
        switchMap(() => {
          const snapshot = this.route.snapshot;
          const storeId = routeParam(snapshot, routingParamStoreId) ?? '';
          const id = routeParam(snapshot, routingParamResultId);
          this.storeId.set(storeId);
          this.backHref.set(linkBackHref(storeId, undefined));
          this.state.set({ kind: 'loading' });
          this.resetRerun();
          if (!isLoopbackStore(storeId)) {
            // Results live on this computer only: no other address is ever asked for one.
            return of<ResultState>({
              kind: 'problem',
              problem: 'agent-unreachable',
            });
          }
          if (!validResultId(id)) {
            return of<ResultState>({
              kind: 'problem',
              problem: 'result-not-found',
            });
          }
          return this.api.storedResult(storeId, id).pipe(
            map((result): ResultState => ({ kind: 'loaded', result })),
            catchError((err: unknown) =>
              of<ResultState>({
                kind: 'problem',
                problem:
                  err instanceof LinkProblemError ? err.problem : 'read-failed',
              }),
            ),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((state) => {
        this.state.set(state);
        this.selectProject(
          state.kind === 'loaded' ? state.result.meta : undefined,
        );
      });
    this.destroyRef.onDestroy(() => this.projectSubscription?.unsubscribe());
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((q) => {
      this.view.set(resultView(q.get(VIEW_QUERY_PARAM)));
      this.row.set(resultRow(q.get(ROW_QUERY_PARAM)));
    });
    this.reload$.next();
  }

  /** Reads the result again (Check again). */
  reload(): void {
    this.reload$.next();
  }

  /** Switches the view; the address follows (it holds the view name only). */
  selectView(value: unknown): void {
    const view = resultView(typeof value === 'string' ? value : '');
    this.view.set(view);
    this.navigate({ [VIEW_QUERY_PARAM]: view });
  }

  /** Selects the row at a 1-based position; the address holds the position, never a value or key. */
  selectRow(position: number): void {
    const total = this.totalRows();
    if (!total) return;
    const row = Math.min(Math.max(1, position), total);
    this.row.set(row);
    this.navigate({ [ROW_QUERY_PARAM]: String(row) });
  }

  gridRowClicked(event: RowClickedEvent<GridRow>): void {
    if (typeof event.rowIndex === 'number') this.selectRow(event.rowIndex + 1);
  }

  /**
   * "Run again": the query page's `exec/run_query` request built from the saved metadata, with the agent's current
   * security context. Only this press runs anything; the agent's own rules (read-only start, policies, grants,
   * limits) apply as for any run, and its refusal is shown as it worded it.
   */
  runAgain(): void {
    const result = this.result();
    if (!result || this.rerunBlocker() || this.rerun().kind === 'running')
      return;
    this.rerun.set({ kind: 'running' });
    this.rerunSubscription?.unsubscribe();
    this.rerunSubscription = this.injector
      .get(AgentContextService)
      .contextFor(this.agentBase)
      .refresh()
      .pipe(
        switchMap((info) => {
          const request = rerunRequest(result.meta, info.securityContextId);
          if (!request) throw new Error('not runnable');
          return this.semanticApi.runQuery(request);
        }),
      )
      .subscribe({
        next: (response: RunQueryResponse) =>
          this.rerun.set({
            kind: 'fresh',
            recordset: decodeRecordset(response.recordset),
            ranAt: new Date().toLocaleTimeString(),
            truncated: response.truncated === true,
          }),
        error: (err: unknown) =>
          this.rerun.set({ kind: 'error', text: rerunErrorText(err) }),
      });
  }

  /** Shows the saved result again; the saved files and this address never changed. */
  backToSaved(): void {
    this.resetRerun();
  }

  /**
   * Makes the project of the result the current one, so the side panel shows its menu as on the project's own pages.
   * The project is named by the result's saved database reference and is selected only when this agent knows it
   * (its summary is read from the same loopback agent); a result of a database outside any project, or of a project
   * this agent does not have, leaves the panel with no project, silently. No id or name is sent anywhere else.
   */
  private selectProject(meta: ResultMeta | undefined): void {
    this.projectSubscription?.unsubscribe();
    const url = this.router.url;
    const ids = meta ? resultDbIds(meta) : undefined;
    const storeId = this.storeId();
    this.backHref.set(linkBackHref(storeId, undefined));
    if (!ids || !storeId) {
      this.navContext.selectResultProject(url);
      return;
    }
    const ref = { projectId: ids.project, storeId };
    this.projectSubscription = this.projectService
      .getSummary(ref)
      .pipe(take(1))
      .subscribe({
        next: (summary) => {
          if (!summary) {
            this.navContext.selectResultProject(url);
            return;
          }
          this.backHref.set(linkBackHref(storeId, ids.project));
          const known = summary.environments?.some((e) => e.id === ids.env);
          this.navContext.selectResultProject(
            url,
            { ref, store: { ref: parseDatatugStoreRef(storeId) } },
            known ? ids.env : undefined,
          );
        },
        error: () => this.navContext.selectResultProject(url),
      });
  }

  private resetRerun(): void {
    this.rerunSubscription?.unsubscribe();
    this.rerunSubscription = undefined;
    this.rerun.set({ kind: 'idle' });
  }

  private navigate(queryParams: Record<string, string>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
