import { AsyncPipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, UrlTree } from '@angular/router';
import { ENABLE_EMPTY_SHELL_PAGES } from '../../../core/feature-flags';
import {
  IonButton,
  IonButtons,
  IonIcon,
  IonItem,
  IonLabel,
  IonMenuToggle,
  IonSpinner,
} from '@ionic/angular';
import { InvestigationContextBarComponent } from '@sneat/datatug-semantic';
import { Observable, Subject } from 'rxjs';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { filter, takeUntil } from 'rxjs/operators';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import {
  DatatugNavService,
  ProjectTopLevelPage,
} from '../../../services/nav/datatug-nav.service';
import { DatatugUserService } from '../../../services/base/datatug-user-service';
import { IProjectSummary } from '../../../models/definition/project';
import {
  IEnvContext,
  IProjectContext,
  parseProjectUrl,
} from '../../../nav/nav-models';
import { incidentContextQueryParams } from '../../../incidents/incident-route-context';
import { incidentPageQueryParams } from '../../../incidents/incident-navigation';
import { PRODUCT_PROFILE } from '@datatug/product-profiles';
import { projectPageHref } from '../../../nav/project-page-href';
import { isCanonicalPublicDemo } from '../../../detective/public-scenario-catalog';
import { addIcons } from 'ionicons';
import { chatbubblesOutline, warningOutline } from 'ionicons/icons';

addIcons({ chatbubblesOutline, warningOutline });

interface IProjectTopLevelPage {
  path: ProjectTopLevelPage;
  title: string;
  icon: string;
  count?: (proj: IProjectSummary) => number | undefined;
  buttons?: { path: ProjectTopLevelPage; icon: string }[];
}

@Component({
  selector: 'sneat-datatug-project-menu-top',
  templateUrl: './project-menu-top.component.html',
  imports: [
    IonItem,
    IonMenuToggle,
    RouterLink,
    AsyncPipe,
    IonIcon,
    IonLabel,
    IonSpinner,
    IonButtons,
    IonButton,
    InvestigationContextBarComponent,
  ],
})
export class ProjectMenuTopComponent implements OnDestroy {
  // A CLI bridge exposes chat and its project summary, while the remaining
  // project pages require the full project store API.
  get cliBridgeChat(): boolean {
    return (
      document.documentElement.dataset['cliChatBridgePath'] ===
      location.pathname
    );
  }
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly nav = inject(DatatugNavService);
  private readonly router = inject(Router, { optional: true });
  readonly inSessionWorkspace = signal(false);
  private readonly userService = inject(DatatugUserService);

  // Incidents moved from a standalone side-panel card into project
  // navigation (UX brief §13). Read declaratively from the profile
  // (REQ:profile-config-is-declarative): fixed `true` for `datatug`
  // (founder, 2026-09-11: "DataTug app should always have Incidents menu
  // item"), `false` for profiles whose home already is the incidents list.
  // The icon follows the standard non-colored project-menu style.
  private readonly profile = inject(PRODUCT_PROFILE);
  protected readonly showIncidents = computed(
    () => this.profile.showIncidentsMenuItem,
  );
  private readonly currentStoreId = signal<string | undefined>(undefined);
  private readonly currentEnvironment = signal<IEnvContext | undefined>(
    undefined,
  );
  // Signal mirror of the plain `project` field so the computed above
  // recomputes on context change (zoneless: plain fields notify nothing).
  private readonly currentProjectId = signal<string | undefined>(undefined);
  // Context carry-over from the retired sidebar card: link the incident list
  // to the active store/project/environment scope when all three are known.
  protected readonly incidentQueryParams = computed(() => {
    const agentStoreId = this.currentStoreId();
    const project = this.currentProjectId();
    const environment = this.currentEnvironment()?.id;
    const scope =
      agentStoreId && project && environment
        ? incidentContextQueryParams({
            agentStoreId,
            scope: {
              storeId: project,
              project,
              environment,
            },
          })
        : undefined;
    const projectRef = this.project?.ref;
    return incidentPageQueryParams(
      projectRef ? projectPageHref(projectRef, 'incidents') : '/incidents',
      scope,
    );
  });

  // Widgets, Tags and DB models are empty-shell pages — see
  // ENABLE_EMPTY_SHELL_PAGES. Left out of the menu entirely while the flag
  // is off, matching them being left out of the routes.
  private static readonly emptyShellPages: IProjectTopLevelPage[] = [
    {
      path: 'dbmodels',
      title: 'DB models',
      icon: 'layers-outline',
      count: (proj) => proj?.dbModels?.length,
    },
    {
      path: 'tags',
      title: 'Tags',
      icon: 'pricetags-outline',
      count: (proj) => Object.keys(proj?.tags || {}).length,
    },
    {
      path: 'widgets',
      title: 'Widgets',
      icon: 'easel-outline',
    },
  ];

