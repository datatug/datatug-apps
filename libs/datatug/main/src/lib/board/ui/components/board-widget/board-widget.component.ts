import { HttpErrorResponse } from '@angular/common/http';
import { HeldRowEvidenceComponent } from '../../../../evidence/held-row-evidence.component';
import { RetainedEvidenceViewerComponent } from '../../../../evidence/retained-evidence-viewer.component';
import { heldEvidenceIdentity } from '../../../../evidence/retained-evidence-contract';
import { requireAppliedInputMatch } from '../../../../evidence/applied-evidence';
import { useNativeRunLifetime } from '../../../../evidence/native-run-lifetime';
import { RetainedRunIntent } from '../../../../evidence/run-intent';
import {
  nativeQueryDiagnostic,
  nativeQueryDiagnosticMessage,
} from '../../../../queries/native-query-failure';
import { BoardPresentationSelection } from '../../../core/board-presentation-selection';
import {
  admitComparisonChart,
  filterHeldOrders,
} from './held-presentation-admission';
import { prepareGroupedBars } from '../held-result-presentation/grouped-bars';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  WritableSignal,
  untracked,
} from '@angular/core';
import { Router, RouterLink, UrlTree } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { IonButton, IonSkeletonText } from '@ionic/angular';
import {
  BoardWidget,
  ChartWidgetDef,
  ChartSpec,
  FieldsWidgetDef,
  SQLWidgetDef,
  TabsWidgetDef,
  TextWidgetDef,
} from '@datatug/board-models';
import { IBoardContext } from '../../../../models/definition/board/board';
import { IProjectRef } from '../../../../core/project-context';
import {
  equalProjectRef,
  isSharedProjectRef,
} from '../../../../core/project-context';
import { projectPageHref } from '../../../../nav/project-page-href';
import { QueryType } from '../../../../models/definition/query-def';
import { IQueryDef } from '../../../../models/definition/query-def';
import { firstValueFrom, fromEvent, takeUntil, timeout } from 'rxjs';
import { QueriesService } from '../../../../queries/queries.service';
import { QueryDispatchService } from '../../../../queries/query-dispatch.service';
import { QueryDispatchError } from '../../../../queries/query-dispatch';
import type { QueryRuntimeOption } from '../../../../queries/query-runtime-registry.service';
import {
  chartEvidenceError,
  decodeResult,
  prepareEvidenceChart,
  type PreparedEvidenceChart,
  type HeldEvidenceIdentity,
  type EvidenceInspection,
  prepareBarRace,
  prepareOrdersMonthlyTrend,
  transformOrdersMonthlyCountryCount,
  SourceRightsNoticeComponent,
  type BrowserPublicApiChartRecordset,
  type BrowserSqliteChartRecordset,
  type ServerChartRecordset,
  type TypedValue,
} from '@sneat/datatug-semantic';
import {
  EvidenceChartComponent,
  BarRaceChartComponent,
  OrdersMonthlyTrendComponent,
  type BarRaceChartViews,
} from '@datatug/charts';
import {
  HeldResultPresentationComponent,
  type CategoryBarFields,
} from '../held-result-presentation/held-result-presentation.component';
import { isShowcaseTutorialBoard } from '../../pages/board/showcase-tutorial-eligibility';
import { FederatedQueryResult } from '../../../../queries/federated-query-executor';
import { isSavedPublicChartQueryId } from '../../../../queries/public-data/public-chart-query';
import {
  BoardQueryResults,
  boardExecutionCacheKey,
  cardResultKey,
  cardResultScope,
  canonicalJson,
} from '../../../core/board-query-results.service';
import { TextWidgetComponent } from '../widgets/text-widget/text-widget.component';
import {
  FieldsViewComponent,
  type FieldPair,
} from '../widgets/fields-widget/fields-view.component';
import { BoardChoicesService } from '../../../core/board-choices.service';
import { BoardReadForRun } from '../../../core/board-read-for-run';
import { TutorialBoardRuntime } from '../../../core/tutorial-board-runtime';
import { signal } from '@angular/core';
import { githubProjectAddressForRef } from '../../../../services/project/project-assets-read.service';
import { qualifiedLocalReadVersionGuidance } from '../../../../services/project/project-query-api.service';
import { TabsWidgetComponent } from '../widgets/tabs-widget/tabs-widget.component';
import { MAX_NESTED_TAB_DEPTH, widgetAtTabPath } from './nested-tab-path';

export interface BoardResultSnapshot {
  readonly queryId: string;
  readonly result:
    | FederatedQueryResult
    | BrowserPublicApiChartRecordset
    | BrowserSqliteChartRecordset
    | ServerChartRecordset;
  readonly identity?: string;
  readonly previous?: BoardResultSnapshot;
  /** Authenticated retained provider identity; never derived from sidecar or UI. */
  readonly evidenceIdentity?: HeldEvidenceIdentity;
}

