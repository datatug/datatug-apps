import { SourceEntriesComponent } from '../../../source-workspace/source-entries.component';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { race, Subject, of, Observable } from 'rxjs';
import { catchError, shareReplay, takeUntil } from 'rxjs/operators';
import { SneatAuthStateService } from '@sneat/auth-core';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IRecord } from '@sneat/data';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonChip,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonSkeletonText,
  IonTitle,
  IonToolbar,
  NavController,
  ViewDidLeave,
  ViewWillEnter,
} from '@ionic/angular';
import { DatatugCoreModule } from '../../../core/datatug-core.module';
import { IProjectRef, equalProjectRef } from '../../../core/project-context';
import { isCanonicalDemoDbProject } from '../../../core/demo-db-project';
import { IEnvironmentFull } from '../../../models/definition/environments';
import { environmentPresentation } from '../../../models/definition/environment-presentation';
import { IEntity } from '../../../models/definition/metapedia/entity';
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
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { DatatugServicesProjectModule } from '../../../services/project/datatug-services-project.module';
import { ProjectService } from '../../../services/project/project.service';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import { ProjectAssetsReadService } from '../../../services/project/project-assets-read.service';
import { qualifiedLocalReadVersionGuidance } from '../../../services/project/project-query-api.service';
import { DemoDbConnectionsComponent } from './demo-db-connections.component';
import { QueriesService } from '../../../queries/queries.service';
import type { IQueryFolder } from '../../../models/definition/query-def';
import {
  ProjectQueriesPreviewComponent,
  countProjectQueries,
} from './project-queries-preview.component';
import { ProjectDatabaseServersPreviewComponent } from './project-database-servers-preview.component';
import { projectPageHref } from '../../../nav/project-page-href';
import { GitHubReauthorizationBannerComponent } from '../../../project/new-project/github-reauthorization-banner.component';
import { readGithubProjectId } from '@datatug/project-address';

