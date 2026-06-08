import { Component, Input, inject } from '@angular/core';
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
} from '@ionic/angular/standalone';
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

  @Input() project?: IProjectContext;
  @Input() currentEnvId?: string;

  public clearEnv(): void {
    // Called from template
    try {
      this.datatugNavContextService.setCurrentEnvironment(undefined);
      if (this.project?.ref && this.project?.summary?.id) {
        this.nav.goProject(this.project);
      }
    } catch (e: unknown) {
      this.errorLogger.logError(e, 'Failed to clear environment');
    }
  }

  switchEnv(event: CustomEvent): void {
    try {
      const envId = event.detail.value as string;
      if (envId !== this.currentEnvId) {
        this.datatugNavContextService.setCurrentEnvironment(envId);
        if (this.project?.ref) {
          this.nav.goEnvironment(this.project, undefined, envId);
        }
      }
    } catch (e: unknown) {
      this.errorLogger.logError(e, 'Failed to handle environment switch');
    }
  }
}