  // Overview is always first. Add other pages inside sortProjectPages below;
  // they appear alphabetically by title, including optional empty-shell pages.
  public readonly projTopLevelPages: IProjectTopLevelPage[] = [
    {
      path: 'overview',
      title: 'Overview',
      icon: 'home-outline',
    },
    ...ProjectMenuTopComponent.sortProjectPages([
      { path: 'quick-search', title: 'Quick Search', icon: 'search-outline' },
      {
        path: 'sessions',
        title: 'Sessions',
        icon: 'albums-outline',
      },
      {
        path: 'chat',
        title: 'Chat',
        icon: 'chatbubbles-outline',
      },
      {
        path: 'checks',
        title: 'Checks',
        icon: 'checkmark-done-outline',
      },
      {
        path: 'detective',
        title: 'Detective',
        icon: 'compass-outline',
      },
      {
        path: 'boards',
        title: 'Boards',
        icon: 'easel-outline',
        count: (proj) => proj?.boards?.length,
      },
      {
        path: 'entities',
        title: 'Entities',
        icon: 'book-outline',
        count: (proj) => proj?.entities?.length,
      },
      {
        path: 'meanings',
        title: 'Meanings',
        icon: 'book-outline',
      },
      {

        path: 'servers',
        title: 'Servers',
        icon: 'server-outline',
      },
      {
        path: 'queries',
        title: 'Queries',
        icon: 'terminal-outline',
        // No `buttons: [{ path: 'query', icon: 'add' }]` "+" shortcut here —
        // it routed through goProjPage() to a bare 'query' segment, but the
        // only project route matching that prefix is 'query/:queryId' (view
        // an existing query); there is no route for "create a new query" by
        // design; that flow is `QueriesUiService.openNewQuery()`, an action
        // sheet reachable from the adjacent "Queries" segment tab
        // (ProjectMenuComponent → QueriesMenuComponent's own "+" button,
        // `project-menu.component.html`). The "+" here duplicated that button
        // and 404'd (NG04002) instead of working, so it is removed rather
        // than given a route to nowhere — see project-menu-top.component.spec.ts.
      },
      ...(ENABLE_EMPTY_SHELL_PAGES
        ? ProjectMenuTopComponent.emptyShellPages
        : []),
    ]),
  ];

  private static sortProjectPages(
    pages: IProjectTopLevelPage[],
  ): IProjectTopLevelPage[] {
    return pages.sort((left, right) => left.title.localeCompare(right.title));
  }

  private readonly projectState = signal<IProjectContext | undefined>(
    undefined,
  );
  get project(): IProjectContext | undefined {
    return this.projectState();
  }
  set project(value: IProjectContext | undefined) {
    this.projectState.set(value);
  }
  readonly metadataOnly = signal(false);
  public currentFolder: Observable<string | undefined>;

  private destroyed = new Subject<void>();

  constructor() {
    const syncSession = () => {
      const parsed = this.router
        ? parseProjectUrl(this.router.url.split('?')[0])
        : undefined;
      this.inSessionWorkspace.set(
        !!parsed?.ok && /^\/sessions\/[^/]+(?:\/|$)/.test(parsed.rest),
      );
    };
    syncSession();
    this.router?.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntil(this.destroyed),
      )
      .subscribe(syncSession);
    const datatugNavContextService = this.datatugNavContextService;

    this.datatugNavContextService.currentProject
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: this.setProject,
        error: this.errorLogger.logErrorHandler(
          'ProjectMenuTopComponent failed to retrieve project context from ProjectTracker',
        ),
      });
    this.datatugNavContextService.currentStoreId
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (storeId) => this.currentStoreId.set(storeId),
        error: this.errorLogger.logErrorHandler(
          'ProjectMenuTopComponent failed to track current store',
        ),
      });
    this.datatugNavContextService.currentEnv
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (env) => this.currentEnvironment.set(env),
        error: this.errorLogger.logErrorHandler(
          'ProjectMenuTopComponent failed to track current environment',
        ),
      });
    this.currentFolder = datatugNavContextService.currentFolder;
  }

  private setProject = (project?: IProjectContext) => {
    this.project = project;
    this.currentProjectId.set(project?.ref.projectId);
    this.metadataOnly.set(project?.ref.spaceID !== undefined);
  };

  ngOnDestroy() {
    this.destroyed.next();
    this.destroyed.complete();
  }

  projectPageUrl(page: ProjectTopLevelPage): string {
    return projectPageHref(this.project?.ref, page, this.router?.url);
  }

  isDemoProject(): boolean {
    return isCanonicalPublicDemo(this.project?.ref);
  }

  incidentsProjectRoute(): string {
    const projectRef = this.project?.ref;
    if (projectRef) {
      return projectPageHref(projectRef, 'incidents').split('?')[0];
    }
    return '/incidents';
  }

  projectPageRoute(page: ProjectTopLevelPage): UrlTree | string {
    const href = this.projectPageUrl(page);
    return this.router ? this.router.parseUrl(href) : href;
  }

  goProjPage(event: Event, page: ProjectTopLevelPage): boolean {
    event.preventDefault();
    event.stopPropagation();
    if (
      (this.cliBridgeChat && page !== 'chat') ||
      (this.metadataOnly() &&
        ![
          'overview',
          'quick-search',
          'queries',
          'checks',
          'detective',
          'sessions',
          'boards',
        ].includes(page))
    )
      return false;
    const project = this.project;
    this.nav.goProjPage(page, project, { project });
    return false;
  }
}
