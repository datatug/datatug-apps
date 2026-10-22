import { ErrorStateComponent } from '../../../../components/error-state/error-state.component';
import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonMenuButton,
  IonToolbar,
} from '@ionic/angular';
import { SneatCardListComponent } from '@sneat/components';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { BehaviorSubject, combineLatest, of, Subject } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs/operators';
import { DatatugCoreModule } from '../../../../core/datatug-core.module';
import { HostedBoardListComponent } from './hosted-board-list.component';
import { isSharedProjectRef } from '../../../../core/project-context';
import { equalProjectRef } from '../../../../core/project-context';
import {
  IProjBoard,
  IProjItemBrief,
} from '../../../../models/definition/project';
import { IProjectContext } from '../../../../nav/nav-models';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../../services/nav/datatug-nav.service';
import { ProjectAssetsReadService } from '../../../../services/project/project-assets-read.service';
import { qualifiedLocalReadVersionGuidance } from '../../../../services/project/project-query-api.service';
import { DatatugServicesNavModule } from '../../../../services/nav/datatug-services-nav.module';
import { DatatugServicesProjectModule } from '../../../../services/project/datatug-services-project.module';
import { DatatugServicesStoreModule } from '../../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../../services/unsorted/datatug-services-unsorted.module';
import { SneatDatatugPageTitleComponent } from '../../../../components/page-title/sneat-datatug-page-title.component';
import { BoardChoicesService } from '../../../core/board-choices.service';
import { projectPageHref } from '../../../../nav/project-page-href';

@Component({
  selector: 'sneat-datatug-boards',
  templateUrl: './boards-page.component.html',
  imports: [
    ErrorStateComponent,
    // `DatatugNavContextService` (injected below) was a plain `@Injectable()`
    // provided by `DatatugServicesNavModule` (it and its whole dependency
    // chain are `providedIn: 'root'` since nav-context-root-singletons),
    // whose own constructor needed
    // `AppContextService` (`DatatugCoreModule`), `ProjectContextService`/
    // `ProjectService` (`DatatugServicesProjectModule`) and
    // `EnvironmentService` (`DatatugServicesUnsortedModule`, itself needing
    // `StoreApiService` from `DatatugServicesStoreModule`) — none of which
    // this page declared, so navigating here from the project side menu's
    // "Boards" item threw `NG0201: No provider found for
    // DatatugNavContextService` (confirmed live, S135, 2026-09-10). Same
    // fix, same cause, as `EnvironmentsPageComponent`/`QueriesPageComponent`
    // (S120 PR #89, S121 Task 17 item B.1) — mirrors the exact module set
    // those pages already declare for the identical transitive chain.
    HostedBoardListComponent,
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesProjectModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    SneatCardListComponent,
    SneatDatatugPageTitleComponent,
    IonHeader,
    IonButtons,
    IonBackButton,
    IonButton,
    IonMenuButton,
    IonToolbar,
    IonContent,
    RouterLink,
  ],
})
export class BoardsPageComponent implements OnInit, OnDestroy {
  private readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly datatugNavService = inject(DatatugNavService);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly choices = inject(BoardChoicesService);
  private readonly router = inject(Router);
  readonly favoriteBoards = computed(() => {
    const ref = this.project()?.ref;
    return ref
      ? (this.boards() || []).filter(
          (board) => this.choices.read(ref, board.id).favorite,
        )
      : [];
  });
  boardLink(id: string) {
    const ref = this.project()?.ref;
    return ref
      ? this.router.parseUrl(projectPageHref(ref, ['board', id]))
      : undefined;
  }
  private readonly assets = inject(ProjectAssetsReadService);

