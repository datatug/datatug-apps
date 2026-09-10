import { Component, OnDestroy, inject, signal } from '@angular/core';
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
import { ProjectContextService } from '../../../services/project/project-context.service';
import { DatatugServicesProjectModule } from '../../../services/project/datatug-services-project.module';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import { DbServerService } from '../../../services/unsorted/db-server.service';

@Component({
  selector: 'sneat-datatug-servers',
  templateUrl: './servers-page.component.html',
  imports: [
    // `ProjectContextService` (injected below) and `DbServerService`
    // (injected below, itself needing `ProjectContextService`/
    // `ProjectService`) are plain `@Injectable()`s provided by
    // `DatatugServicesProjectModule`/`DatatugServicesUnsortedModule`
    // respectively — neither declared here, so navigating to this page from
    // the project side menu's "Servers" item threw `NG0201: No provider
    // found for ProjectContextService` (confirmed live, S135, 2026-09-10).
    // Same cause as `EnvironmentsPageComponent`/`QueriesPageComponent`'s own
    // documented `DatatugNavContextService` fix (S120 PR #89, S121 Task 17
    // item B.1) — this page doesn't inject `DatatugNavContextService`
    // itself, so it needs this narrower two-module subset, not the full
    // five-module bundle those pages declare.
    DatatugServicesProjectModule,
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
  private readonly projectContextService = inject(ProjectContextService);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly modalCtrl = inject(ModalController);
  private readonly navCtrl = inject(NavController);
  private readonly dbServerService = inject(DbServerService);

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

  private readonly destroyed = new Subject<void>();
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
        if (
          target &&
          (previousTarget?.storeId !== target?.storeId ||
            previousTarget?.projectId !== target?.projectId)
        ) {
          this.loadDbServers(target);
        }
        this.target.set(target);
      });
  }

  ngOnDestroy() {
    this.destroyed.next();
  }

  goDbServer(dbServer: IProjDbServerSummary): void {
    this.navCtrl
      .navigateForward([
        'project',
        '.@' + this.target()?.storeId,
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

  private loadDbServers(target: IProjectRef): void {
    this.dbServerService.getDbServers(target).subscribe({
      next: (dbServers) => {
        this.dbServers.set(dbServers || []);
      },
      error: (err) =>
        this.errorLogger.logError(err, 'Failed to load list of DB servers'),
    });
  }
}

const serverId = (dbServer: IDbServer): string =>
  [dbServer.driver, dbServer.host, '' + dbServer.port].join('/');
