import { TitleCasePipe } from '@angular/common';
import { DemoProjectContinuationService, validContinuationToken } from './demo-project-continuation.service';
import { findDemoSqliteDataset } from '../../queries/demo-sqlite-catalog';
import { projectPageHref } from '../../nav/project-page-href';
import { readGithubProjectCopySource, type GithubProjectCopySource } from './github-project-copy-source';
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
  type GithubProjectCreateStatus,
  type PendingGithubProjectSetup,
  type ProjectBillingIntent,
} from '../../services/project/project-query-api.service';
import { GitHubReauthorizationBannerComponent } from './github-reauthorization-banner.component';
import { safeNewProjectReturnUrl } from './new-project.service';
import {
  clearBusinessGithubContinuation,
  saveBusinessGithubContinuation,
} from './business-github-continuation';

interface NewProjectDraft {
  readonly demoContinuation?: string;
  readonly billingIntent?: ProjectBillingIntent;
  readonly source?: GithubProjectCopySource;
  readonly returnUrl?: string;
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
  readonly operationBranch?: string;
  readonly recoveryBranch?: string;
  readonly createNeedsSameOperationRetry?: boolean;
  readonly createConflictNeedsStatusCheck?: boolean;
  readonly oauthResumePending?: boolean;
  readonly projectCreateSubmitted?: boolean;
  readonly setupPR?: { readonly url: string; readonly number: number };
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
    GitHubReauthorizationBannerComponent,
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
  private readonly demoContinuations = inject(DemoProjectContinuationService);
  private demoContinuation?: string;
  private readonly nav = inject(DatatugNavService);
  readonly store = signal<'cloud' | 'github'>('cloud');
  readonly copySource = signal<GithubProjectCopySource | undefined>(undefined);
  private readonly invalidCopySource = signal(false);
  private readonly requestedCopySource = signal<GithubProjectCopySource | undefined>(undefined);
  readonly title = signal('');
  readonly githubFolder = signal('datatug');
  readonly spaceID = signal('');
  readonly billingIntent = signal<ProjectBillingIntent>('personal_pro');
  readonly spaceTitle = signal('');
  readonly isCreatingSpace = signal(false);
  readonly branch = signal('');
  readonly githubRepositoryURL = signal('');
  readonly ciEnabled = signal(true);
  protected readonly setupStatus = signal<'initializing' | 'pending_merge' | 'merged_ready' | 'closed_unmerged' | 'failed' | 'needs_review' | undefined>(undefined);
  protected readonly setupPR = signal<{ url: string; number: number } | undefined>(undefined);
  protected readonly isRefreshingSetup = signal(false);
  protected readonly pendingGithubSetups = signal<readonly PendingGithubProjectSetup[]>([]);
  protected readonly pendingGithubSetupsLoading = signal(false);
  protected readonly pendingGithubSetupsError = signal<string | undefined>(undefined);
  protected readonly pendingGithubSetupsTruncated = signal(false);
  protected readonly pendingGithubSetupRefreshes = signal<ReadonlySet<string>>(new Set());
  protected readonly pendingGithubSetupErrors = signal<Readonly<Record<string, string>>>({});
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
  private readonly userGeneration = signal(0);
  private readonly pendingGithubSetupsActor = signal<string | undefined>(undefined);
  private pendingGithubSetupsRequestGeneration = 0;
  private readonly operationID = signal<string | undefined>(undefined);
  private readonly operationPayload = signal<string | undefined>(undefined);
  private readonly operationBranch = signal<string | undefined>(undefined);
  private readonly recoveryBranch = signal<string | undefined>(undefined);
  private readonly createNeedsSameOperationRetry = signal(false);
  private readonly createConflictNeedsStatusCheck = signal(false);
  private readonly oauthResumePending = signal(false);
  private readonly projectCreateSubmitted = signal(false);
  private readonly oauthState = signal<string | undefined>(undefined);
  private readonly resolvedCreateRequest = signal<CreateGithubProject | undefined>(undefined);
  private oauthResumeQueued = false;
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

  private applyRequestedCopySource(): void {
    const source = this.requestedCopySource();
    if (source && !this.isCreateRetryLocked() && !this.isSetupLocked()) {
      this.copySource.set(source);
      this.store.set('github');
    }
  }

