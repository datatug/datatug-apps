import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
  IonLabel,
  IonList,
  IonMenuButton,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  NavController,
  ToastController,
  ViewDidEnter,
  ViewDidLeave,
} from '@ionic/angular';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IRecord } from '@sneat/data';
import { DatatugCoreModule } from '../../../core/datatug-core.module';
import { IEntity } from '../../../models/definition/metapedia/entity';
import { IProjEntity } from '../../../models/definition/project';
import { IProjectContext } from '../../../nav/nav-models';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { DatatugServicesProjectModule } from '../../../services/project/datatug-services-project.module';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import { EntityService } from '../../../services/unsorted/entity.service';

type Entities = IRecord<IEntity>[];

@Component({
  selector: 'sneat-datatug-entities',
  templateUrl: './entities-page.component.html',
  imports: [
    // `DatatugNavContextService` (injected below) was a plain `@Injectable()`
    // provided by `DatatugServicesNavModule` (it and its whole dependency
    // chain are `providedIn: 'root'` since nav-context-root-singletons),
    // whose own constructor needed
    // `AppContextService` (`DatatugCoreModule`), `ProjectContextService`/
    // `ProjectService` (`DatatugServicesProjectModule`) and
    // `EnvironmentService` (`DatatugServicesUnsortedModule`, itself needing
    // `StoreApiService` from `DatatugServicesStoreModule`) — none of which
    // this page declared, so navigating here from the project side menu's
    // "Entities" item threw `NG0201: No provider found for
    // DatatugNavContextService` (confirmed live, S135, 2026-09-10). Same
    // fix, same cause, as `EnvironmentsPageComponent`/`QueriesPageComponent`
    // (S120 PR #89, S121 Task 17 item B.1) — mirrors the exact module set
    // those pages already declare for the identical transitive chain.
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesProjectModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    FormsModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonTitle,
    IonButton,
    IonIcon,
    IonLabel,
    IonContent,
    IonList,
    IonItem,
    IonBadge,
    IonCard,
    IonInput,
  ],
})
export class EntitiesPageComponent
  implements OnDestroy, ViewDidEnter, ViewDidLeave
{
  private readonly route = inject(ActivatedRoute);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private navCtrl = inject(NavController);
  private readonly datatugNavService = inject(DatatugNavService);
  private readonly navContextService = inject(DatatugNavContextService);
  private readonly entityService = inject(EntityService);
  private readonly toastCtrl = inject(ToastController);

  // Signals, not plain fields: this app is zoneless
  // (provideZonelessChangeDetection(), main.ts) — both are written from
  // inside `.subscribe()` callbacks below, which never trigger change
  // detection on their own for a plain field. See AGENTS.md's "Change
  // detection & state" section and
  // pages/signed-in/project/project-page.component.ts (PR #95) for the
  // established pattern.
  readonly entities = signal<Entities | undefined>(undefined);
  readonly project = signal<IProjectContext | undefined>(undefined);
  private readonly destroyed = new Subject<void>();

  constructor() {
    const navContextService = this.navContextService;

    navContextService.currentProject.pipe(takeUntil(this.destroyed)).subscribe({
      next: (currentProject) => {
        this.project.set(currentProject);
        this.loadEntities();
        // if (currentProject?.brief && !this.entities) {
        // 	if (currentProject?.summary?.entities) {
        // 		this.setEntities([
        // 			...currentProject.summary.entities.map(entity => ({
        // 				id: entity.id,
        // 				data: entity as IEntity,
        // 			}))
        // 		]);
        // 	}
        // 	// this.loadEntities();
        // }
      },
      error: (err) =>
        this.errorLogger.logError(err, 'Failed to get current project context'),
    });
  }

  protected isActiveView = false;

  ionViewDidEnter(): void {
    // console.log('ionViewDidEnter()');
    this.isActiveView = true;
  }

  ionViewDidLeave(): void {
    // console.log('ionViewDidLeave()');
    this.isActiveView = false;
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  entityUrl(entity: IProjEntity): string {
    const project = this.project();
    if (!project?.ref) {
      return undefined as unknown as string; // TODO: fix typing
    }
    return this.datatugNavService.projectPageUrl(
      project.ref,
      'entity',
      entity.id,
    );
  }

  goNewEntity(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.datatugNavService.goProjPage('new-entity', this.project());
  }

  goEntity(entity: IProjEntity): void {
    const project = this.project();
    if (!project?.ref) {
      return;
    }
    this.datatugNavService.goEntity(project, entity);
  }

  deleteEntity(event: Event, entity: IProjEntity): void {
    event?.stopPropagation();
    event?.preventDefault();
    const project = this.project();
    if (!project?.ref) {
      return;
    }
    this.entityService.deleteEntity(project.ref, entity.id).subscribe({
      next: async () => {
        this.entities.set(
          (this.entities() as IProjEntity[]).filter(
            (v) => v.id !== entity.id,
          ),
        );
        const toast = await this.toastCtrl.create({
          position: 'top',
          header: 'Success',
          message: 'Entity deleted',
          duration: 2000,
          buttons: ['OK'],
        });
        await toast.present();
      },
      error: (err) => this.errorLogger.logError(err, 'Failed to delete entity'),
    });
  }

  private loadEntities(): void {
    const project = this.project();
    if (!project) {
      return;
    }
    this.entityService
      .getAllEntities(project.ref)
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (entities) => this.setEntities(entities),
        error: (err) =>
          this.errorLogger.logError(err, 'Failed to load project entities'),
      });
  }

  private setEntities(entities: Entities): void {
    //console.log('entities', [...entities]);
    this.entities.set(entities.toSorted((a, b) => (a.id > b.id ? 1 : -1)));
  }
}
