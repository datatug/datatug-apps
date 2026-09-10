import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router } from '@angular/router';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import {
  ViewDidEnter,
  ViewDidLeave,
  ViewWillEnter,
} from '@ionic/angular';
import { DatatugCoreModule } from '../../core/datatug-core.module';
import { getStoreId, IProjectContext } from '../../nav/nav-models';
import { DatatugServicesNavModule } from '../../services/nav/datatug-services-nav.module';
import { DatatugQueriesServicesModule } from '../datatug-queries-services.module';
import { QueriesTabComponent } from './queries-tab.component';

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
    IonTitle,
    IonButton,
    IonIcon,
    IonSegmentButton,
    FormsModule,
    IonLabel,
    IonCard,
    IonCardContent,
    QueriesTabComponent,
    IonItem,
    IonSelect,
    IonSelectOption,
    IonBadge,
    IonSegment,
    IonContent,
  ],
})
export class QueriesPageComponent
  implements ViewWillEnter, ViewDidEnter, ViewDidLeave
{
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  public isActiveView = false;

  // noinspection SqlDialectInspection
  public sql = 'select * from ';

  public tab: Tab = 'shared';
  public orderTagsBy: OrderBy = 'count';

  public filter = '';

  public project?: IProjectContext;

  public get defaultBackHref(): string {
    return this.project
      ? `/store/${getStoreId(this.project.ref.storeId)}/project/${
          this.project.ref.projectId
        }`
      : '/';
  }

  constructor() {
    this.route.queryParamMap.subscribe((q) => {
      const tab = q.get('tab') as Tab;
      if (!tab) {
        this.updateUrlWithCurrentTab();
      } else if (tab !== this.tab && tabs.includes(tab)) {
        this.tab = tab;
      }

      const orderBy = q.get(paramOrderTagsBy) as OrderBy;
      if (!orderBy) {
        this.updateUrlWithOrderTagsBy();
      } else if (orderBy != this.orderTagsBy && orderBys.includes(orderBy)) {
        this.orderTagsBy = orderBy;
      }
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
    this.isActiveView = true;
  }

  ionViewDidEnter(): void {
    // Lifecycle hook - no action needed
  }

  ionViewDidLeave(): void {
    this.isActiveView = false;
  }

  reloadQueries(): void {
    // this.loadQueries();
  }
}
