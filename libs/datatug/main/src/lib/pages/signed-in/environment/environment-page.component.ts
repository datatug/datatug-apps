import { equalProjectRef } from '../../../core/project-context';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  IonBackButton,
  IonButtons,
  IonCard,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonSkeletonText,
  IonToolbar,
} from '@ionic/angular';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  switchMap,
  tap,
} from 'rxjs/operators';
import { IEnvironmentSummary } from '../../../models/definition/environments';
import { environmentPresentation } from '../../../models/definition/environment-presentation';
import { getStoreId, IProjectContext } from '../../../nav/nav-models';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { SneatDatatugPageTitleComponent } from '../../../components/page-title/sneat-datatug-page-title.component';

@Component({
  selector: 'sneat-datatug-environment',
  templateUrl: './environment-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SneatDatatugPageTitleComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonContent,
    IonCard,
    IonList,
    IonItem,
    IonSkeletonText,
    IonLabel,
    IonIcon,
  ],
  styles: [
    `
      ion-label {
        white-space: normal;
        overflow-wrap: anywhere;
      }
      ion-card {
        max-width: 960px;
      }
      .connection-heading {
        font-weight: 600;
      }
    `,
  ],
})
export class EnvironmentPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly envService = inject(EnvironmentService);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly context = inject(DatatugNavContextService);
  private readonly nav = inject(DatatugNavService);
  private readonly destroyRef = inject(DestroyRef);
  readonly project = signal<IProjectContext | undefined>(undefined);
  readonly env = signal<IEnvironmentSummary | undefined>(undefined);
  readonly error = signal(false);
  readonly presentation = computed(() => environmentPresentation(this.env()));
  readonly connections = computed(() =>
    Object.entries(this.env()?.connections || {}),
  );
  private envId?: string;

  get defaultBackUrl(): string {
    const storeId = this.project()?.ref.storeId;
    return `/store/${storeId ? getStoreId(storeId) : 'localhost:8989'}`;
  }

  constructor() {
    combineLatest([this.context.currentProject, this.route.paramMap])
      .pipe(
        map(([project, params]) => ({
          project,
          id: params.get('environmentId') || undefined,
        })),
        distinctUntilChanged(
          (a, b) =>
            a.id === b.id && equalProjectRef(a.project?.ref, b.project?.ref),
        ),
        tap(({ project, id }) => {
          this.project.set(project);
          this.envId = id;
          this.env.set(undefined);
          this.error.set(false);
        }),
        switchMap(({ project, id }) =>
          project && id
            ? this.envService.getEnvSummary(project.ref, id).pipe(
                catchError((err) => {
                  this.error.set(true);
                  this.errorLogger.logError(
                    err,
                    'Failed to load environment summary',
                  );
                  return of(undefined);
                }),
              )
            : of(undefined),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((env) => this.env.set(env));
  }

  goDb(catalogId: string): void {
    const project = this.project();
    if (project && this.envId)
      this.nav.goCatalog(project, this.envId, catalogId);
  }
}
