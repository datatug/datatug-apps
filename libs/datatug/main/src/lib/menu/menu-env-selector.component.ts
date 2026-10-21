import {
  Component,
  DestroyRef,
  OnChanges,
  SimpleChanges,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonIcon,
  IonItem,
  IonLabel,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonText,
} from '@ionic/angular';
import { IProjectContext } from '../nav/nav-models';
import { IProjEnv } from '../models/definition/project';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../services/nav/datatug-nav.service';
import { EnvironmentService } from '../services/unsorted/environment.service';
import { of, Subject } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

@Component({
  selector: 'sneat-datatug-menu-env-selector',
  templateUrl: 'menu-env-selector.component.html',
  styleUrls: ['menu-selector.component.scss'],
  imports: [
    IonItem,
    IonButtons,
    IonButton,
    IonIcon,
    IonLabel,
    IonNote,
    IonBadge,
    IonText,
    IonSelect,
    IonSelectOption,
  ],
})
export class MenuEnvSelectorComponent implements OnChanges {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly nav = inject(DatatugNavService);
  private readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly environmentService = inject(EnvironmentService);
  private readonly destroyRef = inject(DestroyRef);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly project = input<IProjectContext>();
  readonly currentEnvId = input<string>();
  readonly environments = signal<IProjEnv[]>([]);
  private readonly projectChanges = new Subject<IProjectContext | undefined>();

  constructor() {
    this.projectChanges
      .pipe(
        switchMap((project) => {
          this.environments.set([]);
          if (!project?.ref.projectId) return of([] as IProjEnv[]);
          return this.environmentService.listEnvironments(project.ref).pipe(
            map((environments) =>
              environments.map(({ id, title }) => ({ id, title })),
            ),
            catchError((error: unknown) => {
              this.errorLogger.logError(
                error,
                'Failed to list project environments',
              );
              return of([] as IProjEnv[]);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((environments) => this.environments.set(environments));
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['project']) {
      this.projectChanges.next(this.project());
    }
  }

  public clearEnv(): void {
    // Called from template
    try {
      this.datatugNavContextService.clearCurrentEnvironment();
      const project = this.project();
      if (project?.ref?.projectId) {
        this.nav.goProject(project);
      }
    } catch (e: unknown) {
      this.errorLogger.logError(e, 'Failed to clear environment');
    }
  }

  switchEnv(event: CustomEvent): void {
    try {
      const envId = event.detail.value as string;
      if (
        envId !== this.currentEnvId() &&
        this.environments().some((env) => env.id === envId)
      ) {
        this.datatugNavContextService.setCurrentEnvironment(envId);
        const project = this.project();
        if (project?.ref) {
          this.nav.goEnvironment(project, undefined, envId);
        }
      }
    } catch (e: unknown) {
      this.errorLogger.logError(e, 'Failed to handle environment switch');
    }
  }
}
