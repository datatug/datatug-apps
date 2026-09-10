import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
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
import { DatatugCoreModule } from '../../../../core/datatug-core.module';
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
import { DatatugServicesNavModule } from '../../../../services/nav/datatug-services-nav.module';
import { DatatugServicesStoreModule } from '../../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../../services/unsorted/datatug-services-unsorted.module';
import { DatatugBoardService } from '../../../core/datatug-board.service';
import { BoardComponent } from '../../components/board/board.component';
import { EnvSelectorComponent } from '../../components/env-selector/env-selector.component';

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
  providers: [QueryParamsService, ParameterLookupService],
})
export class BoardPageComponent implements OnInit, OnDestroy {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly boardService = inject(DatatugBoardService);
  private readonly route = inject(ActivatedRoute);
  private readonly lookupService = inject(ParameterLookupService);
  private readonly dataTugNavContext = inject(DatatugNavContextService);
  // Zoneless (AGENTS.md; see `entities-page.component.ts`'s own identical
  // doc comment, this task's sibling fix): `projBoard`/`boardDef`/
  // `parameters` below are plain fields, mutated from RxJS `.subscribe()`
  // callbacks.
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly queryParamsService = inject(QueryParamsService);

  boardId?: string | null;

  projBoard?: IProjBoard;

  boardDef?: Board;

  parameters?: IParamWithDefAndValue[];

  defaultHref?: string;
  envId?: string | null = 'LOCAL';
  projectId?: string;
  storeId?: string;

  boardContext: IBoardContext = { parameters: {}, mode: 'view' };
  private readonly destroyed$ = new Subject<void>();

  constructor() {
    const dataTugNavContext = this.dataTugNavContext;
    this.projBoard = history.state?.projBoard;
    this.parameters = this.resolveParameters();
    try {
      this.route.queryParamMap.subscribe({
        next: (queryParamMap) => {
          this.envId = queryParamMap.get('env');
          if (this.envId) {
            this.dataTugNavContext.setCurrentEnvironment(this.envId);
          }
        },
        error: (err) =>
          this.errorLogger.logError(err, 'Failed to get query parameters'),
      });
      dataTugNavContext.currentEnv
        .pipe(takeUntil(this.destroyed$.asObservable()))
        .subscribe({
          next: (env) => {
            this.envId = env?.id;
            if (this.envId) {
              this.queryParamsService.setQueryParameter('env', this.envId);
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
          map((p) => projectRefToString(p?.ref)),
          distinctUntilChanged(),
          filter((p) => !!p),
        )
        .subscribe((p) => {
          if (p) {
            [this.storeId, this.projectId] = p.split('/');
          }
          console.log(
            'this.store, this.projectId',
            p,
            this.storeId,
            this.projectId,
          );
          this.route.paramMap.subscribe((params) => {
            this.boardId = params.get(routingParamBoard);
            try {
              if (!this.projectId) {
                throw new Error('projectId is ' + this.projectId);
              }
              if (!this.boardId) {
                throw new Error('boardId is ' + this.boardId);
              }
              if (!this.storeId) {
                throw new Error('storeId is ' + this.storeId);
              }
              // Was hard-coded to 'http://localhost:8989' regardless of the
              // project's actual store — every board (agent or GitHub) 404'd
              // /threw against the wrong host unless a local agent happened
              // to be listening there. `this.storeId` is already tracked
              // (above, from `dataTugNavContext.currentProject`) — use it.
              this.boardService
                .getBoard(this.storeId, this.projectId, this.boardId)
                .subscribe({
                  next: (board) => {
                    try {
                      // `Board.parameters` (from `@datatug/board-models`, a
                      // field-for-field mirror of boards.go) types `type` as
                      // plain `string`, matching Go's `ParameterDef.Type`;
                      // `IProjBoard.parameters` (this app's own model) narrows
                      // it to `DataType`. Both describe the same JSON shape,
                      // so the cast is type-only, not a behaviour change.
                      this.projBoard = board as IProjBoard;
                      this.boardDef = board;
                      this.parameters = this.resolveParameters();
                      this.changeDetectorRef.markForCheck();
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
          this.envId = env?.id;
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
    const defs = this.boardDef?.parameters ?? this.projBoard?.parameters;
    return defs?.map((def) => ({ def: def as IParameterDef, val: '' }));
  }

  public startEditing(): void {
    this.boardContext = { ...this.boardContext, mode: 'edit' };
  }

  public saveChanges(): void {
    this.boardContext = { ...this.boardContext, mode: 'view' };
  }

  ngOnInit() {
    try {
      this.defaultHref = location.pathname.split('/').slice(0, -1).join('/');
    } catch (e) {
      this.errorLogger.logError(e, 'Failed in BoardPage.ngOnInit()');
    }
  }

  lookup(p: IParamWithDefAndValue): void {
    if (!this.storeId) {
      return;
    }
    if (!this.projectId) {
      return;
    }
    if (!this.envId) {
      return;
    }
    this.lookupService
      .lookupParameterValue(p.def, this.storeId, this.projectId, this.envId)
      .subscribe({
        next: (v) => {
          p.val = v.value;
          this.boardContext = {
            ...this.boardContext,
            parameters: { ...this.boardContext.parameters, [p.def.id]: v },
          };
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
