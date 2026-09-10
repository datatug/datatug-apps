import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonBackButton,
  IonButtons,
  IonCard,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonMenuButton,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { SneatCardListComponent } from '@sneat/components';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { DatatugCoreModule } from '../../../core/datatug-core.module';
import { IEnvironmentFull } from '../../../models/definition/environments';
import { IProjectSummary, IProjEnv } from '../../../models/definition/project';
import { IProjectContext } from '../../../nav/nav-models';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { ProjectService } from '../../../services/project/project.service';
import { DatatugServicesProjectModule } from '../../../services/project/datatug-services-project.module';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';

@Component({
  selector: 'sneat-datatug-environments',
  templateUrl: './environments-page.component.html',
  imports: [
    // `DatatugNavContextService` (injected below) is a plain `@Injectable()`,
    // provided by `DatatugServicesNavModule`, whose own constructor needs
    // `AppContextService` (`DatatugCoreModule`), `ProjectContextService`/
    // `ProjectService` (`DatatugServicesProjectModule`) and
    // `EnvironmentService` (`DatatugServicesUnsortedModule`, itself needing
    // `StoreApiService` from `DatatugServicesStoreModule`) — none of which
    // this page declared, so reaching it via the project page's "Go to..." ->
    // Environments select (Task 17 item B.1, S121) threw `NG0201: No
    // provider found for DatatugNavContextService` (confirmed live). Same
    // fix, same cause, as `QueriesPageComponent` (S120, PR #89) — mirrors
    // the exact module set `env-db-table.page.ts` already declares for the
    // identical transitive chain.
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesProjectModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    FormsModule,
    SneatCardListComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonTitle,
    IonContent,
    IonCard,
    IonItem,
    IonLabel,
    IonInput,
  ],
})
export class EnvironmentsPageComponent {
  readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly datatugNavService = inject(DatatugNavService);
  private readonly projectService = inject(ProjectService);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  // Zoneless (see queries-tab.component.ts's own `changeDetectorRef` doc
  // comment for the class of gap this closes): `project`/`environments`
  // below are plain fields, both mutated from RxJS `.subscribe()` callbacks.
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  protected project?: IProjectSummary;
  private projectContext?: IProjectContext;

  // Populated from GET /projects/project_full (this.projectService.getFull()
  // below), NOT `project?.environments` (Task 17 item B.1, S121): confirmed
  // live that datatug-core v0.27.3's own `datatug.ProjectSummary` struct —
  // what GET /projects/project_summary actually serves, the source of
  // `this.project` above — has no `Environments` field at all (its embedded
  // `ProjectFile.Environments` is commented out, and `ProjectSummary` only
  // re-adds `Entities` on top, not `Environments`; verified against
  // datatug-core@v0.27.3's project.go). `IProjectSummary.environments`'s own
  // TS type declares the field, but the server can never populate it — a
  // real gap, not a client bug, and out of scope to fix in datatug-core (no
  // datatug-core changes in this task). `project_full` already carries a
  // real, populated `environments` array (verified live: `local` ->
  // `chinook-local`, matching this task's own fixture), the same source
  // `EnvDbPageComponent`/`EnvironmentPageComponent` already fetch through —
  // so this page reads from there instead. This was the reason neither of
  // this page's two entry points (project page's own ENVIRONMENTS segment
  // tab, and the "Go to..." -> Environments select this task's own B.1 item
  // added) ever listed an environment: both mount this same routed
  // component (datatug-routing-proj.ts), and both fed it exclusively from
  // `project?.environments`, always empty.
  protected environments?: IEnvironmentFull[];

  constructor() {
    this.datatugNavContextService.currentProject.subscribe({
      next: (value) => {
        if (value) {
          this.projectContext = value;
          this.project = value.summary;
          this.loadEnvironments(value.ref);
          this.changeDetectorRef.markForCheck();
        }
      },
      error: (err) =>
        this.errorLogger.logError(err, 'failed to retrieve current page', {
          show: false,
        }),
    });
  }

  private loadEnvironments(ref: IProjectContext['ref']): void {
    if (this.environments) {
      return;
    }
    this.projectService.getFull(ref).subscribe({
      next: (full) => {
        this.environments = full.environments || [];
        this.changeDetectorRef.markForCheck();
      },
      error: (err) =>
        this.errorLogger.logError(err, 'Failed to load project environments'),
    });
  }

  // goEnvironment: wires `sneat-card-list`'s (itemClick) — Task 17 item B.1
  // (S121). Nothing bound this before: clicking an environment card was a
  // silent no-op (`itemClick` is an `EventEmitter` `SneatCardListComponent`
  // already fires on every card click; this template just never listened).
  protected goEnvironment(item: unknown): void {
    if (!this.projectContext) {
      this.errorLogger.logError(
        new Error('No current project context'),
        'Failed to navigate to environment page',
      );
      return;
    }
    this.datatugNavService.goEnvironment(
      this.projectContext,
      item as IProjEnv,
    );
  }
}
