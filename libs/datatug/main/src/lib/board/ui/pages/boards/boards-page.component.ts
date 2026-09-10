import {
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonLabel,
  IonMenuButton,
  IonTitle,
  IonToolbar,
  AlertController,
} from '@ionic/angular';
import { SneatCardListComponent } from '@sneat/components';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { DatatugCoreModule } from '../../../../core/datatug-core.module';
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
import { DatatugBoardService } from '../../../core/datatug-board.service';

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
    IonHeader,
    IonButtons,
    IonBackButton,
    IonMenuButton,
    IonTitle,
    IonToolbar,
    IonButton,
    IonIcon,
    IonLabel,
    IonContent,
  ],
})
export class BoardsPageComponent implements OnInit, OnDestroy {
  private readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly datatugNavService = inject(DatatugNavService);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly boardService = inject(DatatugBoardService);
  private readonly alertCtrl = inject(AlertController);
  private readonly foldersService = inject(DatatugFoldersService);

  tab = 'shared';
  noItemsText?: string;

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
  defaultHref?: string;
  readonly project = signal<IProjectContext | undefined>(undefined);

  folderPath = '~';

  private readonly destroyed = new Subject<void>();

  constructor() {
    this.tabChanged(this.tab);
    this.datatugNavContextService.currentProject
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (currentProject) => {
          try {
            this.setProject(currentProject);
            // this.project = currentProject;
            // this.boards = currentProject?.summary?.boards || [];
          } catch (e) {
            this.errorLogger.logError(
              e,
              'Failed to process current project in Boards page',
            );
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
  }

  private setProject(project?: IProjectContext): void {
    const path = this.folderPath;
    if (
      project?.ref?.projectId &&
      project.ref.projectId !== this.project()?.ref?.projectId
    ) {
      this.foldersService
        .watchFolder({ ...project.ref, id: path })
        .pipe(takeUntil(this.destroyed))
        .subscribe((folder) => this.onFolderReceived(path, folder));
    }
    this.project.set(project);
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
    // `board1` — title "1st board" per its own `board.json`/the parent
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

  async newBoard(): Promise<void> {
    const modal = await this.alertCtrl.create({
      message: 'New board',
      inputs: [
        {
          name: 'title',
          type: 'text',
          // handler: v => {
          // 	console.log('input handler:', v);
          // },
          placeholder: 'Name, should be unique',
        },
      ],
      buttons: [
        {
          role: 'cancel',
          text: 'Cancel',
          cssClass: 'ion-color-medium',
        },
        {
          text: 'Create',
          handler: (value) => {
            // const store: IProjStoreRef = {
            // 	type: 'firestore',
            // };
            const project = this.project();
            if (!project) {
              return;
            }
            this.boardService
              .createNewBoard({
                projectRef: project.ref,
                name: value.title as string,
              })
              .subscribe({
                next: (board) => {
                  // Matches the pre-signal behaviour: if the list hasn't
                  // loaded yet, this silently no-ops (same as the old
                  // `this.boards?.push()`).
                  const boards = this.boards();
                  if (boards) {
                    this.boards.set([...boards, board]);
                  }
                },
                error: this.logError(
                  () =>
                    `Failed to create a new board with title [${value.title}]`,
                ),
              });
          },
        },
      ],
    });
    await modal.present();
  }

  public tabChanged(tab: string): void {
    this.tab = tab;
    switch (tab) {
      case 'favorite':
        this.noItemsText = 'No favorite boards';
        break;
      case 'personal':
        this.noItemsText = 'No personal boards';
        break;
      case 'shared':
        this.noItemsText = 'No shared boards';
        break;
      default:
        this.noItemsText = 'No boards';
    }
  }

  private logError = (message: () => string) => (err: unknown) =>
    this.errorLogger.logError(err, message());
}
