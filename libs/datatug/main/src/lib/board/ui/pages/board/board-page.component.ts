import { ChartSourceEditorComponent } from '../../components/chart-source-editor/chart-source-editor.component';
import type { ChartSourceEdit } from '@datatug/board-models';
import { widgetAtTabPath } from '../../components/board-widget/nested-tab-path';
import { parseBoardParameterValue } from '../../../core/board-parameter-value';
import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  afterNextRender,
  ElementRef,
  Injector,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCol,
  IonContent,
  IonGrid,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonMenuButton,
  IonRow,
  IonToolbar,
} from '@ionic/angular';
import {
  catchError,
  distinctUntilChanged,
  map,
  switchMap,
  takeUntil,
} from 'rxjs/operators';
import { BehaviorSubject, EMPTY, Subject, combineLatest } from 'rxjs';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import {
  Board,
  BoardCard,
  TutorialBoardSession,
  TutorialControl,
  BoardSessionAction,
  BoardWidget,
  TabsWidgetDef,
  ChartWidgetDef,
  ChartSpec,
  canonicalBoardQueryIds,
} from '@datatug/board-models';
import {
  ParameterLookupButtonComponent,
  type ParameterLookupPick,
} from '../../../../components/parameters/parameter-lookup-button.component';
import type { ParameterLookupHost } from '../../../../components/parameters/parameter-lookup.service';
import { DatatugCoreModule } from '../../../../core/datatug-core.module';
import { routingParamBoard } from '../../../../core/datatug-routing-params';
import {
  IProjectRef,
  equalProjectRef,
  isLocalProjectRef,
  projectRefToString,
} from '../../../../core/project-context';
import { QueryParamsService } from '../../../../core/services/QueryParamsService';
import { IBoardContext } from '../../../../models/definition/board/board';
import { AgentContextService } from '@sneat/datatug-semantic';
import { agentBaseUrl } from '../../../../services/repo/agent-url';
import {
  IParameterDef,
  IParamWithDefAndValue,
  IParameterValueWithoutID,
} from '../../../../models/definition/parameter';
import { IProjBoard } from '../../../../models/definition/project';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';
import { DatatugServicesNavModule } from '../../../../services/nav/datatug-services-nav.module';
import { DatatugServicesStoreModule } from '../../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../../services/unsorted/datatug-services-unsorted.module';
import { ProjectAssetsReadService } from '../../../../services/project/project-assets-read.service';
import { qualifiedLocalReadVersionGuidance } from '../../../../services/project/project-query-api.service';
import { BoardComponent } from '../../components/board/board.component';
import { SneatDatatugPageTitleComponent } from '../../../../components/page-title/sneat-datatug-page-title.component';
import { BoardChoicesService } from '../../../core/board-choices.service';
import { BoardReadForRun } from '../../../core/board-read-for-run';
import { isShowcaseTutorialBoard } from './showcase-tutorial-eligibility';
import { TutorialBoardRuntime } from '../../../core/tutorial-board-runtime';
import { tabKey } from '../../components/board-widget/nested-tab-path';
import { HostedBoardWorkspaceComponent } from './hosted-board-workspace.component';
import { isSharedProjectRef } from '../../../../core/project-context';
import { isProjectItemNotFound } from '../../../../core/project-item-not-found.error';
import { projectPageHref } from '../../../../nav/project-page-href';
import { ErrorStateComponent } from '../../../../components/error-state/error-state.component';
import { currentTutorialStep, tutorialSteps } from './tutorial-scenario';

interface TutorialEditor {
  readonly key: string;
  readonly cardId: string;
  readonly title: string;
  readonly path: readonly string[];
  readonly widget: BoardWidget;
  readonly tabs?: readonly {
    readonly title: string;
    readonly key: string;
    readonly queryId?: string;
  }[];
  readonly chart?: ChartWidgetDef;
}

interface TutorialStatus {
  readonly control: TutorialControl;
  readonly canNext: boolean;
  readonly canPrevious: boolean;
  readonly isComplete: boolean;
}

