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
  IonToolbar,
} from '@ionic/angular';
import { map, takeUntil } from 'rxjs/operators';
import { combineLatest, Subject } from 'rxjs';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import {
  DbServerService,
  GITHUB_DBSERVER_DETAIL_MESSAGE,
} from '../../../services/unsorted/db-server.service';
import { ProjectContextService } from '../../../services/project/project-context.service';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import {
  IDbServer,
  IDbServerSummary,
  IDbCatalogSummary,
  getDbServerFromId,
} from '../../../models/definition/apis/database';
import { SneatDatatugPageTitleComponent } from '../../../components/page-title/sneat-datatug-page-title.component';

@Component({
  selector: 'sneat-datatug-dbserver',
  templateUrl: './dbserver-page.component.html',
  imports: [
    // `DbServerService` (injected below) is a plain `@Injectable()`,
    // provided by `DatatugServicesUnsortedModule` — its own dependencies
    // (`HttpClient`, `ProjectContextService`, `ProjectService`,
    // `GithubProjectReaderService`) are all `providedIn: 'root'`
    // (nav-context-root-singletons) and need no module here.
    // `servers/db/:dbDriver/:dbServerId` (this page's own bare route,
    // `datatug-routing-proj.ts`) had no ancestor route or module supplying
    // `DbServerService`, so clicking a server from the Servers list threw
    // `NG0201` (confirmed live, S136) — same fix, same cause, as
    // `EntitiesPageComponent`'s own identical doc comment.
    DatatugServicesUnsortedModule,
    SneatDatatugPageTitleComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonMenuButton,
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
  // Set instead of calling `errorLogger.logError()` when a GitHub-store
  // project's read-only limitation (`GITHUB_DBSERVER_DETAIL_MESSAGE`) is
  // the reason a card has no data — an expected, not-a-bug outcome that
  // gets its own friendly notice in both cards rather than an error toast.
  public readonly readOnlyNotice = signal<string | undefined>(undefined);

  private readonly destroyed = new Subject<void>();

  constructor() {
    const dbServer$ = this.route.paramMap.pipe(
      map((q) => {
        const id = q.get('dbServerId');
        const driver = q.get('dbDriver');
        return driver && id ? getDbServerFromId(driver, id) : undefined;
      }),
    );
    // `route.paramMap` and `projectContextService.current$` used to be two
    // independent subscriptions (S161): `loadData()` ran off `current$`
    // alone and read `this.dbServer()`'s value at that moment. Whichever of
    // the two streams happened to deliver first decided the outcome — when
    // `current$` (a `BehaviorSubject`, replaying synchronously on
    // subscribe) already held the project and fired before `paramMap` had
    // produced a value, `loadData()` ran with `dbServer` still `undefined`,
    // so `loadSummary()`/`loadCatalogs()`'s own `if (!dbServer) return;`
    // guard exited silently — no HTTP call, no `.subscribe()` error
    // callback, `loadingSummary`/`loadingCatalogs` left at their initial
    // `true` forever, and nothing ever re-ran `loadData()` once `dbServer`
    // did arrive. Reproduced with a red test (paramMap as an unfed
    // `Subject`, `current$` pre-resolved) in this component's own spec.
    // `combineLatest` removes the ordering dependency entirely: `loadData()`
    // now runs only once BOTH values are known, and reruns whenever either
    // changes afterwards.
    combineLatest([dbServer$, this.projectContextService.current$])
      .pipe(takeUntil(this.destroyed))
      .subscribe(([dbServer, target]) => {
        this.dbServer.set(dbServer);
        if (dbServer && target) {
          this.loadData();
        }
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
          this.readOnlyNotice.set(undefined);
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
          if (isGithubReadOnlyError(err)) {
            this.readOnlyNotice.set(GITHUB_DBSERVER_DETAIL_MESSAGE);
            return;
          }
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
          this.readOnlyNotice.set(undefined);
          this.dbServerCatalogs.set(catalogs);
          this.removeAddedCatalogs();
        },
        error: (err) => {
          this.loadingCatalogs.set(false);
          if (isGithubReadOnlyError(err)) {
            this.readOnlyNotice.set(GITHUB_DBSERVER_DETAIL_MESSAGE);
            return;
          }
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

/**
 * `DbServerService.getDbServerSummary()`/`getServerDatabases()` reject with
 * exactly `new Error(GITHUB_DBSERVER_DETAIL_MESSAGE)` for a GitHub-store
 * project (own doc comment, `db-server.service.ts`) — an expected, not-a-bug
 * outcome that gets its own friendly card notice instead of an
 * `ErrorLogger.logError()` toast.
 */
function isGithubReadOnlyError(err: unknown): boolean {
  return err instanceof Error && err.message === GITHUB_DBSERVER_DETAIL_MESSAGE;
}
