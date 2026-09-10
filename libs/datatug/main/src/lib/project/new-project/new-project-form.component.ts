import { Component, ViewChild, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  PopoverController,
  ViewDidEnter,
  IonButton,
  IonButtons,
  IonFooter,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IProjectContext, parseDatatugStoreRef } from '../../nav/nav-models';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { DatatugServicesProjectModule } from '../../services/project/datatug-services-project.module';
import { ProjectService } from '../../services/project/project.service';

@Component({
  selector: 'sneat-datatug-new-project-form',
  templateUrl: 'new-project-form.component.html',
  imports: [
    FormsModule,
    DatatugServicesProjectModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonItem,
    IonLabel,
    IonSelect,
    IonSelectOption,
    IonItemDivider,
    IonInput,
    IonFooter,
  ],
})
export class NewProjectFormComponent implements ViewDidEnter {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly projectService = inject(ProjectService);
  private readonly popoverController = inject(PopoverController);
  private readonly nav = inject(DatatugNavService);

  store = 'cloud';
  title = '';

  // A signal, not a plain field: this app is zoneless
  // (provideZonelessChangeDetection(), main.ts) — the error branch in
  // create() below writes this from inside a `.subscribe()` callback, which
  // never triggers change detection on its own for a plain field. See
  // AGENTS.md's "Change detection & state" section and
  // pages/signed-in/project/project-page.component.ts (PR #95) for the
  // established pattern.
  protected readonly isCreating = signal(false);

  readonly onCancel = input<() => void>();

  @ViewChild(IonInput, { static: false }) titleInput?: IonInput;

  ionViewDidEnter(): void {
    setTimeout(() => {
      this.titleInput?.setFocus().catch(console.error);
    }, 100);
  }

  cancel(): void {
    const onCancel = this.onCancel();
    if (onCancel) {
      onCancel();
    }
  }

  create(): void {
    this.isCreating.set(true);
    const storeId = 'firestore';
    this.projectService
      .createNewProject(storeId, { title: this.title, userIDs: [] })
      .subscribe({
        next: (projectId) => {
          console.log('New project ID: ' + projectId);
          this.popoverController
            .dismiss()
            .catch(
              this.errorLogger.logErrorHandler(
                'failed to close popover with new project form',
              ),
            );
          const projectContext: IProjectContext = {
            ref: { projectId, storeId },
            store: { ref: parseDatatugStoreRef(storeId) },
          };
          this.nav.goProject(projectContext);
        },
        error: (err) => {
          this.errorLogger.logError(err, 'Failed to create a new project');
          this.isCreating.set(false);
        },
      });
  }
}
