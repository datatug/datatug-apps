import { Component, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonIcon,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonToolbar,
} from '@ionic/angular';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import {
  ViewDidEnter,
  ViewDidLeave,
  ViewWillEnter } from '@ionic/angular';
import { DatatugCoreModule } from '../../core/datatug-core.module';
import { IProjectContext } from '../../nav/nav-models';
import { projectPageHref } from '../../nav/project-page-href';
import { ProjectContextService } from '../../services/project/project-context.service';
import { DatatugServicesNavModule } from '../../services/nav/datatug-services-nav.module';
import { DatatugQueriesServicesModule } from '../datatug-queries-services.module';
import { QueriesTabComponent } from './queries-tab.component';
import { SneatDatatugPageTitleComponent } from '../../components/page-title/sneat-datatug-page-title.component';

// const paramTab = 'tab';
const tabs = ['active', 'bookmarked', 'personal', 'shared'] as const;
type Tab = (typeof tabs)[number];

const paramOrderTagsBy = 'order-tags-by';
const orderBys = ['count', 'title'];
type OrderBy = (typeof orderBys)[number];

@Component({
  selector: 'sneat-datatug-sql-queries',
  templateUrl: './queries-page.component.html',
  styleUrls: ['./queries-page.component.scss'],
  imports: [
    // `QueriesTabComponent` (rendered in this page's own template below)
    // injects `QueriesService` (still a plain `@Injectable()`, provided by
    // these modules) and `DatatugNavContextService` (now `providedIn: 'root'`,
    // nav-context-root-singletons, along with its own constructor dependency
    // `AppContextService`). `queries` (this page's own bare route,
    // `routes/datatug-routing-proj.ts`) had no ancestor route or module
    // supplying any of them, so `QueriesTabComponent`'s constructor threw
    // `NG0201: No provider found for QueriesService` on every navigation to
    // this route, direct or in-app — before that, its own
    // `dataTugNavContextService.currentProject` subscription
    // (`loadQueries()`) is exactly the mechanism `env-db-table.page.ts` and
    // `query-page.component.ts` already use to resolve the current project
    // from the URL (`DatatugNavContextService.processUrl()` parses
    // `location.href` directly), so it never got a chance to run — the page
    // sat on its default empty folder forever, no queries, no error
    // surfaced past the crashed child. Same fix, and same cause, as
    // `EnvDbPageComponent`, `EnvDbTablePageComponent` and
    // `QueryPageComponent`: this standalone component's own `imports` — not
    // `QueriesTabComponent`'s — is what a parent-then-child template render
    // resolves against, mirroring `ProjectPageComponent` supplying
    // `DatatugServicesUnsortedModule` for its own child
    // `DatatugFolderComponent`.
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugQueriesServicesModule,
    IonButtons,
    IonHeader,
    IonToolbar,
    IonBackButton,
    SneatDatatugPageTitleComponent,
    IonButton,
    IonIcon,
    IonSegmentButton,
    FormsModule,
    IonLabel,
    IonCard,
    IonCardContent,
    QueriesTabComponent,
    IonSegment,
    IonContent,
  ],
})
export class QueriesPageComponent
  implements ViewWillEnter, ViewDidEnter, ViewDidLeave
{
  private readonly queryList = viewChild(QueriesTabComponent);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectContext = inject(ProjectContextService);
  private readonly currentProjectRef = toSignal(this.projectContext.current$, { initialValue: undefined,
  });

  public isActiveView = false;

  // noinspection SqlDialectInspection
  public sql = 'select * from ';

  public tab: Tab = 'shared';
  public orderTagsBy: OrderBy = 'count';

  public filter = '';

  public project?: IProjectContext;

  public get defaultBackHref(): string {
    return projectPageHref(this.project?.ref ?? this.currentProjectRef());
  }

  constructor() {
    this.route.queryParamMap.subscribe((q) => {
      const tab = q.get('tab');
      this.tab = tab && tabs.includes(tab as Tab) ? (tab as Tab) : 'shared';

      const orderBy = q.get(paramOrderTagsBy);
      this.orderTagsBy =
        orderBy && orderBys.includes(orderBy as OrderBy)
          ? (orderBy as OrderBy)
          : 'count';
    });
  }

  public updateUrlWithOrderTagsBy(): void {
    this.setUrlParam(paramOrderTagsBy, this.orderTagsBy);
  }

  public updateUrlWithCurrentTab(): void {
    this.setUrlParam('tab', this.tab);
  }

  public setUrlParam(name: string, value: string): void {
    const queryParams: Params = { [name]: value };
    this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: queryParams,
        queryParamsHandling: 'merge', // remove to replace all query params by provided
      })
      .catch(
        this.errorLogger.logErrorHandler(
          `failed to update url with query parameter "${name}"`,
        ),
      );
  }

  ionViewWillEnter(): void {
    // Query lists have no fragment-based deep links. Clear an incoming
    // fragment without routing so unrelated query parameters and Back history
    // remain untouched.
    if (window.location.hash) {
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      );
    }
    this.isActiveView = true;
    this.queryList()?.reload();
  }

  ionViewDidEnter(): void {
    // Lifecycle hook - no action needed
  }

  ionViewDidLeave(): void {
    this.isActiveView = false;
  }

  reloadQueries(): void {
    this.queryList()?.reload();
  }
}
