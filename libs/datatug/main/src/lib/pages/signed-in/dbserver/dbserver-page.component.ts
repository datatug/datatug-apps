import { Component, OnDestroy, inject, signal } from '@angular/core';
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
import { DbServerService } from '../../../services/unsorted/db-server.service';
import { ProjectContextService } from '../../../services/project/project-context.service';
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
  private readonly projectContextService = inject(ProjectContextService);

  tab: 'known' | 'unknown' = 'known';
  // Signals, not plain fields: this app is zoneless
  // (provideZonelessChangeDetection(), main.ts) — every one of these is
  // written from inside `.subscribe()` callbacks below, which never
  // trigger change detection on their own for a plain field. See
  // AGENTS.md's "Change detection & state" section and
  // pages/signed-in/project/project-page.component.ts (PR #95) for the
  // established pattern.
  public readonly dbServer = signal<IDbServer | undefined>(undefined);
  public readonly dbServerSummary = signal<IDbServerSummary | undefined>(
    undefined,
  );
  public readonly dbServerCatalogs = signal<IDbCatalogSummary[] | undefined>(
    undefined,
  );
  public readonly loadingSummary = signal(true);
  public readonly loadingCatalogs = signal(true);
  public readonly envs = signal<string[] | undefined>(undefined);

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
        this.dbServer.set(dbServer);
      });
    this.projectContextService.current$
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (target) => {
          if (target) {
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
    this.loadingSummary.set(true);
    const dbServer = this.dbServer();
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
          this.loadingSummary.set(false);
          this.dbServerSummary.set(dbServerSummary);
          const envs: string[] = [];
          dbServerSummary.databases?.forEach((db) => {
            db.environments?.forEach((env) => {
              if (!envs.includes(env)) {
                envs.push(env);
              }
            });
          });
          this.envs.set(envs);
          this.removeAddedCatalogs();
        },
        error: (err) => {
          this.loadingSummary.set(false);
          this.errorLogger.logError(err, 'Failed to load DB server summary');
        },
      });
  }

  private loadCatalogs(): void {
    this.loadingCatalogs.set(true);
    const dbServer = this.dbServer();
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
          this.loadingCatalogs.set(false);
          this.dbServerCatalogs.set(catalogs);
          this.removeAddedCatalogs();
        },
        error: (err) => {
          this.loadingCatalogs.set(false);
          this.errorLogger.logError(err, 'Failed to load DB catalogs');
        },
      });
  }

  private removeAddedCatalogs(): void {
    const dbServerSummary = this.dbServerSummary();
    const dbServerCatalogs = this.dbServerCatalogs();
    if (dbServerSummary && dbServerCatalogs) {
      const { databases } = dbServerSummary;
      this.dbServerCatalogs.set(
        dbServerCatalogs.filter(
          (c) => !databases || !databases.some((db) => db.id === c.name),
        ),
      );
    }
  }
}