  // Signals, not plain fields: this app is zoneless
  // (provideZonelessChangeDetection(), main.ts). Both are written from
  // setProject()/onFolderReceived() below, which are themselves called from
  // inside `.subscribe()` callbacks — a plain field written by a method
  // *called from* an async callback is exactly as zoneless-unsafe as one
  // written directly inside it; neither triggers change detection on its
  // own. See AGENTS.md's "Change detection & state" section and
  // pages/signed-in/project/project-page.component.ts (PR #95) for the
  // established pattern.
  readonly boards = signal<IProjBoard[] | undefined>(undefined);
  readonly loadError = signal<string | undefined>(undefined);
  /** The failure behind `loadError`, worded by the error state (a rate limit, an outage, a missing project). */
  readonly loadFailure = signal<unknown>(undefined);
  /** Specific guidance for a failure we can explain better than the generic words (a local read version mismatch). */
  readonly loadGuidance = signal<string | undefined>(undefined);
  defaultHref?: string;
  readonly project = signal<IProjectContext | undefined>(undefined);
  readonly hostedProject = computed(() => {
    const ref = this.project()?.ref;
    return !!ref && isSharedProjectRef(ref);
  });
  readonly unsupportedProject = computed(() => {
    const ref = this.project()?.ref;
    return !!ref?.spaceID;
  });

  private readonly hostedList = viewChild(HostedBoardListComponent);
  ionViewWillEnter(): void {
    // Ionic retains routed pages. Re-entry must read the current authorized catalog.
    this.hostedList()?.reload();
  }

  folderPath = '~';

  private readonly destroyed = new Subject<void>();
  private readonly refresh = new BehaviorSubject(0);

  constructor() {
    combineLatest([this.datatugNavContextService.currentProject, this.refresh])
      .pipe(
        tap(([currentProject]) => {
          if (!equalProjectRef(currentProject?.ref, this.project()?.ref)) {
            this.boards.set(undefined);
            this.loadError.set(undefined);
          }
          this.project.set(currentProject);
        }),
        map(([currentProject, refresh]) => ({
          ref: currentProject?.ref,
          refresh,
        })),
        distinctUntilChanged(
          (a, b) => a.refresh === b.refresh && equalProjectRef(a.ref, b.ref),
        ),
        switchMap(({ ref }) => {
          this.boards.set(undefined);
          this.loadError.set(undefined);
          this.loadFailure.set(undefined);
          this.loadGuidance.set(undefined);
          return ref && !isSharedProjectRef(ref)
            ? this.assets.boards(ref).pipe(
                map((boards) => ({ status: 'success' as const, boards })),
                catchError((err: unknown) => {
                  this.errorLogger.logError(err, 'Failed to load boards', {
                    show: false,
                  });
                  return of({
                    status: 'error' as const,
                    failure: err,
                    message: qualifiedLocalReadVersionGuidance(err),
                  });
                }),
              )
            : of({ status: 'success' as const, boards: [] as IProjBoard[] });
        }),
        takeUntil(this.destroyed),
      )
      .subscribe({
        next: (result) => {
          if (result.status === 'error') {
            this.boards.set(undefined);
            this.loadFailure.set(result.failure);
            this.loadGuidance.set(result.message ?? undefined);
            this.loadError.set(
              result.message ?? 'Boards could not be loaded. Please try again.',
            );
          } else {
            this.boards.set(result.boards);
          }
        },
        error: (err) =>
          this.errorLogger.logError(
            err,
            'Failed to get current project at Boards page',
          ),
      });
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
    this.refresh.complete();
  }

  retryLoad(): void {
    if (this.project()?.ref && !this.unsupportedProject())
      this.refresh.next(this.refresh.value + 1);
  }

  protected getLinkToBoard = (item: unknown) => {
    const projItemBrief = item as IProjItemBrief;
    const project = this.project();
    return (
      (project &&
        this.datatugNavService.projectPageUrl(
          project.ref,
          'board',
          projItemBrief.id,
        )) ||
      ''
    );
  };

  ngOnInit() {
    this.defaultHref =
      location.pathname.split('/').slice(0, -1).join('/') + 's';
  }

  public goBoard(item: unknown): void {
    const project = this.project();
    if (project) {
      this.datatugNavService.goBoard(project, <IProjItemBrief>item);
    }
  }
}
