import { ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonMenuButton,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
  ModalController,
  NavController,
} from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IProjectRef } from '../../../core/project-context';
import { AddDbServerComponent } from '../../../db/modals/add-db-serve/add-db-server.component';
import {
  IDbServer,
  IProjDbServerSummary,
} from '../../../models/definition/apis/database';
import { DatatugCoreModule } from '../../../core/datatug-core.module';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import { DbServerService } from '../../../services/unsorted/db-server.service';

@Component({
  selector: 'sneat-datatug-servers',
  templateUrl: './servers-page.component.html',
  imports: [
    // `DatatugNavContextService` (injected below) is a plain
    // `@Injectable()`, provided by `DatatugServicesNavModule`, and itself
    // needs `AppContextService` (`DatatugCoreModule`) — same chain
    // `BoardPageComponent`'s own identical doc comment describes.
    // `DbServerService` likewise needs `DatatugServicesUnsortedModule` (and,
    // transitively, `StoreApiService` from `DatatugServicesStoreModule`).
    // `servers` (this page's own bare route, `datatug-routing-proj.ts`) had
    // no ancestor route or module supplying any of these, so navigating
    // here (the side menu's own "Servers" item) threw `NG0201` (confirmed
    // live, S136) — same fix, same cause, as `EntitiesPageComponent`'s own
    // identical doc comment.
    //
    // This page originally read the current project from
    // `ProjectContextService.current$` instead of
    // `DatatugNavContextService.currentProject` (every other side-menu page
    // — Entities, Boards, Environments — uses the latter). That legacy
    // `ProjectContextService` stream never actually emitted a value on this
    // page (confirmed live, S136: `projectContextService.current` stayed
    // `undefined` indefinitely even though `DatatugNavContextService`'s own
    // `currentProject` had already resolved the real project elsewhere in
    // the same app run). Root cause: each lazy-loaded routed standalone
    // component's own `imports:` array gets its OWN environment-injector
    // scope for a non-`providedIn:'root'` NgModule's providers — it is NOT
    // shared/deduped with another routed component's import of the "same"
    // NgModule (confirmed live, S136: adding `DatatugServicesNavModule` here
    // without also adding `DatatugCoreModule` immediately broke with the
    // exact same `NG0201` pattern, this time for `AppContextService`, one
    // level deeper — proving this component really does construct its own
    // fresh `DatatugNavContextService`, not reuse app's existing one). That
    // fresh instance still resolves the right project on its own, though —
    // its constructor independently parses `location.href`/router events
    // the same way the global one does — so switching this page to
    // `DatatugNavContextService.currentProject` (the pattern every other
    // working side-menu page already uses) fixes it without needing a
    // shared singleton.
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonTitle,
    IonContent,
    IonCard,
    IonItemDivider,
    IonItem,
    IonCheckbox,
    IonLabel,
    IonInput,
    IonCardHeader,
    IonSegment,
    IonSegmentButton,
    IonList,
    IonIcon,
    IonCardContent,
    IonButton,
    IonBadge,
    IonMenuButton,
  ],
})
export class ServersPageComponent implements OnDestroy {
  private readonly navContextService = inject(DatatugNavContextService);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly modalCtrl = inject(ModalController);
  private readonly navCtrl = inject(NavController);
  private readonly dbServerService = inject(DbServerService);
  // Zoneless (AGENTS.md; see `entities-page.component.ts`'s own identical
  // doc comment, this task's sibling fix): `dbServers` below is a plain
  // field, mutated from an RxJS `.subscribe()` callback.
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  protected tab: 'db' | 'web' | 'api' = 'db';

  protected dbServers?: IProjDbServerSummary[];

  private readonly destroyed = new Subject<void>();
  private target?: IProjectRef;
  private readonly isDeletingServer: Record<string, boolean> = {};

  constructor() {
    this.navContextService.currentProject
      .pipe(takeUntil(this.destroyed))
      .subscribe((value) => {
        const target = value?.ref;
        if (
          target &&
          (this.target?.storeId !== target?.storeId ||
            this.target?.projectId !== target?.projectId)
        ) {
          this.loadDbServers(target);
        }
        this.target = target;
      });
  }

  ngOnDestroy() {
    this.destroyed.next();
  }

  goDbServer(dbServer: IProjDbServerSummary): void {
    this.navCtrl
      .navigateForward([
        'project',
        '.@' + this.target?.storeId,
        'servers',
        'db',
        dbServer.dbServer.driver,
        dbServer.dbServer.host,
      ])
      .catch((err) =>
        this.errorLogger.logError(err, 'Failed to navigate to DB server page'),
      );
  }

  deleteDbServer(event: Event, dbServer: IProjDbServerSummary): void {
    event.preventDefault();
    event.stopPropagation();
    const id = serverId(dbServer.dbServer);
    this.isDeletingServer[id] = true;
    this.dbServerService.deleteDbServer(dbServer.dbServer).subscribe({
      next: () => {
        this.dbServers = this.dbServers?.filter((s) => s !== dbServer);
        delete this.isDeletingServer[id];
      },
      error: (err) => {
        delete this.isDeletingServer[id];
        this.errorLogger.logError(
          err,
          'Failed to remove DB server from project',
        );
      },
    });
  }

  public isDeleting(dbServer: IDbServer): boolean {
    return this.isDeletingServer[serverId(dbServer)];
  }

  addDbServer() {
    this.modalCtrl
      .create({ component: AddDbServerComponent })
      .then((modal) => {
        modal.onDidDismiss().then((result) => {
          const projDbServerSummary = result.data as IProjDbServerSummary;
          this.dbServers?.push(projDbServerSummary);
        });
        modal
          .present()
          .catch((err) =>
            this.errorLogger.logError(
              err,
              'Failed to present AddDbServerComponent as modal',
            ),
          );
      })
      .catch((err) =>
        this.errorLogger.logError(
          err,
          'Failed to create a modal for AddDbServerComponent',
        ),
      );
  }

  private loadDbServers(target: IProjectRef): void {
    this.dbServerService.getDbServers(target).subscribe({
      next: (dbServers) => {
        this.dbServers = dbServers || [];
        this.changeDetectorRef.markForCheck();
      },
      error: (err) =>
        this.errorLogger.logError(err, 'Failed to load list of DB servers'),
    });
  }
}

const serverId = (dbServer: IDbServer): string =>
  [dbServer.driver, dbServer.host, '' + dbServer.port].join('/');
