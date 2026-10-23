import { SharedEvidenceLinkComponent } from '../../../evidence/shared-evidence-link.component';
import { BusinessClockChipComponent } from '../../../source-workspace/business-clock-chip.component';
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
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonItemDivider,
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
import {
  ProjectOverviewCardComponent,
  matchesOverviewFilter,
} from './project-overview-card.component';
import { ErrorStateComponent } from '../../../components/error-state/error-state.component';
import { projectPageHref } from '../../../nav/project-page-href';
import { GitHubReauthorizationBannerComponent } from '../../../project/new-project/github-reauthorization-banner.component';
import { readGithubProjectId } from '@datatug/project-address';
import {
  isHostedReadRefused,
  isSignedOut,
} from '../../../services/project/hosted-read-refused';

/**
 * The words for a read the hosted API declined to answer, before the shared friendly mapping sees it: signed out gets
 * a quiet "sign in" note, a refused actor or a missing resource (403/404) says access is needed. Undefined for any
 * other failure, which the error state words itself.
 */
function refusedReadHint(error: unknown, what: string): string | undefined {
  if (isSignedOut(error)) return `Sign in to see ${what}.`;
  if (isHostedReadRefused(error))
    return `Seeing ${what} needs access to this project in DataTug.`;
  return undefined;
}

@Component({
  selector: 'sneat-datatug-project',
  templateUrl: './project-page.component.html',
  styleUrls: ['./project-page.component.scss'],
  imports: [
    SharedEvidenceLinkComponent,
    BusinessClockChipComponent,
    RouterLink,
    ErrorStateComponent,
    SourceEntriesComponent,
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesProjectModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    DemoDbConnectionsComponent,
    ProjectQueriesPreviewComponent,
    ProjectDatabaseServersPreviewComponent,
    ProjectOverviewCardComponent,
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
    IonButton,
    IonItem,
    IonItemDivider,
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
  /** The failure behind `metadataReadError`, so the error state can word a rate limit or an outage plainly. */
  protected readonly metadataFailure = signal<unknown>(undefined);
  protected readonly metadataGuidance = signal<string | undefined>(undefined);
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
  protected readonly environmentFailure = signal<unknown>(undefined);
  protected readonly environmentError = signal(false);
  protected readonly environmentErrorMessage = signal<string | undefined>(
    undefined,
  );
  protected readonly boards = signal<IProjBoard[] | undefined>(undefined);
  protected readonly boardFailure = signal<unknown>(undefined);
  /** All the overview reads failed together (a rate limit, an outage): the page shows one state, not one per section. */
  protected readonly everythingFailed = computed(
    () =>
      !this.project()?.ref?.spaceID &&
      this.environmentError() &&
      this.boardError() &&
      this.entityError(),
  );
  protected readonly boardError = signal(false);
  protected readonly boardErrorMessage = signal<string | undefined>(undefined);
  protected readonly entities = signal<IRecord<IEntity>[] | undefined>(
    undefined,
  );
  protected readonly entityFailure = signal<unknown>(undefined);
  protected readonly entityError = signal(false);
  protected readonly entityErrorMessage = signal<string | undefined>(undefined);
  protected readonly environmentPresentation = environmentPresentation;
  /** Quick client-side filters typed in the Boards and Entities overview cards. */
  readonly boardFilter = signal('');
  readonly entityFilter = signal('');
  protected readonly filteredBoards = computed(() => {
    const filter = this.boardFilter();
    return (this.boards() ?? []).filter((board) =>
      matchesOverviewFilter(filter, board.title, board.id),
    );
  });
  protected readonly filteredEntities = computed(() => {
    const filter = this.entityFilter();
    return (this.entities() ?? []).filter((entity) =>
      matchesOverviewFilter(filter, entity.dbo?.title, entity.id),
    );
  });
  /** Each overview card's title links to the section's full page. */
  protected readonly sectionHref = computed(() => {
    const ref = this.project()?.ref;
    return {
      boards: ref ? projectPageHref(ref, 'boards') : undefined,
      entities: ref ? projectPageHref(ref, 'entities') : undefined,
      servers: ref ? projectPageHref(ref, 'servers') : undefined,
    };
  });
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
      this.metadataFailure.set(undefined);
      this.activeTab.set(isCanonicalDemoDbProject(ref) ? 'queries' : 'boards');
      this.queryCount.set(undefined);
      this.querySource.set(undefined);
      this.environments.set(undefined);
      this.entities.set(undefined);
      this.boards.set(undefined);
      this.boardFilter.set('');
      this.entityFilter.set('');
      this.environmentError.set(false);
      this.environmentErrorMessage.set(undefined);
      this.environmentFailure.set(undefined);
      this.entityError.set(false);
      this.entityErrorMessage.set(undefined);
      this.entityFailure.set(undefined);
      this.boardError.set(false);
      this.boardErrorMessage.set(undefined);
      this.boardFailure.set(undefined);
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
              this.environmentFailure.set(error);
              this.environmentErrorMessage.set(
                qualifiedLocalReadVersionGuidance(error) ??
                  refusedReadHint(error, 'environments'),
              );
              if (!isSignedOut(error)) {
                this.errorLogger.logError(
                  error,
                  'Failed to load overview environments',
                  { show: false },
                );
              }
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
              this.boardFailure.set(error);
              this.boardErrorMessage.set(
                qualifiedLocalReadVersionGuidance(error) ??
                  refusedReadHint(error, 'boards'),
              );
              if (!isSignedOut(error)) {
                this.errorLogger.logError(
                  error,
                  'Failed to load overview boards',
                  { show: false },
                );
              }
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
              this.entityFailure.set(error);
              this.entityErrorMessage.set(
                qualifiedLocalReadVersionGuidance(error) ??
                  refusedReadHint(error, 'entities'),
              );
              if (!isSignedOut(error)) {
                this.errorLogger.logError(
                  error,
                  'Failed to load overview entities',
                  { show: false },
                );
              }
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
            this.metadataFailure.set(error);
            this.metadataGuidance.set(
              qualifiedLocalReadVersionGuidance(error) ?? undefined,
            );
            this.metadataReadError.set(
              qualifiedLocalReadVersionGuidance(error) ??
                'Project details could not be loaded. Check access and refresh to try again.',
            );
            this.errorLogger.logError(
              error,
              'Failed to load project summary for project page',
              { show: false },
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

  protected retryMetadata(): void {
    const ref = this.project()?.ref;
    if (ref) this.setProjRef(ref);
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
