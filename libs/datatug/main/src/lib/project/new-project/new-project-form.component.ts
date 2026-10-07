import {
  Component,
  ViewChild,
  inject,
  input,
  signal,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  IonToolbar,
} from '@ionic/angular';
import { SneatUserService } from '@sneat/auth-core';
import { readNewProjectFolder } from '@datatug/project-address';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IProjectContext, parseDatatugStoreRef } from '../../nav/nav-models';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { DatatugServicesProjectModule } from '../../services/project/datatug-services-project.module';
import { ProjectService } from '../../services/project/project.service';
import {
  GithubConnectionService,
  type ConnectedGithubRepository,
} from '../../services/repo/github/github-connection.service';
import {
  ProjectQueryApiService,
  type CreateGithubProject,
} from '../../services/project/project-query-api.service';

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
    IonSpinner,
    IonFooter,
  ],
})
export class NewProjectFormComponent implements ViewDidEnter, OnInit {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly projectService = inject(ProjectService);
  private readonly connection = inject(GithubConnectionService);
  private readonly queryApi = inject(ProjectQueryApiService);
  private readonly userService = inject(SneatUserService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly popoverController = inject(PopoverController);
  private readonly nav = inject(DatatugNavService);
  store: 'cloud' | 'github' = 'cloud';
  title = '';
  githubFolder = 'datatug';
  readonly spaceID = signal('');
  readonly branch = signal('');
  protected readonly isCreating = signal(false);
  protected readonly formError = signal<string | undefined>(undefined);
  protected readonly isGithubSignedIn = signal(false);
  protected readonly isConnecting = signal(false);
  protected readonly isLoadingRepos = signal(false);
  protected readonly githubRepos = signal<readonly ConnectedGithubRepository[]>(
    [],
  );
  protected readonly selectedRepo = signal<number | undefined>(undefined);
  protected readonly spaces = signal<readonly { id: string; title: string }[]>(
    [],
  );
  protected readonly branches = signal<
    readonly { name: string; head: string }[]
  >([]);
  private selectionGeneration = 0;
  private readonly userID = signal<string | undefined>(undefined);
  private readonly pendingCreate = signal<
    { payload: string; request: CreateGithubProject } | undefined
  >(undefined);
  readonly onCancel = input<() => void>();
  @ViewChild(IonInput, { static: false }) titleInput?: IonInput;

  constructor() {
    this.userService.userState
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        this.spaces.set(
          Object.entries(state.record?.spaces ?? {}).map(([id, space]) => ({
            id,
            title: space.title,
          })),
        );
        if (!this.spaces().some((space) => space.id === this.spaceID()))
          this.spaceID.set('');
        const uid = state.user?.uid;
        if (uid !== this.userID()) {
          this.userID.set(uid);
          this.selectionGeneration++;
          this.githubRepos.set([]);
          this.selectedRepo.set(undefined);
          this.branches.set([]);
          this.branch.set('');
          this.pendingCreate.set(undefined);
          this.isCreating.set(false);
          if (this.store === 'github') this.loadGithubRepos();
        }
      });
  }
  ngOnInit(): void {
    if (this.store === 'github') this.loadGithubRepos();
  }
  ionViewDidEnter(): void {
    setTimeout(
      () => void this.titleInput?.setFocus().catch(() => undefined),
      100,
    );
  }
  cancel(): void {
    this.onCancel()?.();
  }
  storeChanged(): void {
    if (this.store === 'github') this.loadGithubRepos();
  }

  signInToGithub(): void {
    this.formError.set(undefined);
    this.isConnecting.set(true);
    this.connection.start().subscribe({
      next: (result) => {
        try {
          const url = new URL(result.authorizationURL);
          if (
            url.protocol !== 'https:' ||
            url.hostname !== 'github.com' ||
            url.pathname !== '/login/oauth/authorize' ||
            url.username ||
            url.password
          )
            throw new Error();
          window.location.assign(url.href);
        } catch {
          this.isConnecting.set(false);
          this.formError.set(
            'GitHub could not be connected. Please try again.',
          );
        }
      },
      error: () => {
        this.isConnecting.set(false);
        this.formError.set('Sign in to DataTug, then connect GitHub.');
      },
    });
  }
  loadGithubRepos(): void {
    const generation = ++this.selectionGeneration;
    this.isLoadingRepos.set(true);
    this.connection.repositories().subscribe({
      next: (result) => {
        if (generation !== this.selectionGeneration) return;
        this.githubRepos.set(
          result.repositories.filter((repo) => repo.permission === 'write'),
        );
        this.isGithubSignedIn.set(true);
        this.isLoadingRepos.set(false);
      },
      error: () => {
        if (generation !== this.selectionGeneration) return;
        this.githubRepos.set([]);
        this.selectedRepo.set(undefined);
        this.branches.set([]);
        this.isGithubSignedIn.set(false);
        this.isLoadingRepos.set(false);
      },
    });
  }
  repositoryChanged(id: number): void {
    this.selectedRepo.set(id);
    this.branch.set('');
    this.loadBranches();
  }
  loadBranches(): void {
    const generation = ++this.selectionGeneration;
    const repo = this.githubRepos().find(
      (repo) => repo.id === this.selectedRepo(),
    );
    const folder = readNewProjectFolder(this.githubFolder);
    this.branches.set([]);
    this.pendingCreate.set(undefined);
    if (!repo || !folder.ok) {
      this.formError.set('Choose a repository and a valid relative folder.');
      return;
    }
    this.queryApi
      .branches({
        storeId: 'github.com',
        projectId: `${repo.name}@${repo.owner}@${folder.folder}`,
      })
      .subscribe({
        next: (result) => {
          if (generation !== this.selectionGeneration) return;
          this.branches.set(result.branches);
          this.formError.set(undefined);
        },
        error: () => {
          if (generation === this.selectionGeneration)
            this.formError.set(
              'Branches could not be loaded. Check your repository access and retry.',
            );
        },
      });
  }
  create(): void {
    if (this.isCreating()) return;
    this.formError.set(undefined);
    if (this.store !== 'github') {
      this.isCreating.set(true);
      this.projectService
        .createNewProject('firestore', { title: this.title, userIDs: [] })
        .subscribe({
          next: (projectId) =>
            this.dismissAndGo({ projectId, storeId: 'firestore' }),
          error: () => {
            this.isCreating.set(false);
            this.formError.set(
              'The project could not be created. Please try again.',
            );
          },
        });
      return;
    }
    const repo = this.githubRepos().find(
      (repo) => repo.id === this.selectedRepo(),
    );
    const folder = readNewProjectFolder(this.githubFolder);
    const branch = this.branches().find(
      (branch) => branch.name === this.branch(),
    );
    if (
      !repo ||
      !folder.ok ||
      !branch ||
      !this.spaces().some((space) => space.id === this.spaceID()) ||
      !this.title.trim()
    ) {
      this.formError.set(
        'Choose a Space, initialized repository, branch and valid folder, and enter a title.',
      );
      return;
    }
    const fields = {
      title: this.title,
      spaceID: this.spaceID(),
      github: {
        repositoryID: repo.id,
        owner: repo.owner,
        name: repo.name,
        folder: folder.folder,
        branch: branch.name,
        expectedBranchHead: branch.head,
      },
      template: {
        id: 'demo-project-1' as const,
        commit: '51716f3a4d682d5cb7ef70a7fd37f42e5418fd3d' as const,
      },
    };
    const payload = JSON.stringify(fields);
    const pending = this.pendingCreate();
    const request =
      pending?.payload === payload
        ? pending.request
        : { ...fields, operationId: crypto.randomUUID() };
    this.pendingCreate.set({ payload, request });
    const generation = this.selectionGeneration;
    this.isCreating.set(true);
    this.queryApi.create(request).subscribe({
      next: (result) => {
        if (generation !== this.selectionGeneration) return;
        this.pendingCreate.set(undefined);
        this.dismissAndGo({
          storeId: 'github.com',
          projectId: result.project,
          projectApi: 'cloud',
          branch: result.branch,
        });
      },
      error: () => {
        this.isCreating.set(false);
        this.formError.set(
          'Creation was not confirmed. Retry unchanged to recover the same operation; changed inputs start a new operation.',
        );
      },
    });
  }
  private dismissAndGo(ref: IProjectContext['ref']): void {
    void this.popoverController
      .dismiss()
      .catch(
        this.errorLogger.logErrorHandler(
          'Failed to close the new-project dialog',
        ),
      );
    this.nav.goProject({
      ref,
      store: { ref: parseDatatugStoreRef(ref.storeId) },
    });
  }
}