@Component({
  selector: 'sneat-datatug-board-page',
  templateUrl: './board-page.component.html',
  styleUrl: './board-page.component.scss',
  imports: [ChartSourceEditorComponent,
    ErrorStateComponent,
    // `DatatugNavContextService` (injected below) needs `AppContextService`
    // (`DatatugCoreModule`), `EnvironmentService`
    // (`DatatugServicesUnsortedModule`) and, transitively, `StoreApiService`
    // (`DatatugServicesStoreModule`) — the exact same chain
    // `BoardsPageComponent` (this task's own sibling fix) needed, one level
    // deeper: `board/:id` (this page's own bare route,
    // `datatug-routing-proj.ts`) had no ancestor route or module supplying
    // any of them either, so opening a board from the Boards list threw the
    // same `NG0201` chain (confirmed live, S136), one level further:
    // `ParameterLookupService` (injected below, needs `AgentService` from
    // `DatatugServicesStoreModule`) is a plain `@Injectable()`, not
    // `providedIn: 'root'`, and was never in this component's own
    // `providers` either.
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    HostedBoardWorkspaceComponent,
    // BoardServiceModule,
    SneatDatatugPageTitleComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonMenuButton,
    IonContent,
    IonGrid,
    IonRow,
    IonCol,
    IonButton,
    IonIcon,
    IonItem,
    IonInput,
    BoardComponent,
    ParameterLookupButtonComponent,
  ],
  providers: [QueryParamsService, TutorialBoardRuntime],
})
export class BoardPageComponent implements OnInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private focusGeneration = 0;
  private readonly tutorialRuntime =
    inject(TutorialBoardRuntime, { optional: true }) ??
    new TutorialBoardRuntime();
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly choices = inject(BoardChoicesService);
  private readonly assets = inject(ProjectAssetsReadService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router, { optional: true });
  private readonly dataTugNavContext = inject(DatatugNavContextService);
  private readonly queryParamsService = inject(QueryParamsService);
  private readonly agentContext = inject(AgentContextService);

  // Signals, not plain fields: this app is zoneless
  // (provideZonelessChangeDetection(), main.ts) — every one of these is
  // written from inside a `.subscribe()` callback (or, for `storeId`/
  // `projectId`, a destructuring assignment inside one — the same
  // zoneless-unsafe shape as a plain `this.field = ...` write, just via
  // array-pattern syntax) in the constructor below, which never triggers
  // change detection on its own for a plain field. See AGENTS.md's "Change
  // detection & state" section and
  // pages/signed-in/project/project-page.component.ts (PR #95) for the
  // established pattern.
  readonly hostedProject = computed(() => {
    const ref = this.projectRef();
    return !!ref && isSharedProjectRef(ref);
  });
  readonly boardId = signal<string | null | undefined>(undefined);

  readonly projBoard = signal<IProjBoard | undefined>(undefined);

  readonly boardDef = signal<Board | undefined>(undefined);
  readonly tutorialRequested = signal(false);
  readonly tutorialBoard = signal<Board | undefined>(undefined);
  readonly tutorialStatus = signal<TutorialStatus | undefined>(undefined);
  readonly tutorialLoading = signal(false);
  readonly tutorialError = signal<string | undefined>(undefined);
  readonly authoringError = signal<string | undefined>(undefined);
  readonly tutorialAnnouncement = signal('');
  readonly tutorialGuide = signal<
    ReturnType<typeof currentTutorialStep> | undefined
  >(undefined);
  readonly tutorialProgressCue = computed(() => {
    const status = this.tutorialStatus();
    if (status?.control === 'free')
      return 'Editing freely. Resume the guide or restart this session.';
    if (this.tutorialGuide()?.step.action)
      return status?.canNext
        ? `Next: ${this.tutorialGuide()?.step.title}`
        : 'Session action limit reached. Use Previous or Restart to continue.';
    return 'Review the source limitation or take control.';
  });
  readonly tutorialStepCount = computed(() =>
    this.boardDef() ? tutorialSteps(this.boardDef() as Board).length : 0,
  );
  readonly tutorialQueries = computed(() =>
    this.boardDef() ? canonicalBoardQueryIds(this.boardDef() as Board) : [],
  );
  readonly nextCardPreview = computed(() => this.hiddenTutorialCards()[0]);
  readonly tutorialEditors = computed(() => {
    const editors: TutorialEditor[] = [];
    const walk = (
      cardId: string,
      title: string,
      widget: BoardWidget | undefined,
      path: readonly string[] = [],
    ) => {
      if (!widget || path.length > 8) return;
      if (widget.name === 'tabs') {
        const tabs = (widget.data as TabsWidgetDef).tabs ?? [];
        editors.push({
          key: JSON.stringify([cardId, ...path]),
          cardId,
          title,
          path,
          widget,
          tabs: tabs.map((tab, index) => ({
            title: tab.title,
            key: tabKey(tab, index),
            queryId:
              tab.widget?.name === 'SQL'
                ? (tab.widget.data as { sql?: { queryId?: string } }).sql
                    ?.queryId
                : undefined,
          })),
        });
        tabs.forEach((tab, index) =>
          walk(cardId, `${title} / ${tab.title}`, tab.widget, [
            ...path,
            tabKey(tab, index),
          ]),
        );
      } else if (widget.name === 'chart')
        editors.push({
          key: JSON.stringify([cardId, ...path]),
          cardId,
          title,
          path,
          widget,
          chart: widget.data as ChartWidgetDef,
        });
    };
    for (const item of this.visibleTutorialCards())
      walk(item.card.id, item.card.title || item.card.id, item.card.widget);
    return editors;
  });
  readonly tutorialAvailable = computed(() =>
    isShowcaseTutorialBoard(this.projectRef(), this.boardDef()),
  );
  readonly tutorialActive = computed(
    () => this.tutorialRequested() && this.tutorialAvailable(),
  );
  readonly displayBoard = computed(() =>
    this.tutorialActive() ? this.tutorialBoard() : this.boardDef(),
  );
  readonly hiddenTutorialCards = computed(() => {
    const saved = this.boardDef();
    const working = this.tutorialBoard();
    if (!saved || !working) return [];
    const visible = new Set(
      (working.rows ?? []).flatMap((row) =>
        (row.cards ?? []).map((card) => card.id),
      ),
    );
    return (saved.rows ?? [])
      .flatMap((row) => row.cards ?? [])
      .filter((card) => !visible.has(card.id));
  });
  readonly visibleTutorialCards = computed(() =>
    (this.tutorialBoard()?.rows ?? []).flatMap((row, rowIndex) =>
      (row.cards ?? []).map((card, index) => ({
        card,
        rowIndex,
        index,
        rowLength: row.cards?.length ?? 0,
      })),
    ),
  );
  private tutorialSession?: TutorialBoardSession;
  private tutorialGeneration = 0;
  readonly favoriteError = signal<string | undefined>(undefined);
  readonly canSaveFavorite = computed(() =>
    this.choices.canPersist(this.projectRef()),
  );
  readonly choicesForBoard = computed(() =>
    this.choices.read(this.projectRef(), this.boardId() || undefined),
  );
  private readonly reloadBoard = new BehaviorSubject(0);
  retryLoad(): void {
    this.reloadBoard.next(this.reloadBoard.value + 1);
  }
  readonly readBoardForRun: BoardReadForRun = (ref, id) =>
    this.assets.board(ref, id);

  toggleFavorite(): void {
    const ref = this.projectRef();
    const id = this.boardId();
    if (
      ref &&
      id &&
      this.boardDef() &&
      !this.tutorialActive() &&
      this.canSaveFavorite()
    ) {
      this.favoriteError.set(
        this.choices.setFavorite(ref, id, !this.choicesForBoard().favorite)
          ? undefined
          : 'This browser could not save the favorite. Please try again.',
      );
    }
  }
  readonly projectRef = signal<IProjectRef | undefined>(undefined);
  readonly unsupportedProject = computed(() => {
    const ref = this.projectRef();
    return !!ref?.spaceID;
  });
  readonly lookupUnavailable = computed(() => {
    const ref = this.projectRef();
    return !!(ref?.projectApi || ref?.branch);
  });
  /** The unavailable-lookup note concerns explicit (author SQL) lookups only. */
  readonly explicitLookupUnavailable = computed(
    () =>
      this.lookupUnavailable() &&
      !!this.parameters()?.some((p) => !!p.def.lookup),
  );
  /** Where this board's parameter pickers look up values (parameter-lookup REQ:runtime-execution). */
  readonly lookupContext = computed<ParameterLookupHost>(() => {
    const ref = this.projectRef();
    const storeId = this.storeId();
    const projectId = this.projectId();
    const envId = this.envId();
    return {
      projectRef: ref,
      environment: envId ?? undefined,
      ...(ref && isLocalProjectRef(ref) && !this.lookupUnavailable() && storeId && projectId && envId
        ? { explicitAgent: { storeId, projectId, envId } }
        : {}),
    };
  });
  /** Parameters whose current value was picked in the lookup ("from lookup"). */
  readonly lookupOrigins = signal<Readonly<Record<string, true>>>({});
  readonly presentationReset = signal(0);
  readonly loading = signal(true);
  readonly loadError = signal<string | undefined>(undefined);
  /** The saved board does not exist (a mistyped or deleted id): shown as not found, never as an empty board. */
  readonly notFound = signal(false);
  /** The failure behind `loadError`, kept so the error state can choose words for its kind. */
  readonly loadFailure = signal<unknown>(undefined);
  /** Specific guidance (update the local agent) that replaces the generic words for the failure. */
  readonly loadGuidance = signal<string | undefined>(undefined);
  /** The Boards list of this project, for the not-found and error states. */
  readonly boardsHref = computed(() => projectPageHref(this.projectRef(), 'boards'));
  readonly queriesHref = computed(() => projectPageHref(this.projectRef(), 'queries'));

  readonly parameters = signal<IParamWithDefAndValue[] | undefined>(undefined);
  readonly parameterErrors = signal<Readonly<Record<string, string>>>({});

  defaultHref?: string;
  readonly envId = signal<string | null | undefined>('LOCAL');
  readonly projectId = signal<string | undefined>(undefined);
  readonly storeId = signal<string | undefined>(undefined);

  readonly boardContext = signal<IBoardContext>({
    parameters: {},
    mode: 'view',
  });
  private readonly destroyed$ = new Subject<void>();

  constructor() {
    effect(() => {
      const ref = this.projectRef();
      const local = isLocalProjectRef(ref);
      const hosted = ref?.storeId === 'firestore' && !!ref.spaceID;
      const securityContextId = local
        ? this.agentContext
            .contextFor(agentBaseUrl(ref.storeId))
            .securityContextId()
        : undefined;
      untracked(() =>
        this.boardContext.update((context) => ({
          ...context,
          securityContextId,
          executionTarget: local
            ? { kind: 'local-agent', agentStoreId: ref.storeId }
            : hosted
              ? { kind: 'hosted-cloud' }
              : undefined,
        })),
      );
    });
    this.route.queryParamMap.pipe(takeUntil(this.destroyed$)).subscribe({
      next: (queryParamMap) => {
        const envId = queryParamMap.get('env');
        if (envId) this.dataTugNavContext.setCurrentEnvironment(envId);
        const requested = ['tutorial', 'tutoril'].includes(
          queryParamMap.get('mode') ?? '',
        );
        if (requested !== this.tutorialRequested()) {
          const tutorialWasActive = this.tutorialActive();
          this.tutorialRequested.set(requested);
          this.clearTutorial();
          if (requested) void this.openTutorial();
          else if (tutorialWasActive && this.boardDef())
            this.focusSavedBoardHeading();
        }
      },
      error: (err) =>
        this.errorLogger.logError(err, 'Failed to get query parameters'),
    });
    this.dataTugNavContext.currentEnv
      .pipe(takeUntil(this.destroyed$))
      .subscribe({
        next: (env) => {
          this.envId.set(env?.id);
          this.boardContext.update((context) => ({
            ...context,
            environment: env?.id ?? undefined,
          }));
          if (env?.id) this.queryParamsService.setQueryParameter('env', env.id);
        },
        error: (err) =>
          this.errorLogger.logError(err, 'Failed to get current environment'),
      });
    combineLatest([
      this.dataTugNavContext.currentProject,
      this.route.paramMap,
      this.reloadBoard,
    ])
      .pipe(
        map(([project, params, attempt]) => ({
          ref: project?.ref,
          id: params.get(routingParamBoard),
          attempt,
        })),
        distinctUntilChanged(
          (a, b) =>
            a.id === b.id &&
            a.attempt === b.attempt &&
            equalProjectRef(a.ref, b.ref),
        ),
        switchMap(({ ref, id }) => {
          this.projectRef.set(ref);
          this.storeId.set(ref?.storeId);
          this.projectId.set(ref?.projectId);
          this.boardId.set(id);
          this.clearTutorial();
          this.boardDef.set(undefined);
          this.projBoard.set(undefined);
          this.parameters.set(undefined);
          this.lookupOrigins.set({});
          this.parameterErrors.set({});
          this.boardContext.update((context) => ({
            ...context,
            parameters: {},
          }));
          this.loadError.set(undefined);
          this.notFound.set(false);
          this.loadFailure.set(undefined);
          this.loadGuidance.set(undefined);
          this.favoriteError.set(undefined);
          this.loading.set(true);
          if (!ref || isSharedProjectRef(ref)) {
            this.loading.set(false);
            return EMPTY;
          }
          if (!id) {
            this.loading.set(false);
            this.loadError.set('Board ID is missing.');
            return EMPTY;
          }
          return this.assets.board(ref, id, undefined, { requireExisting: true }).pipe(
            catchError((err: unknown) => {
              if (isProjectItemNotFound(err)) {
                this.notFound.set(true);
                this.loading.set(false);
                return EMPTY;
              }
              this.errorLogger.logError(err, 'Failed to get board', { show: false });
              this.loadFailure.set(err);
              this.loadGuidance.set(qualifiedLocalReadVersionGuidance(err) ?? undefined);
              this.loadError.set(
                qualifiedLocalReadVersionGuidance(err) ??
                  'This board could not be loaded. Try opening it again from Boards.',
              );
              this.loading.set(false);
              return EMPTY;
            }),
          );
        }),
        takeUntil(this.destroyed$),
      )
      .subscribe((board) => {
        this.projBoard.set(board as IProjBoard);
        this.boardDef.set(board);
        this.parameters.set(this.resolveParameters());
        this.lookupOrigins.set({});
        for (const def of board?.parameters ?? []) {
          const parameter = this.parameters()?.find(
            (parameter) => parameter.def.id === def.id,
          );
          if (parameter && def.defaultValue !== undefined)
            this.setParameterValue(parameter, def.defaultValue);
        }
        this.loading.set(false);
        if (this.tutorialRequested()) void this.openTutorial();
      });
  }

  private clearTutorial(): void {
    this.presentationReset.update((value) => value + 1);
    this.focusGeneration++;
    this.tutorialAnnouncement.set('');
    this.tutorialRuntime.clear();
    this.tutorialGuide.set(undefined);
    this.authoringError.set(undefined);
    this.tutorialGeneration++;
    this.tutorialSession = undefined;
    this.tutorialBoard.set(undefined);
    this.tutorialStatus.set(undefined);
    this.tutorialLoading.set(false);
    this.tutorialError.set(undefined);
  }

  private async openTutorial(): Promise<void> {
    const board = this.boardDef();
    const ref = this.projectRef();
    if (
      !this.tutorialRequested() ||
      !isShowcaseTutorialBoard(ref, board) ||
      !board ||
      !ref
    )
      return;
    const scope = projectRefToString(ref);
    if (!scope) return;
    const generation = ++this.tutorialGeneration;
    this.tutorialLoading.set(true);
    this.tutorialBoard.set(undefined);
    this.tutorialError.set(undefined);
    try {
      const session = await TutorialBoardSession.openBrowser(board, scope);
      if (
        generation !== this.tutorialGeneration ||
        !this.tutorialRequested() ||
        this.boardDef() !== board
      )
        return;
      this.tutorialSession = session;
      this.publishTutorial();
      this.focusTutorialChange(
        undefined,
        'Tutorial opened',
        'Your working copy stays in this browser session.',
        this.visibleTutorialCards().length
          ? '[data-tutorial-route-heading]'
          : '[data-tutorial-empty-focus]',
      );
    } catch (error) {
      if (generation !== this.tutorialGeneration) return;
      this.errorLogger.logError(error, 'Failed to open tutorial board');
      this.tutorialError.set(
        'This tutorial could not be opened. You can still view the completed board.',
      );
      this.focusTutorialChange(
        undefined,
        'Tutorial unavailable',
        'You can still view the completed board.',
        '[data-tutorial-route-heading]',
      );
    } finally {
      if (generation === this.tutorialGeneration)
        this.tutorialLoading.set(false);
    }
  }

  private publishTutorial(): void {
    const session = this.tutorialSession;
    if (!session) return;
    const canonicalCards = new Map(
      (session.canonical.rows ?? []).flatMap((row) =>
        (row.cards ?? []).map((card) => [card.id, card] as const),
      ),
    );
    const working = session.board;
    const previousCards = new Map(
      (this.tutorialBoard()?.rows ?? []).flatMap((row) =>
        (row.cards ?? []).map((card) => [card.id, card] as const),
      ),
    );
    // Keep existing card and widget inputs stable across action replay. The
    // session returns a fresh clone, while query results live in widget state.
    this.tutorialBoard.set({
      ...working,
      rows: working.rows?.map((row) => ({
        ...row,
        cards: row.cards?.map((card) => {
          const previous = previousCards.get(card.id);
          if (previous && JSON.stringify(previous) === JSON.stringify(card))
            return previous;
          const canonical = canonicalCards.get(card.id);
          return canonical && JSON.stringify(canonical) === JSON.stringify(card)
            ? canonical
            : card;
        }),
      })),
    });
    this.tutorialGuide.set(currentTutorialStep(session));
    const history = session.history;
    this.tutorialStatus.set({
      control: session.control,
      canNext:
        session.control === 'guided' &&
        (history.cursor < history.actions.length ||
          (session.canAppendAction && !!this.tutorialGuide()?.step.action)),
      canPrevious: session.canPrevious,
      isComplete: session.isComplete,
    });
    const ref = this.projectRef();
    if (ref)
      this.tutorialRuntime.publish(
        ref,
        session,
        (action) => this.editTutorial(action),
        session.control === 'guided'
          ? {
              next: () => this.addNextTutorialCard(),
              previous: () => this.previousTutorialStep(),
              canNext: this.tutorialStatus()?.canNext ?? false,
              canPrevious: session.canPrevious,
              cue: this.tutorialProgressCue(),
              limitation: this.tutorialGuide()?.step.limitation,
            }
          : undefined,
      );
  }

  addNextTutorialCard(): void {
    const session = this.tutorialSession;
    if (!session || session.control !== 'guided') return;
    const history = session.history;
    const step = currentTutorialStep(session).step;
    if (history.cursor < history.actions.length) {
      const action = history.actions[history.cursor];
      if (session.next()) {
        this.publishTutorial();
        this.focusTutorialChange(action.cardId, step.title, step.detail);
      }
      return;
    }
    const action = step.action;
    if (action && session.dispatch(action)) {
      this.publishTutorial();
      this.focusTutorialChange(action.cardId, step.title, step.detail);
    }
  }

  previousTutorialStep(): void {
    const session = this.tutorialSession;
    const history = session?.history;
    const action = history?.actions[(history?.cursor ?? 0) - 1];
    if (session?.previous()) {
      this.publishTutorial();
      this.focusTutorialChange(
        action?.cardId,
        'Previous step restored',
        this.tutorialGuide()?.step.detail ?? '',
      );
    }
  }

  restartTutorial(): void {
    this.presentationReset.update((value) => value + 1);
    this.tutorialSession?.restart();
    this.publishTutorial();
    this.focusTutorialChange(
      undefined,
      'Tutorial restarted',
      'Your browser-session canvas is empty again.',
    );
  }

  takeTutorialControl(): void {
    this.tutorialSession?.takeControl();
    this.publishTutorial();
    this.focusTutorialChange(
      undefined,
      'You have control',
      'Edit widgets in this browser session.',
      '[data-tutorial-authoring-focus]',
    );
  }

  resumeTutorial(): void {
    this.tutorialSession?.resume();
    this.publishTutorial();
    this.focusTutorialChange(
      undefined,
      'Guide resumed',
      this.tutorialGuide()?.step.detail ?? '',
    );
  }

  private focusTutorialChange(
    cardId: string | undefined,
    title: string,
    detail: string,
    fallback?: string,
  ): void {
    const generation = ++this.focusGeneration;
    this.tutorialRuntime.notice.set(
      cardId ? { cardId, title, detail } : undefined,
    );
    this.tutorialAnnouncement.set(
      `${title}. ${detail} ${this.tutorialProgressCue()}`,
    );
    afterNextRender(
      () => {
        if (generation !== this.focusGeneration || !this.tutorialActive())
          return;
        const root = this.element.nativeElement;
        const target = root.querySelector<HTMLElement>(
          fallback ??
            (!this.visibleTutorialCards().length
              ? '[data-tutorial-empty-focus]'
              : '[data-tutorial-guide-focus]'),
        );
        target?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
        target?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  private focusSavedBoardHeading(): void {
    const generation = ++this.focusGeneration;
    const board = this.boardDef();
    afterNextRender(
      () => {
        if (
          generation !== this.focusGeneration ||
          this.tutorialActive() ||
          this.boardDef() !== board
        )
          return;
        const heading = this.element.nativeElement.querySelector<HTMLElement>(
          '[data-board-page-heading]',
        );
        heading?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
        heading?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  editTutorial(action: BoardSessionAction): void {
    const session = this.tutorialSession;
    if (!session || !this.tutorialActive()) return;
    if (!session.dispatch(action)) {
      this.authoringError.set(
        'This change is unavailable, invalid, or already applied. Choose saved queries and supported chart settings.',
      );
      return;
    }
    session.takeControl();
    this.focusGeneration++;
    this.tutorialRuntime.notice.set(undefined);
    this.authoringError.set(undefined);
    this.publishTutorial();
    this.tutorialAnnouncement.set(this.tutorialProgressCue());
  }

  addTutorialTab(editor: TutorialEditor, title: string, queryId: string): void {
    this.editTutorial({
      type: 'add-tab',
      cardId: editor.cardId,
      widgetPath: editor.path,
      tabId: `session-${crypto.randomUUID()}`,
      title: title.trim(),
      queryId,
    });
  }

  tabAction(
    editor: TutorialEditor,
    type: 'select-tab' | 'remove-tab' | 'reorder-tab' | 'set-tab-query',
    key: string,
    value?: string | number,
  ): void {
    const common = {
      cardId: editor.cardId,
      widgetPath: editor.path,
      tabKey: key,
    };
    if (type === 'set-tab-query')
      this.editTutorial({ ...common, type, queryId: String(value) });
    else if (type === 'reorder-tab')
      this.editTutorial({ ...common, type, toIndex: Number(value) });
    else this.editTutorial({ ...common, type });
  }

  setTutorialView(editor: TutorialEditor, view: string): void {
    if (view !== 'chart' && view !== 'grid') return;
    this.editTutorial({
      type: 'set-view',
      cardId: editor.cardId,
      widgetPath: editor.path,
      view,
    });
  }

  setTutorialSeriesColumn(
    editor: TutorialEditor,
    seriesId: string,
    valueColumn: string,
  ): void {
    const chart = editor.chart?.chart;
    if (!chart?.series) return;
    this.editTutorial({
      type: 'set-chart-spec',
      cardId: editor.cardId,
      widgetPath: editor.path,
      spec: {
        ...chart,
        series: chart.series.map((item) =>
          item.id === seriesId ? { ...item, valueColumn } : item,
        ),
      },
    });
  }

  setTutorialChart(editor: TutorialEditor, field: string, value: string): void {
    if (
      !editor.chart ||
      ![
        'categoryColumn',
        'valueColumn',
        'periodColumn',
        'topN',
        'mode',
      ].includes(field)
    )
      return;
    const spec = {
      ...editor.chart.chart,
      [field]: field === 'topN' ? Number(value) : value,
    } as ChartSpec;
    this.editTutorial({
      type: 'set-chart-spec',
      cardId: editor.cardId,
      widgetPath: editor.path,
      spec,
    });
  }

  tutorialSourceQueries(editor: TutorialEditor) {
    const card = this.boardDef()?.rows?.flatMap((row) => row.cards ?? []).find((item) => item.id === editor.cardId);
    const widget = widgetAtTabPath(card?.widget, editor.path);
    const sources = widget?.name === 'chart' ? (widget.data as ChartWidgetDef).sources : [];
    return this.tutorialQueries().map((id) => ({ id, sourceId: sources.find((source) => source.queryId === id)?.id }));
  }
  editTutorialSource(editor: TutorialEditor, edit: ChartSourceEdit): void {
    this.editTutorial({ ...edit, cardId: editor.cardId, widgetPath: editor.path });
  }

  removeTutorialSource(editor: TutorialEditor, sourceId: string): void {
    this.editTutorial({
      type: 'remove-chart-source',
      cardId: editor.cardId,
      widgetPath: editor.path,
      sourceId,
    });
  }

  addTutorialCard(card: BoardCard): void {
    if (this.tutorialSession?.dispatch({ type: 'add-card', cardId: card.id }))
      this.publishTutorial();
  }

  removeTutorialCard(card: BoardCard): void {
    if (
      this.tutorialSession?.dispatch({ type: 'remove-card', cardId: card.id })
    )
      this.publishTutorial();
  }

  moveTutorialCard(card: BoardCard, rowIndex: number, index: number): void {
    if (
      this.tutorialSession?.dispatch({
        type: 'move-card',
        cardId: card.id,
        toRow: rowIndex,
        toIndex: index,
      })
    )
      this.publishTutorial();
  }

  showFullBoard(): void {
    this.presentationReset.update((value) => value + 1);
    void this.router?.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: null },
      queryParamsHandling: 'merge',
    });
  }

  buildStepByStep(): void {
    void this.router?.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: 'tutorial' },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * `Board` now carries its own `parameters`/`requiredParams` (mirroring
   * `ProjBoardBrief`, i.e. `IProjBoard`) — prefer the loaded board's own
   * definitions once available, falling back to the brief passed via router
   * state before that.
   */
  private resolveParameters(): IParamWithDefAndValue[] | undefined {
    const defs = this.boardDef()?.parameters ?? this.projBoard()?.parameters;
    return defs?.map((def) => ({ def: def as IParameterDef, val: '' }));
  }

  parameterText(parameter: IParamWithDefAndValue): string {
    return parameter.val == null ? '' : String(parameter.val);
  }

  setParameterValue(parameter: IParamWithDefAndValue, raw: unknown): void {
    if (!this.parameters()?.some((current) => current.def === parameter.def))
      return;
    let value: IParameterValueWithoutID | undefined;
    let error: string | undefined;
    try {
      value = parseBoardParameterValue(parameter.def, raw);
    } catch (reason) {
      error =
        reason instanceof Error
          ? reason.message
          : 'This parameter value is invalid.';
    }
    this.parameters.update((parameters) =>
      parameters?.map((current) =>
        current.def === parameter.def
          ? {
              ...current,
              val:
                typeof raw === 'string' ||
                typeof raw === 'number' ||
                typeof raw === 'boolean'
                  ? raw
                  : undefined,
            }
          : current,
      ),
    );
    this.parameterErrors.update((errors) => {
      const next = { ...errors };
      if (error) next[parameter.def.id] = error;
      else delete next[parameter.def.id];
      return next;
    });
    // Publish a fresh context even for a cleared/invalid value, so every card
    // cancels pending work and cannot display results from the previous input.
    this.boardContext.update((context) => {
      const parameters = { ...context.parameters };
      if (value) parameters[parameter.def.id] = value;
      else delete parameters[parameter.def.id];
      return { ...context, parameters };
    });
  }


  ngOnInit() {
    try {
      this.defaultHref = location.pathname.split('/').slice(0, -1).join('/');
    } catch (e) {
      this.errorLogger.logError(e, 'Failed in BoardPage.ngOnInit()');
    }
  }

  /** A hand edit replaces the "from lookup" label. */
  onParameterInput(parameter: IParamWithDefAndValue, raw: unknown): void {
    this.forgetLookupOrigin(parameter.def.id);
    this.setParameterValue(parameter, raw);
  }

  onLookupPicked(parameter: IParamWithDefAndValue, pick: ParameterLookupPick): void {
    // setParameterValue ignores a parameter of a board that is no longer shown.
    this.setParameterValue(parameter, pick.value);
    if (!this.parameterErrors()[parameter.def.id])
      this.lookupOrigins.update((origins) => ({ ...origins, [parameter.def.id]: true }));
  }

  private forgetLookupOrigin(id: string): void {
    if (!this.lookupOrigins()[id]) return;
    this.lookupOrigins.update((origins) => {
      const next = { ...origins };
      delete next[id];
      return next;
    });
  }

  ngOnDestroy(): void {
    try {
      if (this.destroyed$) {
        this.destroyed$.next();
        this.destroyed$.complete();
      }
    } catch (err) {
      this.errorLogger.logError(err, 'Failed to destroy BoarPageComponent');
    }
  }
}
