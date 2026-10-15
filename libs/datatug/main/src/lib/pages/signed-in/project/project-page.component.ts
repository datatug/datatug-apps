import {
  Component,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { race, Subject, of } from 'rxjs';
import { catchError, map, skip, takeUntil } from 'rxjs/operators';
import {
  ErrorLogger,
  IErrorLogger,
  STORE_ID_GITHUB_COM,
  STORE_TYPE_GITHUB,
} from '@sneat/core';
import { IRecord } from '@sneat/data';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonInput,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonSkeletonText,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
  NavController,
  ViewDidLeave,
  ViewWillEnter,
} from '@ionic/angular';
import { DatatugCoreModule } from '../../../core/datatug-core.module';
import { ENABLE_EMPTY_SHELL_PAGES } from '../../../core/feature-flags';
import { IProjectRef, equalProjectRef } from '../../../core/project-context';
import { isCanonicalDemoDbProject } from '../../../core/demo-db-project';
import { IEnvironmentFull } from '../../../models/definition/environments';
import { environmentPresentation } from '../../../models/definition/environment-presentation';
import { IEntity } from '../../../models/definition/metapedia/entity';
import { DatatugFolderComponent } from '../../../folders/ui/datatug-folder.component';
import {
  IProjBoard,
  IProjectSummary,
  IProjEntity,
  IProjEnv,
  IProjItemBrief,
  ProjectItem,
  ProjectItemType,
} from '../../../models/definition/project';
import {
  IProjectContext,
  parseDatatugStoreRef,
  storeIdToDisplayLabel,
  tryProjectUrl,
} from '../../../nav/nav-models';
import { ProjectTracker } from '../../../services/nav/contexts/project.tracker';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import {
  DatatugNavService,
  ProjectTopLevelPage,
} from '../../../services/nav/datatug-nav.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { DatatugServicesProjectModule } from '../../../services/project/datatug-services-project.module';
import { ProjectService } from '../../../services/project/project.service';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import { EntityService } from '../../../services/unsorted/entity.service';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { SchemaService } from '../../../services/unsorted/schema.service';
import { DemoDbConnectionsComponent } from './demo-db-connections.component';
import { projectPageHref } from '../../../nav/project-page-href';

