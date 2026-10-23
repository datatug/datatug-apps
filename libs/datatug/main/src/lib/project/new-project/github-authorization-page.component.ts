import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { filter, switchMap, take, Subject, takeUntil } from 'rxjs';
import {
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButton,
} from '@ionic/angular';
import { GithubConnectionService } from '../../services/repo/github/github-connection.service';
import { NewProjectService } from './new-project.service';
import {
  clearBusinessGithubContinuation,
  takeBusinessGithubContinuation,
} from './business-github-continuation';
import {
  clearPendingGithubReconnect,
  readPendingGithubReconnect,
  safeGitHubReconnectReturnUrl,
  type PendingGithubReconnect,
} from './github-reauthorization-banner.component';
import {
  digestReturnedOAuthState,
  isOAuthStateDigest,
} from './oauth-state-digest';

declare global {
  interface Window {
    __datatugTakeGitHubAuthorization?: () =>
      | { code: string; state: string }
      | { error: string; state: string }
      | undefined;
  }
}

@Component({
  selector: 'sneat-datatug-github-authorization-page',
  imports: [IonContent, IonHeader, IonToolbar, IonTitle, IonButton, RouterLink],
  providers: [NewProjectService],
  template: `<ion-header
      ><ion-toolbar
        ><ion-title>Connect GitHub</ion-title></ion-toolbar
      ></ion-header
    >
    <ion-content class="ion-padding"
      ><p>{{ message() }}</p>
      @if (needsSignIn()) {
        <ion-button (click)="signIn()">Sign in to DataTug</ion-button>
      }
      @if (connected()) {
        <ion-button (click)="newProject()">Create a project</ion-button>
      }
      @if (reconnectReturnUrl(); as returnUrl) {
        <ion-button [href]="returnUrl">Return to project</ion-button>
      }
      <ion-button routerLink="/" fill="clear"
        >Back to projects</ion-button
      ></ion-content
    >`,
})
export class GithubAuthorizationPageComponent {
  private readonly auth = inject(SneatAuthStateService);
  private readonly connection = inject(GithubConnectionService);
  private readonly newProjectService = inject(NewProjectService);
  private readonly destroyRef = inject(DestroyRef);
  readonly message = signal('Checking your DataTug sign-in…');
  readonly connected = signal(false);
  readonly needsSignIn = signal(false);
  readonly reconnectReturnUrl = signal<string | undefined>(undefined);
  private readonly boundUserID = signal<string | undefined>(undefined);
  private readonly authChanged = new Subject<void>();
  /** Settles once the callback has been matched to a saved request. */
  private resumed: Promise<void> = Promise.resolve();

