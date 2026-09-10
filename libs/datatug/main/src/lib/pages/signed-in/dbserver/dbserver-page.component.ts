import { ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
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
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { map, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { DatatugCoreModule } from '../../../core/datatug-core.module';
import { DbServerService } from '../../../services/unsorted/db-server.service';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import {
  IDbServer,
  IDbServerSummary,
  IDbCatalogSummary,
  getDbServerFromId,
} from '../../../models/definition/apis/database';

@Component({
  selector: 'sneat-datatug-dbserver',
  templateUrl: './dbserver-page.component.html',
  imports: [
    // `DbServerService` (injected below) needs `DatatugServicesUnsortedModule`
    // (and, transitively, `StoreApiService`/`GithubProjectReaderService` from
    // `DatatugServicesStoreModule`); `DatatugNavContextService` needs
    // `DatatugServicesNavModule` + `AppContextService`
    // (`DatatugCoreModule`) — same chain `ServersPageComponent`'s own
    // identical doc comment describes. `servers/db/:dbDriver/:dbServerId`
    // (this page's own bare route, `datatug-routing-proj.ts`) had no
    // ancestor route or module supplying any of these, so clicking a server
    // from the Servers list threw `NG0201` (confirmed live, S136) — same
    // fix, same cause, as `EntitiesPageComponent`'s own identical doc
    // comment.
    //
    // This page originally read the current project from
    // `ProjectContextService.current$`, which `DbServerService` itself also
    // reads internally (`getDbServerSummary()`'s own
    // `this.projectContextService.current`) — switched the outer
    // subscription to `DatatugNavContextService.currentProject` (see
    // `ServersPageComponent`'s doc comment for why the legacy stream never
    // emitted) so both this component's own load trigger AND
    // `DbServerService`'s internal read resolve against the same
    // `ProjectContextService` instance populated by the
    // `DatatugNavContextService` this component's own `imports` now provide.
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonMenuButton,
    IonTitle,
    IonContent,
    IonCard,
    IonItemDivider,
    IonIcon,
    IonLabel,
    IonItem,
    IonInput,
    IonSegment,
    IonSegmentButton,
    IonBadge,
    IonList,
    IonButton,
    FormsModule,
    IonText,
  ],
})
export class DbserverPageComponent implements OnDestroy {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly route = inject(ActivatedRoute);
  private readonly dbServerService = inject(DbServerService);
  private readonly navContextService = inject(DatatugNavContextService);
  // Zoneless (AGENTS.md; see `entities-page.component.ts`'s own identical
  // doc comment): `dbServer`/`dbServerSummary`/`dbServerCatalogs`/`envs`
  // below are plain fields, mutated from RxJS `.subscribe()` callbacks.
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  tab: 'known' | 'unknown' = 'known';
  public dbServer?: IDbServer;
  public dbServerSummary?: IDbServerSummary;
  public dbServerCatalogs?: IDbCatalogSummary[];
  public loadingSummary = true;
  public loadingCatalogs = true;
  public envs?: string[];

  private readonly destroyed = new Subject<void>();

  constructor() {
    this.route.paramMap
      .pipe(
        takeUntil(this.destroyed),
        map((q) => {
          const id = q.get('dbServerId');
          const driver = q.get('dbDriver');
          return driver && id ? getDbServerFromId(driver, id) : undefined;
        }),
      )
      .subscribe((dbServer) => {
        this.dbServer = dbServer;
        this.changeDetectorRef.markForCheck();
      });
    this.navContextService.currentProject
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (value) => {
          if (value?.ref) {
            this.loadData();
          }
        },
      });
  }

  ngOnDestroy() {
    // console.log('DbserverPage.ngOnDestroy()');
    this.destroyed.next();
  }

  private loadData(): void {
    this.loadSummary();
    this.loadCatalogs();
  }

  private loadSummary(): void {
    this.loadingSummary = true;
    const dbServer = this.dbServer;
    if (!dbServer) {
      return;
    }
    this.dbServerService
      .getDbServerSummary(dbServer)
      .pipe(
        takeUntil(this.destroyed),
        // delay(1000),
      )
      .subscribe({
        next: (dbServerSummary) => {
          this.loadingSummary = false;
          this.dbServerSummary = dbServerSummary;
          this.envs = [];
          dbServerSummary.databases?.forEach((db) => {
            db.environments?.forEach((env) => {
              if (!this.envs?.includes(env)) {
                if (this.envs) {
                  this.envs?.push(env);
                } else {
                  this.envs = [env];
                }
              }
            });
          });
          this.removeAddedCatalogs();
          this.changeDetectorRef.markForCheck();
        },
        error: (err) => {
          this.loadingSummary = false;
          this.errorLogger.logError(err, 'Failed to load DB server summary');
          this.changeDetectorRef.markForCheck();
        },
      });
  }

  private loadCatalogs(): void {
    this.loadingCatalogs = true;
    const dbServer = this.dbServer;
    if (!dbServer) {
      return;
    }
    this.dbServerService
      .getServerDatabases({ dbServer })
      .pipe(
        takeUntil(this.destroyed),
        // delay(1000),
      )
      .subscribe({
        next: (catalogs) => {
          this.loadingCatalogs = false;
          this.dbServerCatalogs = catalogs;
          this.removeAddedCatalogs();
          this.changeDetectorRef.markForCheck();
        },
        error: (err) => {
          this.loadingCatalogs = false;
          this.errorLogger.logError(err, 'Failed to load DB catalogs');
          this.changeDetectorRef.markForCheck();
        },
      });
  }

  private removeAddedCatalogs(): void {
    if (this.dbServerSummary && this.dbServerCatalogs) {
      const { databases } = this.dbServerSummary;
      this.dbServerCatalogs = this.dbServerCatalogs.filter(
        (c) => !databases || !databases.some((db) => db.id === c.name),
      );
    }
  }
}