@Component({
  selector: 'sneat-datatug-project',
  templateUrl: './project-page.component.html',
  styleUrls: ['./project-page.component.scss'],
  imports: [
    FormsModule,
    RouterLink,
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesProjectModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    DatatugFolderComponent,
    DemoDbConnectionsComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonTitle,
    IonContent,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonButton,
    IonItem,
    IonLabel,
    IonInput,
    IonIcon,
    IonSelect,
    IonSelectOption,
    IonList,
    IonSkeletonText,
  ],
})
export class ProjectPageComponent
  implements OnDestroy, ViewWillEnter, ViewDidLeave
{
  // Tags is an empty-shell page — see ENABLE_EMPTY_SHELL_PAGES. Read from
  // the template to hide the "Go to..." menu option for it.
  protected readonly enableEmptyShellPages = ENABLE_EMPTY_SHELL_PAGES;

  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly route = inject(ActivatedRoute);
  private readonly datatugNavService = inject(DatatugNavService);
  private readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly projectService = inject(ProjectService);
  private readonly schemaService = inject(SchemaService);
  private readonly environmentService = inject(EnvironmentService);
  private readonly entityService = inject(EntityService);
  private readonly navController = inject(NavController);

  // readonly DbModel = ProjectItem.dbModel as const;

  // A signal, not a plain field: this app is zoneless
  // (provideZonelessChangeDetection(), main.ts) — a plain field mutated from
  // an RxJS `.subscribe()` callback (setProjRef()/onProjectSummaryChanged()
  // below, driven by ProjectService.watchProjectSummary()'s HTTP response)
  // never triggers change detection on its own. Confirmed live (S126,
  // journey e2e J1/Epilogue A title-load flake): the console showed
  // `onProjectSummaryChanged()` receiving the correct title and assigning it
  // to this field, yet the Title `ion-input`'s committed value stayed
  // "Loading..." until the e2e's own 15s timeout — the same class of gap
  // already fixed elsewhere in this codebase for the identical reason
  // (env-db-table.page.ts's own `grid`/`semanticColumns` signals;
  // queries-tab.component.ts's `markForCheck()` for the narrower
  // no-template-rewrite case). A signal write notifies change detection
  // directly, per this repo's own zoneless convention (AGENTS.md).
  protected readonly project = signal<IProjectContext | undefined>(undefined);

  /**
   * The read-only "Store" field shows this instead of the raw
   * `project.ref.storeId` so an agent store reads as the actual URL the
   * browser calls (`http://localhost:8989`), not the raw id
   * (`http-localhost:8989`) — see `storeIdToDisplayLabel()` in
   * `nav-models.ts` and its twin use in `DatatugStorePageComponent`. A
   * plain function, not a stored field: purely derived from
   * `project.ref.storeId`, called directly from the template.
   */
  protected readonly storeDisplayLabel = storeIdToDisplayLabel;

  protected readonly metadataState = signal<
    'loading' | 'available' | 'unavailable'
  >('loading');
  protected readonly activeTab = signal<
    'overview' | 'environments' | 'entities'
  >('overview');
  protected readonly environments = signal<IEnvironmentFull[] | undefined>(
    undefined,
  );
  protected readonly environmentError = signal(false);
  protected readonly entities = signal<IRecord<IEntity>[] | undefined>(
    undefined,
  );
  protected readonly entityError = signal(false);
  protected readonly environmentPresentation = environmentPresentation;
  protected readonly sandboxHref = computed(() => {
    const ref = this.project()?.ref;
    return isCanonicalDemoDbProject(ref)
      ? projectPageHref(ref, 'demo-db-sandbox')
      : undefined;
  });
  private readonly scopeChanged = new Subject<void>();

  protected destroyed = new Subject<boolean>();
  @ViewChild(IonInput, { static: false }) addInput?: IonInput;

  protected isActiveView = false;

  private readonly projectTracker: ProjectTracker;

  constructor() {
    const route = this.route;
    console.log(
      'ProjectPageComponent.constructor()',
      route?.snapshot?.paramMap,
    );
    this.projectTracker = new ProjectTracker(this.destroyed, route);
    this.projectTracker.projectRef.subscribe({
      next: this.setProjRef,
      error: this.errorLogger.logErrorHandler(
        'Failed to get project ref for ProjectPageComponent',
      ),
    });
  }

  private setProjRef = (ref: IProjectRef) => {
    try {
      this.scopeChanged.next();
      this.project.set({
        ref,
        store: { ref: parseDatatugStoreRef(ref.storeId) },
      });
      this.metadataState.set('loading');
      this.activeTab.set('overview');
      this.environments.set(undefined);
      this.entities.set(undefined);
      this.environmentError.set(false);
      this.entityError.set(false);
      if (!ref.spaceID) {
        const github =
          ref.storeId === STORE_ID_GITHUB_COM ||
          ref.storeId === STORE_TYPE_GITHUB;
        const cancel$ = race([this.scopeChanged, this.destroyed]);
        const environments$ = github
          ? this.environmentService.listEnvironments(ref.projectId)
          : this.projectService
              .getFull(ref)
              .pipe(map((full) => full.environments || []));
        environments$
          .pipe(
            takeUntil(cancel$),
            catchError((error) => {
              this.environmentError.set(true);
              this.errorLogger.logError(
                error,
                'Failed to load overview environments',
              );
              return of(undefined);
            }),
          )
          .subscribe((items) => this.environments.set(items));
        this.entityService
          .getAllEntities(ref)
          .pipe(
            takeUntil(cancel$),
            catchError((error) => {
              this.entityError.set(true);
              this.errorLogger.logError(
                error,
                'Failed to load overview entities',
              );
              return of(undefined);
            }),
          )
          .subscribe((items) =>
            this.entities.set(
              items?.toSorted((a, b) => a.id.localeCompare(b.id)),
            ),
          );
      }
      this.projectService
        .watchProjectSummary(ref)
        .pipe(
          takeUntil(
            race([
              this.projectTracker.projectRef.pipe(skip(1)),
              this.destroyed,
            ]),
          ),
        )
        .subscribe({
          next: (summary) => this.onProjectSummaryChanged(ref, summary),
          error: (error) => {
            this.onProjectSummaryChanged(ref, undefined);
            this.errorLogger.logError(
              error,
              'Failed to load project summary for project page',
            );
          },
        });
    } catch (e) {
      this.errorLogger.logError(
        e,
        'Failed to set projectRef at ProjectPageComponent',
      );
    }
  };

  ionViewWillEnter(): void {
    this.isActiveView = true;
  }

  ionViewDidLeave(): void {
    this.isActiveView = false;
  }

  ngOnDestroy(): void {
    this.scopeChanged.next();
    this.scopeChanged.complete();
    this.destroyed.next(true);
    this.destroyed.complete();
  }

  // noinspection JSUnusedGlobalSymbols
  protected goDbModel(): void {
    this.goProjItemPage(ProjectItem.dbModel);
  }

  // public createEntity = (title: string) => {
  // 	return this.createProjItem(ProjectItem.Entity, title, this.entityService.createEntity);
  // }

  // noinspection JSUnusedGlobalSymbols
  protected goEnvironment(projEnv: IProjEnv): void {
    this.datatugNavService.goEnvironment(this.project(), projEnv);
  }

  protected selectTab(tab: 'overview' | 'environments' | 'entities'): void {
    this.activeTab.set(tab);
  }

  // noinspection JSUnusedGlobalSymbols
  protected goProjFolder(projItemType: ProjectItemType): void {
    const project = this.project();
    if (!project?.ref?.projectId) {
      this.errorLogger.logError(
        new Error('Can not navigate to project folder'),
        '!this.projBrief.id',
      );
      return;
    }
    const url = tryProjectUrl(
      project.ref,
      projItemType === 'query' ? 'queries' : `${projItemType}s`,
    );
    if (typeof url !== 'string') {
      this.errorLogger.logError(
        new Error(`no exact address for the project (${url.reason})`),
        'Failed to navigate to project item page: ' + projItemType,
      );
      return;
    }
    this.navController
      .navigateForward(url, {
        state: {
          project,
        },
      })
      .catch((err) =>
        this.errorLogger.logError(
          err,
          'Failed to navigate to project item page: ' + url,
        ),
      );
  }

  // noinspection JSUnusedGlobalSymbols
  protected goEntity(entity: IProjEntity): void {
    const project = this.project();
    if (!project) {
      return;
    }
    this.datatugNavService.goEntity(project, entity);
  }

  // noinspection JSUnusedGlobalSymbols
  protected goBoard(board: IProjBoard): void {
    const project = this.project();
    if (!project) {
      return;
    }
    this.datatugNavService.goBoard(project, board);
  }

  // noinspection JSUnusedGlobalSymbols
  protected getItemLink = (path: string) => (item: IProjItemBrief) =>
    `${path}/${item.id}`;

  // private onProjectIdChanged(): void {
  // 	console.log('ProjectPageComponent.onProjectIdChanged()', this.project.ref);
  // 	if (this.projectSubscription) {
  // 		this.projectSubscription.unsubscribe();
  // 	}
  // 	if (this.project?.ref) {
  // 		this.projectSubscription = this.projectService.watchProjectSummary(this.project.ref).pipe(
  // 			takeUntil(this.destroyed),
  // 		).subscribe({
  // 			next: projectSummary => this.onProjectSummaryChanged(this.project.ref, projectSummary),
  //
  // 		});
  // 	}
  // }

  private onProjectSummaryChanged(
    ref: IProjectRef,
    summary?: IProjectSummary,
  ): void {
    console.log(
      'ProjectPageComponent.onProjectSummaryChanged():',
      ref,
      summary,
    );
    if (!equalProjectRef(this.project()?.ref, ref)) return;
    this.metadataState.set(summary ? 'available' : 'unavailable');
    if (!summary) {
      this.project.set({
        ref,
        store: { ref: parseDatatugStoreRef(ref.storeId) },
      });
      return;
    }
    this.project.set({
      ...this.project(),
      ref,
      brief: { access: summary.access, title: summary.title },
      summary,
    });
  }

  private goProjItemPage(page: ProjectItemType): void {
    switch (page) {
      case ProjectItem.environment:
        page = 'env' as ProjectItemType;
        break;
    }
    const project = this.project();
    this.datatugNavService.goProjPage(page, project, {
      projectContext: project,
    });
  }

  goTo(event: CustomEvent): void {
    const page = event.detail.value as ProjectTopLevelPage;
    this.datatugNavService.goProject(this.project(), page);
  }
}
