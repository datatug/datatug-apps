import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonLabel,
  IonSegment,
  IonSegmentButton,
} from '@ionic/angular';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IProjEnv } from '../../../../models/definition/project';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';

export interface IEnv {
  readonly id: string;
  readonly title?: string;
}

@Component({
  selector: 'sneat-datatug-env-selector',
  templateUrl: './env-selector.component.html',
  imports: [IonSegment, FormsModule, IonSegmentButton, IonLabel],
})
export class EnvSelectorComponent {
  private readonly dataTugNavContext = inject(DatatugNavContextService);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);

  // Signals, not plain fields: this app is zoneless
  // (provideZonelessChangeDetection(), main.ts) — both are written from
  // inside `.subscribe()` callbacks below, which never trigger change
  // detection on their own for a plain field. See AGENTS.md's "Change
  // detection & state" section and
  // pages/signed-in/project/project-page.component.ts (PR #95) for the
  // established pattern.
  public readonly currentEnvId = signal<string | undefined>(undefined);

  public readonly environments = signal<IProjEnv[] | undefined>(undefined);

  constructor() {
    const dataTugNavContext = this.dataTugNavContext;

    dataTugNavContext.currentProject.subscribe((currentProject) => {
      if (currentProject?.summary?.environments) {
        this.environments.set(currentProject.summary.environments);
      }
    });
    dataTugNavContext.currentEnv.subscribe({
      next: (currentEnv) => {
        this.currentEnvId.set(currentEnv?.id);
      },
      error: (err: unknown) =>
        this.errorLogger.logError(
          err,
          'Failed to get current environment by EnvSelectorComponent',
        ),
    });
  }

  public envChanged(): void {
    this.dataTugNavContext.setCurrentEnvironment(this.currentEnvId());
  }
}
