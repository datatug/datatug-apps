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
  IonCheckbox,
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
  type ProjectBillingIntent,
} from '../../services/project/project-query-api.service';
import { safeNewProjectReturnUrl } from './new-project.service';
import {
  clearBusinessGithubContinuation,
  saveBusinessGithubContinuation,
} from './business-github-continuation';

interface NewProjectDraft {
  readonly actorID?: string;
  readonly githubActorID?: string;
  readonly store: 'cloud' | 'github';
  readonly title: string;
  readonly githubFolder: string;
  readonly spaceID?: string;
  readonly spaceTitle: string;
  readonly repositoryID?: number;
  readonly branch?: string;
  readonly githubRepositoryURL?: string;
  readonly ciEnabled?: boolean;
  readonly operationID?: string;
  readonly operationPayload?: string;
  readonly oauthResumePending?: boolean;
  readonly projectCreateSubmitted?: boolean;
  readonly oauthState?: string;
  readonly resolvedCreateRequest?: CreateGithubProject;
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
    IonCheckbox,
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
  readonly billingIntent = signal<ProjectBillingIntent>('personal_pro');
  readonly spaceTitle = signal('');
  readonly isCreatingSpace = signal(false);
  readonly branch = signal('');
  readonly githubRepositoryURL = signal('');
  readonly ciEnabled = signal(true);
  protected readonly setupStatus = signal<'pending_merge' | 'merged_ready' | 'closed_unmerged' | 'failed' | undefined>(undefined);
  protected readonly setupPR = signal<{ url: string; number: number } | undefined>(undefined);
  protected readonly isRefreshingSetup = signal(false);
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
  private readonly operationID = signal<string | undefined>(undefined);
  private readonly operationPayload = signal<string | undefined>(undefined);
  private readonly oauthResumePending = signal(false);
  private readonly projectCreateSubmitted = signal(false);
  private readonly oauthState = signal<string | undefined>(undefined);
  private readonly resolvedCreateRequest = signal<CreateGithubProject | undefined>(undefined);
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
    this.billingIntent.set(
      this.route.snapshot.queryParamMap.get('billingIntent') ===
        'space_business'
        ? 'space_business'
        : 'personal_pro',
    );
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
        else if (
          this.requestedSpaceID() ||
          !this.spaces().some((space) => space.id === this.spaceID())
        )
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
          this.isCreating.set(false);
          this.operationID.set(undefined);
          this.operationPayload.set(undefined);
          this.oauthResumePending.set(false);
          this.projectCreateSubmitted.set(false);
          this.setupStatus.set(undefined);
          this.setupPR.set(undefined);
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
    const oauthResult = this.route.snapshot.queryParamMap.get('oauthResult');
    if (oauthResult === 'actor-changed') {
      this.oauthResumePending.set(false);
      this.oauthState.set(undefined);
      this.formError.set('Your GitHub account changed. Choose a repository and branch again, then submit the project request.');
      this.saveDraft();
    } else if (oauthResult && oauthResult !== 'success') {
      this.oauthResumePending.set(false);
      this.oauthState.set(undefined);
      this.formError.set('GitHub authorization was canceled or did not grant the required repository and workflow access. Review the repository and try again.');
      this.saveDraft();
    }
    this.returnUrl = safeNewProjectReturnUrl(
      this.route.snapshot.queryParamMap.get('returnUrl'),
    );
    if (this.store() === 'github' && this.userID()) this.loadGithubRepos();
    if (
      oauthResult === 'success' &&
      draft?.oauthResumePending &&
      draft.actorID === this.userID()
    ) {
      this.oauthResumePending.set(false);
      this.saveDraft();
      queueMicrotask(() => this.create());
    }
    if (
      this.projectCreateSubmitted() &&
      !draft?.oauthResumePending &&
      oauthResult !== 'denied'
    )
      queueMicrotask(() => this.refreshSetupStatus());
  }
  ionViewDidEnter(): void {
    setTimeout(
      () => void this.titleInput?.setFocus().catch(() => undefined),
      100,
    );
  }
  cancel(): void {
    if (this.isCreating()) return;
    if (this.setupStatus() !== 'pending_merge') clearNewProjectDraft();
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
    clearBusinessGithubContinuation();
    if (!this.saveDraft()) return;
    if (this.billingIntent() === 'space_business') {
      const actorID = this.userID();
      const spaceID = this.spaceID();
      if (
        !actorID ||
        !this.spaces().some((space) => space.id === spaceID) ||
        !saveBusinessGithubContinuation(actorID, spaceID)
      ) {
        this.formError.set(
          'Your Business Space could not be saved for the GitHub return. Choose a Space and try again.',
        );
        return;
      }
    }
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
          clearBusinessGithubContinuation();
          this.isConnecting.set(false);
          this.formError.set(
            'GitHub could not be connected. Please try again.',
          );
        }
      },
      error: () => {
        clearBusinessGithubContinuation();
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
    this.connection.oauthRepositories().subscribe({
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
          'Could not load connected GitHub repositories. Enter the repository URL and submit to authorize access, or retry refresh.',
        );
      },
    });
  }
  repositoryChanged(id: number): void {
    this.selectedRepo.set(id);
    const repo = this.githubRepos().find((candidate) => candidate.id === id);
    if (repo) this.githubRepositoryURL.set(`https://github.com/${repo.owner}/${repo.name}`);
    this.branch.set('');
    this.loadBranches();
  }
  repositoryURLChanged(value: string): void {
    this.githubRepositoryURL.set(value);
    this.selectedRepo.set(undefined);
    this.branch.set('');
    this.branches.set([]);
  }
  loadBranches(): void {
    const generation = ++this.selectionGeneration;
    const repo = this.githubRepos().find(
      (repo) => repo.id === this.selectedRepo(),
    );
    const folder = readNewProjectFolder(this.githubFolder());
    this.branches.set([]);
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
    if (this.isCreating() || this.setupStatus() === 'pending_merge') return;
    if (this.setupStatus() === 'closed_unmerged') {
      this.operationID.set(undefined);
      this.operationPayload.set(undefined);
      this.resolvedCreateRequest.set(undefined);
      this.projectCreateSubmitted.set(false);
      this.setupStatus.set(undefined);
      this.setupPR.set(undefined);
    }
    this.formError.set(undefined);
    if (!this.userID()) {
      this.requestSignIn(
        'Sign in to create your project. Your details are saved in this browser.',
      );
      return;
    }
    if (this.store() !== 'github') {
      if (
        this.billingIntent() === 'space_business' &&
        !this.spaces().some((space) => space.id === this.spaceID())
      ) {
        this.formError.set(
          'Choose a Business Space before creating the project.',
        );
        return;
      }
      this.isCreating.set(true);
      this.projectService
        .createNewProject('firestore', {
          title: this.title(),
          userIDs: [],
          billingIntent: this.billingIntent(),
          ...(this.spaceID() ? { spaceID: this.spaceID() } : {}),
        })
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
    const address = repo ?? parseGithubRepositoryURL(this.githubRepositoryURL());
    const folder = readNewProjectFolder(this.githubFolder());
    if (
      !address ||
      !folder.ok ||
      !this.spaces().some((space) => space.id === this.spaceID()) ||
      !this.title().trim()
    ) {
      this.formError.set(
        'Choose a Space, enter a GitHub repository, choose a valid folder, and enter a title.',
      );
      return;
    }
    const intent = {
      title: this.title(),
      spaceID: this.spaceID(),
      billingIntent: this.billingIntent(),
      github: {
        owner: address.owner,
        name: address.name,
        folder: folder.folder,
      },
      template: DATATUG_DEMO_PROJECT_TEMPLATE,
      ciEnabled: this.ciEnabled(),
    };
    const payload = JSON.stringify(intent);
    if (payload !== this.operationPayload()) {
      this.operationPayload.set(payload);
      this.operationID.set(crypto.randomUUID());
      this.projectCreateSubmitted.set(false);
      this.resolvedCreateRequest.set(undefined);
    }
    const operationID = this.operationID() ?? crypto.randomUUID();
    this.operationID.set(operationID);
    const previousRequest = this.resolvedCreateRequest();
    if (previousRequest) {
      this.submitGithubProject(previousRequest, address.owner, address.name, operationID);
      return;
    }
    this.saveDraft();
    const generation = this.selectionGeneration;
    const actorID = this.userID();
    this.isCreating.set(true);
    this.connection.resolveOAuthRepository(address.owner, address.name).subscribe({
      next: (resolved) => {
        if (generation !== this.selectionGeneration || this.userID() !== actorID) return;
        const projectId = formatGithubProjectApiKey({
          org: resolved.owner,
          repo: resolved.name,
          folder: folder.folder,
        });
        this.queryApi.branches({ storeId: 'github.com', projectId }).subscribe({
          next: (result) => {
            if (generation !== this.selectionGeneration || this.userID() !== actorID) return;
            const branchName = this.branch() || result.defaultBranch || resolved.defaultBranch;
            const branch = result.branches.find((candidate) => candidate.name === branchName);
            if (!branch?.head) {
              this.isCreating.set(false);
              this.formError.set('The repository branch could not be verified. Refresh branches and try again.');
              return;
            }
            const fields = {
              ...intent,
              github: {
                repositoryID: resolved.id,
                owner: resolved.owner,
                name: resolved.name,
                folder: folder.folder,
                branch: branch.name,
                expectedBranchHead: branch.head,
              },
            };
            const request = { ...fields, operationID, ciEnabled: this.ciEnabled() };
            this.resolvedCreateRequest.set(request);
            this.saveDraft();
            this.submitGithubProject(request, address.owner, address.name, operationID);
          },
          error: (error: unknown) => {
            if (generation !== this.selectionGeneration) return;
            if (githubOAuthNeedsAuthorization(error)) {
              this.isCreating.set(false);
              this.oauthResumePending.set(true);
              this.saveDraft();
              this.startGithubOAuth(address.owner, address.name, operationID, ['repo']);
              return;
            }
            this.isCreating.set(false);
            this.formError.set('Branches could not be loaded. Check GitHub access and retry.');
          },
        });
      },
      error: (error: unknown) => {
        if (generation !== this.selectionGeneration) return;
        if (githubOAuthNeedsAuthorization(error)) {
          this.oauthResumePending.set(true);
          this.saveDraft();
          this.startGithubOAuth(
            address.owner,
            address.name,
            operationID,
            this.ciEnabled() ? ['repo', 'workflow'] : ['repo'],
          );
          return;
        }
        this.isCreating.set(false);
        this.formError.set('This GitHub repository could not be resolved for your account. Check the owner and repository name, then retry.');
      },
    });
  }

  protected refreshSetupStatus(): void {
    const operationID = this.operationID();
    if (!operationID || this.isRefreshingSetup()) return;
    const resolvedRequest = this.resolvedCreateRequest();
    if (!resolvedRequest) {
      this.formError.set('The saved repository selection is missing. Re-enter the repository URL and submit again.');
      return;
    }
    this.isRefreshingSetup.set(true);
    this.queryApi.createStatus({
      operationID,
      repositoryID: resolvedRequest.github.repositoryID,
      owner: resolvedRequest.github.owner,
      name: resolvedRequest.github.name,
    }).subscribe({
      next: (status) => {
        this.isRefreshingSetup.set(false);
        this.setupStatus.set(status.status);
        if (status.setupPR)
          this.setupPR.set({ url: status.setupPR.url, number: status.setupPR.number });
        if (status.status === 'merged_ready') {
          const repo = this.githubRepos().find((item) => item.id === this.selectedRepo()) ?? parseGithubRepositoryURL(this.githubRepositoryURL());
          const folder = readNewProjectFolder(this.githubFolder());
          const projectID = status.projectID ?? (repo && folder.ok
            ? formatGithubProjectApiKey({ org: repo.owner, repo: repo.name, folder: folder.folder })
            : undefined);
          const branch = status.setupPR?.baseBranch ?? this.resolvedCreateRequest()?.github.branch ?? this.branch();
          if (!projectID || !branch) {
            this.formError.set('The setup is ready, but project details need to be reselected before opening it.');
            return;
          }
          clearNewProjectDraft();
          this.dismissAndGo({
            storeId: 'github.com',
            projectId: projectID,
            projectApi: 'cloud',
            branch,
          });
        }
      },
      error: (error: unknown) => {
        this.isRefreshingSetup.set(false);
        if (githubOAuthNeedsAuthorization(error)) {
          this.oauthResumePending.set(true);
          this.saveDraft();
          this.startGithubOAuth(resolvedRequest.github.owner, resolvedRequest.github.name, operationID, ['repo']);
          return;
        }
        this.formError.set('Setup status could not be checked. Retry to confirm whether the pull request merged.');
      },
    });
  }

  protected retryClosedSetup(): void {
    if (this.setupStatus() !== 'closed_unmerged' || this.isCreating()) return;
    this.operationID.set(undefined);
    this.operationPayload.set(undefined);
    this.resolvedCreateRequest.set(undefined);
    this.projectCreateSubmitted.set(false);
    this.setupStatus.set(undefined);
    this.setupPR.set(undefined);
    this.create();
  }

  protected setupStatusMessage(
    status: 'pending_merge' | 'merged_ready' | 'closed_unmerged' | 'failed',
  ): string {
    switch (status) {
      case 'pending_merge':
        return 'Setup pull request is open. Project files become active after it merges.';
      case 'merged_ready':
        return 'Setup is verified and ready.';
      case 'closed_unmerged':
        return 'The setup pull request closed without merging. Review the repository and retry to create a fresh setup request, or go back to your projects.';
      case 'failed':
        return 'Project setup did not complete.';
    }
  }

  private startGithubOAuth(
    owner: string,
    repository: string,
    operationID: string,
    requiredScopes: readonly ('repo' | 'workflow')[],
  ): void {
    this.connection.startOAuth({ operationID, owner, repository, requiredScopes }).subscribe({
      next: ({ authorizationURL }) => {
        try {
          const url = new URL(authorizationURL);
          if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.pathname !== '/login/oauth/authorize' || url.username || url.password) throw new Error();
          const state = url.searchParams.get('state');
          if (!state || state.length > 512) throw new Error();
          this.oauthState.set(state);
          this.saveDraft();
          window.location.assign(url.href);
        } catch {
          this.isCreating.set(false);
          this.oauthResumePending.set(false);
          this.saveDraft();
          this.formError.set('GitHub authorization could not be started. Retry the same project request.');
        }
      },
      error: () => {
        this.isCreating.set(false);
        this.oauthResumePending.set(false);
        this.saveDraft();
        this.formError.set('GitHub authorization could not be started. Retry the same project request.');
      },
    });
  }

  private submitGithubProject(
    request: CreateGithubProject,
    owner: string,
    repository: string,
    operationID: string,
  ): void {
    const generation = this.selectionGeneration;
    const actorID = this.userID();
    this.isCreating.set(true);
    this.queryApi.create(request).subscribe({
      next: (created) => {
        if (generation !== this.selectionGeneration || this.userID() !== actorID) return;
        this.isCreating.set(false);
        this.setupStatus.set(created.status);
        this.setupPR.set({ url: created.setupPR.url, number: created.setupPR.number });
        this.projectCreateSubmitted.set(true);
        this.oauthResumePending.set(false);
        this.oauthState.set(undefined);
        this.formError.set(undefined);
        this.saveDraft();
      },
      error: (error: unknown) => {
        if (githubProjectErrorCode(error) === 'workflow_scope_required') {
          this.oauthResumePending.set(true);
          this.saveDraft();
          this.startGithubOAuth(owner, repository, operationID, ['workflow']);
          return;
        }
        this.handleCreateFailure(error);
      },
    });
  }

  private handleCreateFailure(error: unknown): void {
    this.isCreating.set(false);
    const failure = githubProjectCreateFailure(error);
    this.formError.set(failure.message);
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

  private saveDraft(): boolean {
    try {
      const draft: NewProjectDraft = {
        actorID: this.userID(),
        githubActorID: this.restoredDraft()?.githubActorID,
        store: this.store(),
        title: this.title(),
        githubFolder: this.githubFolder(),
        spaceID: this.spaceID() || undefined,
        spaceTitle: this.spaceTitle(),
        repositoryID: this.selectedRepo(),
        branch: this.branch() || undefined,
        githubRepositoryURL: this.githubRepositoryURL(),
        ciEnabled: this.ciEnabled(),
        operationID: this.operationID(),
        operationPayload: this.operationPayload(),
        oauthResumePending: this.oauthResumePending(),
        projectCreateSubmitted: this.projectCreateSubmitted(),
        oauthState: this.oauthState(),
        resolvedCreateRequest: this.resolvedCreateRequest(),
      };
      this.restoredDraft.set(draft);
      sessionStorage.setItem(NEW_PROJECT_DRAFT_KEY, JSON.stringify(draft));
      return true;
    } catch {
      this.formError.set(
        'Project details could not be saved in this browser. Keep this page open while signing in.',
      );
      return false;
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
    this.githubRepositoryURL.set(draft.githubRepositoryURL ?? '');
    this.ciEnabled.set(draft.ciEnabled ?? true);
    this.operationID.set(draft.operationID);
    this.operationPayload.set(draft.operationPayload);
    this.oauthResumePending.set(draft.oauthResumePending ?? false);
    this.projectCreateSubmitted.set(draft.projectCreateSubmitted ?? false);
    this.oauthState.set(draft.oauthState);
    this.resolvedCreateRequest.set(draft.resolvedCreateRequest);
    this.branch.set(draft.branch ?? '');
    this.spaceTitle.set(draft.spaceTitle);
    if (
      !this.requestedSpaceID() &&
      this.spaces().some((space) => space.id === draft.spaceID)
    )
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
      githubActorID:
        typeof draft.githubActorID === 'string'
          ? draft.githubActorID.slice(0, 128)
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
      githubRepositoryURL:
        typeof draft.githubRepositoryURL === 'string'
          ? draft.githubRepositoryURL.slice(0, 512)
          : undefined,
      ciEnabled: typeof draft.ciEnabled === 'boolean' ? draft.ciEnabled : true,
      operationID:
        typeof draft.operationID === 'string' &&
        /^[0-9a-f-]{36}$/i.test(draft.operationID)
          ? draft.operationID
          : undefined,
      operationPayload:
        typeof draft.operationPayload === 'string'
          ? draft.operationPayload.slice(0, 4096)
          : undefined,
      oauthResumePending: draft.oauthResumePending === true,
      projectCreateSubmitted: draft.projectCreateSubmitted === true,
      oauthState: typeof draft.oauthState === 'string' ? draft.oauthState.slice(0, 512) : undefined,
      resolvedCreateRequest: isCreateGithubProject(draft.resolvedCreateRequest) ? draft.resolvedCreateRequest : undefined,
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

function isCreateGithubProject(value: unknown): value is CreateGithubProject {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<CreateGithubProject>;
  return (
    typeof request.operationID === 'string' &&
    /^[0-9a-f-]{36}$/i.test(request.operationID) &&
    typeof request.title === 'string' &&
    typeof request.spaceID === 'string' &&
    typeof request.ciEnabled === 'boolean' &&
    !!request.github &&
    typeof request.github.repositoryID === 'number' &&
    typeof request.github.owner === 'string' &&
    typeof request.github.name === 'string' &&
    typeof request.github.folder === 'string' &&
    typeof request.github.branch === 'string' &&
    typeof request.github.expectedBranchHead === 'string'
  );
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
  const code = githubProjectErrorCode(error);
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

function githubProjectErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const response = error as { error?: { error?: { code?: unknown } } };
  return typeof response.error?.error?.code === 'string'
    ? response.error.error.code
    : undefined;
}

function githubOAuthNeedsAuthorization(error: unknown): boolean {
  const code = githubProjectErrorCode(error);
  return (
    code === 'reauthorization_required' ||
    code === 'authorization_required' ||
    code === 'scope_required' ||
    code === 'workflow_scope_required'
  );
}

function parseGithubRepositoryURL(
  value: string,
): { readonly owner: string; readonly name: string } | undefined {
  const input = value.trim();
  if (!input) return undefined;
  try {
    const url = new URL(input.includes('://') ? input : `https://github.com/${input}`);
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLowerCase() !== 'github.com' ||
      url.username ||
      url.password
    )
      return undefined;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 2) {
      const name = segments[1].replace(/\.git$/i, '');
      if (/^[A-Za-z0-9_.-]+$/.test(segments[0]) && /^[A-Za-z0-9_.-]+$/.test(name))
        return { owner: segments[0], name };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
