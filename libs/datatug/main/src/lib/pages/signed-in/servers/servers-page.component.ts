import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
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
  IonToolbar,
  ModalController,
  NavController,
} from '@ionic/angular';
import { Subject } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';
import {
  ErrorLogger,
  IErrorLogger,
  STORE_ID_GITHUB_COM,
  STORE_TYPE_GITHUB,
} from '@sneat/core';
import {
  equalProjectRef,
  IProjectRef,
  isSharedProjectRef,
} from '../../../core/project-context';
import { AddDbServerComponent } from '../../../db/modals/add-db-serve/add-db-server.component';
import {
  getDbServerId,
  IDbServer,
  IProjDbServerSummary,
} from '../../../models/definition/apis/database';
import { IEnvironmentFull } from '../../../models/definition/environments';
import { tryProjectUrl } from '../../../nav/nav-models';
import { ProjectContextService } from '../../../services/project/project-context.service';
import { ProjectService } from '../../../services/project/project.service';
import { ProjectQueryApiService } from '../../../services/project/project-query-api.service';
import { DatatugServicesProjectModule } from '../../../services/project/datatug-services-project.module';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import { DbServerService } from '../../../services/unsorted/db-server.service';
import { SneatDatatugPageTitleComponent } from '../../../components/page-title/sneat-datatug-page-title.component';
import { EnvironmentService } from '../../../services/unsorted/environment.service';

// Same one-off `isGithubStoreId` idiom `EnvironmentService`,
// `DbServerService` and `EnvironmentsPageComponent` each already define for
// themselves — no shared util exists for it in this codebase yet.
const isGithubStoreId = (storeId: string): boolean =>
  storeId === STORE_ID_GITHUB_COM || storeId === STORE_TYPE_GITHUB;

interface ProjectConnectionSource {
  readonly id?: string;
  readonly dataset?: string;
  readonly storage?: string;
  readonly source?: string;
  readonly readiness?: string;
  readonly query?: string;
  readonly environments?: readonly string[];
}

interface ProjectConnectionCatalog {
  readonly connections?: readonly ProjectConnectionSource[];
}

interface DatasetSources {
  readonly dataset: string;
  readonly sources: readonly ProjectConnectionSource[];
}