  constructor() {
    this.destroyRef.onDestroy(clearBusinessGithubContinuation);
    const authorization = window.__datatugTakeGitHubAuthorization?.();
    delete window.__datatugTakeGitHubAuthorization;
    if (!authorization) {
      this.message.set(
        'GitHub authorization was canceled or did not return. Your project details are saved; retry from the project form.',
      );
      return;
    }
    // Saved requests hold only a digest of the OAuth state, so the returned
    // state is digested before it is matched to a saved request.
    this.resumed = digestReturnedOAuthState(authorization.state).then(
      (stateDigest) => this.resumeAuthorization(authorization, stateDigest),
    );
  }
  private resumeAuthorization(
    authorization: { code: string; state: string } | { error: string; state: string },
    stateDigest: string | undefined,
  ): void {
    if ('error' in authorization) {
      this.message.set('GitHub authorization was canceled. Your project details are saved; retry from the project form.');
      if (hasPendingOAuthProject(stateDigest))
        this.newProjectService.returnFromGithubOAuth('denied');
      const reconnect = readPendingGithubReconnect(stateDigest);
      if (reconnect) {
        clearPendingGithubReconnect();
        this.reconnectReturnUrl.set(reconnect.returnUrl);
        this.message.set('GitHub reconnection was canceled. Return to the project and try again when ready.');
      }
      return;
    }
    // Existing GitHub App callbacks remain supported. Only the explicit
    // operation-bound marker selects the new OAuth project-create flow.
    const isOAuthProjectFlow = hasPendingOAuthProject(stateDigest);
    const reconnect = readPendingGithubReconnect(stateDigest);
    this.watchAuthChanges(isOAuthProjectFlow, reconnect);
    if (reconnect) {
      this.completeGithubReconnect(authorization.code, authorization.state, reconnect);
      return;
    }
    if (!isOAuthProjectFlow) {
      this.completeLegacyAuthorization(authorization.code, authorization.state);
      return;
    }
    const operationID = readPendingOperationID();
    if (!operationID) {
      this.message.set(
        'The saved project request is missing. Return to the project form and submit again.',
      );
      this.newProjectService.returnFromGithubOAuth('denied');
      return;
    }
    const expectedActorID = readPendingGitHubActorID();
    const requiresWorkflow = readPendingCIEnabled();
    this.auth.authState
      .pipe(
        filter((auth) => auth.status === 'authenticated' && !!auth.user?.uid),
        take(1),
        switchMap((auth) => {
          this.boundUserID.set(auth.user?.uid);
          return this.connection.completeOAuth(
            operationID,
            authorization.code,
            authorization.state,
          );
        }),
        takeUntil(this.authChanged),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          if (result.connected === true && expectedActorID && String(result.actorID) !== expectedActorID) {
            resetPendingProjectForGitHubActor(String(result.actorID));
            this.message.set('The GitHub account changed. Choose the repository and branch again before continuing.');
            this.newProjectService.returnFromGithubOAuth('actor-changed');
            return;
          }
          if (
            result.connected === true &&
            result.scopes.includes('repo') &&
            (!requiresWorkflow || result.scopes.includes('workflow'))
          ) {
            bindGitHubActorID(String(result.actorID));
            this.connected.set(true);
            this.message.set(
              'GitHub access is ready. Resuming your saved project request…',
            );
            this.newProjectService.returnFromGithubOAuth('success');
          } else {
            this.message.set(
              'GitHub access did not match this DataTug account or include repository permission. Your project details are saved; retry authorization from the project form.',
            );
            this.newProjectService.returnFromGithubOAuth('denied');
          }
        },
        error: () => {
          this.message.set(
            'GitHub could not be connected. Your project details are saved; retry authorization from the project form.',
          );
          this.newProjectService.returnFromGithubOAuth('denied');
        },
      });
  }
  private watchAuthChanges(
    isOAuthProjectFlow: boolean,
    reconnect?: PendingGithubReconnect,
  ): void {
    this.auth.authState
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((auth) => {
        this.needsSignIn.set(auth.status === 'notAuthenticated');
        const uid = auth.status === 'authenticated' ? auth.user?.uid : undefined;
        if (!this.boundUserID() && uid) {
          this.boundUserID.set(uid);
          return;
        }
        if (
          this.boundUserID() &&
          (!uid || uid !== this.boundUserID())
        ) {
          this.authChanged.next();
          this.connected.set(false);
          this.message.set('Your sign-in changed. Start Connect GitHub again.');
          if (isOAuthProjectFlow)
            this.newProjectService.returnFromGithubOAuth('denied');
          if (reconnect) {
            clearPendingGithubReconnect();
            this.reconnectReturnUrl.set(reconnect.returnUrl);
          }
        }
      });
  }
  private completeGithubReconnect(
    code: string,
    state: string,
    reconnect: PendingGithubReconnect,
  ): void {
    this.auth.authState
      .pipe(
        filter((auth) => auth.status === 'authenticated' && !!auth.user?.uid),
        take(1),
        switchMap((auth) => {
          const firebaseUID = auth.user?.uid;
          if (firebaseUID !== reconnect.firebaseUID) {
            throw new Error('DataTug sign-in changed during GitHub reconnection');
          }
          this.boundUserID.set(firebaseUID);
          return this.connection.completeOAuth(reconnect.operationID, code, state);
        }),
        takeUntil(this.authChanged),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          if (!result.connected || !reconnect.requiredScopes.every((requiredScope) => result.scopes.some((scope) => scope.split(',').includes(requiredScope)))) {
            clearPendingGithubReconnect();
            this.reconnectReturnUrl.set(reconnect.returnUrl);
            this.message.set('GitHub did not grant the requested access. Return to the project and retry reconnect.');
            return;
          }
          clearPendingGithubReconnect();
          this.message.set('GitHub reconnected. Returning to your project…');
          window.location.assign(safeGitHubReconnectReturnUrl(reconnect.returnUrl));
        },
        error: () => {
          clearPendingGithubReconnect();
          this.reconnectReturnUrl.set(reconnect.returnUrl);
          this.message.set('GitHub could not be reconnected. Return to the project and retry.');
        },
      });
  }
  private completeLegacyAuthorization(code: string, state: string): void {
    this.auth.authState
      .pipe(
        filter((auth) => auth.status === 'authenticated' && !!auth.user?.uid),
        take(1),
        switchMap((auth) => {
          this.boundUserID.set(auth.user?.uid);
          return this.connection.complete(code, state);
        }),
        takeUntil(this.authChanged),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          if (!result.connected || !this.boundUserID()) return;
          this.connected.set(true);
          this.message.set('GitHub is connected. Choose a repository and branch to create your project.');
        },
        error: () => this.message.set('GitHub could not be connected. Start Connect GitHub again.'),
      });
  }
  signIn(): void {
    void this.auth
      .signInWith('google.com')
      .catch(() =>
        this.message.set('Sign-in could not be completed. Please try again.'),
      );
  }
  newProject(): void {
    const boundUserID = this.boundUserID();
    if (!this.connected() || !boundUserID) return;
    const continuation = takeBusinessGithubContinuation(boundUserID);
    if (continuation) {
      this.newProjectService.navigateToNewProjectPage('github', '/', continuation);
    } else {
      this.newProjectService.navigateToNewProjectPage('github', '/');
    }
  }
}