@Component({
  selector: 'sneat-datatug-board-widget',
  templateUrl: './board-widget.component.html',
  styleUrl: './board-widget.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RetainedEvidenceViewerComponent,
    HeldRowEvidenceComponent,
    EvidenceChartComponent,
    TabsWidgetComponent,
    RouterLink,
    IonButton,
    EvidenceChartComponent,
    BarRaceChartComponent,
    OrdersMonthlyTrendComponent,
    HeldResultPresentationComponent,
    SourceRightsNoticeComponent,
    IonSkeletonText,
    TextWidgetComponent,
    FieldsViewComponent,
  ],
})
export class BoardWidgetComponent {
  readonly presentationSelection = inject(BoardPresentationSelection, {
    optional: true,
  });
  readonly selectedCountry = computed(() =>
    this.presentationSelection?.value(this.chartWidgetDef()?.chart.selectionId),
  );
  readonly filteredPresentation = computed(() => {
    const filter = this.sqlWidgetDef()?.sql?.presentationFilter;
    return filterHeldOrders(
      this.result(),
      this.queryId() ?? '',
      filter,
      this.presentationSelection?.value(filter?.selectionId),
    );
  });
  clearCountry(): void {
    this.presentationSelection?.clear(
      this.sqlWidgetDef()?.sql?.presentationFilter?.selectionId ??
        this.chartWidgetDef()?.chart.selectionId,
    );
  }
  selectCountry(country: string): void {
    const id = this.chartWidgetDef()?.chart.selectionId;
    if (id) this.presentationSelection?.select(id, country);
  }
  private readonly tutorialRuntime = inject(TutorialBoardRuntime, {
    optional: true,
  });
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly queries = inject(QueriesService);
  private readonly dispatcher = inject(QueryDispatchService);
  private readonly injectedQueries = inject(BoardQueryResults, {
    optional: true,
  });
  /** A cache handed in by a standalone card view wins over the board-scoped one. */
  readonly resultCache = input<BoardQueryResults>();
  private get heldQueries(): BoardQueryResults | null {
    return this.resultCache() ?? this.injectedQueries;
  }
  /**
   * Standalone project-card rendering: no board to revalidate against, runs
   * start by themselves, and every widget shows loading / error / empty states.
   * Card parameter values arrive as `boardContext().parameters`.
   */
  readonly cardMode = input(false);
  readonly textWidgetDef = computed(() =>
    this.widgetDef()?.name === 'text'
      ? (this.widgetDef()?.data as TextWidgetDef | undefined)
      : undefined,
  );
  readonly fieldsWidgetDef = computed(() =>
    this.widgetDef()?.name === 'fields'
      ? (this.widgetDef()?.data as FieldsWidgetDef | undefined)
      : undefined,
  );
  /** Parameter values by id, for `text` placeholders and parameter-sourced widgets. */
  readonly parameterValues = computed<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = {};
    for (const [id, item] of Object.entries(
      this.boardContext()?.parameters ?? {},
    ))
      out[id] = item?.value;
    return out;
  });
  /** Label/value pairs of the `fields` widget, or undefined while there is no record. */
  readonly fieldPairs = computed<FieldPair[] | undefined>(() => {
    const def = this.fieldsWidgetDef();
    if (!def?.source) return undefined;
    let record: Record<string, unknown> | undefined;
    if ('parameter' in def.source) {
      const value = this.parameterValues()[def.source.parameter];
      const row = Array.isArray(value) ? value[0] : value;
      record =
        row && typeof row === 'object'
          ? (row as Record<string, unknown>)
          : undefined;
    } else {
      const answer = this.result()?.recordset;
      const first = answer?.rows[0];
      if (!answer || !first) return undefined;
      record = {};
      answer.columns.forEach((column, i) => {
        (record as Record<string, unknown>)[column.name] = first[i]?.value;
      });
    }
    if (!record) return undefined;
    const source = record;
    const wanted = def.fields?.length
      ? def.fields
      : Object.keys(source).map((column) => ({ column, label: undefined }));
    return wanted.map((f) => ({
      label: f.label || f.column,
      value:
        source[f.column] == null
          ? ''
          : typeof source[f.column] === 'object'
            ? JSON.stringify(source[f.column])
            : String(source[f.column]),
    }));
  });
  readonly fieldsSourceIsParameter = computed(() => {
    const source = this.fieldsWidgetDef()?.source;
    return !!source && 'parameter' in source;
  });
  /** Id of the card parameter a grid (`SQL`) widget takes its rows from, if any. */
  readonly sqlSourceParameter = computed(
    () => this.sqlWidgetDef()?.source?.parameter,
  );
  /** Rows of a parameter-sourced grid: a `recordset` (array) or one `record`. */
  readonly sqlParameterGrid = computed<
    { columns: string[]; rows: unknown[][] } | undefined
  >(() => {
    const id = this.sqlSourceParameter();
    if (!id) return undefined;
    const value = this.parameterValues()[id];
    const list = (Array.isArray(value) ? value : value ? [value] : []).filter(
      (row): row is Record<string, unknown> =>
        !!row && typeof row === 'object' && !Array.isArray(row),
    );
    const columns: string[] = [];
    for (const row of list.slice(0, 200))
      for (const key of Object.keys(row))
        if (!columns.includes(key)) columns.push(key);
    return {
      columns,
      rows: list.slice(0, 200).map((row) => columns.map((c) => row[c])),
    };
  });
  /** Template switch key: parameter-sourced grids render without any query. */
  readonly widgetCase = computed(() =>
    this.sqlSourceParameter() ? 'SQL-parameter' : this.widgetDef()?.name,
  );
  readonly cardQueryWidget = computed(
    () =>
      !this.sqlSourceParameter() &&
      ['SQL', 'chart', 'fields'].includes(this.widgetKind() ?? ''),
  );
  private readonly nativeRunLifetime = useNativeRunLifetime();
  private readonly retainedIntent = new RetainedRunIntent();
  readonly retainedPending = signal(false);
  readonly retainedReviewed = signal(false);
  async reviewRetainedRun(): Promise<void> {
    const ref = this.projectRef(),
      id = this.boardId(),
      read = this.readBoardForRun();
    if (!ref || !id || !read || this.running()) return;
    const key = this.executionIdentity();
    this.retainedReviewed.set(false);
    try {
      const lifetime = this.nativeRunLifetime.capture(
        ref,
        this.choices.actor(),
        this.definition()?.connectionId === 'shipping-working-copy' ||
          this.boardContext()?.evidenceSelection
          ? {
              sourceId: 'shipping-working-copy',
              environment: this.boardContext()?.environment || '',
            }
          : undefined,
      );
      await firstValueFrom(
        read(ref, id).pipe(
          takeUntil(fromEvent(lifetime.signal, 'abort')),
          timeout(15000),
        ),
      );
      if (
        !lifetime.signal.aborted &&
        key === this.executionIdentity() &&
        this.retainedPending()
      )
        this.retainedReviewed.set(true);
    } catch {
      this.runError.set(
        'Current board rights could not be refreshed. Original run may already be attached.',
      );
    }
  }
  abandonRetainedRun(): void {
    if (!this.retainedReviewed() || this.running()) return;
    this.retainedIntent.abandonReviewed();
    this.retainedPending.set(false);
    this.retainedReviewed.set(false);
  }

  private readonly destroyRef = inject(DestroyRef);
  private activeRun?: AbortController;
  private activeIdentity?: string;
  readonly choices = inject(BoardChoicesService);
  private generation = 0;
  private destroyed = false;
  readonly running = signal(false);
  private readonly ownSnapshot = signal<BoardResultSnapshot | undefined>(
    undefined,
  );
  /** Shared only through this card's nested widget tree; never persisted. */
  readonly resultSnapshot =
    input<WritableSignal<BoardResultSnapshot | undefined>>();
  readonly snapshotStore = computed(
    () => this.resultSnapshot() ?? this.ownSnapshot,
  );
  private readonly ownAutoRunAttempts = signal<ReadonlySet<string>>(new Set());
  readonly autoRunAttempts = input<WritableSignal<ReadonlySet<string>>>();
  readonly attemptsStore = computed(
    () => this.autoRunAttempts() ?? this.ownAutoRunAttempts,
  );
  /** A held result can only be reused within the same execution and saved query identity. */
  readonly executionIdentity = computed(() =>
    JSON.stringify({
      project: this.projectRef(),
      board: this.boardId(),
      card: this.cardId(),
      query: this.queryId(),
      definition: this.definition(),
      sources: this.chartExecutionInputs(),
      tutorial: this.sessionOnly(),
      context: this.boardContext(),
      actor: this.choices.actor(),
      runtime: this.selectedRuntimeId(),
      revision: this.dispatcher.runtimeRevision(),
    }),
  );
  readonly heldSnapshot = computed(() => {
    const identity = this.executionIdentity();
    for (
      let snapshot = this.snapshotStore()();
      snapshot;
      snapshot = snapshot.previous
    ) {
      if (snapshot.queryId === this.queryId() && snapshot.identity === identity)
        return snapshot;
    }
    return undefined;
  });
  readonly result = computed(() => this.heldSnapshot()?.result);
  readonly evidenceKind = computed(() =>
    ['timeline', 'timing-bars', 'heatmap'].includes(
      this.chartWidgetDef()?.chart.type ?? '',
    ),
  );
  private readonly preparedEvidenceIdentity = signal('');
  private readonly preparedEvidenceInputs = signal<
    { snapshot: BoardResultSnapshot; chart: ChartSpec } | undefined
  >(undefined);
  private readonly heldPreparedEvidence = signal<PreparedEvidenceChart | null>(
    null,
  );
  readonly preparedEvidence = computed(() =>
    this.preparedEvidenceIdentity() === this.executionIdentity() &&
    this.preparedEvidenceInputs()?.snapshot === this.heldSnapshot() &&
    this.preparedEvidenceInputs()?.chart === this.chartWidgetDef()?.chart
      ? this.heldPreparedEvidence()
      : null,
  );
  readonly evidenceError = signal<string | null>(null);
  readonly preparingEvidence = signal(false);
  readonly inspectedEvidence = signal<EvidenceInspection | undefined>(
    undefined,
  );
  readonly inspectEvidence = output<EvidenceInspection>();
  inspectHeldEvidence(value: EvidenceInspection): void {
    if (
      !this.preparedEvidence() ||
      !this.result() ||
      this.preparedEvidenceIdentity() !== this.executionIdentity() ||
      this.running() ||
      this.preparingEvidence()
    )
      return;
    this.inspectedEvidence.set(value);
    this.inspectEvidence.emit(value);
  }
  readonly showcase = computed(() => {
    const ref = this.projectRef();
    if (
      !ref ||
      !['github', 'github.com'].includes(ref.storeId) ||
      ref.projectApi
    )
      return false;
    try {
      return isShowcaseTutorialBoard(ref, {
        id: this.boardId() ?? '',
        title: '',
      });
    } catch {
      return false;
    }
  });
  readonly browserSnapshot = computed(() => {
    const result = this.result();
    return (
      !!result && 'runtime' in result && result.runtime === 'browser-sqlite'
    );
  });
  readonly chartView = signal<'chart' | 'grid' | 'trend'>('chart');
  readonly chartWidgetDef = computed(() =>
    this.widgetDef()?.name === 'chart'
      ? (this.widgetDef()?.data as ChartWidgetDef)
      : undefined,
  );
  private readonly widgetKind = computed(() => this.widgetDef()?.name);
  private readonly chartExecutionInputs = computed(() =>
    JSON.stringify(this.chartWidgetDef()?.sources),
  );
  readonly raceInitialMode = computed(() => {
    const chart = this.chartWidgetDef()?.chart;
    return chart?.type === 'bar-race' ? chart.mode : 'period';
  });
  readonly raceInitialTopN = computed(() => {
    const chart = this.chartWidgetDef()?.chart;
    return chart?.type === 'bar-race' ? chart.topN : 10;
  });
  readonly barFields = computed<CategoryBarFields | null>(() => {
    const widget = this.chartWidgetDef();
    return widget?.chart?.type === 'bar'
      ? {
          categoryColumn: widget.chart.categoryColumn,
          measureColumn: widget.chart.valueColumn,
          series: widget.chart.series,
          title: widget.title ?? 'Query results',
          unit: widget.chart.unit,
        }
      : null;
  });
  private readonly raceDefinition = computed(
    () => {
      const widget = this.chartWidgetDef();
      return widget?.chart.type === 'bar-race'
        ? { chart: widget.chart, transform: widget.sources[0]?.transform }
        : undefined;
    },
    { equal: (left, right) => JSON.stringify(left) === JSON.stringify(right) },
  );
  readonly monthlyTrend = computed(() => {
    const race = this.raceDefinition(),
      result = this.result();
    if (!race?.transform)
      return {
        error: 'Monthly trend requires the declared raw Orders transform.',
      };
    if (!result) return {};
    if (
      !('runtime' in result) ||
      !['browser-public-api', 'browser-sqlite', 'server'].includes(
        result.runtime,
      )
    )
      return {
        error: 'Monthly trend requires a complete admitted Orders result.',
      };
    const trend = prepareOrdersMonthlyTrend(result, race.transform);
    return trend.ok ? { data: trend.data } : { error: trend.message };
  });
  readonly preparedRace = computed<{
    views?: BarRaceChartViews;
    error?: string;
  }>(() => {
    const race = this.raceDefinition();
    const result = this.result();
    if (!race || !result) return {};
    if (
      !('runtime' in result) ||
      !['browser-public-api', 'browser-sqlite', 'server'].includes(
        result.runtime,
      )
    )
      return { error: 'This race requires an admitted public chart result.' };
    const transform = race.transform;
    const transformed = transform
      ? transformOrdersMonthlyCountryCount(result, transform)
      : undefined;
    if (transformed && !transformed.ok) return { error: transformed.message };
    const source = transformed?.ok ? transformed.data.recordset : result;
    const spec = {
      kind: 'bar-race' as const,
      periodColumn: race.chart.periodColumn,
      categoryColumn: race.chart.categoryColumn,
      measureColumn: race.chart.valueColumn,
      unit: race.chart.unit,
      onDuplicate: race.chart.onDuplicate,
      topN: race.chart.topN,
    };
    const period = prepareBarRace(source, { ...spec, mode: 'period' });
    const cumulative = prepareBarRace(source, { ...spec, mode: 'cumulative' });
    return period.ok && cumulative.ok
      ? { views: { period: period.data, cumulative: cumulative.data } }
      : {
          error: !period.ok
            ? period.message
            : !cumulative.ok
              ? cumulative.message
              : undefined,
        };
  });
  readonly serverResult = computed(() => {
    const result = this.result();
    return result && !('runtime' in result) ? result : undefined;
  });
  readonly runError = signal<string | undefined>(undefined);
  /** Retained locally for inspection/tests; never rendered or sent to logging. */
  readonly runFailure = signal<unknown>(undefined);
  readonly choiceError = signal<string | undefined>(undefined);
  readonly unsupportedReason = signal<string | undefined>(undefined);
  readonly definitionLoading = signal(false);
  readonly definition = signal<IQueryDef | undefined>(undefined);
  readonly workingCopies = signal<readonly QueryRuntimeOption[]>([]);
  readonly selectedRuntimeId = signal('snapshot');
  readonly remembered = computed(
    () =>
      !this.sessionOnly() &&
      this.choices.read(this.projectRef(), this.boardId()).selectedQueryId ===
        this.queryId(),
  );
  readonly canRemember = computed(
    () => !this.sessionOnly() && this.choices.canPersist(this.projectRef()),
  );
  readonly sessionOnly = computed(
    () =>
      this.showcase() &&
      ['tutorial', 'tutoril'].includes(this.queryParams().get('mode') ?? '') &&
      !!this.tutorialRuntime?.activeFor(this.projectRef(), this.boardId()),
  );
  readonly level = input<number>();
  readonly widgetPath = input<readonly string[]>([]);
  readonly maxTabDepth = MAX_NESTED_TAB_DEPTH;
  readonly nestedWidgetComponent = BoardWidgetComponent;
  readonly cardTab = input<QueryType | 'grid' | 'card'>();
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly widgetDef = input<BoardWidget>();

  // In boards.go, BoardWidget.data for name "SQL" is the whole SQLWidgetDef
  // ({ title?, parameters?, sql: { query } }), not the inner settings.
  readonly tabsWidgetDef = computed(
    () => this.widgetDef()?.data as TabsWidgetDef | undefined,
  );
  readonly sqlWidgetDef = computed(() =>
    this.widgetDef()?.name === 'SQL'
      ? (this.widgetDef()?.data as SQLWidgetDef | undefined)
      : undefined,
  );
  readonly queryId = computed(() =>
    this.widgetDef()?.name === 'chart'
      ? this.chartWidgetDef()?.sources?.length === 1
        ? this.chartWidgetDef()?.sources[0]?.queryId?.trim()
        : undefined
      : this.widgetDef()?.name === 'fields'
        ? this.fieldsQuerySource()?.queryId?.trim()
        : this.sqlWidgetDef()?.sql?.queryId?.trim(),
  );
  private readonly fieldsQuerySource = computed(() => {
    const source = this.fieldsWidgetDef()?.source;
    return source && 'queryId' in source ? source : undefined;
  });
  readonly boardId = input<string>();
  readonly cardId = input<string>();
  readonly readBoardForRun = input<BoardReadForRun>();
  readonly visibleRows = computed(
    () => this.result()?.recordset.rows.slice(0, 50) || [],
  );

  private queryReadRef(ref: IProjectRef): IProjectRef {
    if (
      ref.projectApi ||
      !ref.branch ||
      !['github', 'github.com'].includes(ref.storeId)
    )
      return ref;
    return { ...ref, projectId: githubProjectAddressForRef(ref) };
  }

  private readonly initialPresentationView = computed(
    () => {
      const active =
        !!this.sessionOnly() &&
        !!this.tutorialRuntime?.activeFor(this.projectRef(), this.boardId());
      return {
        scope: JSON.stringify([
          this.projectRef(),
          this.boardId(),
          this.cardId(),
          this.widgetPath(),
          active,
        ]),
        view:
          (active
            ? this.tutorialRuntime?.presentationView(
                this.cardId(),
                this.widgetPath(),
              )
            : undefined) ??
          this.chartWidgetDef()?.defaultView ??
          'chart',
      };
    },
    {
      equal: (left, right) =>
        left.scope === right.scope && left.view === right.view,
    },
  );

  constructor() {
    this.nativeRunLifetime.changes$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.activeRun?.abort();
      this.heldQueries?.invalidate();
      this.retainedIntent.clearHeld();
      this.retainedPending.set(false);
      this.retainedReviewed.set(false);
      this.snapshotStore().set(undefined);
      this.inspectedEvidence.set(undefined);
    });
    effect((onCleanup) => {
      const chart = this.chartWidgetDef()?.chart;
      const held = this.heldSnapshot();
      const currentIdentity = this.executionIdentity();
      const result = this.result();
      const running = this.running();
      this.heldPreparedEvidence.set(null);
      this.preparedEvidenceIdentity.set('');
      this.preparedEvidenceInputs.set(undefined);
      this.inspectedEvidence.set(undefined);
      this.evidenceError.set(null);
      this.preparingEvidence.set(false);
      if (!chart || !this.evidenceKind() || !result || running) return;
      const identity = held?.evidenceIdentity;
      if (!identity || !held) {
        this.evidenceError.set(
          'Retained source identity is unavailable for this result. The server must provide admitted execution evidence.',
        );
        return;
      }
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });
      this.preparingEvidence.set(true);
      try {
        const core = decodeResult(result);
        void prepareEvidenceChart(chart, core, identity)
          .then(
            (data) => {
              if (!cancelled) {
                this.heldPreparedEvidence.set(data);
                this.preparedEvidenceIdentity.set(currentIdentity);
                this.preparedEvidenceInputs.set({ snapshot: held, chart });
              }
            },
            (error: unknown) => {
              if (!cancelled)
                this.evidenceError.set(
                  error instanceof Error
                    ? error.message
                    : 'Held evidence is unavailable.',
                );
            },
          )
          .finally(() => {
            if (!cancelled) this.preparingEvidence.set(false);
          });
      } catch (error) {
        this.evidenceError.set(
          error instanceof Error
            ? error.message
            : 'Held evidence is unavailable.',
        );
        this.preparingEvidence.set(false);
      }
    });
    effect(() => this.chartView.set(this.initialPresentationView().view));
    this.destroyRef.onDestroy(() => {
      const id = this.chartWidgetDef()?.chart.selectionId;
      if (id) this.presentationSelection?.clear(id);
      this.destroyed = true;
      this.generation++;
      this.activeRun?.abort();
    });
    effect((onCleanup) => {
      const ref = this.projectRef();
      const id = this.queryId();
      this.chartExecutionInputs();
      this.sessionOnly();
      this.boardId();
      this.cardId();
      this.widgetPath();
      this.readBoardForRun();
      this.choices.actor();
      this.boardContext();
      this.dispatcher.runtimeRevision();
      this.selectedRuntimeId();
      this.generation++;
      const generation = this.generation;
      this.definition.set(undefined);
      this.workingCopies.set([]);
      if (!this.resultSnapshot()) this.ownSnapshot.set(undefined);
      this.runError.set(undefined);
      this.runFailure.set(undefined);
      this.choiceError.set(undefined);
      this.running.set(false);
      this.unsupportedReason.set(undefined);
      if (!ref || !id || !this.cardQueryWidget())
        return;
      // The existing public GitHub query reader ignores branch. The qualified
      // reader and board revalidation must both be available before Run.
      let queryRef: IProjectRef;
      try {
        queryRef = this.queryReadRef(ref);
      } catch {
        this.unsupportedReason.set(
          'The project branch conflicts with its GitHub address. Open the saved query to inspect it.',
        );
        return;
      }
      this.definitionLoading.set(true);
      const subscription = this.queries.getQuery(queryRef, id).subscribe({
        next: (definition) => {
          if (this.generation !== generation) return;
          this.definitionLoading.set(false);
          const reason = this.ineligibleReason(definition, id);
          this.unsupportedReason.set(reason);
          if (!reason) {
            this.definition.set(definition);
            if (
              definition.request.queryType === QueryType.DTQL ||
              definition.request.queryType === QueryType.TugQL
            ) {
              const controller = new AbortController();
              onCleanup(() => controller.abort());
              void this.dispatcher
                .availableWorkingCopies({
                  projectRef: ref,
                  definition,
                  environment: this.boardContext()?.environment,
                  signal: controller.signal,
                })
                .then((options) => {
                  if (this.generation !== generation) return;
                  this.workingCopies.set(options);
                  if (
                    !options.some(
                      (option) =>
                        option.selectionId === this.selectedRuntimeId(),
                    )
                  )
                    this.selectedRuntimeId.set('snapshot');
                })
                .catch(() => {
                  if (this.generation === generation)
                    this.workingCopies.set([]);
                });
            }
          }
        },
        error: (error: unknown) => {
          if (this.generation !== generation) return;
          this.definitionLoading.set(false);
          this.unsupportedReason.set(
            error instanceof HttpErrorResponse && error.status === 404
              ? `Query not found: ${id}`
              : 'This saved query could not be checked. Open it to inspect its source.',
          );
        },
      });
      onCleanup(() => {
        subscription.unsubscribe();
        this.activeRun?.abort();
      });
    });
    effect(() => {
      const definition = this.definition();
      const identity = this.executionIdentity();
      const eligible =
        definition &&
        !this.unsupportedReason() &&
        ((this.showcase() && this.readBoardForRun()) || this.cardMode());
      if (!eligible) return;
      untracked(() => {
        if (this.result() || this.attemptsStore()().has(identity)) return;
        this.attemptsStore().update(
          (attempts) => new Set([...attempts, identity]),
        );
        queueMicrotask(() => {
          if (!this.destroyed && this.executionIdentity() === identity)
            void this.run(true);
        });
      });
    });
  }

  private stillCurrent(
    generation: number,
    ref: IProjectRef,
    boardId: string,
    cardId: string,
    queryId: string,
    actor: string | undefined,
    readBoard: BoardReadForRun | undefined,
    path: readonly string[],
  ): boolean {
    return (
      !this.destroyed &&
      this.generation === generation &&
      this.executionIdentity() === this.activeIdentity &&
      this.projectRef() === ref &&
      equalProjectRef(this.projectRef(), ref) &&
      this.boardId() === boardId &&
      this.cardId() === cardId &&
      this.queryId() === queryId &&
      this.cardQueryWidget() &&
      this.choices.actor() === actor &&
      this.readBoardForRun() === readBoard &&
      this.widgetPath() === path
    );
  }

  private ineligibleReason(
    definition: IQueryDef,
    id: string,
  ): string | undefined {
    if (definition.id !== id && !id.endsWith('/' + definition.id))
      return 'The saved query identity changed. Open it to inspect the source.';
    if (
      ![QueryType.SQL, QueryType.DTQL, QueryType.TugQL].includes(
        definition.request.queryType,
      )
    )
      return 'This widget uses a query language this board cannot run.';
    return undefined;
  }

  projectRuntimeLabel(): string {
    if (
      (this.definition()?.federation ||
        isSavedPublicChartQueryId(this.queryId() ?? '')) &&
      this.selectedRuntimeId() === 'snapshot'
    )
      return 'Read-only OVDB server';
    switch (this.boardContext()?.executionTarget?.kind) {
      case 'local-agent':
        return 'Local agent';
      case 'hosted-cloud':
        return 'Shared cloud';
      case 'ovdb-federation':
        return 'Federated runtime';
      case 'ovdb-connection':
        return 'OVDB connection';
      default:
        return 'Published browser snapshot';
    }
  }

  selectRuntime(selectionId: string): void {
    if (selectionId === this.selectedRuntimeId()) return;
    this.activeRun?.abort();
    this.runError.set(undefined);
    this.runFailure.set(undefined);
    this.selectedRuntimeId.set(selectionId);
  }

  async run(reuse = false): Promise<void> {
    const ref = this.projectRef();
    const boardId = this.boardId();
    const cardId = this.cardId();
    const queryId = this.queryId();
    const readBoard = this.readBoardForRun();
    const path = this.widgetPath();
    const actor = this.choices.actor();
    const standalone = this.cardMode();
    if (
      !ref ||
      !boardId ||
      !cardId ||
      !queryId ||
      (!readBoard && !standalone) ||
      !this.definition() ||
      this.running() ||
      this.unsupportedReason()
    )
      return;
    if (
      !this.definition()?.federation &&
      !isSavedPublicChartQueryId(queryId) &&
      this.definition()?.request.queryType !== QueryType.SQL &&
      this.selectedRuntimeId() === 'snapshot' &&
      (!this.boardContext()?.executionTarget ||
        this.boardContext()?.executionTarget?.kind === 'browser-sqlite')
    ) {
      this.runError.set(
        'Choose an open working copy to run this structured query.',
      );
      return;
    }
    if (
      this.definition()?.request.queryType === QueryType.SQL &&
      this.selectedRuntimeId() !== 'snapshot'
    ) {
      this.runError.set(
        'Raw SQL cannot run in this working-copy runtime. Choose the project runtime.',
      );
      return;
    }
    const generation = ++this.generation;
    const controller = new AbortController();
    this.activeRun?.abort();
    this.activeRun = controller;
    this.running.set(true);
    const previous = this.snapshotStore()();
    const identity = this.executionIdentity();
    this.activeIdentity = identity;
    const widgetName = this.widgetDef()?.name;
    const chartDefinition = JSON.stringify(this.chartWidgetDef());
    this.runError.set(undefined);
    this.runFailure.set(undefined);
    try {
      const originalNative =
        this.boardContext()?.executionTarget?.kind === 'hosted-cloud' &&
        isSharedProjectRef(ref)
          ? this.nativeRunLifetime.capture(
              ref,
              actor,
              this.definition()?.connectionId === 'shipping-working-copy' ||
                this.boardContext()?.evidenceSelection
                ? {
                    sourceId: 'shipping-working-copy',
                    environment: this.boardContext()?.environment || '',
                  }
                : undefined,
            )
          : undefined;
      const readSignal = originalNative
        ? AbortSignal.any([controller.signal, originalNative.signal])
        : controller.signal;
      if (!standalone && readBoard) {
        const board = await firstValueFrom(
          readBoard(ref, boardId).pipe(
            takeUntil(fromEvent(readSignal, 'abort')),
            timeout(15000),
          ),
        );
        if (
          !this.stillCurrent(
            generation,
            ref,
            boardId,
            cardId,
            queryId,
            actor,
            readBoard,
            path,
          )
        )
          return;
        const matchingCards = board.rows
          ?.flatMap((row) => row.cards || [])
          .filter((card) => card.id === cardId);
        const currentCard =
          matchingCards?.length === 1 ? matchingCards[0] : undefined;
        const currentWidget = widgetAtTabPath(currentCard?.widget, path);
        const expectedWidget = this.widgetDef();
        const sessionRequested = this.sessionOnly() && !!this.tutorialRuntime;
        const sessionAdmitted =
          sessionRequested &&
          expectedWidget &&
          this.tutorialRuntime?.activeFor(ref, boardId)
            ? await this.tutorialRuntime.admit(
                board,
                ref,
                cardId,
                path,
                expectedWidget,
              )
            : false;
        if (
          !this.stillCurrent(
            generation,
            ref,
            boardId,
            cardId,
            queryId,
            actor,
            readBoard,
            path,
          )
        )
          return;
        if (
          board.id !== boardId ||
          (sessionRequested
            ? !sessionAdmitted
            : !currentWidget ||
              currentWidget.name !== widgetName ||
              (widgetName === 'chart'
                ? JSON.stringify(currentWidget.data) !== chartDefinition
                : widgetName === 'fields'
                  ? JSON.stringify(
                      (currentWidget.data as FieldsWidgetDef | undefined)
                        ?.source,
                    ) !==
                    JSON.stringify(
                      (expectedWidget?.data as FieldsWidgetDef | undefined)
                        ?.source,
                    )
                  : JSON.stringify(
                      (currentWidget.data as SQLWidgetDef | undefined)?.sql,
                    ) !==
                    JSON.stringify(
                      (expectedWidget?.data as SQLWidgetDef | undefined)?.sql,
                    )))
        )
          throw new Error(
            'This board card changed. Reopen the board before running it.',
          );
      }
      const queryRef = this.queryReadRef(ref);
      const definition = await firstValueFrom(
        this.queries.getQuery(queryRef, queryId).pipe(timeout(15000)),
      );
      if (
        !this.stillCurrent(
          generation,
          ref,
          boardId,
          cardId,
          queryId,
          actor,
          readBoard,
          path,
        )
      )
        return;
      const reason = this.ineligibleReason(definition, queryId);
      if (reason) throw new Error(reason);
      if (
        !this.stillCurrent(
          generation,
          ref,
          boardId,
          cardId,
          queryId,
          actor,
          readBoard,
          path,
        )
      )
        return;
      const context = this.boardContext();
      const parameters = this.typedParameters(definition);
      const selectedRuntimeId = this.selectedRuntimeId();
      if (
        selectedRuntimeId !== 'snapshot' &&
        !this.workingCopies().some(
          (option) => option.selectionId === selectedRuntimeId,
        )
      )
        throw new QueryDispatchError(
          'The selected working copy is closed. Choose a current runtime.',
        );
      if (JSON.stringify(definition) !== JSON.stringify(this.definition()))
        throw new Error(
          'This saved query changed. Reopen the board before running it.',
        );
      const selection = context?.evidenceSelection;
      const hosted =
        context?.executionTarget?.kind === 'hosted-cloud' &&
        isSharedProjectRef(ref);
      const native = hosted
        ? this.nativeRunLifetime.capture(
            ref,
            actor,
            selection || definition.connectionId === 'shipping-working-copy'
              ? {
                  sourceId: 'shipping-working-copy',
                  environment: context?.environment || '',
                }
              : undefined,
          )
        : undefined;
      if (selection) {
        if (
          !hosted ||
          selection.environment !== context?.environment ||
          selection.choice.evidence.context.scope.environmentId !==
            context?.environment
        )
          throw new Error(
            'Choose applied context for this current hosted environment.',
          );
        requireAppliedInputMatch(selection.choice, parameters);
      }
      const intent = hosted
        ? await this.retainedIntent.prepare(
            JSON.stringify([
              actor,
              ref,
              boardId,
              cardId,
              path,
              definition,
              context,
            ]),
            {
              queryId,
              parameters,
              ...(selection ? { evidence: selection.choice.evidence } : {}),
            },
          )
        : undefined;
      if (
        controller.signal.aborted ||
        native?.signal.aborted ||
        identity !== this.executionIdentity()
      )
        return;
      if (intent) this.retainedPending.set(true);
      const execute = async (signal: AbortSignal) => {
        return this.dispatcher.executeHeld(
          {
            projectRef: ref,
            definition,
            queryId,
            environment: context?.environment,
            ...(selectedRuntimeId !== 'snapshot'
              ? { runtimeSelectionId: selectedRuntimeId }
              : context?.executionTarget
                ? { target: context.executionTarget }
                : {}),
            ...(context?.securityContextId
              ? { securityContextId: context.securityContextId }
              : {}),
            ...(context?.runtimeBinding
              ? { runtimeBinding: context.runtimeBinding }
              : {}),
            parameters,
            signal: native ? AbortSignal.any([signal, native.signal]) : signal,
            ...(native ? { principal: native.actor } : {}),
            ...(intent ? { operationId: intent.operationId } : {}),
            ...(selection ? { evidence: selection.choice.evidence } : {}),
          },
          { maxRows: 1000 },
        );
      };
      const scope = standalone
        ? cardResultScope({
            actor: JSON.stringify([actor, this.dispatcher.runtimeRevision()]),
            project: JSON.stringify(ref),
            environment: context?.environment,
          })
        : JSON.stringify({
            ref,
            boardId,
            context,
            actor,
            tutorial: this.sessionOnly(),
            revision: this.dispatcher.runtimeRevision(),
          });
      const key = standalone
        ? cardResultKey({
            queryId,
            // No backend revision yet: the definition itself versions the entry.
            variant: canonicalJson({
              definition,
              selectedRuntimeId,
              operationId: intent?.operationId,
            }),
            parameters,
          })
        : boardExecutionCacheKey(
            { queryId, definition, selectedRuntimeId, parameters },
            intent?.operationId,
          );
      const rawResult = this.heldQueries
        ? await this.heldQueries.readExecution(
            scope,
            key,
            controller.signal,
            reuse,
            execute,
          )
        : await execute(controller.signal);
      const result = this.chartResult(rawResult.result, definition);
      const evidenceIdentity =
        rawResult.hostedResponse && native && context?.environment
          ? heldEvidenceIdentity(rawResult.hostedResponse, {
              projectRef: ref,
              environment: context.environment,
              actor: native.actor,
            })
          : undefined;
      if (
        this.stillCurrent(
          generation,
          ref,
          boardId,
          cardId,
          queryId,
          actor,
          readBoard,
          path,
        )
      ) {
        this.snapshotStore().set({
          queryId,
          result,
          ...(evidenceIdentity ? { evidenceIdentity } : {}),
          identity,
          previous: this.retainSnapshots(previous, identity),
        });
        if (intent) {
          this.retainedIntent.confirm();
          this.retainedPending.set(false);
          this.retainedReviewed.set(false);
        }
        this.rememberChoice();
      }
    } catch (error) {
      this.retainedIntent.rejectConflict(error);
      if (this.retainedIntent.hasPending) this.retainedPending.set(true);
      if (
        this.stillCurrent(
          generation,
          ref,
          boardId,
          cardId,
          queryId,
          actor,
          readBoard,
          path,
        )
      ) {
        if (
          error instanceof HttpErrorResponse &&
          [401, 403].includes(error.status)
        ) {
          this.snapshotStore().set(undefined);
          this.inspectedEvidence.set(undefined);
        }
        this.runFailure.set(error);
        this.runError.set(
          nativeQueryDiagnosticMessage(nativeQueryDiagnostic(error)) ??
            qualifiedLocalReadVersionGuidance(error) ??
            (error instanceof QueryDispatchError ||
            (error instanceof Error &&
              (error.message.startsWith('This board card changed.') ||
                error.message.startsWith(
                  'This board card needs a value for ',
                ) ||
                error.message.startsWith('This saved query changed.') ||
                error.message.startsWith('This chart source')))
              ? error.message
              : 'The saved query could not run. Try again or open the saved query to inspect it.'),
        );
      }
    } finally {
      if (this.activeRun === controller) this.activeRun = undefined;
      if (
        this.stillCurrent(
          generation,
          ref,
          boardId,
          cardId,
          queryId,
          actor,
          readBoard,
          path,
        )
      )
        this.running.set(false);
    }
  }

  /** Only the validated complete ordinary server path can supply chart evidence. */
  private chartResult(
    result: FederatedQueryResult,
    definition: IQueryDef,
  ): BoardResultSnapshot['result'] {
    const chart = this.chartWidgetDef()?.chart;
    const tables = definition.federation?.tables;
    if (chart?.series) {
      if (
        'runtime' in result &&
        (result.runtime === 'browser-public-api' ||
          result.runtime === 'browser-sqlite' ||
          result.runtime === 'server')
      ) {
        const admitted = result as
          | BrowserPublicApiChartRecordset
          | BrowserSqliteChartRecordset
          | ServerChartRecordset;
        if (
          !admitted.complete ||
          admitted.hasMore ||
          admitted.truncated ||
          chartEvidenceError(admitted)
        )
          throw new Error(
            'This chart source needs a complete admitted result.',
          );
      } else if (tables?.length === 1) {
        if (
          !result.nativeDirect ||
          !result.ordinaryComplete ||
          result.totalRows !== result.recordset.rows.length ||
          result.hasMore ||
          result.truncated ||
          !result.provenance.executionProfile ||
          result.ordinarySources?.length !== 1 ||
          result.ordinarySources[0].database !== tables[0].database ||
          result.ordinarySources[0].collection !== tables[0].name
        )
          throw new Error(
            'This chart source needs a complete admitted single-source result.',
          );
      } else admitComparisonChart(result, definition);
      prepareGroupedBars(result, chart.categoryColumn, chart.series);
    }
    if (
      !result.nativeDirect ||
      !result.ordinaryComplete ||
      tables?.length !== 1 ||
      result.totalRows !== result.recordset.rows.length ||
      result.hasMore ||
      result.truncated ||
      !result.provenance.executionProfile ||
      result.ordinarySources?.length !== 1 ||
      result.ordinarySources[0].database !== tables[0].database ||
      result.ordinarySources[0].collection !== tables[0].name
    )
      return result;
    return {
      ...result,
      runtime: 'server',
      complete: true,
      hasMore: false,
      provenance: {
        ...result.provenance,
        executionProfile: result.provenance.executionProfile,
        collection: tables[0].name,
      },
    };
  }

  /** Card-mode retry after a failed run or an unavailable query definition. */
  retry(): void {
    this.runError.set(undefined);
    void this.run(false);
  }

  setChartView(view: 'chart' | 'grid' | 'trend'): void {
    // Manual view choices are ephemeral even in a tutorial. Guide actions own replay.
    if (view === 'trend' && !this.raceDefinition()?.transform) return;
    this.chartView.set(view);
  }

  /** At most one held result per identity, with a small card-local history. */
  private retainSnapshots(
    previous: BoardResultSnapshot | undefined,
    identity: string,
  ): BoardResultSnapshot | undefined {
    const snapshots: BoardResultSnapshot[] = [];
    const seen = new Set([identity]);
    for (
      let current = previous;
      current && snapshots.length < 12;
      current = current.previous
    ) {
      const key = current.identity ?? current.queryId;
      if (seen.has(key)) continue;
      seen.add(key);
      snapshots.push(current);
    }
    return snapshots.reduceRight<BoardResultSnapshot | undefined>(
      (previous, current) => ({ ...current, previous }),
      undefined,
    );
  }

  private typedParameters(
    definition: IQueryDef,
  ): Readonly<Record<string, TypedValue>> {
    const supplied = this.boardContext()?.parameters ?? {};
    const values: Record<string, TypedValue> = {};
    const chartSource = this.chartWidgetDef()?.sources?.[0];
    const bindings =
      chartSource?.parameters ??
      this.sqlWidgetDef()?.sql?.parameters ??
      this.fieldsQuerySource()?.parameters;
    const boundParameters = !!chartSource || bindings !== undefined;
    const bindingKind = chartSource ? 'chart' : 'saved-query widget';
    const boundValues = new Map<string, unknown>();
    if (bindings !== undefined) {
      if (!Array.isArray(bindings))
        throw new QueryDispatchError(
          `This ${bindingKind} has malformed parameter bindings.`,
        );
      for (const binding of bindings) {
        if (
          !binding ||
          typeof binding !== 'object' ||
          typeof binding.id !== 'string' ||
          !binding.id ||
          binding.id.trim() !== binding.id ||
          boundValues.has(binding.id) ||
          !definition.parameters?.some(
            (parameter) => parameter.id === binding.id,
          )
        )
          throw new QueryDispatchError(
            `This ${bindingKind} has an unknown or duplicate parameter binding.`,
          );
        const hasValue = Object.prototype.hasOwnProperty.call(binding, 'value');
        const hasBoardParameter = Object.prototype.hasOwnProperty.call(
          binding,
          'boardParameterId',
        );
        if (hasValue && hasBoardParameter)
          throw new QueryDispatchError(
            `This ${bindingKind} parameter has conflicting bindings.`,
          );
        if (hasBoardParameter) {
          const id = binding.boardParameterId;
          if (
            typeof id !== 'string' ||
            !id ||
            id.trim() !== id ||
            supplied[id]?.value === undefined
          )
            throw new QueryDispatchError(
              `This ${bindingKind} parameter references an unavailable board parameter.`,
            );
          boundValues.set(binding.id, supplied[id].value);
        } else if (hasValue) {
          if (binding.value === undefined)
            throw new QueryDispatchError(
              `This ${bindingKind} parameter has no constant value.`,
            );
          boundValues.set(binding.id, binding.value);
        } else {
          const parameter = definition.parameters?.find(
            (parameter) => parameter.id === binding.id,
          );
          boundValues.set(
            binding.id,
            (parameter as { defaultValue?: unknown } | undefined)?.defaultValue,
          );
        }
      }
    }
    for (const parameter of definition.parameters ?? []) {
      if (
        boundParameters &&
        ![
          'integer',
          'number',
          'float',
          'money',
          'boolean',
          'bit',
          'date',
          'datetime',
          'string',
          'text',
          'UUID',
          'GUID',
        ].includes(parameter.type)
      )
        throw new QueryDispatchError(
          `The ${bindingKind} parameter type for ${parameter.title ?? parameter.id} is unsupported.`,
        );
      const raw = boundParameters
        ? boundValues.has(parameter.id)
          ? boundValues.get(parameter.id)
          : (parameter as { defaultValue?: unknown }).defaultValue
        : supplied[parameter.id]?.value;
      if (raw === undefined) {
        if (parameter.isRequired !== false)
          throw new Error(
            `This board card needs a value for ${parameter.title ?? parameter.id}.`,
          );
        continue;
      }
      if (Array.isArray(raw))
        throw new Error(
          `This board card requires a single value for ${parameter.title ?? parameter.id}.`,
        );
      switch (parameter.type) {
        case 'integer':
          if (
            !(
              (typeof raw === 'number' && Number.isSafeInteger(raw)) ||
              (typeof raw === 'string' && /^-?(0|[1-9][0-9]*)$/.test(raw))
            )
          )
            throw new QueryDispatchError(
              `The value for ${parameter.title ?? parameter.id} is invalid.`,
            );
          values[parameter.id] = { type: 'integer', value: String(raw) };
          break;
        case 'number':
        case 'float':
        case 'money':
          if (typeof raw !== 'number' || !Number.isFinite(raw))
            throw new Error(
              `The value for ${parameter.title ?? parameter.id} is invalid.`,
            );
          values[parameter.id] = { type: 'number', value: raw };
          break;
        case 'boolean':
        case 'bit':
          if (typeof raw !== 'boolean')
            throw new Error(
              `The value for ${parameter.title ?? parameter.id} is invalid.`,
            );
          values[parameter.id] = { type: 'boolean', value: raw };
          break;
        case 'date':
          if (typeof raw !== 'string')
            throw new Error(
              `The value for ${parameter.title ?? parameter.id} is invalid.`,
            );
          values[parameter.id] = { type: 'date', value: raw };
          break;
        case 'datetime':
          if (typeof raw !== 'string')
            throw new Error(
              `The value for ${parameter.title ?? parameter.id} is invalid.`,
            );
          values[parameter.id] = { type: 'datetime', value: raw };
          break;
        default:
          if (typeof raw !== 'string')
            throw new Error(
              `The value for ${parameter.title ?? parameter.id} is invalid.`,
            );
          values[parameter.id] = { type: 'string', value: raw };
      }
    }
    return Object.freeze(values);
  }

  rememberChoice(): void {
    if (this.cardMode()) return;
    const ref = this.projectRef();
    const boardId = this.boardId();
    const queryId = this.queryId();
    if (ref && boardId && queryId && this.canRemember())
      this.choiceError.set(
        this.choices.selectQuery(ref, boardId, queryId)
          ? undefined
          : 'This browser could not remember the selected query.',
      );
  }

  displayParameterCell(value: unknown): string {
    return value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  }

  displayCell(cell: { readonly value?: unknown }): string {
    return cell.value == null ? 'NULL' : String(cell.value);
  }
  readonly queryUrlTree = computed<UrlTree | undefined>(() => {
    const ref = this.projectRef();
    const id = this.queryId();
    if (!ref || !id) return undefined;
    const href = projectPageHref(ref, ['query', id]);
    if (href === '/') return undefined;
    const tree = this.router.parseUrl(href);
    const environment = this.boardContext()?.environment;
    tree.queryParams = {
      ...tree.queryParams,
      id,
      ...(environment ? { env: environment } : {}),
      runtime:
        this.selectedRuntimeId() === 'snapshot'
          ? 'project'
          : this.selectedRuntimeId(),
    };
    return tree;
  });

  readonly boardContext = input<IBoardContext>();
  readonly projectRef = input<IProjectRef>();
}
