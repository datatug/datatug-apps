import { equalProjectRef } from '../../../core/project-context';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environmentPresentation } from '../../../models/definition/environment-presentation';
import { FormsModule } from '@angular/forms';
import { of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  switchMap,
  tap,
} from 'rxjs/operators';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonMenuButton,
  IonToolbar,
  IonCard,
  IonList,
  IonItem,
  IonLabel,
  IonIcon,
  IonSkeletonText,
} from '@ionic/angular';
import {
  ErrorLogger,
  IErrorLogger,
  STORE_ID_GITHUB_COM,
  STORE_TYPE_GITHUB,
} from '@sneat/core';
import { DatatugCoreModule } from '../../../core/datatug-core.module';
import { IEnvironmentFull } from '../../../models/definition/environments';
import { IProjEnv } from '../../../models/definition/project';
import { IProjectContext } from '../../../nav/nav-models';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { ProjectService } from '../../../services/project/project.service';
import { DatatugServicesProjectModule } from '../../../services/project/datatug-services-project.module';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { SneatDatatugPageTitleComponent } from '../../../components/page-title/sneat-datatug-page-title.component';

const isGithubStoreId = (storeId: string): boolean =>
  storeId === STORE_ID_GITHUB_COM || storeId === STORE_TYPE_GITHUB;

@Component({
  selector: 'sneat-datatug-environments',
  templateUrl: './environments-page.component.html',
  imports: [
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesProjectModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    FormsModule,
    IonCard,
    IonList,
    IonItem,
    IonLabel,
    IonIcon,
    IonSkeletonText,
    SneatDatatugPageTitleComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonContent,
  ],
})
export class EnvironmentsPageComponent {
  readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly datatugNavService = inject(DatatugNavService);
  private readonly projectService = inject(ProjectService);
  private readonly environmentService = inject(EnvironmentService);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private projectContext?: IProjectContext;

  // GitHub metadata and agent project_full both provide the actual environment list.
  protected readonly environments = signal<IEnvironmentFull[] | undefined>(
    undefined,
  );
  protected readonly presentation = environmentPresentation;
  protected readonly loadError = signal(false);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.datatugNavContextService.currentProject
      .pipe(
        distinctUntilChanged((a, b) => equalProjectRef(a?.ref, b?.ref)),
        tap((value) => {
          this.projectContext = value;
          this.environments.set(undefined);
          this.loadError.set(false);
        }),
        switchMap((value) => {
          if (!value) return of([]);
          const ref = value.ref;
          const environments$ = isGithubStoreId(ref.storeId)
            ? this.environmentService.listEnvironments(ref.projectId)
            : this.projectService
                .getFull(ref)
                .pipe(map((full) => full.environments || []));
          return environments$.pipe(
            catchError((err) => {
              this.loadError.set(true);
              this.errorLogger.logError(
                err,
                'Failed to load project environments',
              );
              return of(undefined);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((environments) => this.environments.set(environments));
  }

  protected goEnvironment(item: unknown): void {
    if (!this.projectContext) {
      this.errorLogger.logError(
        new Error('No current project context'),
        'Failed to navigate to environment page',
      );
      return;
    }
    this.datatugNavService.goEnvironment(this.projectContext, item as IProjEnv);
  }
}
