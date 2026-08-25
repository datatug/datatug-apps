import { Component, inject, input } from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonIcon,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonText,
  PopoverController,
} from '@ionic/angular';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IProjectContext } from '../nav/nav-models';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../services/nav/datatug-nav.service';

@Component({
  selector: 'sneat-datatug-menu-env-selector',
  templateUrl: 'menu-env-selector.component.html',
  imports: [
    IonItem,
    IonButtons,
    IonButton,
    IonIcon,
    IonLabel,
    IonBadge,
    IonText,
    IonSelect,
    IonSelectOption,
  ],
})
export class MenuEnvSelectorComponent {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly popoverController = inject(PopoverController);
  private readonly nav = inject(DatatugNavService);
  private readonly datatugNavContextService = inject(DatatugNavContextService);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly project = input<IProjectContext>();
  readonly currentEnvId = input<string>();

  public clearEnv(): void {
    // Called from template
    try {
      this.datatugNavContextService.setCurrentEnvironment(undefined);
      const project = this.project();
      if (project?.ref && project?.summary?.id) {
        this.nav.goProject(project);
      }
    } catch (e: unknown) {
      this.errorLogger.logError(e, 'Failed to clear environment');
    }
  }

  switchEnv(event: CustomEvent): void {
    try {
      const envId = event.detail.value as string;
      if (envId !== this.currentEnvId()) {
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
