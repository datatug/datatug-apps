import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCol,
  IonContent,
  IonGrid,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
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
import { EMPTY, Subject, combineLatest } from 'rxjs';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { Board } from '@datatug/board-models';
import { ParameterLookupService } from '../../../../components/parameters/parameter-lookup.service';
import { DatatugCoreModule } from '../../../../core/datatug-core.module';
import { routingParamBoard } from '../../../../core/datatug-routing-params';
import { IProjectRef, equalProjectRef } from '../../../../core/project-context';
import { QueryParamsService } from '../../../../core/services/QueryParamsService';
import { IBoardContext } from '../../../../models/definition/board/board';
import { AgentContextService } from '@sneat/datatug-semantic';
import { agentBaseUrl } from '../../../../services/repo/agent-url';
import {
  IParameterDef,
  IParamWithDefAndValue,
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

@Component({
  selector: 'sneat-datatug-board-page',
  templateUrl: './board-page.component.html',
  imports: [
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
    FormsModule,
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
    IonLabel,
    IonCard,
    IonItem,
    IonInput,
    BoardComponent,
  ],
  providers: [QueryParamsService, ParameterLookupService],
})
export class BoardPageComponent implements OnInit, OnDestroy {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly choices = inject(BoardChoicesService);
  private readonly assets = inject(ProjectAssetsReadService);
  private readonly route = inject(ActivatedRoute);
  private readonly lookupService = inject(ParameterLookupService);
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
  readonly boardId = signal<string | null | undefined>(undefined);

  readonly projBoard = signal<IProjBoard | undefined>(undefined);

  readonly boardDef = signal<Board | undefined>(undefined);
  readonly favoriteError = signal<string | undefined>(undefined);
  readonly canSaveFavorite = computed(() =>
    this.choices.canPersist(this.projectRef()),
  );
  readonly choicesForBoard = computed(() =>
    this.choices.read(this.projectRef(), this.boardId() || undefined),
  );
  readonly readBoardForRun: BoardReadForRun = (ref, id) =>
    this.assets.board(ref, id);

  toggleFavorite(): void {
    const ref = this.projectRef();
    const id = this.boardId();
    if (ref && id && this.boardDef() && this.canSaveFavorite()) {
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
  readonly loading = signal(true);
  readonly loadError = signal<string | undefined>(undefined);

  readonly parameters = signal<IParamWithDefAndValue[] | undefined>(undefined);

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
      const local = ref?.projectApi === 'local' && !['github', 'github.com', 'firestore'].includes(ref.storeId);
      const hosted = ref?.storeId === 'firestore' && !!ref.spaceID;
      const securityContextId = local ? this.agentContext.contextFor(agentBaseUrl(ref.storeId)).securityContextId() : undefined;
      untracked(() => this.boardContext.update((context) => ({
        ...context,
        securityContextId,
        executionTarget: local ? { kind: 'local-agent', agentStoreId: ref.storeId } : hosted ? { kind: 'hosted-cloud' } : undefined,
      })));
    });
    this.route.queryParamMap.pipe(takeUntil(this.destroyed$)).subscribe({
      next: (queryParamMap) => {
        const envId = queryParamMap.get('env');
        if (envId) this.dataTugNavContext.setCurrentEnvironment(envId);
      },
      error: (err) =>
        this.errorLogger.logError(err, 'Failed to get query parameters'),
    });
    this.dataTugNavContext.currentEnv
      .pipe(takeUntil(this.destroyed$))
      .subscribe({
        next: (env) => {
          this.envId.set(env?.id);
          this.boardContext.update((context) => ({ ...context, environment: env?.id ?? undefined }));
          if (env?.id) this.queryParamsService.setQueryParameter('env', env.id);
        },
        error: (err) =>
          this.errorLogger.logError(err, 'Failed to get current environment'),
      });
    combineLatest([this.dataTugNavContext.currentProject, this.route.paramMap])
      .pipe(
        map(([project, params]) => ({
          ref: project?.ref,
          id: params.get(routingParamBoard),
        })),
        distinctUntilChanged(
          (a, b) => a.id === b.id && equalProjectRef(a.ref, b.ref),
        ),
        switchMap(({ ref, id }) => {
          this.projectRef.set(ref);
          this.storeId.set(ref?.storeId);
          this.projectId.set(ref?.projectId);
          this.boardId.set(id);
          this.boardDef.set(undefined);
          this.projBoard.set(undefined);
          this.parameters.set(undefined);
          this.loadError.set(undefined);
          this.favoriteError.set(undefined);
          this.loading.set(true);
          if (!ref) return EMPTY;
          if (!id) {
            this.loading.set(false);
            this.loadError.set('Board ID is missing.');
            return EMPTY;
          }
          return this.assets.board(ref, id).pipe(
            catchError((err: unknown) => {
              this.errorLogger.logError(err, 'Failed to get board');
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
        this.loading.set(false);
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

  ngOnInit() {
    try {
      this.defaultHref = location.pathname.split('/').slice(0, -1).join('/');
    } catch (e) {
      this.errorLogger.logError(e, 'Failed in BoardPage.ngOnInit()');
    }
  }

  lookup(p: IParamWithDefAndValue): void {
    if (this.projectRef()?.projectApi || this.projectRef()?.branch) return;
    const storeId = this.storeId();
    const projectId = this.projectId();
    const envId = this.envId();
    if (!storeId) {
      return;
    }
    if (!projectId) {
      return;
    }
    if (!envId) {
      return;
    }
    this.lookupService
      .lookupParameterValue(p.def, storeId, projectId, envId)
      .subscribe({
        next: (v) => {
          p.val = v.value;
          this.boardContext.update((boardContext) => ({
            ...boardContext,
            parameters: { ...boardContext.parameters, [p.def.id]: v },
          }));
        },
        error: (err) =>
          this.errorLogger.logError(err, 'Failed to lookup parameter value'),
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