function readPendingOperationID(): string | undefined {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem('datatug:new-project:draft') ?? 'null',
    );
    if (!value || typeof value !== 'object') return undefined;
    const operationID = (value as { operationID?: unknown }).operationID;
    return typeof operationID === 'string' && /^[0-9a-f-]{36}$/i.test(operationID)
      ? operationID
      : undefined;
  } catch {
    return undefined;
  }
}

function hasPendingOAuthProject(returnedStateDigest: string | undefined): boolean {
  const draft = readPendingDraft();
  return (
    !!returnedStateDigest &&
    draft?.['oauthResumePending'] === true &&
    typeof draft['operationID'] === 'string' &&
    /^[0-9a-f-]{36}$/i.test(draft['operationID']) &&
    isOAuthStateDigest(draft['oauthStateDigest']) &&
    draft['oauthStateDigest'] === returnedStateDigest
  );
}

function readPendingDraft(): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem('datatug:new-project:draft') ?? 'null',
    );
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readPendingGitHubActorID(): string | undefined {
  const actorID = readPendingDraft()?.['githubActorID'];
  return typeof actorID === 'string' ? actorID : undefined;
}

function readPendingCIEnabled(): boolean {
  return readPendingDraft()?.['ciEnabled'] !== false;
}

function bindGitHubActorID(actorID: string): void {
  const draft = readPendingDraft();
  if (!draft) return;
  try {
    sessionStorage.setItem(
      'datatug:new-project:draft',
      JSON.stringify({ ...draft, githubActorID: actorID, oauthStateDigest: undefined }),
    );
  } catch {
    // The form reports storage failures when it resumes.
  }
}

function resetPendingProjectForGitHubActor(actorID: string): void {
  const draft = readPendingDraft();
  if (!draft) return;
  try {
    sessionStorage.setItem(
      'datatug:new-project:draft',
      JSON.stringify({
        ...draft,
        githubActorID: actorID,
        repositoryID: undefined,
        githubRepositoryURL: '',
        branch: '',
        operationID: undefined,
        operationPayload: undefined,
        operationBranch: undefined,
        recoveryBranch: undefined,
        createNeedsSameOperationRetry: false,
        createConflictNeedsStatusCheck: false,
        resolvedCreateRequest: undefined,
        oauthResumePending: false,
        oauthStateDigest: undefined,
        projectCreateSubmitted: false,
      }),
    );
  } catch {
    // The project form keeps its normal storage error behavior.
  }
}
