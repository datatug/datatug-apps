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
  IonSpinner,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular';
import { STORE_ID_GITHUB_COM } from '@sneat/core';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IProjectContext, parseDatatugStoreRef } from '../../nav/nav-models';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { DatatugServicesProjectModule } from '../../services/project/datatug-services-project.module';
import { ProjectService } from '../../services/project/project.service';
import { IGithubRepo } from '../../services/repo/github/github-api';
import { GithubOAuthService } from '../../services/repo/github/github-oauth.service';
import { GithubReposService } from '../../services/repo/github/github-repos.service';
import {
  DEFAULT_GITHUB_PROJECT_FOLDER,
  GithubProjectCreateService,
} from '../../services/repo/github/github-project-create.service';

/** Stores the new-project dialog can create a project in. */
type NewProjectStore = 'cloud' | 'github';

/** Sentinel the repository select uses for "create a new repository". */
export const NEW_GITHUB_REPO = '__new__';

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
    IonToggle,
    IonSpinner,
    IonFooter,
  ],
})
export class NewProjectFormComponent implements ViewDidEnter {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly projectService = inject(ProjectService);
  private readonly githubOAuth = inject(GithubOAuthService);
  private readonly githubReposService = inject(GithubReposService);
  private readonly githubProjectCreateService = inject(
    GithubProjectCreateService,
  );
  private readonly popoverController = inject(PopoverController);
  private readonly nav = inject(DatatugNavService);

  /** Sentinel value for the "create a new repository" option. */
  protected readonly newRepoValue = NEW_GITHUB_REPO;

  // Written only by template events (`[(ngModel)]`), which is zoneless-safe on
  // its own (AGENTS.md "Change detection & state", rule 4).
  store: NewProjectStore = 'cloud';
  title = '';
  githubFolder = DEFAULT_GITHUB_PROJECT_FOLDER;
  newRepoName = '';
  makeRepoPrivate = false;

  // Signals, not plain fields: everything below is written from promise and
  // observable callbacks (sign-in, repo loading), which never schedule a
  // repaint on their own in this zoneless app.
  protected readonly isCreating = signal(false);
  protected readonly formError = signal<string | undefined>(undefined);
  protected readonly isGithubSignedIn = signal(false);
  protected readonly isConnecting = signal(false);
  protected readonly isLoadingRepos = signal(false);
  protected readonly githubRepos = signal<IGithubRepo[]>([]);
  /** The selected repository's `owner/name`, or {@link newRepoValue}. */
  protected readonly selectedRepo = signal<string>('');

  readonly onCancel = input<() => void>();

  @ViewChild(IonInput, { static: false }) titleInput?: IonInput;

  constructor() {
    this.isGithubSignedIn.set(this.githubOAuth.isSignedIn);
  }

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

  /** True when the user chose to create a new repository rather than pick one. */
  protected isNewRepo(): boolean {
    return this.selectedRepo() === NEW_GITHUB_REPO;
  }

  /**
   * Signs in to GitHub (or links GitHub to the current Sneat account) and loads
   * the repositories the user can push to.
   */
  async signInToGithub(): Promise<void> {
    this.formError.set(undefined);
    this.isConnecting.set(true);
    try {
      await this.githubOAuth.signIn();
      this.isGithubSignedIn.set(true);
      this.isConnecting.set(false);
      this.loadGithubRepos();
    } catch (err) {
      this.isConnecting.set(false);
      const code = (err as { code?: string })?.code;
      this.formError.set(
        code === 'auth/popup-blocked' ||
          code === 'auth/popup-closed-by-user' ||
          code === 'auth/cancelled-popup-request'
          ? 'GitHub sign-in was blocked or closed — allow pop-ups for this site and try again.'
          : 'GitHub sign-in failed. Please try again.',
      );
      this.errorLogger.logError(err, 'Failed to sign in to GitHub');
    }
  }

  /** Loads the repositories the token can push to. */
  loadGithubRepos(): void {
    const token = this.githubOAuth.accessToken;
    if (!token) {
      return;
    }
    this.isLoadingRepos.set(true);
    this.githubReposService.listRepos(token).subscribe({
      next: (repos) => {
        this.githubRepos.set(repos);
        this.isLoadingRepos.set(false);
        if (!this.selectedRepo() && repos.length) {
          this.selectedRepo.set(repos[0].fullName);
        }
      },
      error: (err) => {
        this.isLoadingRepos.set(false);
        this.formError.set('Failed to load your GitHub repositories.');
        this.errorLogger.logError(err, 'Failed to load GitHub repositories');
      },
    });
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
    const token = this.githubOAuth.accessToken;
    if (!token) {
      this.formError.set('Sign in to GitHub first.');
      return;
    }
    const repo = this.selectedRepo();
    if (!repo) {
      this.formError.set('Select a repository, or create a new one.');
      return;
    }
    if (repo === NEW_GITHUB_REPO) {
      const name = this.newRepoName.trim();
      if (!name) {
        this.formError.set('Enter a name for the new repository.');
        return;
      }
      this.isCreating.set(true);
      this.githubReposService
        .createRepo(token, name, this.makeRepoPrivate)
        .subscribe({
          next: (created) => this.commitGithubProject(created.fullName, token),
          error: (err) => {
            this.isCreating.set(false);
            this.formError.set(
              `Failed to create the repository "${name}" on GitHub.`,
            );
            this.errorLogger.logError(err, 'Failed to create a GitHub repo');
          },
        });
      return;
    }
    this.isCreating.set(true);
    this.commitGithubProject(repo, token);
  }

  private commitGithubProject(fullName: string, token: string): void {
    const [org, repo] = fullName.split('/');
    if (!org || !repo) {
      this.isCreating.set(false);
      this.formError.set(`Unexpected repository name: ${fullName}`);
      return;
    }
    this.githubProjectCreateService
      .createProject(
        { org, repo, folder: this.githubFolder, title: this.title },
        token,
      )
      .subscribe({
        next: (project) => {
          // The app's GitHub reader addresses a project as `repo@org@folder`.
          this.dismissAndGo({
            projectId: `${project.repo}@${project.org}@${project.folder}`,
            storeId: STORE_ID_GITHUB_COM,
          });
        },
        error: (err) => {
          this.isCreating.set(false);
          this.formError.set(
            `Failed to create the project in ${fullName}. Check that your GitHub access allows writing to it.`,
          );
          this.errorLogger.logError(
            err,
            'Failed to create a project in the GitHub repo',
          );
        },
      });
  }

  private dismissAndGo(ref: { projectId: string; storeId: string }): void {
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