@Component({
  selector: 'sneat-datatug-project',
  templateUrl: './project-page.component.html',
  styleUrls: ['./project-page.component.scss'],
  imports: [
    RouterLink,
    SourceEntriesComponent,
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesProjectModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    DemoDbConnectionsComponent,
    ProjectQueriesPreviewComponent,
    ProjectDatabaseServersPreviewComponent,
    GitHubReauthorizationBannerComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonTitle,
    IonContent,
    IonCard,
    IonCardContent,
    IonChip,
    IonCardHeader,
    IonCardTitle,
    IonButton,
    IonItem,
    IonLabel,
    IonIcon,
    IonList,
    IonSkeletonText,
  ],
})
export class ProjectPageComponent
  implements OnDestroy, ViewWillEnter, ViewDidLeave
{
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly datatugNavService = inject(DatatugNavService);
  private readonly projectService = inject(ProjectService);
  private readonly auth = inject(SneatAuthStateService);
  private readonly projectAssets = inject(ProjectAssetsReadService);
  private readonly queriesService = inject(QueriesService);
  protected readonly queryCount = signal<number | undefined>(undefined);
  protected readonly querySource = signal<
    Observable<IQueryFolder | null | undefined> | undefined
  >(undefined);
  private readonly navController = inject(NavController);

  // readonly DbModel = ProjectItem.dbModel as const;

  protected goEnvironments(): void {
    this.datatugNavService.goProject(this.project(), 'environments');
  }

  // Summary responses repaint the zoneless project identity and metadata.
  protected readonly project = signal<IProjectContext | undefined>(undefined);
  private readonly authState = toSignal(this.auth.authState, {
    initialValue: undefined,
  });
  protected readonly signedIn = computed(() => {
    const state = this.authState();
    return (
      state?.status === 'authenticated' &&
      !!state.user?.uid &&
      state.user.isAnonymous !== true
    );
  });
  protected readonly projectTitle = computed(() => {
    const project = this.project();
    if (project?.brief?.title) return project.brief.title;
    const ref = project?.ref;
    if (!ref) return 'Project';
    if (ref.storeId === 'github.com' || ref.storeId === 'github') {
      const address = readGithubProjectId(ref.projectId);
      if (address.ok) return address.id.folder || address.id.repo;
    }
    return ref.projectId;
  });
  protected readonly projectMetadata = computed(() => {
    const project = this.project();
    if (!project) return [] as string[];
    const { ref } = project;
    return [
      ref.storeId !== 'firestore'
        ? `Store: ${this.storeDisplayLabel(ref.storeId)}`
        : undefined,
      ref.branch ? `Branch: ${ref.branch}` : undefined,
      ref.spaceID ? `Space: ${ref.spaceID}` : undefined,
      project.brief?.access ? `Access: ${project.brief.access}` : undefined,
    ].filter((value): value is string => !!value);
  });
  readonly quickSearchQuery = signal('');
  updateQuickSearch(event: Event): void {
    if (event.target instanceof HTMLInputElement)
      this.quickSearchQuery.set(event.target.value);
  }
  submitQuickSearch(event: Event): void {
    event.preventDefault();
    const ref = this.project()?.ref,
      q = this.quickSearchQuery().trim();
    if (!ref || !q) return;
    const destination = this.router.parseUrl(
      projectPageHref(ref, ['quick-search']),
    );
    destination.queryParams = { ...destination.queryParams, q };
    void this.router
      .navigateByUrl(destination)
      .catch(() => this.errorLogger.logError('Could not open Quick Search'));
  }

  protected readonly publicDataHref = computed(() => {
    const ref = this.project()?.ref;
    return ref && !ref.spaceID
      ? this.router.parseUrl(projectPageHref(ref, 'public-data'))
      : undefined;
  });
  protected readonly projectItemsUnsupported = computed(() => {
    const ref = this.project()?.ref;
    return !!(ref?.spaceID || ref?.projectApi || ref?.branch);
  });
  protected readonly projectAssetsUnsupported = computed(
    () => !!this.project()?.ref.spaceID,
  );

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
  protected readonly metadataReadError = signal<string | undefined>(undefined);
  protected readonly activeTab = signal<
    'boards' | 'queries' | 'entities' | 'databases'
  >('boards');
  protected readonly overviewTabs = [
    { id: 'boards', label: 'Boards' },
    { id: 'queries', label: 'Queries' },
    { id: 'entities', label: 'Entities' },
    { id: 'databases', label: 'Databases' },
  ] as const;
  protected readonly environments = signal<IEnvironmentFull[] | undefined>(
    undefined,
  );
  protected readonly environmentError = signal(false);
  protected readonly environmentErrorMessage = signal<string | undefined>(
    undefined,
  );
  protected readonly boards = signal<IProjBoard[] | undefined>(undefined);
  protected readonly boardError = signal(false);
  protected readonly boardErrorMessage = signal<string | undefined>(undefined);
  protected readonly entities = signal<IRecord<IEntity>[] | undefined>(
    undefined,
  );
  protected readonly entityError = signal(false);
  protected readonly entityErrorMessage = signal<string | undefined>(undefined);
  protected readonly environmentPresentation = environmentPresentation;
  protected readonly sandboxHref = computed(() => {
    const ref = this.project()?.ref;
    return isCanonicalDemoDbProject(ref)
      ? projectPageHref(ref, 'demo-db-sandbox')
      : undefined;
  });
  private readonly scopeChanged = new Subject<void>();

  protected destroyed = new Subject<boolean>();

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
      if (!equalProjectRef(this.project()?.ref, ref))
        this.quickSearchQuery.set('');
      this.project.set({
        ref,
        store: { ref: parseDatatugStoreRef(ref.storeId) },
      });
      this.metadataState.set('loading');
      this.metadataReadError.set(undefined);
      this.activeTab.set(isCanonicalDemoDbProject(ref) ? 'queries' : 'boards');
      this.queryCount.set(undefined);
      this.querySource.set(undefined);
      this.environments.set(undefined);
      this.entities.set(undefined);
      this.boards.set(undefined);
      this.environmentError.set(false);
      this.environmentErrorMessage.set(undefined);
      this.entityError.set(false);
      this.entityErrorMessage.set(undefined);
      this.boardError.set(false);
      this.boardErrorMessage.set(undefined);
      // These fixed-asset reads use the complete project ref so branch and
      // connection selectors stay aligned. Shared Space asset shortcuts remain
      // excluded because that API does not expose these asset collections.
      const cancel$ = race([this.scopeChanged, this.destroyed]);
      if (!ref.spaceID) {
        const queries$ = this.queriesService
          .getQueriesFolder(ref, '~', 'shared')
          .pipe(shareReplay({ bufferSize: 1, refCount: true }));
        this.querySource.set(queries$);
        queries$.pipe(takeUntil(cancel$)).subscribe({
          next: (folder) => this.queryCount.set(countProjectQueries(folder)),
          error: () => this.queryCount.set(undefined),
        });
        const environments$ = this.projectAssets.environments(ref);
        environments$
          .pipe(
            takeUntil(cancel$),
            catchError((error) => {
              this.environmentError.set(true);
              this.environmentErrorMessage.set(
                qualifiedLocalReadVersionGuidance(error) ??
                  'Environments could not be loaded. Refresh to try again.',
              );
              this.errorLogger.logError(
                error,
                'Failed to load overview environments',
              );
              return of(undefined);
            }),
          )
          .subscribe((items) => this.environments.set(items));
        this.projectAssets
          .boards(ref)
          .pipe(
            takeUntil(cancel$),
            catchError((error) => {
              this.boardError.set(true);
              this.boardErrorMessage.set(
                qualifiedLocalReadVersionGuidance(error) ??
                  'Boards could not be loaded. Refresh to try again.',
              );
              this.errorLogger.logError(
                error,
                'Failed to load overview boards',
              );
              return of(undefined);
            }),
          )
          .subscribe((items) => this.boards.set(items));
        this.projectAssets
          .entities(ref)
          .pipe(
            takeUntil(cancel$),
            catchError((error) => {
              this.entityError.set(true);
              this.entityErrorMessage.set(
                qualifiedLocalReadVersionGuidance(error) ??
                  'Entities could not be loaded. Refresh to try again.',
              );
              this.errorLogger.logError(
                error,
                'Failed to load overview entities',
              );
              return of(undefined);
            }),
          )
          .subscribe((items) =>
            this.entities.set(
              items
                ?.map((item) => ({
                  id: item.id,
                  dbo: item as unknown as IEntity,
                }))
                .toSorted((a, b) => a.id.localeCompare(b.id)),
            ),
          );
      }
      this.projectService
        .watchProjectSummary(ref)
        .pipe(takeUntil(cancel$))
        .subscribe({
          next: (summary) => this.onProjectSummaryChanged(ref, summary),
          complete: () => {
            if (
              equalProjectRef(this.project()?.ref, ref) &&
              this.metadataState() === 'loading'
            ) {
              this.onProjectSummaryChanged(ref, undefined);
            }
          },
          error: (error) => {
            if (!equalProjectRef(this.project()?.ref, ref)) return;
            this.onProjectSummaryChanged(ref, undefined);
            this.metadataReadError.set(
              qualifiedLocalReadVersionGuidance(error) ??
                'Project details could not be loaded. Check access and refresh to try again.',
            );
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

  protected selectTab(
    tab: 'boards' | 'queries' | 'entities' | 'databases',
  ): void {
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
}
