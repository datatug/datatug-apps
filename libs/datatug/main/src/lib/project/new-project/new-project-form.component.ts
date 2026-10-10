import {
  Component,
  Injector,
  ViewChild,
  inject,
  signal,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ViewDidEnter,
  IonButton,
  IonButtons,
  IonFooter,
  IonHeader,
  IonIcon,
  IonInput,
  IonContent,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { SpaceService, SpaceServiceModule } from '@sneat/space-services';
import {
  SneatAuthStateService,
  SneatUserService,
  type AuthStatus,
} from '@sneat/auth-core';
import {
  formatGithubProjectApiKey,
  readNewProjectFolder,
} from '@datatug/project-address';
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
  DATATUG_DEMO_PROJECT_TEMPLATE,
  type CreateGithubProject,
} from '../../services/project/project-query-api.service';
import { safeNewProjectReturnUrl } from './new-project.service';

interface NewProjectDraft {
  readonly actorID?: string;
  readonly store: 'cloud' | 'github';
  readonly title: string;
  readonly githubFolder: string;
  readonly spaceID?: string;
  readonly spaceTitle: string;
  readonly repositoryID?: number;
  readonly branch?: string;
}

const NEW_PROJECT_DRAFT_KEY = 'datatug:new-project:draft';

@Component({
  selector: 'sneat-datatug-new-project-form',
  templateUrl: 'new-project-form.component.html',
  imports: [
    FormsModule,
    SpaceServiceModule,
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
    IonContent,
    IonFooter,
  ],
})
export class NewProjectFormComponent implements ViewDidEnter, OnInit {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly projectService = inject(ProjectService);
  private readonly connection = inject(GithubConnectionService);
  private readonly queryApi = inject(ProjectQueryApiService);
  private readonly auth = inject(SneatAuthStateService);
  private readonly userService = inject(SneatUserService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly nav = inject(DatatugNavService);
  readonly store = signal<'cloud' | 'github'>('cloud');
  readonly title = signal('');
  readonly githubFolder = signal('datatug');
  readonly spaceID = signal('');
  readonly spaceTitle = signal('');
  readonly isCreatingSpace = signal(false);
  readonly branch = signal('');
  protected readonly isCreating = signal(false);
  protected readonly formError = signal<string | undefined>(undefined);
  protected readonly githubReposError = signal<string | undefined>(undefined);
  protected readonly isGithubSignedIn = signal(false);
  protected readonly isConnecting = signal(false);
  protected readonly isSigningIn = signal(false);
  protected readonly signInMessage = signal<string | undefined>(undefined);
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
  private readonly restoredDraft = signal<NewProjectDraft | undefined>(
    undefined,
  );
  private readonly pendingDraft = signal<NewProjectDraft | undefined>(
    undefined,
  );
  private readonly requestedSpaceID = signal<string | undefined>(undefined);
  private readonly authStatus = signal<AuthStatus | undefined>(undefined);
  private returnUrl = '/';
  @ViewChild(IonInput, { static: false }) titleInput?: IonInput;

  createSpace(): void {
    const title = this.spaceTitle().trim();
    const actor = this.userID();
    if (this.isCreatingSpace()) return;
    if (!title) {
      this.formError.set('Enter a Space name before creating it.');
      return;
    }
    if (!actor) {
      this.requestSignIn(
        'Sign in to create a Space. Your project details are saved in this browser.',
      );
      return;
    }
    this.formError.set(undefined);
    this.isCreatingSpace.set(true);
    this.injector
      .get(SpaceService)
      .createSpace({ type: 'group', title })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (space) => {
          if (this.userID() !== actor) return;
          this.isCreatingSpace.set(false);
          if (!space.id) {
            this.formError.set(
              'The Space could not be selected. Please try again.',
            );
            return;
          }
          this.spaces.update((spaces) => [
            ...spaces.filter((value) => value.id !== space.id),
            { id: space.id, title: space.dbo?.title || title },
          ]);
          this.spaceID.set(space.id);
          this.spaceTitle.set('');
          this.saveDraft();
        },
        error: () => {
          if (this.userID() !== actor) return;
          this.isCreatingSpace.set(false);
          this.formError.set(
            'The Space could not be created. Check your sign-in and try again.',
          );
        },
      });
  }

  constructor() {
    const requestedSpaceID = this.route.snapshot.queryParamMap.get('spaceID');
    if (requestedSpaceID && /^[A-Za-z0-9_-]{1,128}$/.test(requestedSpaceID))
      this.requestedSpaceID.set(requestedSpaceID);
    this.userService.userState
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        this.authStatus.set(state.status);
        this.spaces.set(
          Object.entries(state.record?.spaces ?? {}).map(([id, space]) => ({
            id,
            title: space.title,
          })),
        );
        const savedSpaceID =
          this.requestedSpaceID() ?? this.restoredDraft()?.spaceID;
        if (
          savedSpaceID &&
          this.spaces().some((space) => space.id === savedSpaceID)
        )
          this.spaceID.set(savedSpaceID);
        else if (!this.spaces().some((space) => space.id === this.spaceID()))
          this.spaceID.set('');
        const uid = state.user?.uid;
        if (uid !== this.userID()) {
          const previousUserID = this.userID();
          this.userID.set(uid);
          this.isCreatingSpace.set(false);
          if (previousUserID) {
            // A different account must not inherit another user's draft.
            clearNewProjectDraft();
            this.restoredDraft.set(undefined);
            this.title.set('');
            this.githubFolder.set('datatug');
            this.spaceTitle.set('');
            this.spaceID.set('');
          } else {
            // The initial sign-in completes in-place for popup auth.
            this.spaceTitle.set(
              this.restoredDraft()?.spaceTitle ?? this.spaceTitle(),
            );
            if (this.restoredDraft() && !this.restoredDraft()?.actorID)
              this.saveDraft();
          }
          this.selectionGeneration++;
          this.githubRepos.set([]);
          this.selectedRepo.set(undefined);
          this.branches.set([]);
          this.branch.set('');
          this.pendingCreate.set(undefined);
          this.isCreating.set(false);
          if (this.store() === 'github') this.loadGithubRepos();
        }
        this.resolvePendingDraft(uid, state.status);
      });
  }
  ngOnInit(): void {
    const draft = readNewProjectDraft();
    const storeParam = this.route.snapshot.queryParamMap.get('store');
    if (storeParam !== null) {
      this.store.set(storeParam === 'github' ? 'github' : 'cloud');
    }
    this.restoreDraftForCurrentActor(draft);
    this.returnUrl = safeNewProjectReturnUrl(
      this.route.snapshot.queryParamMap.get('returnUrl'),
    );
    if (this.store() === 'github' && this.userID()) this.loadGithubRepos();
  }
  ionViewDidEnter(): void {
    setTimeout(
      () => void this.titleInput?.setFocus().catch(() => undefined),
      100,
    );
  }
  cancel(): void {
    if (this.isCreating()) return;
    clearNewProjectDraft();
    void this.router
      .navigateByUrl(this.returnUrl, { replaceUrl: true })
      .catch(
        this.errorLogger.logErrorHandler(
          'Failed to return from the new project page',
        ),
      );
  }
  storeChanged(store: 'cloud' | 'github'): void {
    this.store.set(store);
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { store: this.store() },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .catch(
        this.errorLogger.logErrorHandler(
          'Failed to update the new project page URL',
        ),
      );
    if (this.store() === 'github' && this.userID()) this.loadGithubRepos();
  }

  signInToGithub(): void {
    if (!this.userID()) {
      this.requestSignIn(
        'Sign in to connect GitHub. Your project details are saved in this browser.',
      );
      return;
    }
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
    if (!this.userID()) return;
    const generation = ++this.selectionGeneration;
    this.githubReposError.set(undefined);
    this.isLoadingRepos.set(true);
    this.connection.repositories().subscribe({
      next: (result) => {
        if (generation !== this.selectionGeneration) return;
        const writableRepos = result.repositories.filter(
          (repo) => repo.permission === 'write',
        );
        this.githubRepos.set(writableRepos);
        this.isGithubSignedIn.set(true);
        this.isLoadingRepos.set(false);
        this.githubReposError.set(undefined);
        const saved = this.restoredDraft();
        if (saved?.repositoryID) {
          const repo = writableRepos.find(
            (candidate) => candidate.id === saved.repositoryID,
          );
          if (repo) {
            this.selectedRepo.set(repo.id);
            this.githubFolder.set(saved.githubFolder);
            this.loadBranches();
          } else {
            // The saved selection is restored only if it is still writable.
            this.restoredDraft.set(undefined);
          }
        }
      },
      error: () => {
        if (generation !== this.selectionGeneration) return;
        this.githubRepos.set([]);
        this.selectedRepo.set(undefined);
        this.branches.set([]);
        this.isGithubSignedIn.set(false);
        this.isLoadingRepos.set(false);
        this.githubReposError.set(
          'Could not load GitHub repositories. Connect or reconnect GitHub, then refresh repositories.',
        );
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
    const folder = readNewProjectFolder(this.githubFolder());
    this.branches.set([]);
    this.pendingCreate.set(undefined);
    if (!repo || !folder.ok) {
      this.formError.set('Choose a repository and a valid relative folder.');
      return;
    }
    let projectId: string;
    try {
      projectId = formatGithubProjectApiKey({
        repo: repo.name,
        org: repo.owner,
        folder: folder.folder,
      });
    } catch {
      this.formError.set('Choose a repository and a valid relative folder.');
      return;
    }
    this.queryApi.branches({ storeId: 'github.com', projectId }).subscribe({
      next: (result) => {
        if (generation !== this.selectionGeneration) return;
        this.branches.set(result.branches);
        const savedBranch = this.restoredDraft()?.branch;
        this.branch.set(
          savedBranch &&
            result.branches.some((candidate) => candidate.name === savedBranch)
            ? savedBranch
            : '',
        );
        this.restoredDraft.set(undefined);
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
    if (!this.userID()) {
      this.requestSignIn(
        'Sign in to create your project. Your details are saved in this browser.',
      );
      return;
    }
    if (this.store() !== 'github') {
      this.isCreating.set(true);
      this.projectService
        .createNewProject('firestore', { title: this.title(), userIDs: [] })
        .subscribe({
          next: (projectId) => {
            clearNewProjectDraft();
            this.dismissAndGo({ projectId, storeId: 'firestore' });
          },
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
    const folder = readNewProjectFolder(this.githubFolder());
    const branch = this.branches().find(
      (branch) => branch.name === this.branch(),
    );
    if (
      !repo ||
      !folder.ok ||
      !branch ||
      !this.spaces().some((space) => space.id === this.spaceID()) ||
      !this.title().trim()
    ) {
      this.formError.set(
        'Choose a Space, initialized repository, branch and valid folder, and enter a title.',
      );
      return;
    }
    const fields = {
      title: this.title(),
      spaceID: this.spaceID(),
      github: {
        repositoryID: repo.id,
        owner: repo.owner,
        name: repo.name,
        folder: folder.folder,
        branch: branch.name,
        expectedBranchHead: branch.head,
      },
      template: DATATUG_DEMO_PROJECT_TEMPLATE,
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
        clearNewProjectDraft();
        this.dismissAndGo({
          storeId: 'github.com',
          projectId: result.project,
          projectApi: 'cloud',
          branch: result.branch,
        });
      },
      error: (error: unknown) => {
        this.isCreating.set(false);
        const failure = githubProjectCreateFailure(error);
        if (!failure.retrySameOperation) this.pendingCreate.set(undefined);
        this.formError.set(failure.message);
      },
    });
  }
  private dismissAndGo(ref: IProjectContext['ref']): void {
    this.nav.goProject(
      {
        ref,
        store: { ref: parseDatatugStoreRef(ref.storeId) },
      },
      undefined,
      { replaceUrl: true },
    );
  }

  protected async signInToContinue(): Promise<void> {
    if (this.isSigningIn()) return;
    this.saveDraft();
    this.isSigningIn.set(true);
    try {
      await this.auth.signInWith('google.com');
      this.signInMessage.set(undefined);
    } catch {
      this.formError.set('Sign-in could not be completed. Please try again.');
    } finally {
      this.isSigningIn.set(false);
    }
  }

  private requestSignIn(message: string): void {
    this.saveDraft();
    this.signInMessage.set(message);
  }

  private saveDraft(): void {
    try {
      const draft: NewProjectDraft = {
        actorID: this.userID(),
        store: this.store(),
        title: this.title(),
        githubFolder: this.githubFolder(),
        spaceID: this.spaceID() || undefined,
        spaceTitle: this.spaceTitle(),
        repositoryID: this.selectedRepo(),
        branch: this.branch() || undefined,
      };
      this.restoredDraft.set(draft);
      sessionStorage.setItem(NEW_PROJECT_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      this.formError.set(
        'Project details could not be saved in this browser. Keep this page open while signing in.',
      );
    }
  }

  private restoreDraftForCurrentActor(draft?: NewProjectDraft): void {
    if (!draft) return;
    if (!draft.actorID) {
      this.restoredDraft.set(draft);
      this.applyDraft(draft);
      // Anonymous drafts are intentionally eligible for the first sign-in.
      // Bind them as soon as the current signed-in actor is known.
      if (this.userID()) this.saveDraft();
      return;
    }
    if (this.userID() === draft.actorID) {
      this.restoredDraft.set(draft);
      this.applyDraft(draft);
      return;
    }
    if (!this.userID() && this.authStatus() === 'authenticating') {
      // Do not expose another account's data while session restoration runs.
      this.pendingDraft.set(draft);
      return;
    }
    clearNewProjectDraft();
  }

  private resolvePendingDraft(
    uid: string | undefined,
    status: AuthStatus,
  ): void {
    const draft = this.pendingDraft();
    if (!draft || status === 'authenticating') return;
    this.pendingDraft.set(undefined);
    if (uid && uid === draft.actorID) {
      this.restoredDraft.set(draft);
      this.applyDraft(draft);
      if (
        this.store() === 'github' &&
        !this.isLoadingRepos() &&
        !this.isGithubSignedIn()
      )
        this.loadGithubRepos();
      return;
    }
    clearNewProjectDraft();
  }

  private applyDraft(draft: NewProjectDraft): void {
    const storeParam = this.route.snapshot.queryParamMap.get('store');
    if (storeParam === null) this.store.set(draft.store);
    this.title.set(draft.title);
    this.githubFolder.set(draft.githubFolder);
    this.spaceTitle.set(draft.spaceTitle);
    if (this.spaces().some((space) => space.id === draft.spaceID))
      this.spaceID.set(draft.spaceID ?? '');
  }
}

function readNewProjectDraft(): NewProjectDraft | undefined {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(NEW_PROJECT_DRAFT_KEY) ?? 'null',
    );
    if (!value || typeof value !== 'object') return undefined;
    const draft = value as Partial<NewProjectDraft>;
    return {
      actorID:
        typeof draft.actorID === 'string'
          ? draft.actorID.slice(0, 128)
          : undefined,
      store: draft.store === 'github' ? 'github' : 'cloud',
      title: typeof draft.title === 'string' ? draft.title.slice(0, 30) : '',
      githubFolder:
        typeof draft.githubFolder === 'string'
          ? draft.githubFolder.slice(0, 256)
          : 'datatug',
      spaceID:
        typeof draft.spaceID === 'string'
          ? draft.spaceID.slice(0, 128)
          : undefined,
      spaceTitle:
        typeof draft.spaceTitle === 'string'
          ? draft.spaceTitle.slice(0, 100)
          : '',
      repositoryID:
        typeof draft.repositoryID === 'number' ? draft.repositoryID : undefined,
      branch:
        typeof draft.branch === 'string'
          ? draft.branch.slice(0, 255)
          : undefined,
    };
  } catch {
    return undefined;
  }
}

function clearNewProjectDraft(): void {
  try {
    sessionStorage.removeItem(NEW_PROJECT_DRAFT_KEY);
  } catch {
    // Session storage is optional; page navigation still works without it.
  }
}

function githubProjectCreateFailure(error: unknown): {
  readonly message: string;
  readonly retrySameOperation: boolean;
} {
  const response =
    error && typeof error === 'object'
      ? (error as {
          status?: unknown;
          error?: { error?: { code?: unknown } };
        })
      : undefined;
  const status = response?.status;
  const code = response?.error?.error?.code;
  switch (code) {
    case 'invalid':
      return {
        message: 'Check the project details and try again.',
        retrySameOperation: false,
      };
    case 'unauthorized':
    case 'repository_denied':
    case 'actor_mismatch':
      return {
        message:
          'Your current Space, plan or GitHub access does not allow this project. Check access before trying again.',
        retrySameOperation: false,
      };
    case 'reauthorization_required':
      return {
        message: 'Reconnect GitHub, then try creating the project again.',
        retrySameOperation: false,
      };
    case 'conflict':
      return {
        message:
          'The branch, folder or shared-project limit conflicts with current state. Retry unchanged to check this operation, or review your selection before a new attempt.',
        retrySameOperation: true,
      };
  }
  if (status === 400 || status === 401 || status === 402 || status === 403) {
    return {
      message:
        'Project creation was denied. Check your details and access before trying again.',
      retrySameOperation: false,
    };
  }
  return {
    message:
      'Creation was not confirmed. Retry unchanged to recover the same operation; changed inputs start a new operation.',
    retrySameOperation: true,
  };
}
