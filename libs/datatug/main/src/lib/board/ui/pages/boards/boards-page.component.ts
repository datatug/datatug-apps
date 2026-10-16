import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
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
import { BehaviorSubject, combineLatest, EMPTY, of, Subject } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs/operators';
import { DatatugCoreModule } from '../../../../core/datatug-core.module';
import { equalProjectRef } from '../../../../core/project-context';
import { DatatugFoldersService } from '../../../../folders/core/datatug-folders.service';
import {
  folderItemsAsList,
  IFolder,
} from '../../../../models/definition/folder';
import {
  IProjBoard,
  IProjItemBrief,
} from '../../../../models/definition/project';
import { IProjectContext } from '../../../../nav/nav-models';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../../services/nav/datatug-nav.service';
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
  private readonly foldersService = inject(DatatugFoldersService);
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
  defaultHref?: string;
  readonly project = signal<IProjectContext | undefined>(undefined);
  readonly unsupportedProject = computed(() => {
    const ref = this.project()?.ref;
    return !!(ref?.projectApi || ref?.branch);
  });

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
          // The folder store drops projectApi and branch. Reading here would
          // silently show an unqualified project's boards under another ref.
          if (ref?.projectApi || ref?.branch) return EMPTY;
          return ref
            ? this.foldersService
                .watchFolder({ ...ref, id: this.folderPath })
                .pipe(
                  map((folder) => ({ status: 'success' as const, folder })),
                  catchError((err: unknown) => {
                    this.errorLogger.logError(err, 'Failed to load boards');
                    return of({ status: 'error' as const });
                  }),
                )
            : of({ status: 'success' as const, folder: null });
        }),
        takeUntil(this.destroyed),
      )
      .subscribe({
        next: (result) => {
          if (result.status === 'error') {
            this.boards.set(undefined);
            this.loadError.set('Boards could not be loaded. Please try again.');
          } else {
            this.onFolderReceived(this.folderPath, result.folder);
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

  private onFolderReceived = (path: string, folder?: IFolder | null): void => {
    if (this.folderPath !== path) {
      return;
    }
    // `folderItemsAsList()` returns `IFolderItemWithId[]` (`{id, name}`) —
    // `this.boards` is typed `Signal<IProjBoard[] | undefined>`, and
    // `IProjBoard` is `{id, title?}` (`title` optional), so TS accepts this
    // structurally, but `sneat-card-list` (the external `@sneat/components`
    // list this page's own template feeds `[items]="boards()"` into) reads
    // `.title`, not `.name`, and silently falls back to showing the board's
    // own `.id` when `.title` is `undefined` (confirmed live, S136: GitHub's
    // `board1` — title "Chinook customer insights" in the demo project
    // `datatug-project.json` summary — rendered as the id "board1" in the
    // list). Pre-existing and not GitHub-specific: any store's board list
    // goes through this same `IFolder`/`folderItemsAsList()` path
    // (`DatatugFoldersService.watchFolder()`, used for every store type).
    // Remapping `name` -> `title` here is the minimal fix.
    this.boards.set(
      folder?.boards
        ? folderItemsAsList(folder.boards).map(({ id, name }) => ({
            id,
            title: name,
          }))
        : [],
    );
  };

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