@Component({
  selector: 'sneat-datatug-servers',
  templateUrl: './servers-page.component.html',
  styleUrls: ['./servers-page.component.scss'],
  imports: [
    // `ProjectContextService` (injected below) and `DbServerService`
    // (injected below, itself needing `ProjectContextService`/
    // `ProjectService`) were plain `@Injectable()`s provided by
    // `DatatugServicesProjectModule`/`DatatugServicesUnsortedModule`
    // respectively. `ProjectContextService` and `ProjectService` are now
    // `providedIn: 'root'` (nav-context-root-singletons), so only
    // `DbServerService` still needs `DatatugServicesUnsortedModule`; the
    // project-module import is now redundant, left for a follow-up cleanup.
    // Neither was declared here before, so navigating to this page from
    // the project side menu's "Servers" item threw `NG0201: No provider
    // found for ProjectContextService` (confirmed live, S135, 2026-09-10).
    // Same cause as `EnvironmentsPageComponent`/`QueriesPageComponent`'s own
    // documented `DatatugNavContextService` fix (S120 PR #89, S121 Task 17
    // item B.1) — this page doesn't inject `DatatugNavContextService`
    // itself, so it needs this narrower two-module subset, not the full
    // five-module bundle those pages declare.
    //
    // This page's own constructor reads `ProjectContextService.current$`
    // directly (rather than `DatatugNavContextService.currentProject`, the
    // pattern most other side-menu pages use): that stream previously never
    // actually emitted here, because `ProjectContextService` was a plain
    // `@Injectable()` and this page's own lazy-loaded route held a SEPARATE
    // instance from whichever page's `DatatugNavContextService` fed the
    // "real" one (S136, found live before `nav-context-root-singletons`
    // landed). Now that `ProjectContextService` is `providedIn: 'root'`,
    // every page shares the one true instance and this stream resolves
    // correctly again — confirmed live, S136, against the GitHub-store demo
    // project (`getGithubDbServers()`'s own aggregated `sqlite3` result now
    // renders here).
    DatatugServicesProjectModule,
    DatatugServicesUnsortedModule,
    FormsModule,
    SneatDatatugPageTitleComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
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
  protected readonly getDbServerId = getDbServerId;
  private readonly projectContextService = inject(ProjectContextService);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly modalCtrl = inject(ModalController);
  private readonly navCtrl = inject(NavController);
  private readonly dbServerService = inject(DbServerService);
  private readonly environmentService = inject(EnvironmentService);
  private readonly projectService = inject(ProjectService);
  private readonly projectQueries = inject(ProjectQueryApiService);

  protected tab: 'db' | 'web' | 'api' = 'db';

  // A signal, not a plain field: this app is zoneless
  // (provideZonelessChangeDetection(), main.ts) — written from inside
  // `.subscribe()` callbacks below, which never trigger change detection on
  // their own for a plain field. See AGENTS.md's "Change detection & state"
  // section and pages/signed-in/project/project-page.component.ts (PR #95)
  // for the established pattern.
  protected readonly dbServers = signal<IProjDbServerSummary[] | undefined>(
    undefined,
  );
  protected readonly filterText = signal('');
  protected readonly dbServersError = signal<string | undefined>(undefined);
  protected readonly catalogSources = signal<
    readonly ProjectConnectionSource[] | undefined
  >(undefined);
  protected readonly catalogError = signal<string | undefined>(undefined);

  protected readonly visibleDatasetSources = computed(
    (): DatasetSources[] | undefined => {
      const sources = this.catalogSources();
      if (!sources) return undefined;
      const selected = this.selectedEnvironmentIds();
      const environmentFilterAvailable = this.environments() !== undefined;
      const query = this.filterText().trim().toLocaleLowerCase();
      const groups = new Map<string, ProjectConnectionSource[]>();
      for (const source of sources) {
        const dataset = source.dataset?.trim();
        if (!dataset) continue;
        if (
          environmentFilterAvailable &&
          source.environments?.length &&
          !source.environments.some((environment) => selected.has(environment))
        ) {
          continue;
        }
        if (
          query &&
          ![dataset, source.storage, source.readiness, source.id].some(
            (value) => value?.toLocaleLowerCase().includes(query),
          )
        ) {
          continue;
        }
        groups.set(dataset, [...(groups.get(dataset) ?? []), source]);
      }
      return [...groups].map(([dataset, datasetSources]) => ({
        dataset,
        sources: datasetSources,
      }));
    },
  );

  // The project's real environment list (S153: the "Local"/"PROD" checkboxes
  // used to be hard-coded text with no binding at all — they matched neither
  // the demo project's real five environments, `QA`/`UAT`/`dev`/`local`/
  // `prod`, nor anything the component tracked). `undefined` while loading.
  protected readonly environments = signal<IEnvironmentFull[] | undefined>(
    undefined,
  );
  protected readonly environmentsError = signal<string | undefined>(undefined);

  // Which environment ids are currently checked — seeded to "every
  // environment" once `environments` arrives (loadEnvironments() below),
  // matching this page's previous all-checked-by-default look. Drives
  // `filteredDbServers` below.
  protected readonly selectedEnvironmentIds = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  // The list the template actually renders: `dbServers()` narrowed to the
  // environments currently checked. A row whose `environments` breakdown is
  // `undefined` (the live-agent read path — see `IProjDbServerSummary`'s own
  // doc comment) always passes through unfiltered; a row WITH a breakdown is
  // dropped once none of its contributing environments remain checked, and
  // otherwise gets its own `databasesCount` recomputed from only the checked
  // environments. The DB-servers tab badge and the footer "Total:" line both
  // read this same signal's `.length`, so — unlike the hard-coded `2` badge
  // this replaces — they can never disagree with each other or with the
  // rows actually shown (S153, the founder's "numbers mismatch" ruling).
  protected readonly filteredDbServers = computed(
    (): IProjDbServerSummary[] | undefined => {
      const servers = this.dbServers();
      if (!servers) {
        return undefined;
      }
      const selected = this.selectedEnvironmentIds();
      const environmentFilterAvailable = this.environments() !== undefined;
      const query = this.filterText().trim().toLocaleLowerCase();
      return servers
        .map((server) => {
          if (!server.environments || !environmentFilterAvailable) {
            return server;
          }
          const environments = server.environments.filter((e) =>
            selected.has(e.envId),
          );
          return {
            ...server,
            databasesCount: environments.reduce(
              (sum, e) => sum + e.databasesCount,
              0,
            ),
            environments,
          };
        })
        .filter(
          (server) => !server.environments || server.environments.length > 0,
        )
        .filter(
          (server) =>
            !query ||
            [
              server.dbServer.driver,
              this.serverLabel(server.dbServer),
              server.dbServer.port,
            ].some((value) =>
              String(value ?? '')
                .toLocaleLowerCase()
                .includes(query),
            ),
        );
    },
  );

  private readonly destroyed = new Subject<void>();
  private loadEpoch = 0;
  private dbServersRequest = 0;
  private environmentsRequest = 0;
  private catalogRequest = 0;
  // Written from the same `.subscribe()` callback as `dbServers` above.
  // Never read by the template, but kept as a signal too for consistency
  // and so tools/check-zoneless-fields.mjs doesn't need a carve-out for it.
  private readonly target = signal<IProjectRef | undefined>(undefined);
  // A signal, not a plain field mutated in place: `this.isDeletingServer[id]
  // = ...` / `delete this.isDeletingServer[id]` from deleteDbServer()'s
  // `.subscribe()` callback below used to mutate a plain `Record` — a
  // different zoneless-unsafe shape than the "this.field = ..." pattern
  // tools/check-zoneless-fields.mjs originally looked for (in-place
  // mutation, not reassignment of this field), flagged as a follow-up in
  // the S138 report and fixed here (S147) once the detector was extended to
  // also catch this shape. Written via `.update()` with an immutable copy —
  // see `setDeleting()` below.
  private readonly isDeletingServer = signal<Record<string, boolean>>({});

  constructor() {
    this.projectContextService.current$
      .pipe(takeUntil(this.destroyed))
      .subscribe((target) => {
        const previousTarget = this.target();
        if (!equalProjectRef(previousTarget, target)) {
          const epoch = ++this.loadEpoch;
          this.clearLoadedState();
          if (target) {
            this.loadDbServers(target, epoch);
            this.loadEnvironments(target, epoch);
            this.loadCatalogSources(target, epoch);
          }
        }
        this.target.set(target);
      });
  }

  ngOnDestroy() {
    this.loadEpoch++;
    this.destroyed.next();
    this.destroyed.complete();
  }

  /** Toggles one environment's checked state — bound to each checkbox row's
   * `(ionChange)` in the template. Recomputing `filteredDbServers` (and thus
   * the tab badge/footer total/row `databasesCount`) is then automatic: it's
   * a `computed()` over this signal and `dbServers`, not something this
   * method needs to trigger itself. */
  protected toggleEnvironment(envId: string, checked: boolean): void {
    this.selectedEnvironmentIds.update((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(envId);
      } else {
        next.delete(envId);
      }
      return next;
    });
  }

  protected selectAllEnvironments(): void {
    this.selectedEnvironmentIds.set(
      new Set(this.environments()?.map((environment) => environment.id) ?? []),
    );
  }

  protected clearEnvironments(): void {
    this.selectedEnvironmentIds.set(new Set());
  }

  /** The row label for one DB server: its `host` when the project actually
   * declares one, or an explicit placeholder otherwise — never blank. The
   * demo project's `environments/*.env.json` files declare `dbServers`
   * entries with a `driver` and `catalogs` but no `host` at all (sqlite3 is
   * file-based, not network-addressed), which is exactly the blank row the
   * founder's ruling flagged ("no server name shown in the row") — the
   * adjacent driver badge (see the template) already names the driver, so
   * this only needs to say plainly that there's no host, not repeat it. */
  protected serverLabel(dbServer: IDbServer): string {
    return dbServer.host?.trim() || dbServer.path?.trim() || '(no host)';
  }

  protected serverIdentity(dbServer: IDbServer): string {
    return serverKey(dbServer);
  }

  protected canOpenDbServer(dbServer: IDbServer): boolean {
    return !dbServer.path?.trim();
  }

  protected sourceFormat(source: ProjectConnectionSource): string {
    switch (source.storage) {
      case 'sqlite':
        return 'SQLite';
      case 'postgresql':
        return 'PostgreSQL';
      case 'ingitdb':
        return 'inGitDB';
      default:
        return source.storage || 'Unknown format';
    }
  }

  protected sourceAccess(source: ProjectConnectionSource): string {
    if (source.readiness === 'public-api') return 'Public API declared';
    if (
      source.readiness === 'hosted-repository' &&
      source.query === 'local-checkout-required'
    )
      return 'Hosted repository declared · local checkout required';
    if (source.readiness === 'hosted-repository')
      return 'Hosted repository declared';
    return source.readiness || 'Setup required';
  }

  protected retryDbServers(): void {
    const target = this.target();
    if (target) this.loadDbServers(target, this.loadEpoch);
  }

  protected retryCatalogSources(): void {
    const target = this.target();
    if (target) this.loadCatalogSources(target, this.loadEpoch);
  }

  protected retryEnvironments(): void {
    const target = this.target();
    if (target) this.loadEnvironments(target, this.loadEpoch);
  }

  /**
   * S160 (NG04002, 100% reproducible on every store/project — founder
   * report, 2026-09-10): this used to build `['project', '.@' +
   * this.target()?.storeId, 'servers', 'db', driver, host]` — an ABSOLUTE
   * array starting at a bare `'project'` segment with no `store/:storeId`
   * prefix at all, and a `host` segment left blank (`NaN`-producing) for
   * any host-less server. The real route lives at `/store/:storeId/
   * project/:projectId/servers/db/:dbDriver/:dbServerId`
   * (`datatug-routing-proj.ts`'s `'servers'` entry, now `loadChildren` into
   * `ServersPageRoutingModule`) — same `store/<id>/project/<id>/...` shape
   * every other project sub-page link uses (`projectUrl()`,
   * `nav/nav-models.ts`; c.f. `DatatugNavService.projectPageUrl()`/
   * `goCatalog()`; a GitHub project is at its short address). `getDbServerId()` (database.ts) supplies the
   * `:dbServerId` segment, including the host-less placeholder.
   */
  goDbServer(dbServer: IProjDbServerSummary): void {
    const target = this.target();
    if (!target) {
      return;
    }
    if (!this.canOpenDbServer(dbServer.dbServer)) {
      return;
    }
    const url = tryProjectUrl(target, [
      'servers',
      'db',
      dbServer.dbServer.driver,
      getDbServerId(dbServer.dbServer),
    ]);
    if (typeof url !== 'string') {
      this.errorLogger.logError(
        new Error(`no exact address for the project (${url.reason})`),
        'Failed to navigate to DB server page',
      );
      return;
    }
    this.navCtrl
      .navigateForward(url)
      .catch((err) =>
        this.errorLogger.logError(err, 'Failed to navigate to DB server page'),
      );
  }

  deleteDbServer(event: Event, dbServer: IProjDbServerSummary): void {
    event.preventDefault();
    event.stopPropagation();
    const id = serverId(dbServer.dbServer);
    this.setDeleting(id, true);
    this.dbServerService.deleteDbServer(dbServer.dbServer).subscribe({
      next: () => {
        this.dbServers.set(this.dbServers()?.filter((s) => s !== dbServer));
        this.setDeleting(id, false);
      },
      error: (err) => {
        this.setDeleting(id, false);
        this.errorLogger.logError(
          err,
          'Failed to remove DB server from project',
        );
      },
    });
  }

  public isDeleting(dbServer: IDbServer): boolean {
    return this.isDeletingServer()[serverId(dbServer)] ?? false;
  }

  /** Immutable `isDeletingServer` update: `true` marks `id` as deleting,
   * `false` removes it from the map (rather than storing `false`) so the map
   * doesn't grow unboundedly across the page's lifetime. */
  private setDeleting(id: string, deleting: boolean): void {
    this.isDeletingServer.update((byId) => {
      if (deleting) {
        return { ...byId, [id]: true };
      }
      if (!(id in byId)) {
        return byId;
      }
      const next = { ...byId };
      delete next[id];
      return next;
    });
  }

  addDbServer() {
    this.modalCtrl
      .create({ component: AddDbServerComponent })
      .then((modal) => {
        modal.onDidDismiss().then((result) => {
          const projDbServerSummary = result.data as IProjDbServerSummary;
          const dbServers = this.dbServers();
          // Matches the pre-signal behaviour: if the list hasn't loaded yet,
          // this silently no-ops (same as the old `this.dbServers?.push()`).
          if (dbServers) {
            this.dbServers.set([...dbServers, projDbServerSummary]);
          }
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

  private loadDbServers(target: IProjectRef, epoch: number): void {
    const request = ++this.dbServersRequest;
    this.dbServers.set(undefined);
    this.dbServersError.set(undefined);
    this.dbServerService
      .getDbServers(target)
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (dbServers) => {
          if (epoch !== this.loadEpoch || request !== this.dbServersRequest)
            return;
          this.dbServers.set(dbServers || []);
        },
        error: (err) => {
          if (epoch !== this.loadEpoch || request !== this.dbServersRequest)
            return;
          this.dbServers.set(undefined);
          this.dbServersError.set('Database servers could not be loaded.');
          this.errorLogger.logError(err, 'Failed to load list of DB servers');
        },
      });
  }

  /** Same GitHub-vs-agent split `EnvironmentsPageComponent` already uses
   * (pages/signed-in/environments) — reused here rather than reimplemented,
   * since it already knows how to read each store's real environment list
   * (`EnvironmentService.listEnvironments()` for GitHub, `ProjectService`'s
   * own `getFull()` for a live agent). Every environment starts checked,
   * matching this page's previous (hard-coded) all-checked look. */
  private loadEnvironments(target: IProjectRef, epoch: number): void {
    const request = ++this.environmentsRequest;
    this.environments.set(undefined);
    this.environmentsError.set(undefined);
    const environments$ = isGithubStoreId(target.storeId)
      ? this.environmentService.listEnvironments(target.projectId)
      : this.projectService
          .getFull(target)
          .pipe(map((full) => full.environments || []));
    environments$.pipe(takeUntil(this.destroyed)).subscribe({
      next: (environments) => {
        if (epoch !== this.loadEpoch || request !== this.environmentsRequest)
          return;
        this.environments.set(environments);
        this.selectedEnvironmentIds.set(new Set(environments.map((e) => e.id)));
      },
      error: (err) => {
        if (epoch !== this.loadEpoch || request !== this.environmentsRequest)
          return;
        this.environments.set(undefined);
        this.environmentsError.set('Environments could not be loaded.');
        this.errorLogger.logError(err, 'Failed to load project environments');
      },
    });
  }

  private loadCatalogSources(target: IProjectRef, epoch: number): void {
    const request = ++this.catalogRequest;
    this.catalogSources.set(undefined);
    this.catalogError.set(undefined);
    if (isSharedProjectRef(target)) {
      this.catalogSources.set([]);
      this.catalogError.set(
        'Connection catalog discovery is unavailable for shared projects.',
      );
      return;
    }
    this.projectQueries
      .connectionCatalog<ProjectConnectionCatalog>(target)
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (catalog) => {
          if (epoch !== this.loadEpoch || request !== this.catalogRequest)
            return;
          this.catalogSources.set(catalog?.connections ?? []);
        },
        error: () => {
          if (epoch !== this.loadEpoch || request !== this.catalogRequest)
            return;
          this.catalogSources.set([]);
          this.catalogError.set(
            'The project connection catalog could not be loaded.',
          );
        },
      });
  }

  private clearLoadedState(): void {
    this.dbServers.set(undefined);
    this.dbServersError.set(undefined);
    this.environments.set(undefined);
    this.environmentsError.set(undefined);
    this.selectedEnvironmentIds.set(new Set());
    this.catalogSources.set(undefined);
    this.catalogError.set(undefined);
  }
}

const serverId = (dbServer: IDbServer): string => serverKey(dbServer);

const serverKey = (dbServer: IDbServer): string =>
  [
    dbServer.driver,
    dbServer.host,
    dbServer.port ?? '',
    dbServer.path ?? '',
  ].join('/');
