import {
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
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
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { distinctUntilChanged, filter, map, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { Board } from '@datatug/board-models';
import { ParameterLookupService } from '../../../../components/parameters/parameter-lookup.service';
import { routingParamBoard } from '../../../../core/datatug-routing-params';
import { projectRefToString } from '../../../../core/project-context';
import { QueryParamsService } from '../../../../core/services/QueryParamsService';
import { IBoardContext } from '../../../../models/definition/board/board';
import {
  IParameterDef,
  IParamWithDefAndValue,
} from '../../../../models/definition/parameter';
import { IProjBoard } from '../../../../models/definition/project';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';
import { DatatugBoardService } from '../../../core/datatug-board.service';
import { BoardComponent } from '../../components/board/board.component';
import { EnvSelectorComponent } from '../../components/env-selector/env-selector.component';

@Component({
  selector: 'sneat-datatug-board-page',
  templateUrl: './board-page.component.html',
  imports: [
    FormsModule,
    // BoardServiceModule,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonMenuButton,
    IonTitle,
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
    EnvSelectorComponent,
    BoardComponent,
  ],
  providers: [QueryParamsService],
})
export class BoardPageComponent implements OnInit, OnDestroy {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly boardService = inject(DatatugBoardService);
  private readonly route = inject(ActivatedRoute);
  private readonly lookupService = inject(ParameterLookupService);
  private readonly dataTugNavContext = inject(DatatugNavContextService);
  private readonly queryParamsService = inject(QueryParamsService);

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

  readonly parameters = signal<IParamWithDefAndValue[] | undefined>(
    undefined,
  );

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
    const dataTugNavContext = this.dataTugNavContext;
    this.projBoard.set(history.state?.projBoard);
    this.parameters.set(this.resolveParameters());
    try {
      this.route.queryParamMap.subscribe({
        next: (queryParamMap) => {
          const envId = queryParamMap.get('env');
          this.envId.set(envId);
          if (envId) {
            this.dataTugNavContext.setCurrentEnvironment(envId);
          }
        },
        error: (err) =>
          this.errorLogger.logError(err, 'Failed to get query parameters'),
      });
      dataTugNavContext.currentEnv
        .pipe(takeUntil(this.destroyed$.asObservable()))
        .subscribe({
          next: (env) => {
            this.envId.set(env?.id);
            if (env?.id) {
              this.queryParamsService.setQueryParameter('env', env.id);
            }
          },
          error: (e) =>
            this.errorLogger.logError(
              e,
              'Failed on getting current environment',
            ),
        });
      dataTugNavContext.currentProject
        .pipe(
          filter((p) => !!p?.ref),
          map((p) => p?.ref),
          distinctUntilChanged(
            (a, b) => projectRefToString(a) === projectRefToString(b),
          ),
          filter((ref) => !!ref),
        )
        .subscribe((ref) => {
          const { storeId, projectId } = ref;
          this.storeId.set(storeId);
          this.projectId.set(projectId);
          this.route.paramMap.subscribe((params) => {
            const boardId = params.get(routingParamBoard);
            this.boardId.set(boardId);
            try {
              if (!projectId) {
                throw new Error('projectId is ' + projectId);
              }
              if (!boardId) {
                throw new Error('boardId is ' + boardId);
              }
              this.boardService
                .getBoard('http://localhost:8989', projectId, boardId)
                .subscribe({
                  next: (board) => {
                    try {
                      // `Board.parameters` (from `@datatug/board-models`, a
                      // field-for-field mirror of boards.go) types `type` as
                      // plain `string`, matching Go's `ParameterDef.Type`;
                      // `IProjBoard.parameters` (this app's own model) narrows
                      // it to `DataType`. Both describe the same JSON shape,
                      // so the cast is type-only, not a behaviour change.
                      this.projBoard.set(board as IProjBoard);
                      this.boardDef.set(board);
                      this.parameters.set(this.resolveParameters());
                    } catch (e) {
                      this.errorLogger.logError(
                        e,
                        'Failed to process board response',
                      );
                    }
                  },
                  error: (err) =>
                    this.errorLogger.logError(err, 'Failed to get board'),
                });
            } catch (e) {
              this.errorLogger.logError(
                e,
                'Failed to request board definition',
              );
            }
          });
        });
      dataTugNavContext.currentEnv.subscribe({
        next: (env) => {
          this.envId.set(env?.id);
        },
        error: (err) =>
          this.errorLogger.logError(err, 'Failed process current environment'),
      });
    } catch (e) {
      this.errorLogger.logError(e, 'Failed in BoardPage.constructor()');
    }
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

  public startEditing(): void {
    this.boardContext.update((boardContext) => ({
      ...boardContext,
      mode: 'edit',
    }));
  }

  public saveChanges(): void {
    this.boardContext.update((boardContext) => ({
      ...boardContext,
      mode: 'view',
    }));
  }

  ngOnInit() {
    try {
      this.defaultHref = location.pathname.split('/').slice(0, -1).join('/');
    } catch (e) {
      this.errorLogger.logError(e, 'Failed in BoardPage.ngOnInit()');
    }
  }

  lookup(p: IParamWithDefAndValue): void {
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
