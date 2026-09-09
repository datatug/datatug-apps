import { Component, OnDestroy, OnInit, inject } from '@angular/core';
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
  IonIcon,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonMenuButton,
  IonTitle,
  IonToolbar,
  ViewDidEnter,
  ViewDidLeave,
} from '@ionic/angular';
import { AuthStatus } from '@sneat/auth-core';
import { SneatErrorCardComponent } from '@sneat/components';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { merge, Subject } from 'rxjs';
import { filter, takeUntil, tap } from 'rxjs/operators';
import { IProjectBase } from '../../../models/definition/project';
import {
  IDatatugStoreContext,
  IProjectContext,
  parseDatatugStoreRef,
  storeIdToDisplayLabel,
} from '../../../nav/nav-models';
import { NewProjectService } from '../../../project/new-project/new-project.service';
import { DatatugUserService } from '../../../services/base/datatug-user-service';
import { StoreTracker } from '../../../services/nav/contexts/store.tracker';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import {
  AgentStateService,
  IAgentState,
} from '../../../services/repo/agent-state.service';
import { DatatugStoreService } from '../../../services/repo/datatug-store.service';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';

@Component({
  selector: 'sneat-datatug-store-page',
  templateUrl: './datatug-store-page.component.html',
  imports: [
    // `DatatugStoreService`/`AgentStateService` (both injected below) are
    // provided by this module, not `providedIn: 'root'`. Every route that
    // reaches this component directly (`/store/:storeId` itself, or a
    // hard `page.goto('/store/...')`) previously threw `NG0201: No
    // provider found for _DatatugStoreService` — no ancestor route
    // provides it either (see `routes/datatug-routing.module.ts` and
    // `routes/datatug-routing-store.ts`, neither has a `providers:`
    // entry for it). It went unnoticed because the only e2e that reached
    // this component tree navigated straight to the child project page
    // instead (`ProjectPageComponent`, which already imports this same
    // module) — see `journey.spec.ts`'s J1 comment. Found while adding
    // `e2e/journey/store-id-scheme.spec.ts` for this stream, which DOES
    // navigate straight to this page.
    DatatugServicesStoreModule,
    SneatErrorCardComponent,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonTitle,
    IonContent,
    IonCard,
    IonList,
    IonItemDivider,
    IonLabel,
    IonButton,
    IonIcon,
    IonItem,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
  ],
  // `DatatugUserService`/`NewProjectService` (both injected below) have no
  // `providedIn: 'root'` either, and — unlike `DatatugServicesStoreModule`
  // above — no ancestor route provides them: `DatatugHomePageComponent`
  // (`pages/home/datatug-home-page.component.ts`) provides them the same
  // way, as component-local `providers`, but that only reaches this page
  // when it is a DESCENDANT of the home route's injector. `/store/:storeId`
  // is a sibling top-level route (`routes/datatug-routing.module.ts`), not
  // a child of `/`, so it never inherits them — this threw the same NG0201
  // as the `DatatugServicesStoreModule` gap above for any direct hit on
  // `/store/:storeId` (a full navigation, or a `page.goto`), independent of
  // this stream's store-id fix.
  providers: [DatatugUserService, NewProjectService],
})
export class DatatugStorePageComponent
  implements OnInit, OnDestroy, ViewDidLeave, ViewDidEnter
{
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly route = inject(ActivatedRoute);
  private readonly storeService = inject(DatatugStoreService);
  private readonly nav = inject(DatatugNavService);
  private readonly agentStateService = inject(AgentStateService);
  private readonly newProjectService = inject(NewProjectService);
  private readonly datatugUserService = inject(DatatugUserService);

  public storeId?: string | null;
  public projects?: IProjectBase[];
  public error: unknown;

  /**
   * The page title shows this instead of the raw `storeId` so an agent
   * store — reached via `datatug serve`'s `http-<host>:<port>` link —
   * reads as the actual URL (`http://localhost:8989`) the browser calls,
   * not the raw id. A getter, not a stored field: it is purely derived
   * from `storeId` and re-evaluated on every template read, so it never
   * needs its own change-detection trigger — see `storeIdToDisplayLabel()`
   * in `nav-models.ts`.
   */
  public get storeDisplayId(): string {
    return storeIdToDisplayLabel(this.storeId);
  }

  public agentState?: IAgentState;
  public isLoading?: boolean;

  private readonly destroyed = new Subject<void>();
  private readonly viewDidLeave = new Subject<void>();
  private readonly storeChanged = new Subject<void>();

  private readonly storeTracker: StoreTracker;

  protected authStatus?: AuthStatus;

  constructor() {
    const route = this.route;
    const datatugUserService = this.datatugUserService;
    console.log(
      'DatatugStorePageComponent.constructor(), window.history.state:',
      window.history.state,
    );
    const store = window.history.state?.store as IDatatugStoreContext;
    if (store) {
      // this.storeId = store.id;
      // this.projects = projectsBriefFromDictToFlatList(store.brief.projects);
      throw new Error('Not implemented yet');
    }
    this.storeTracker = new StoreTracker(this.destroyed, route);
    datatugUserService.datatugUserState.subscribe((state) => {
      this.authStatus = state.status;
    });
  }

  ionViewDidLeave(): void {
    this.viewDidLeave.next();
  }

  ionViewDidEnter(): void {
    if (this.storeId) {
      this.processStoreId(this.storeId);
    }
  }

  ngOnInit() {
    this.trackStoreId();
  }

  private trackStoreId(): void {
    this.storeTracker.storeId
      .pipe(
        tap(() => this.storeChanged.next()),
        filter((id) => !!id),
      )
      .subscribe({
        next: this.processStoreId,
        error: this.errorLogger.logErrorHandler('Failed to track store id'),
      });
  }

  processStoreId = (storeId: string | null): void => {
    if (storeId === this.storeId) {
      return;
    }
    this.storeId = storeId;
    if (storeId === 'firestore' || storeId === 'github.com') {
      this.loadProjects(storeId);
      return;
    }
    if (storeId) {
      this.agentStateService
        .watchAgentInfo(storeId)
        .pipe(
          takeUntil(
            merge([this.viewDidLeave, this.destroyed, this.storeChanged]),
          ),
        )
        .subscribe({
          next: (agentState) => {
            this.agentState = agentState;
            if (!agentState?.isNotAvailable && !this.projects) {
              this.loadProjects(storeId);
            }
          },
          error: this.errorLogger.logErrorHandler(
            'Failed to get agent state info',
          ),
        });
    }
  };

  private loadProjects(storeId: string): void {
    this.isLoading = true;
    this.storeService
      .getProjects(storeId)
      .pipe(takeUntil(this.storeChanged), takeUntil(this.destroyed))
      .subscribe({
        next: (projects) => this.processStoreProjects(projects),
        error: (err) => {
          this.isLoading = false;
          if (
            err.name === 'HttpErrorResponse' &&
            err.ok === false &&
            err.status === 0
          ) {
            if (!this.agentState?.isNotAvailable) {
              this.agentState = {
                isNotAvailable: true,
                lastCheckedAt: new Date(),
                error: err,
              };
            }
            // this.error = 'Agent is not available at URL: ' + err.url;
          } else {
            this.error = this.errorLogger.logError(
              err,
              `Failed to get list of projects hosted by agent [${storeId}]`,
              { show: false },
            );
          }
        },
      });
  }

  private processStoreProjects(projects: IProjectBase[]): void {
    console.table(projects);
    this.isLoading = false;
    this.projects = projects;
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  public goProject(project: IProjectBase, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.storeId) {
      return;
    }
    const projectContext: IProjectContext = {
      ref: { projectId: project.id, storeId: this.storeId },
      store: { ref: parseDatatugStoreRef(this.storeId) },
      brief: {
        access: project.access,
        title: project.title,
      },
    };
    this.nav.goProject(projectContext);
  }

  create(): void {
    this.newProjectService.openNewProjectDialog();
  }
}
