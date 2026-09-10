import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  NavController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonSkeletonText,
  IonToolbar,
} from '@ionic/angular';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { DatatugCoreModule } from '../../../core/datatug-core.module';
import {
  IEnvDbServer,
  IEnvironmentSummary,
} from '../../../models/definition/environments';
import { IProjEnv } from '../../../models/definition/project';
import { IDatatugProjectBriefWithIdAndStoreRef } from '../../../models/interfaces';
import { IProjectContext } from '../../../nav/nav-models';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { DatatugServicesProjectModule } from '../../../services/project/datatug-services-project.module';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { SneatDatatugPageTitleComponent } from '../../../components/page-title/sneat-datatug-page-title.component';

@Component({
  selector: 'sneat-datatug-environment',
  templateUrl: './environment-page.component.html',
  imports: [
    // `EnvironmentService`/`DatatugNavContextService` (injected below), and
    // `ProjectService` (injected transitively by `EnvironmentService`), are
    // all now `providedIn: 'root'` (nav-context-root-singletons) — nothing
    // this page injects still needs `DatatugServicesUnsortedModule`/
    // `DatatugServicesNavModule`/`DatatugServicesProjectModule`/
    // `DatatugServicesStoreModule`/`DatatugCoreModule` below; the imports
    // are now redundant and left in for a follow-up cleanup rather than
    // folded into this fix. Historically (before that fix) `EnvironmentService`
    // was a plain `@Injectable()`, provided only by those modules — this
    // page's own bare route (`env/:envId`, one level above
    // `EnvDbPageComponent`'s `db/:catalogId` route) had no ancestor route or
    // module supplying it, so navigating here (project -> Environments ->
    // an environment card, Task 17 item B.1, S121) threw `NG0201: No
    // provider found for EnvironmentService. Source:
    // Standalone[EnvironmentPageComponent]` (confirmed live) and the page
    // never rendered. Same fix, same cause, as `EnvironmentsPageComponent`/
    // `EnvDbPageComponent` (this task, same file) and `QueriesPageComponent`
    // (S120, PR #89). `DatatugNavService` (also injected below) needs none
    // of these: it was already `providedIn: 'root'`.
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesProjectModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    FormsModule,
    SneatDatatugPageTitleComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonList,
    IonItem,
    IonSkeletonText,
    IonLabel,
    IonButton,
  ],
})
export class EnvironmentPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly envService = inject(EnvironmentService);
  private readonly navController = inject(NavController);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly dataTugNavContextService = inject(DatatugNavContextService);
  private readonly datatugNavService = inject(DatatugNavService);
  // Zoneless (see queries-tab.component.ts's own `changeDetectorRef` doc
  // comment for the class of gap this closes, and this app's own
  // AGENTS.md): `env` below is a plain field, mutated from
  // `loadEnvSummary()`'s RxJS `.subscribe()` callback, a write Angular's
  // zoneless change detector has no way to notice on its own. Confirmed
  // live (Task 17, S121b, wiring the real project -> Environments -> local
  // click-through): `GET /datatug/environment-summary` succeeds and
  // `ng.getComponent(el).env` holds the correct `{id, dbServers}` payload,
  // but the Servers/Databases/DB servers cards stay on their skeleton-text
  // loading state forever because nothing ever told Angular to repaint.
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  projEnv?: IProjEnv;
  projBrief?: IDatatugProjectBriefWithIdAndStoreRef;

  project?: IProjectContext;
  env?: IEnvironmentSummary;
  dbCols = [{ field: 'id', sortable: true, filter: true }];
  public defaultBackUrl = '/store/localhost:8989';
  private envId?: string;

  constructor() {
    this.projEnv = history.state.projEnv as IProjEnv;

    this.dataTugNavContextService.currentProject.subscribe({
      next: (currentProject) => {
        this.project = currentProject;
        if (this.project) {
          if (!this.projBrief) {
            this.projBrief = {
              id: this.project.ref.projectId,
              access: 'private', // TODO pass actual
              title: 'TODO_pass_title',
              store: { ref: { type: 'agent' } },
            };
          }
          this.loadEnvSummary();
        }
      },
      error: (err) =>
        this.errorLogger.logError(
          err,
          'Failed to get current project for EnvironmentPage',
        ),
    });
    this.dataTugNavContextService.currentEnv.subscribe((env) => {
      this.envId = env?.id;
      this.loadEnvSummary();
    });
    // this.route.paramMap.subscribe({
    // 	next: params => {
    // 		this.envId = params.get(routingParamEnvironmentId);
    // 		if (!this.projEnv || this.projEnv.id !== this.envId) {
    // 			this.projEnv = {id: this.envId};
    // 		}
    // 		this.loadEnvSummary();
    // 	}
    // });
  }

  goDbServer(envServer: IEnvDbServer): void {
    const obj = { ...envServer, id: envServer.host };
    this.goEnvSubPage(obj, 'servers/dbserver', { envServer });
  }

  // goDb: env/:envId/db/:catalogId (EnvDbPageComponent) — Task 17 item B.1
  // (S121). Restores/fixes the commented-out predecessor above: that one
  // built its own URL by hand and pushed `db.databases.find(...)` into
  // router state, a shape `EnvDbPageComponent` never actually read (S120's
  // report: it only ever read `history.state.db`, which nothing pushed);
  // this uses the shared `DatatugNavService.goCatalog()` helper and lets
  // `EnvDbPageComponent` fetch its own data from GET /datatug/catalog-tables
  // (env-db-page.component.ts's loadCatalogTables()).
  goDb(catalogId: string): void {
    if (!this.project || !this.envId) {
      this.errorLogger.logError(
        new Error(`project=${this.project}, envId=${this.envId}`),
        'Failed to navigate to catalog page: missing project or environment',
      );
      return;
    }
    this.datatugNavService.goCatalog(this.project, this.envId, catalogId);
  }

  private loadEnvSummary(): void {
    // console.log('loadEnvSummary', this.project, this.envId);
    if (!this.project || !this.envId) {
      return;
    }
    this.envService.getEnvSummary(this.project.ref, this.envId).subscribe({
      next: (value) => {
        this.env = value;
        // Zoneless (this class's own `changeDetectorRef` doc comment).
        this.changeDetectorRef.markForCheck();
      },
      error: (err) =>
        this.errorLogger.logError(err, 'Failed to load environment summary'),
    });
  }

  private goEnvSubPage(
    envObject: { id: string },
    folder: string,
    state?: Record<string, unknown>,
  ): void {
    const { id } = envObject;
    this.navController
      .navigateForward(
        `/project/${this.projBrief?.id}/env/${this.projEnv?.id}/${folder}/${id}`, // TODO: relative path?
        { state },
      )
      .catch((err) =>
        this.errorLogger.logError(err, 'Failed to navigate to db page'),
      );
  }
}
