import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  WritableSignal,
  untracked,
} from '@angular/core';
import { Router, RouterLink, UrlTree } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonButton } from '@ionic/angular';
import {
  BoardWidget,
  ChartWidgetDef,
  SQLWidgetDef,
  TabsWidgetDef,
} from '@datatug/board-models';
import { IBoardContext } from '../../../../models/definition/board/board';
import { IProjectRef } from '../../../../core/project-context';
import { equalProjectRef } from '../../../../core/project-context';
import { projectPageHref } from '../../../../nav/project-page-href';
import { QueryType } from '../../../../models/definition/query-def';
import { IQueryDef } from '../../../../models/definition/query-def';
import { firstValueFrom, timeout } from 'rxjs';
import { QueriesService } from '../../../../queries/queries.service';
import { QueryDispatchService } from '../../../../queries/query-dispatch.service';
import { QueryDispatchError } from '../../../../queries/query-dispatch';
import type { QueryRuntimeOption } from '../../../../queries/query-runtime-registry.service';
import {
  prepareBarRace,
  transformOrdersMonthlyCountryCount,
  SourceRightsNoticeComponent,
  type BrowserPublicApiChartRecordset,
  type TypedValue,
} from '@sneat/datatug-semantic';
import { BarRaceChartComponent, type BarRaceChartViews } from '@datatug/charts';
import {
  HeldResultPresentationComponent,
  type CategoryBarFields,
} from '../held-result-presentation/held-result-presentation.component';
import {
  executeSavedPublicChartQuery,
  isSavedPublicChartQueryId,
  executeSavedPublicInspectQuery,
  isSavedPublicInspectQueryId,
} from '../../../../queries/public-data/public-chart-query';
import { isShowcaseTutorialBoard } from '../../pages/board/showcase-tutorial-eligibility';
import { FederatedQueryResult } from '../../../../queries/federated-query-executor';
import { BoardChoicesService } from '../../../core/board-choices.service';
import { BoardReadForRun } from '../../../core/board-read-for-run';
import { signal } from '@angular/core';
import { githubProjectAddressForRef } from '../../../../services/project/project-assets-read.service';
import { qualifiedLocalReadVersionGuidance } from '../../../../services/project/project-query-api.service';
import { TabsWidgetComponent } from '../widgets/tabs-widget/tabs-widget.component';
import { MAX_NESTED_TAB_DEPTH, widgetAtTabPath } from './nested-tab-path';

export interface BoardResultSnapshot {
  readonly queryId: string;
  readonly result: FederatedQueryResult | BrowserPublicApiChartRecordset;
  readonly identity?: string;
  readonly previous?: BoardResultSnapshot;
}