  protected copyDestinationSummary(): string {
    const resolved = this.resolvedCreateRequest()?.github;
    const repository = resolved ?? this.githubRepos().find((repo) => repo.id === this.selectedRepo()) ?? parseGithubRepositoryURL(this.githubRepositoryURL());
    if (!repository) return 'Choose a repository below';
    return `${repository.owner}/${repository.name}/${resolved?.folder ?? this.githubFolder()} · ${resolved?.branch ?? (this.branch() || 'repository default branch')}`;
  }

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
            { id: space.id, title: space.dbo?.title?.trim() || title },
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
    const titleCase = new TitleCasePipe();
    this.userService.userState
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        this.authStatus.set(state.status);
        this.spaces.set(
          Object.entries(state.record?.spaces ?? {}).map(([id, space]) => ({
            id,
            title: space.title?.trim() || titleCase.transform(space.type)?.trim() || id,
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
        if (this.demoContinuation && !this.spaceID() && !savedSpaceID && this.spaces().length === 1) this.spaceID.set(this.spaces()[0].id);
        const uid = state.user?.uid;
        if (uid !== this.userID()) {
          const previousUserID = this.userID();
          this.userID.set(uid);
          this.isCreatingSpace.set(false);
          if (previousUserID) {
            // A different account must not inherit another user's draft.
            clearNewProjectDraft();
            this.restoredDraft.set(undefined);
            this.billingIntent.set(this.route.snapshot.queryParamMap.get('billingIntent') === 'space_business' ? 'space_business' : 'personal_pro');
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
          this.userGeneration.update((generation) => generation + 1);
          this.githubRepos.set([]);
          this.selectedRepo.set(undefined);
          this.branches.set([]);
          this.branch.set('');
          this.isCreating.set(false);
          this.operationID.set(undefined);
          this.operationPayload.set(undefined);
          this.operationBranch.set(undefined);
          this.recoveryBranch.set(undefined);
          this.createNeedsSameOperationRetry.set(false);
          this.createConflictNeedsStatusCheck.set(false);
          this.resolvedCreateRequest.set(undefined);
          this.oauthResumePending.set(false);
          this.projectCreateSubmitted.set(false);
          this.setupStatus.set(undefined);
          this.setupPR.set(undefined);
          this.isRefreshingSetup.set(false);
          this.pendingGithubSetups.set([]);
          this.pendingGithubSetupsError.set(undefined);
          this.pendingGithubSetupsLoading.set(false);
          this.pendingGithubSetupRefreshes.set(new Set());
          this.pendingGithubSetupErrors.set({});
          this.pendingGithubSetupsActor.set(undefined);
          this.pendingGithubSetupsTruncated.set(false);
          if (this.store() === 'github') this.loadGithubRepos();
        }
        if (uid) this.loadPendingGithubSetups(uid);
        this.resolvePendingDraft(uid, state.status);
      });
  }
  ngOnInit(): void {
    const draft = readNewProjectDraft();
    this.returnUrl = safeNewProjectReturnUrl(
      this.route.snapshot.queryParamMap.get('returnUrl') ?? draft?.returnUrl,
    );
    const storeParam = this.route.snapshot.queryParamMap.get('store');
    if (storeParam !== null) {
      this.store.set(storeParam === 'github' ? 'github' : 'cloud');
    }
    this.restoreDraftForCurrentActor(draft);
    const continuationParam = this.route.snapshot.queryParamMap.get('demoContinuation') ?? this.restoredDraft()?.demoContinuation;
    this.demoContinuation = validContinuationToken(continuationParam) ? continuationParam : undefined;
    const continuation = this.demoContinuations.read(this.demoContinuation);
    if (continuation && !this.spaceID() && !this.restoredDraft()?.spaceID && this.spaces().length === 1) this.spaceID.set(this.spaces()[0].id);
    if (continuation && !this.restoredDraft() && !this.pendingDraft()) {
      this.title.set(`${findDemoSqliteDataset(continuation.dataset)?.title ?? continuation.dataset} project`);
      this.githubFolder.set(`${continuation.dataset}-datatug`);
    }
    const sourceParam = this.route.snapshot.queryParamMap.get('source');
    if (sourceParam) {
      try {
        const source = readGithubProjectCopySource(JSON.parse(sourceParam));
        if (!source) throw new Error();
        // A saved uncertain operation must be recovered before switching sources.
        this.requestedCopySource.set(source);
        this.applyRequestedCopySource();
        this.store.set('github');
      } catch { this.invalidCopySource.set(true); this.formError.set('The source project link is invalid. Return to the demo and try again.'); }
    }
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
    if (this.store() === 'github' && this.userID()) this.loadGithubRepos();
    if (oauthResult === 'success') this.resumeOAuthDraftIfReady();
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
    if (!this.isSetupLocked() && !this.createNeedsSameOperationRetry())
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
    if (!this.userID() || this.isCreating() || this.createNeedsSameOperationRetry()) return;
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
    if (this.isCreating() || this.createNeedsSameOperationRetry()) return;
    this.selectedRepo.set(id);
    const repo = this.githubRepos().find((candidate) => candidate.id === id);
    if (repo) this.githubRepositoryURL.set(`https://github.com/${repo.owner}/${repo.name}`);
    this.branch.set('');
    this.loadBranches();
  }
  repositoryURLChanged(value: string): void {
    if (this.isCreating() || this.createNeedsSameOperationRetry()) return;
    this.githubRepositoryURL.set(value);
    this.selectedRepo.set(undefined);
    this.branch.set('');
    this.branches.set([]);
  }
  loadBranches(): void {
    if (this.isCreating() || this.createNeedsSameOperationRetry()) return;
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
  branchChanged(value: string): void {
    if (this.isCreating() || this.createNeedsSameOperationRetry()) return;
    this.branch.set(value);
    this.saveDraft();
  }
  create(): void {
    if (this.invalidCopySource()) {
      this.formError.set('The source project link is invalid. Return to the demo and try again.');
      return;
    }
    if (this.isCreating() || this.isSetupLocked()) return;
    if (this.createNeedsSameOperationRetry() && this.createConflictNeedsStatusCheck()) {
      this.refreshSetupStatus();
      return;
    }
    if (this.setupStatus() === 'closed_unmerged') {
      this.operationID.set(undefined);
      this.operationPayload.set(undefined);
      this.operationBranch.set(undefined);
      this.recoveryBranch.set(undefined);
      this.resolvedCreateRequest.set(undefined);
      this.projectCreateSubmitted.set(false);
      this.createNeedsSameOperationRetry.set(false);
      this.createConflictNeedsStatusCheck.set(false);
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
      ...(this.copySource() ? { source: this.copySource() } : { template: DATATUG_DEMO_PROJECT_TEMPLATE }),
      ciEnabled: this.ciEnabled(),
    };
    const currentBranch = this.branch();
    const resolvedRequest = this.resolvedCreateRequest();
    const operationBranch = this.operationBranch();
    const branchMatchesDefaultMaterialization =
      operationBranch === '' &&
      !!(this.recoveryBranch() ?? resolvedRequest?.github.branch) &&
      currentBranch === (this.recoveryBranch() ?? resolvedRequest?.github.branch);
    const branchChanged =
      operationBranch !== undefined &&
      currentBranch !== operationBranch &&
      !branchMatchesDefaultMaterialization;
    if (this.createNeedsSameOperationRetry() && branchChanged) {
      this.formError.set(
        'This creation may already have reached GitHub. Retry the saved operation before changing its branch.',
      );
      return;
    }
    const payload = JSON.stringify({
      ...intent,
      selectedBranch: branchChanged ? currentBranch : (operationBranch ?? currentBranch),
    });
    if (
      this.createNeedsSameOperationRetry() &&
      payload !== this.operationPayload()
    ) {
      this.formError.set(
        'This creation may already have reached GitHub. Retry the saved operation before changing its details.',
      );
      return;
    }
    if (payload !== this.operationPayload()) {
      this.operationPayload.set(payload);
      this.operationBranch.set(currentBranch);
      this.recoveryBranch.set(undefined);
      this.operationID.set(crypto.randomUUID());
      this.projectCreateSubmitted.set(false);
      this.resolvedCreateRequest.set(undefined);
      this.createNeedsSameOperationRetry.set(false);
      this.createConflictNeedsStatusCheck.set(false);
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
            const branchName = this.branch() || this.recoveryBranch() || result.defaultBranch || resolved.defaultBranch;
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
              this.startGithubOAuth(address.owner, address.name, operationID, this.requiredOAuthScopes());
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
            this.requiredOAuthScopes(),
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
    const actorID = this.userID();
    const generation = this.selectionGeneration;
    const isCurrent = () =>
      this.userID() === actorID &&
      this.selectionGeneration === generation &&
      this.operationID() === operationID &&
      this.resolvedCreateRequest() === resolvedRequest;
    this.isRefreshingSetup.set(true);
    this.queryApi.createStatus({
      operationID,
      repositoryID: resolvedRequest.github.repositoryID,
      owner: resolvedRequest.github.owner,
      name: resolvedRequest.github.name,
    }).subscribe({
      next: (status) => {
        if (!isCurrent()) return;
        this.isRefreshingSetup.set(false);
        this.createConflictNeedsStatusCheck.set(false);
        this.setupStatus.set(status.status);
        if (status.status === 'pending_merge' || status.status === 'needs_review') {
          this.createNeedsSameOperationRetry.set(false);
          this.projectCreateSubmitted.set(true);
        } else if (status.status === 'closed_unmerged') {
          this.createNeedsSameOperationRetry.set(false);
          this.projectCreateSubmitted.set(false);
        }
        if (status.status === 'initializing' && this.createNeedsSameOperationRetry() && actorID) {
          // An earlier request may have won the operation-ID CAS with its
          // original digest. Rediscover that server-owned request so its
          // canonical inputs remain available for recovery.
          this.loadPendingGithubSetups(actorID, true);
        }
        if (status.setupPR)
          this.setupPR.set({ url: status.setupPR.url, number: status.setupPR.number });
        this.saveDraft();
        if (status.status === 'merged_ready') {
          const projectID = formatGithubProjectApiKey({
            org: resolvedRequest.github.owner,
            repo: resolvedRequest.github.name,
            folder: resolvedRequest.github.folder,
          });
          const branch = status.setupPR?.baseBranch ?? resolvedRequest.github.branch;
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
        if (!isCurrent()) return;
        this.isRefreshingSetup.set(false);
        if (
          this.createNeedsSameOperationRetry() &&
          this.createConflictNeedsStatusCheck() &&
          isHttpStatus(error, 404) &&
          githubProjectErrorCode(error) === 'not_found'
        ) {
          this.createConflictNeedsStatusCheck.set(false);
          this.recoveryBranch.set(resolvedRequest.github.branch);
          this.branch.set(resolvedRequest.github.branch);
          this.resolvedCreateRequest.set(undefined);
          this.formError.set(
            'GitHub has no saved setup visible yet. Retry this same operation; its details stay locked while the request is being recovered.',
          );
          this.saveDraft();
          return;
        }
        if (githubOAuthNeedsAuthorization(error)) {
          this.oauthResumePending.set(true);
          this.saveDraft();
          this.startGithubOAuth(resolvedRequest.github.owner, resolvedRequest.github.name, operationID, this.requiredOAuthScopes());
          return;
        }
        this.formError.set('Setup status could not be checked. Retry to confirm whether the pull request merged.');
      },
    });
  }

  protected pendingSetupProjectRef(setup: PendingGithubProjectSetup) {
    return {
      storeId: 'github.com',
      projectId: formatGithubProjectApiKey({
        org: setup.owner,
        repo: setup.name,
        folder: setup.folder,
      }),
      projectApi: 'cloud' as const,
      branch: setup.branch,
    };
  }

  protected isRefreshingPendingSetup(setup: PendingGithubProjectSetup): boolean {
    return this.pendingGithubSetupRefreshes().has(setup.operationID);
  }

  protected pendingSetupMessage(status: PendingGithubProjectSetup['status']): string {
    switch (status) {
      case 'initializing':
        return 'The server is preparing the setup pull request. Check again shortly.';
      case 'pending_merge':
        return 'The setup pull request is ready. Check its status after merging.';
      case 'needs_review':
        return 'The merged setup needs repair before DataTug can open this project.';
      case 'closed_unmerged':
        return 'The setup pull request closed without merging. Re-enter the project details above and submit a new setup request.';
      case 'failed':
        return 'This setup request failed. Re-enter the project details above and submit a new request.';
    }
  }

  protected reloadPendingGithubSetups(): void {
    const actor = this.userID();
    if (actor) this.loadPendingGithubSetups(actor, true);
  }

  protected resumePendingSetup(setup: PendingGithubProjectSetup): void {
    if (setup.status === 'initializing') {
      this.replayPendingCreate(setup);
      return;
    }
    this.refreshPendingSetup(setup);
  }

  protected refreshPendingSetup(setup: PendingGithubProjectSetup): void {
    const actor = this.userID();
    if (!actor || this.isRefreshingPendingSetup(setup)) return;
    const generation = this.userGeneration();
    const current = () => this.userID() === actor && this.userGeneration() === generation &&
      this.pendingGithubSetups().some((item) => samePendingSetupBinding(item, setup));
    this.pendingGithubSetupRefreshes.update((set) => new Set([...set, setup.operationID]));
    this.pendingGithubSetupErrors.update((errors) => {
      const next = { ...errors };
      delete next[setup.operationID];
      return next;
    });
    this.queryApi.createStatus({
      operationID: setup.operationID,
      repositoryID: setup.repositoryID,
      owner: setup.owner,
      name: setup.name,
    }).subscribe({
      next: (status) => {
        if (!current()) return;
        this.finishPendingSetupRefresh(setup.operationID);
        if (status.status === 'initializing' || status.status === 'pending_merge' || status.status === 'needs_review' || status.status === 'closed_unmerged' || status.status === 'failed')
          this.pendingGithubSetups.update((items) => items.map((item) => item.operationID === setup.operationID
            ? { ...item, status: status.status as PendingGithubProjectSetup['status'], setupPR: status.setupPR ?? item.setupPR }
            : item));
        if (status.status === 'merged_ready') this.openDiscoveredReadySetup(setup, status);
      },
      error: (error: unknown) => {
        if (!current()) return;
        this.finishPendingSetupRefresh(setup.operationID);
        if (githubOAuthNeedsAuthorization(error)) {
          this.queryApi.reportGithubReauthorizationRequired(
            this.pendingSetupProjectRef(setup),
            githubProjectErrorCode(error) === 'workflow_scope_required' ? ['repo', 'workflow'] : ['repo'],
          );
          return;
        }
        this.pendingGithubSetupErrors.update((errors) => ({ ...errors, [setup.operationID]: 'Setup status could not be checked. Try again.' }));
      },
    });
  }

  private finishPendingSetupRefresh(operationID: string): void {
    this.pendingGithubSetupRefreshes.update((set) => {
      const next = new Set(set);
      next.delete(operationID);
      return next;
    });
  }

  private replayPendingCreate(setup: PendingGithubProjectSetup): void {
    const actor = this.userID();
    if (!actor || this.isRefreshingPendingSetup(setup)) return;
    if (!setup.source && (setup.templateID !== DATATUG_DEMO_PROJECT_TEMPLATE.id || setup.templateCommit !== DATATUG_DEMO_PROJECT_TEMPLATE.commit)) {
      this.pendingGithubSetupErrors.update((errors) => ({ ...errors, [setup.operationID]: 'This setup uses a different project template version. Refresh the pending setup list before retrying.' }));
      return;
    }
    const generation = this.userGeneration();
    const current = () => this.userID() === actor && this.userGeneration() === generation &&
      this.pendingGithubSetups().some((item) => samePendingSetupBinding(item, setup));
    const request: CreateGithubProject = {
      title: setup.title,
      spaceID: setup.spaceID,
      billingIntent: setup.billingIntent,
      operationID: setup.operationID,
      ciEnabled: setup.ciEnabled,
      github: {
        repositoryID: setup.repositoryID,
        owner: setup.owner,
        name: setup.name,
        folder: setup.folder,
        branch: setup.branch,
        expectedBranchHead: setup.expectedHead,
      },
      ...(setup.source ? { source: setup.source } : { template: DATATUG_DEMO_PROJECT_TEMPLATE }),
    };
    this.pendingGithubSetupRefreshes.update((set) => new Set([...set, setup.operationID]));
    this.pendingGithubSetupErrors.update((errors) => {
      const next = { ...errors };
      delete next[setup.operationID];
      return next;
    });
    this.queryApi.create(request).subscribe({
      next: (result) => {
        if (!current()) return;
        this.finishPendingSetupRefresh(setup.operationID);
        this.pendingGithubSetups.update((items) => items.map((item) => item.operationID === setup.operationID
          ? { ...item, status: result.status, setupPR: result.setupPR }
          : item));
      },
      error: (error: unknown) => {
        if (!current()) return;
        this.finishPendingSetupRefresh(setup.operationID);
        if (githubOAuthNeedsAuthorization(error)) {
          this.queryApi.reportGithubReauthorizationRequired(
            this.pendingSetupProjectRef(setup),
            githubProjectErrorCode(error) === 'workflow_scope_required' ? ['repo', 'workflow'] : ['repo'],
          );
          return;
        }
        this.pendingGithubSetupErrors.update((errors) => ({ ...errors, [setup.operationID]: 'The same project setup could not be resumed. Check repository access, then try again.' }));
      },
    });
  }

  private openDiscoveredReadySetup(setup: PendingGithubProjectSetup, status: GithubProjectCreateStatus): void {
    const projectId = formatGithubProjectApiKey({ org: setup.owner, repo: setup.name, folder: setup.folder });
    const branch = status.setupPR?.baseBranch ?? setup.branch;
    if (!projectId || !branch) {
      this.pendingGithubSetupErrors.update((errors) => ({ ...errors, [setup.operationID]: 'The setup is ready, but its repository branch could not be restored.' }));
      return;
    }
    this.demoContinuation = this.userID() ? this.demoContinuations.find(this.userID() as string, setup.operationID, setup.source) : undefined;
    if (setup.source?.owner === 'datatug' && setup.source.name === 'datatug-demo-project' && !this.demoContinuation) {
      this.pendingGithubSetupErrors.update(errors => ({ ...errors, [setup.operationID]: 'Project files are ready, but the edited browser continuation is unavailable in this tab. Return to the demo to keep exploring; a lost memory-only database cannot be recovered automatically.' }));
      return;
    }
    this.pendingGithubSetups.update((items) => items.filter((item) => item.operationID !== setup.operationID));
    if (this.demoContinuation) { this.copySource.set(setup.source); this.operationID.set(setup.operationID); }
    this.dismissAndGo({ storeId: 'github.com', projectId, projectApi: 'cloud', branch });
  }

  private loadPendingGithubSetups(actor: string, force = false): void {
    if (!force && this.pendingGithubSetupsActor() === actor) return;
    this.pendingGithubSetupsActor.set(actor);
    this.pendingGithubSetupsLoading.set(true);
    this.pendingGithubSetupsError.set(undefined);
    const generation = this.userGeneration();
    const requestGeneration = ++this.pendingGithubSetupsRequestGeneration;
    this.queryApi.pendingGithubProjectSetups().subscribe({
      next: (result) => {
        if (this.userID() !== actor || this.userGeneration() !== generation || this.pendingGithubSetupsRequestGeneration !== requestGeneration) return;
        this.pendingGithubSetupsLoading.set(false);
        this.pendingGithubSetups.set(result.setups.filter(isPendingGithubProjectSetup));
        this.pendingGithubSetupsTruncated.set(result.truncated);
      },
      error: () => {
        if (this.userID() !== actor || this.userGeneration() !== generation || this.pendingGithubSetupsRequestGeneration !== requestGeneration) return;
        this.pendingGithubSetupsLoading.set(false);
        this.pendingGithubSetupsError.set('Pending GitHub project setups could not be loaded. Try refreshing this page.');
      },
    });
  }

  protected retryClosedSetup(): void {
    if (this.setupStatus() !== 'closed_unmerged' || this.isCreating()) return;
    if (this.demoContinuation && this.userID() && this.operationID()) this.demoContinuations.restart(this.demoContinuation, this.userID() as string, this.operationID() as string);
    this.operationID.set(undefined);
    this.operationPayload.set(undefined);
    this.operationBranch.set(undefined);
    this.recoveryBranch.set(undefined);
    this.createNeedsSameOperationRetry.set(false);
    this.createConflictNeedsStatusCheck.set(false);
    this.resolvedCreateRequest.set(undefined);
    this.projectCreateSubmitted.set(false);
    this.setupStatus.set(undefined);
    this.setupPR.set(undefined);
    this.create();
  }

  protected setupStatusMessage(
    status: 'initializing' | 'pending_merge' | 'merged_ready' | 'closed_unmerged' | 'failed' | 'needs_review',
  ): string {
    switch (status) {
      case 'initializing':
        return 'The server is preparing the setup pull request.';
      case 'pending_merge':
        return 'Setup pull request is open. Project files become active after it merges.';
      case 'merged_ready':
        return 'Setup is verified and ready.';
      case 'closed_unmerged':
        return 'The setup pull request closed without merging. Review the repository and retry to create a fresh setup request, or go back to your projects.';
      case 'failed':
        return 'Project setup did not complete.';
      case 'needs_review':
        return 'The setup pull request merged, but its project files could not be verified. Repair the required files on the repository base branch, then refresh status; this project stays unopened until verification succeeds.';
    }
  }

  protected isSetupLocked(): boolean {
    const status = this.setupStatus();
    return (
      status === 'pending_merge' ||
      status === 'needs_review' ||
      (this.projectCreateSubmitted() && status === undefined)
    );
  }

  protected isCreateRetryLocked(): boolean {
    return this.createNeedsSameOperationRetry();
  }

  private startGithubOAuth(
    owner: string,
    repository: string,
    operationID: string,
    requiredScopes: readonly ('repo' | 'workflow')[],
  ): void {
    const actorID = this.userID();
    const generation = this.selectionGeneration;
    const intentPayload = this.operationPayload();
    const isCurrent = () =>
      this.userID() === actorID &&
      this.selectionGeneration === generation &&
      this.operationID() === operationID &&
      this.operationPayload() === intentPayload;
    this.isCreating.set(true);
    if (!this.saveDraft()) {
      this.isCreating.set(false);
      this.oauthResumePending.set(false);
      this.formError.set('Project details could not be saved for the GitHub redirect. Keep this page open and retry after enabling browser session storage.');
      return;
    }
    this.connection.startOAuth({ operationID, owner, repository, requiredScopes }).subscribe({
      next: ({ authorizationURL }) => {
        if (!isCurrent()) return;
        try {
          const url = new URL(authorizationURL);
          if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.pathname !== '/login/oauth/authorize' || url.username || url.password) throw new Error();
          const state = url.searchParams.get('state');
          if (!state || state.length > 512) throw new Error();
          this.oauthState.set(state);
          if (!this.saveDraft()) {
            this.oauthState.set(undefined);
            this.oauthResumePending.set(false);
            this.isCreating.set(false);
            this.formError.set('Project details could not be saved for the GitHub redirect. Keep this page open and retry after enabling browser session storage.');
            return;
          }
          window.location.assign(url.href);
        } catch {
          this.isCreating.set(false);
          this.oauthResumePending.set(false);
          this.saveDraft();
          this.formError.set('GitHub authorization could not be started. Retry the same project request.');
        }
      },
      error: (error: unknown) => {
        if (!isCurrent()) return;
        this.isCreating.set(false);
        this.oauthResumePending.set(false);
        this.saveDraft();
        this.formError.set(
          githubProjectErrorCode(error) === 'unavailable'
            ? 'GitHub authorization is not configured for this environment yet. Your project details are saved; try again later.'
            : 'GitHub authorization could not be started. Retry the same project request.',
        );
      },
    });
  }

  private requiredOAuthScopes(): readonly ('repo' | 'workflow')[] {
    return this.ciEnabled() ? ['repo', 'workflow'] : ['repo'];
  }

  private submitGithubProject(
    request: CreateGithubProject,
    owner: string,
    repository: string,
    operationID: string,
  ): void {
    const generation = this.selectionGeneration;
    const actorID = this.userID();
    const previouslyUncertain = this.createNeedsSameOperationRetry();
    const isCurrent = () =>
      generation === this.selectionGeneration &&
      this.userID() === actorID &&
      this.operationID() === operationID &&
      this.resolvedCreateRequest() === request;
    this.createNeedsSameOperationRetry.set(true);
    if (!this.saveDraft()) {
      this.isCreating.set(false);
      return;
    }
    this.isCreating.set(true);
    this.queryApi.create(request).subscribe({
      next: (created) => {
        if (!isCurrent()) return;
        this.isCreating.set(false);
        this.createNeedsSameOperationRetry.set(false);
        this.createConflictNeedsStatusCheck.set(false);
        this.setupStatus.set(created.status);
        this.setupPR.set({ url: created.setupPR.url, number: created.setupPR.number });
        this.projectCreateSubmitted.set(true);
        this.oauthResumePending.set(false);
        this.oauthState.set(undefined);
        this.formError.set(undefined);
        this.saveDraft();
      },
      error: (error: unknown) => {
        if (!isCurrent()) return;
        if (githubProjectErrorCode(error) === 'workflow_scope_required') {
          if (!this.ciEnabled()) {
            this.handleCreateFailure(error, previouslyUncertain);
            return;
          }
          if (previouslyUncertain)
            this.createConflictNeedsStatusCheck.set(true);
          else
            this.createNeedsSameOperationRetry.set(false);
          this.oauthResumePending.set(true);
          this.saveDraft();
          this.startGithubOAuth(owner, repository, operationID, this.requiredOAuthScopes());
          return;
        }
        this.handleCreateFailure(error, previouslyUncertain);
      },
    });
  }

  private handleCreateFailure(error: unknown, previouslyUncertain = false): void {
    this.isCreating.set(false);
    const failure = githubProjectCreateFailure(error);
    this.createNeedsSameOperationRetry.set(
      failure.retrySameOperation || previouslyUncertain,
    );
    this.createConflictNeedsStatusCheck.set(
      githubProjectErrorCode(error) === 'conflict' ||
        (previouslyUncertain && !failure.retrySameOperation),
    );
    this.saveDraft();
    this.formError.set(failure.message);
  }
  private dismissAndGo(ref: IProjectContext['ref']): void {
    const source = this.copySource();
    const actor = this.userID();
    const operation = this.operationID();
    const token = this.demoContinuation ?? (actor && operation ? this.demoContinuations.find(actor, operation, source) : undefined);
    if (token && source && actor) {
      const continuation = this.demoContinuations.bind(token, actor, source, operation, ref);
      if (!continuation) {
        this.formError.set('The project is ready, but its edited database continuation belongs to another setup. Return to the demo to keep exploring.');
        return;
      }
      const destination = this.router.parseUrl(projectPageHref(ref, ['browser-db', 'demo']));
      destination.queryParams = { projectApi: ref.projectApi, branch: ref.branch, demoContinuation: token };
      void this.router.navigateByUrl(destination, { replaceUrl: true });
      return;
    }
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

  billingIntentChanged(value: unknown): void {
    if (value !== 'personal_pro' && value !== 'space_business') return;
    if (this.isSetupLocked() || this.isCreating() || this.isCreateRetryLocked()) return;
    this.billingIntent.set(value);
    this.saveDraft();
  }

  private saveDraft(): boolean {
    try {
      if (this.demoContinuation && this.userID() && this.copySource()) {
        if (!this.demoContinuations.bind(this.demoContinuation, this.userID() as string, this.copySource() as GithubProjectCopySource, this.operationID())) {
          this.formError.set('This edited database continuation belongs to another account or setup. Return to the demo to start a new copy.');
          return false;
        }
      }
      const draft: NewProjectDraft = {
        demoContinuation: this.demoContinuation,
        billingIntent: this.billingIntent(),
        source: this.copySource(),
        returnUrl: this.returnUrl,
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
        operationBranch: this.operationBranch(),
        recoveryBranch: this.recoveryBranch(),
        createNeedsSameOperationRetry: this.createNeedsSameOperationRetry(),
        createConflictNeedsStatusCheck: this.createConflictNeedsStatusCheck(),
        oauthResumePending: this.oauthResumePending(),
        projectCreateSubmitted: this.projectCreateSubmitted(),
        setupPR: this.setupPR(),
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
      this.resumeOAuthDraftIfReady();
      return;
    }
    clearNewProjectDraft();
  }

  private resumeOAuthDraftIfReady(): void {
    const draft = this.restoredDraft();
    const uid = this.userID();
    if (
      this.oauthResumeQueued ||
      this.route.snapshot.queryParamMap.get('oauthResult') !== 'success' ||
      !uid ||
      !draft?.oauthResumePending ||
      draft.actorID !== uid
    ) return;
    this.oauthResumeQueued = true;
    this.oauthResumePending.set(false);
    this.saveDraft();
    queueMicrotask(() => {
      if (this.userID() === uid) this.create();
      else this.oauthResumeQueued = false;
    });
  }

  private applyDraft(draft: NewProjectDraft): void {
    const storeParam = this.route.snapshot.queryParamMap.get('store');
    if (storeParam === null) this.store.set(draft.store);
    this.copySource.set(draft.source);
    this.demoContinuation = draft.demoContinuation;
    if (!this.route.snapshot.queryParamMap.get('billingIntent'))
      this.billingIntent.set(draft.billingIntent ?? 'personal_pro');
    this.title.set(draft.title);
    this.githubFolder.set(draft.githubFolder);
    this.githubRepositoryURL.set(draft.githubRepositoryURL ?? '');
    this.ciEnabled.set(draft.ciEnabled ?? true);
    this.operationID.set(draft.operationID);
    const legacyOperation =
      draft.operationBranch === undefined && draft.operationPayload;
    const restoredBranch = draft.operationBranch ?? draft.branch ?? '';
    const restoredPayload =
      legacyOperation && draft.operationPayload
        ? addSelectedBranchToLegacyIntent(draft.operationPayload, restoredBranch)
        : draft.operationPayload;
    this.operationPayload.set(restoredPayload);
    this.operationBranch.set(
      draft.operationBranch ??
        (legacyOperation ? restoredBranch : undefined),
    );
    this.recoveryBranch.set(draft.recoveryBranch);
    this.createNeedsSameOperationRetry.set(
      draft.createNeedsSameOperationRetry ??
        (!!draft.resolvedCreateRequest && !draft.projectCreateSubmitted),
    );
    this.createConflictNeedsStatusCheck.set(
      draft.createConflictNeedsStatusCheck ?? false,
    );
    this.oauthResumePending.set(draft.oauthResumePending ?? false);
    this.projectCreateSubmitted.set(draft.projectCreateSubmitted ?? false);
    this.setupPR.set(draft.setupPR);
    if (draft.projectCreateSubmitted) this.setupStatus.set('pending_merge');
    this.oauthState.set(draft.oauthState);
    this.resolvedCreateRequest.set(draft.resolvedCreateRequest);
    this.branch.set(draft.branch ?? '');
    this.spaceTitle.set(draft.spaceTitle);
    if (
      !this.requestedSpaceID() &&
      this.spaces().some((space) => space.id === draft.spaceID)
    )
      this.spaceID.set(draft.spaceID ?? '');
    this.applyRequestedCopySource();
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
      demoContinuation: validContinuationToken(draft.demoContinuation) ? draft.demoContinuation : undefined,
      billingIntent: draft.billingIntent === 'space_business' ? 'space_business' : 'personal_pro',
      source: readGithubProjectCopySource(draft.source),
      returnUrl: safeNewProjectReturnUrl(draft.returnUrl),
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
      operationBranch:
        typeof draft.operationBranch === 'string'
          ? draft.operationBranch.slice(0, 255)
          : undefined,
      recoveryBranch:
        typeof draft.recoveryBranch === 'string'
          ? draft.recoveryBranch.slice(0, 255)
          : undefined,
      createNeedsSameOperationRetry:
        typeof draft.createNeedsSameOperationRetry === 'boolean'
          ? draft.createNeedsSameOperationRetry
          : undefined,
      createConflictNeedsStatusCheck:
        typeof draft.createConflictNeedsStatusCheck === 'boolean'
          ? draft.createConflictNeedsStatusCheck
          : undefined,
      oauthResumePending: draft.oauthResumePending === true,
      projectCreateSubmitted: draft.projectCreateSubmitted === true,
      setupPR: isSafeSetupPR(draft.setupPR) ? draft.setupPR : undefined,
      oauthState: typeof draft.oauthState === 'string' ? draft.oauthState.slice(0, 512) : undefined,
      resolvedCreateRequest: isCreateGithubProject(draft.resolvedCreateRequest) ? draft.resolvedCreateRequest : undefined,
    };
  } catch {
    return undefined;
  }
}

function addSelectedBranchToLegacyIntent(
  payload: string,
  selectedBranch: string,
): string {
  try {
    const intent: unknown = JSON.parse(payload);
    if (!intent || typeof intent !== 'object' || Array.isArray(intent))
      return payload;
    const value = intent as Record<string, unknown>;
    if ('selectedBranch' in value) return payload;
    return JSON.stringify({ ...value, selectedBranch });
  } catch {
    return payload;
  }
}

function isPendingGithubProjectSetup(value: unknown): value is PendingGithubProjectSetup {
  if (!value || typeof value !== 'object') return false;
  const setup = value as Partial<PendingGithubProjectSetup>;
  const folder = typeof setup.folder === 'string' ? readNewProjectFolder(setup.folder) : undefined;
  return (
    typeof setup.operationID === 'string' && /^[0-9a-f-]{36}$/i.test(setup.operationID) &&
    (setup.status === 'initializing' || setup.status === 'pending_merge' || setup.status === 'needs_review') &&
    typeof setup.spaceID === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(setup.spaceID) &&
    typeof setup.projectID === 'string' && setup.projectID.length > 0 && setup.projectID.length <= 128 &&
    typeof setup.title === 'string' && setup.title.length >= 2 && setup.title.length <= 100 &&
    typeof setup.repositoryID === 'number' && Number.isSafeInteger(setup.repositoryID) && setup.repositoryID > 0 &&
    typeof setup.owner === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(setup.owner) &&
    typeof setup.name === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(setup.name) &&
    !!folder?.ok &&
    typeof setup.branch === 'string' && setup.branch.length > 0 && setup.branch.length <= 255 && !Array.from(setup.branch).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) &&
    typeof setup.ciEnabled === 'boolean' &&
    typeof setup.expectedHead === 'string' && /^[0-9a-f]{7,64}$/i.test(setup.expectedHead) &&
    (setup.source !== undefined ? !!readGithubProjectCopySource(setup.source) : (typeof setup.templateID === 'string' && setup.templateID.length <= 100 &&
    typeof setup.templateCommit === 'string' && /^[0-9a-f]{7,64}$/i.test(setup.templateCommit))) &&
    (setup.billingIntent === 'personal_pro' || setup.billingIntent === 'space_business') &&
    (setup.setupPR === undefined || isSafeFullSetupPR(setup.setupPR))
  );
}

function isSafeFullSetupPR(value: unknown): value is NonNullable<PendingGithubProjectSetup['setupPR']> {
  if (!value || typeof value !== 'object') return false;
  const pr = value as Partial<NonNullable<PendingGithubProjectSetup['setupPR']>>;
  return typeof pr.url === 'string' && /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/.test(pr.url) &&
    Number.isInteger(pr.number) && (pr.number as number) > 0 &&
    typeof pr.headBranch === 'string' && pr.headBranch.length <= 255 &&
    typeof pr.baseBranch === 'string' && pr.baseBranch.length <= 255 &&
    typeof pr.commit === 'string' && /^[0-9a-f]{7,64}$/i.test(pr.commit) &&
    typeof pr.repositoryID === 'number' && Number.isSafeInteger(pr.repositoryID) && pr.repositoryID > 0;
}

function samePendingSetupBinding(
  left: PendingGithubProjectSetup,
  right: PendingGithubProjectSetup,
): boolean {
  return left.operationID === right.operationID &&
    left.spaceID === right.spaceID &&
    left.projectID === right.projectID &&
    left.title === right.title &&
    left.repositoryID === right.repositoryID &&
    left.owner === right.owner &&
    left.name === right.name &&
    left.folder === right.folder &&
    left.branch === right.branch &&
    left.ciEnabled === right.ciEnabled &&
    left.expectedHead === right.expectedHead &&
    JSON.stringify(left.source) === JSON.stringify(right.source) &&
    left.templateID === right.templateID &&
    left.templateCommit === right.templateCommit &&
    left.billingIntent === right.billingIntent;
}

function clearNewProjectDraft(): void {
  try {
    sessionStorage.removeItem(NEW_PROJECT_DRAFT_KEY);
  } catch {
    // Session storage is optional; page navigation still works without it.
  }
}

function isSafeSetupPR(value: unknown): value is { readonly url: string; readonly number: number } {
  if (!value || typeof value !== 'object') return false;
  const pullRequest = value as { url?: unknown; number?: unknown };
  return (
    typeof pullRequest.url === 'string' &&
    /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/.test(pullRequest.url) &&
    Number.isInteger(pullRequest.number) &&
    (pullRequest.number as number) > 0
  );
}

function isCreateGithubProject(value: unknown): value is CreateGithubProject {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<CreateGithubProject>;
  return (
    (request.source === undefined || !!readGithubProjectCopySource(request.source)) &&
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
    case 'source_too_large':
      return {
        message: 'This private project is too large to copy through GitHub setup. Clone the repository with Git and use the DataTug CLI.',
        retrySameOperation: false,
      };
    case 'workflow_conflict':
      return {
        message:
          'The workflow setup conflicts with this repository. Review the workflow files, then retry with the same project details or choose another branch.',
        retrySameOperation: false,
      };
    case 'conflict':
      return {
        message:
          'The branch, folder or shared-project limit conflicts with current state. Retry the saved operation to resolve its outcome before changing project details.',
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
      'Creation was not confirmed. Retry the saved operation to recover its outcome before changing project details.',
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

function isHttpStatus(error: unknown, expected: number): boolean {
  return !!error && typeof error === 'object' &&
    (error as { status?: unknown }).status === expected;
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
