import { TitleCasePipe } from '@angular/common';
import {
  Component,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonBadge,
  IonCard,
  IonCardContent,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonText,
} from '@ionic/angular';
import { SneatCardListComponent } from '@sneat/components';
import { Observable, Subject, throwError } from 'rxjs';
import { IProjectRef } from '../../core/project-context';
import { takeUntil, tap } from 'rxjs/operators';
import { folderItemsAsList, IFolder } from '../../models/definition/folder';
import { IOptionallyTitled } from '../../models/core';
import {
  IProjItemBrief,
  ProjectItem,
  ProjectItemType,
} from '../../models/definition/project';
import { CreateNamedRequest } from '../../dto/requests';
import { IRecord } from '@sneat/data';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { EntityService } from '../../services/unsorted/entity.service';
import { EnvironmentService } from '../../services/unsorted/environment.service';
import { SchemaService } from '../../services/unsorted/schema.service';
import { DatatugFoldersService } from '../core/datatug-folders.service';
import { DatatugBoardService } from '../../board/core/datatug-board.service';

@Component({
  selector: 'sneat-datatug-folder',
  templateUrl: 'datatug-folder.component.html',
  imports: [
    TitleCasePipe,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonBadge,
    IonText,
    IonCard,
    IonCardContent,
    SneatCardListComponent,
    FormsModule,
  ],
})
export class DatatugFolderComponent implements OnChanges, OnDestroy {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly foldersService = inject(DatatugFoldersService);
  private readonly datatugNavService = inject(DatatugNavService);
  private readonly schemaService = inject(SchemaService);
  private readonly environmentService = inject(EnvironmentService);
  private readonly boardService = inject(DatatugBoardService);
  private readonly entityService = inject(EntityService);

  readonly Environment: ProjectItemType = ProjectItem.environment as const;

  readonly Board: ProjectItemType = ProjectItem.Board;
  readonly Query: ProjectItemType = ProjectItem.query;

  tabs = ['boards', 'queries', 'environments', 'entities'];

  private destroyed = new Subject<void>();

  // Signals, not plain fields: this app is zoneless
  // (provideZonelessChangeDetection(), main.ts) — both are written from
  // inside the `.subscribe()` callback in subscribeForFolder() below, which
  // never triggers change detection on its own for a plain field. See
  // AGENTS.md's "Change detection & state" section and
  // pages/signed-in/project/project-page.component.ts (PR #95) for the
  // established pattern.
  readonly boards = signal<IProjItemBrief[] | undefined>(undefined);
  queries?: IProjItemBrief[];

  readonly path = input('~');
  readonly projectRef = input<IProjectRef>();

  tab: 'boards' | 'queries' | 'environments' | 'entities' = 'boards';

  public readonly folder = signal<IFolder | undefined | null>(undefined);

  public numberOf(tab: string): number {
    return this.folder()?.numberOf?.[tab] ?? 0;
  }

  public getItemLink = (path: string) => (item: IProjItemBrief) =>
    `${path}/${item.id}`;

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['projectRef']) {
      if (this.projectRef()) {
        this.subscribeForFolder();
      }
    }
  }

  public createFolderItem: (
    name: string,
  ) => Observable<IRecord<IOptionallyTitled>> = (title: string) =>
    this.createProjItem(
      ProjectItem.Board,
      title,
      this.boardService.createNewBoard,
    );

  public createQuery = (title: string) =>
    alert(`Not implemented yet. ${title}`);

  public createEnvironment = (title: string) =>
    this.createProjItem(
      ProjectItem.environment,
      title,
      this.environmentService.createEnvironment,
    );

  public createSchema = (title: string) =>
    this.createProjItem(
      ProjectItem.dbModel,
      title,
      this.schemaService.createSchema,
    );

  private createProjItem<T extends IOptionallyTitled>(
    projItemType: ProjectItem,
    name: string,
    create: (request: CreateNamedRequest) => Observable<IRecord<T>>,
  ): Observable<IRecord<T>> {
    // console.log('createProjItem()', projItemType, name);
    const projectRef = this.projectRef();
    if (!projectRef) {
      return throwError(() => 'projectRef is not set');
    }
    return create({ projectRef: projectRef, name: name.trim() }).pipe(
      tap(() => {
        // console.log('project item created:', value);
        try {
          // if (!this.project.summary.environments) {
          // 	this.project = {
          // 		...this.project,
          // 		summary: {...this.project.summary, environments: []},
          // 	}
          // }
          // const projItemBrief = { id: value.id, title: value.dbo?.title };
          // this.project.environments.push(projItemBrief)
          this.goProjItemPage(projItemType);
        } catch (err) {
          this.errorLogger.logError(err, 'Failed to process API response');
        }
      }),
      // catchError(err => {
      // 	this.errorLogger.logError(err, 'Failed to create ' + projItemType);
      // 	return throwError(err);
      // }),
    );
  }

  private goProjItemPage(page: ProjectItemType): void {
    // console.log('goProjItemPage()', page, projItem, this.projectRef);
    const projectRef = this.projectRef();
    if (!projectRef) {
      throw new Error('projectRef is not set');
    }
    switch (page) {
      case ProjectItem.environment:
        page = 'env' as ProjectItemType;
        break;
    }
    this.datatugNavService.goProjPage(
      page,
      { ref: projectRef },
      {
        projectContext: { ref: projectRef },
      },
    );
  }

  private subscribeForFolder(): void {
    const projectRef = this.projectRef();
    if (projectRef) {
      this.foldersService
        .watchFolder({ ...projectRef, id: this.path() })
        .pipe(takeUntil(this.destroyed))
        .subscribe({
          next: (folder) => {
            this.folder.set(folder);
            this.boards.set(
              folder?.boards
                ? folderItemsAsList(folder.boards).map((v) => ({
                    id: v.id,
                    title: v.name,
                  }))
                : [],
            );
            // console.log('DatatugFolderComponent => folder:', folder);
          },
          // Log, never rethrow: a folder that cannot be watched (e.g. the
          // GitHub store's "not implemented", an unknown store) must not
          // become an unhandled error that takes the project page down.
          error: (err) =>
            this.errorLogger.logError(
              err,
              `Failed to watch folder "${this.path()}" of project ${projectRef.projectId} at store ${projectRef.storeId}`,
            ),
        });
    }
  }
}
