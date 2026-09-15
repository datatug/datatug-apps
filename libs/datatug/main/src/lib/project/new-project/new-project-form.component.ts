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
import { STORE_ID_GITHUB_COM } from '@sneat/core';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IProjectContext, parseDatatugStoreRef } from '../../nav/nav-models';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { DatatugServicesProjectModule } from '../../services/project/datatug-services-project.module';
import { ProjectService } from '../../services/project/project.service';
import {
  DEFAULT_GITHUB_PROJECT_FOLDER,
  GithubProjectCreateService,
  parseGithubRepo,
} from '../../services/repo/github/github-project-create.service';

/** Stores the new-project dialog can create a project in. */
type NewProjectStore = 'cloud' | 'github';

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
  private readonly githubProjectCreateService = inject(
    GithubProjectCreateService,
  );
  private readonly popoverController = inject(PopoverController);
  private readonly nav = inject(DatatugNavService);

  // `store`, `title`, `githubRepo` and `githubFolder` are written only by
  // template events (`[(ngModel)]`), which is zoneless-safe on its own (see
  // AGENTS.md's "Change detection & state", rule 4) — no signal needed.
  store: NewProjectStore = 'cloud';
  title = '';
  /** `owner/name` of the GitHub repository, used when `store === 'github'`. */
  githubRepo = '';
  /** Repo-relative folder for the project; defaults to `datatug`. */
  githubFolder = DEFAULT_GITHUB_PROJECT_FOLDER;

  // A signal, not a plain field: this app is zoneless
  // (provideZonelessChangeDetection(), main.ts) — the error branch in
  // create() below writes this from inside a `.subscribe()` callback, which
  // never triggers change detection on its own for a plain field. See
  // AGENTS.md's "Change detection & state" section and
  // pages/signed-in/project/project-page.component.ts (PR #95) for the
  // established pattern.
  protected readonly isCreating = signal(false);

  /** Validation message for input the user has to fix before we call out. */
  protected readonly formError = signal<string | undefined>(undefined);

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
    this.formError.set(undefined);
    if (this.store === 'github') {
      this.createInGithubRepo();
      return;
    }
    this.createInCloud();
  }

  private createInCloud(): void {
    this.isCreating.set(true);
    const storeId = 'firestore';
    this.projectService
      .createNewProject(storeId, { title: this.title, userIDs: [] })
      .subscribe({
        next: (projectId) => {
          this.dismissAndGo({ projectId, storeId });
        },
        error: (err) => {
          this.errorLogger.logError(err, 'Failed to create a new project');
          this.isCreating.set(false);
        },
      });
  }

  private createInGithubRepo(): void {
    const repo = parseGithubRepo(this.githubRepo);
    if (!repo) {
      this.formError.set(
        'Enter the GitHub repository as owner/name, e.g. datatug/demo-projects',
      );
      return;
    }
    this.isCreating.set(true);
    this.githubProjectCreateService
      .createProject({
        org: repo.org,
        repo: repo.repo,
        folder: this.githubFolder,
        title: this.title,
      })
      .subscribe({
        next: (project) => {
          // The app's GitHub reader addresses a project as `repo@org@folder`.
          this.dismissAndGo({
            projectId: `${project.repo}@${project.org}@${project.folder}`,
            storeId: STORE_ID_GITHUB_COM,
          });
        },
        error: (err) => {
          this.errorLogger.logError(
            err,
            'Failed to create a project in the GitHub repo',
          );
          this.isCreating.set(false);
        },
      });
  }

  private dismissAndGo(ref: {
    projectId: string;
    storeId: string;
  }): void {
    this.popoverController
      .dismiss()
      .catch(
        this.errorLogger.logErrorHandler(
          'failed to close popover with new project form',
        ),
      );
    const projectContext: IProjectContext = {
      ref,
      store: { ref: parseDatatugStoreRef(ref.storeId) },
    };
    this.nav.goProject(projectContext);
  }
}