@Component({
  selector: 'sneat-datatug-board-widget',
  templateUrl: './board-widget.component.html',
  styleUrl: './board-widget.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TabsWidgetComponent,
    RouterLink,
    IonButton,
    BarRaceChartComponent,
    HeldResultPresentationComponent,
    SourceRightsNoticeComponent,
  ],
})
export class BoardWidgetComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly queries = inject(QueriesService);
  private readonly dispatcher = inject(QueryDispatchService);
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
      context: this.boardContext(),
      actor: this.choices.actor(),
      runtime: this.selectedRuntimeId(),
      revision: this.dispatcher.runtimeRevision(),
    }),
  );
  readonly result = computed(() => {
    const identity = this.executionIdentity();
    for (
      let snapshot = this.snapshotStore()();
      snapshot;
      snapshot = snapshot.previous
    ) {
      if (snapshot.queryId === this.queryId() && snapshot.identity === identity)
        return snapshot.result;
    }
    return undefined;
  });
  readonly showcase = computed(() =>
    isShowcaseTutorialBoard(this.projectRef(), {
      id: this.boardId() ?? '',
      title: '',
    }),
  );
  readonly publicQuery = computed(
    () =>
      this.showcase() &&
      !!this.queryId() &&
      (isSavedPublicChartQueryId(this.queryId()!) ||
        (this.widgetDef()?.name === 'SQL' &&
          isSavedPublicInspectQueryId(this.queryId()!))),
  );
  readonly chartView = signal<'chart' | 'grid'>('chart');
  readonly chartWidgetDef = computed(() =>
    this.widgetDef()?.name === 'chart'
      ? (this.widgetDef()?.data as ChartWidgetDef)
      : undefined,
  );
  readonly barFields = computed<CategoryBarFields | null>(() => {
    const widget = this.chartWidgetDef();
    return widget?.chart?.type === 'bar'
      ? {
          categoryColumn: widget.chart.categoryColumn,
          measureColumn: widget.chart.valueColumn,
          title: widget.title ?? 'Query results',
          unit: widget.chart.unit,
        }
      : null;
  });
  readonly preparedRace = computed<{
    views?: BarRaceChartViews;
    error?: string;
  }>(() => {
    const widget = this.chartWidgetDef();
    const result = this.result();
    if (widget?.chart?.type !== 'bar-race' || !result) return {};
    if (!('runtime' in result) || result.runtime !== 'browser-public-api')
      return { error: 'This race requires an admitted public chart result.' };
    const transform = widget.sources[0]?.transform;
    const transformed = transform
      ? transformOrdersMonthlyCountryCount(result, transform)
      : undefined;
    if (transformed && !transformed.ok) return { error: transformed.message };
    const source = transformed?.ok ? transformed.data.recordset : result;
    const spec = {
      kind: 'bar-race' as const,
      periodColumn: widget.chart.periodColumn,
      categoryColumn: widget.chart.categoryColumn,
      measureColumn: widget.chart.valueColumn,
      unit: widget.chart.unit,
      onDuplicate: widget.chart.onDuplicate,
      topN: widget.chart.topN,
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
    () => this.queryParams().get('mode') === 'tutorial',
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
  readonly sqlWidgetDef = computed(
    () => this.widgetDef()?.data as SQLWidgetDef | undefined,
  );
  readonly queryId = computed(() =>
    this.widgetDef()?.name === 'chart'
      ? this.chartWidgetDef()?.sources?.length === 1
        ? this.chartWidgetDef()?.sources[0]?.queryId?.trim()
        : undefined
      : this.sqlWidgetDef()?.sql?.queryId?.trim(),
  );
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

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.generation++;
      this.activeRun?.abort();
    });
    effect((onCleanup) => {
      const ref = this.projectRef();
      const id = this.queryId();
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
      this.choiceError.set(undefined);
      this.running.set(false);
      this.unsupportedReason.set(undefined);
      this.chartView.set(this.chartWidgetDef()?.defaultView ?? 'chart');
      if (
        !ref ||
        !id ||
        !['SQL', 'chart'].includes(this.widgetDef()?.name ?? '')
      )
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
        error: () => {
          if (this.generation !== generation) return;
          this.definitionLoading.set(false);
          this.unsupportedReason.set(
            'This saved query could not be checked. Open it to inspect its source.',
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
        this.showcase() &&
        definition &&
        !this.unsupportedReason() &&
        this.readBoardForRun();
      if (!eligible) return;
      untracked(() => {
        if (this.result() || this.attemptsStore()().has(identity)) return;
        this.attemptsStore().update(
          (attempts) => new Set([...attempts, identity]),
        );
        queueMicrotask(() => {
          if (!this.destroyed && this.executionIdentity() === identity)
            void this.run();
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
    readBoard: BoardReadForRun,
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
      ['SQL', 'chart'].includes(this.widgetDef()?.name ?? '') &&
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
    if (definition.federation)
      return 'This saved query needs its admitted federation session. Open it to run the full query.';
    return undefined;
  }

  projectRuntimeLabel(): string {
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
        return this.publicQuery()
          ? 'Verified public API'
          : 'Published browser snapshot';
    }
  }

  selectRuntime(selectionId: string): void {
    if (selectionId === this.selectedRuntimeId()) return;
    this.activeRun?.abort();
    this.runError.set(undefined);
    this.selectedRuntimeId.set(selectionId);
  }

  async run(): Promise<void> {
    const ref = this.projectRef();
    const boardId = this.boardId();
    const cardId = this.cardId();
    const queryId = this.queryId();
    const readBoard = this.readBoardForRun();
    const path = this.widgetPath();
    const actor = this.choices.actor();
    if (
      !ref ||
      !boardId ||
      !cardId ||
      !queryId ||
      !readBoard ||
      !this.definition() ||
      this.running() ||
      this.unsupportedReason()
    )
      return;
    if (
      !this.publicQuery() &&
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
    try {
      const board = await firstValueFrom(
        readBoard(ref, boardId).pipe(timeout(15000)),
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
      if (
        board.id !== boardId ||
        !currentWidget ||
        currentWidget.name !== widgetName ||
        (widgetName === 'chart'
          ? JSON.stringify(currentWidget.data) !== chartDefinition
          : (
              currentWidget.data as SQLWidgetDef | undefined
            )?.sql?.queryId?.trim() !== queryId)
      )
        throw new Error(
          'This board card changed. Reopen the board before running it.',
        );
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
      if (this.widgetDef()?.name === 'chart' && !this.publicQuery())
        throw new Error(
          'This chart source is not admitted for public chart execution.',
        );
      if (this.publicQuery() && selectedRuntimeId === 'snapshot' &&
        (context?.runtimeBinding || context?.executionTarget && context.executionTarget.kind !== 'browser-sqlite'))
        throw new QueryDispatchError('This saved public source requires the public API runtime. Choose the public board runtime to run it.');
      const result =
        this.publicQuery() &&
        selectedRuntimeId === 'snapshot' &&
        (!context?.executionTarget || context.executionTarget.kind === 'browser-sqlite') &&
        !context?.runtimeBinding
          ? isSavedPublicInspectQueryId(queryId)
            ? await executeSavedPublicInspectQuery(queryId, definition, {
                signal: controller.signal,
              })
            : await executeSavedPublicChartQuery(queryId, definition, {
                signal: controller.signal,
              })
          : await this.dispatcher.execute({
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
              signal: controller.signal,
            });
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
        this.snapshotStore().set({ queryId, result, identity, previous: this.retainSnapshots(previous, identity) });
        this.rememberChoice();
      }
    } catch (error) {
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
        this.runError.set(
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

  /** At most one held result per identity, with a small card-local history. */
  private retainSnapshots(previous: BoardResultSnapshot | undefined, identity: string): BoardResultSnapshot | undefined {
    const snapshots: BoardResultSnapshot[] = [];
    const seen = new Set([identity]);
    for (let current = previous; current && snapshots.length < 12; current = current.previous) {
      const key = current.identity ?? current.queryId;
      if (seen.has(key)) continue;
      seen.add(key);
      snapshots.push(current);
    }
    return snapshots.reduceRight<BoardResultSnapshot | undefined>((previous, current) => ({ ...current, previous }), undefined);
  }

  private typedParameters(
    definition: IQueryDef,
  ): Readonly<Record<string, TypedValue>> {
    const supplied = this.boardContext()?.parameters ?? {};
    const values: Record<string, TypedValue> = {};
    for (const parameter of definition.parameters ?? []) {
      const raw = supplied[parameter.id]?.value;
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
    };
    return tree;
  });

  readonly boardContext = input<IBoardContext>();
  readonly projectRef = input<IProjectRef>();
}
