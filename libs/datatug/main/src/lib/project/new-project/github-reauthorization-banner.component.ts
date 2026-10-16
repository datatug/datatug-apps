import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SneatAuthStateService } from '@sneat/auth-core';
import { IonButton, IonCard, IonCardContent } from '@ionic/angular';
import { filter, switchMap, take, map } from 'rxjs';
import { IProjectRef, equalProjectRef } from '../../core/project-context';
import { readGithubProjectId } from '@datatug/project-address';
import { ProjectQueryApiService } from '../../services/project/project-query-api.service';
import { GithubConnectionService } from '../../services/repo/github/github-connection.service';
import { Router } from '@angular/router';

export interface PendingGithubReconnect {
  readonly operationID: string;
  readonly firebaseUID: string;
  readonly oauthState: string;
  readonly returnUrl: string;
}

export const GITHUB_RECONNECT_SESSION_KEY = 'datatug:github:reconnect';

@Component({
  selector: 'sneat-datatug-github-reauthorization-banner',
  imports: [IonButton, IonCard, IonCardContent],
  template: `
    @if (required()) {
      <ion-card color="warning" data-testid="github-reauthorization">
        <ion-card-content>
          <p>GitHub access expired. Reconnect to continue viewing this private project.</p>
          @if (error()) {
            <p role="alert">{{ error() }}</p>
          }
          <ion-button fill="outline" [disabled]="reconnecting()" (click)="reconnect()">
            {{ reconnecting() ? 'Connecting…' : 'Reconnect GitHub' }}
          </ion-button>
        </ion-card-content>
      </ion-card>
    }
  `,
})
export class GitHubReauthorizationBannerComponent {
  readonly projectRef = input.required<IProjectRef>();
  private readonly requiredRef = signal<IProjectRef | undefined>(undefined);
  readonly required = computed(() => {
    const ref = this.requiredRef();
    return !!ref && equalProjectRef(ref, this.projectRef());
  });
  readonly reconnecting = signal(false);
  readonly error = signal('');

  private readonly api = inject(ProjectQueryApiService);
  private readonly connection = inject(GithubConnectionService);
  private readonly auth = inject(SneatAuthStateService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentFirebaseUID = signal<string | undefined>(undefined);
  private readonly authGeneration = signal(0);
  private readonly requestGeneration = signal(0);

  constructor() {
    this.api.githubReauthorizationRequired
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ref) => {
        if (equalProjectRef(ref, this.projectRef())) this.requiredRef.set(ref);
      });
    this.auth.authState
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        const nextUID = state.status === 'authenticated' ? state.user?.uid : undefined;
        if (this.currentFirebaseUID() && nextUID !== this.currentFirebaseUID()) {
          this.authGeneration.update((value) => value + 1);
          this.requestGeneration.update((value) => value + 1);
          this.reconnecting.set(false);
          this.error.set('Your sign-in changed. Sign in again before reconnecting GitHub.');
        }
        this.currentFirebaseUID.set(nextUID);
      });
  }

  reconnect(): void {
    const ref = this.projectRef();
    const address = readGithubProjectId(ref.projectId);
    if (!address.ok || (ref.storeId !== 'github' && ref.storeId !== 'github.com')) {
      this.error.set('This project connection cannot be reauthorized here.');
      return;
    }
    const returnUrl = safeGitHubReconnectReturnUrl(this.router.url);
    const generation = this.requestGeneration() + 1;
    this.requestGeneration.set(generation);
    const authGeneration = this.authGeneration();
    this.reconnecting.set(true);
    this.error.set('');
    this.auth.authState
      .pipe(
        filter((state) => state.status === 'authenticated' && !!state.user?.uid),
        take(1),
        switchMap((state) => {
          const firebaseUID = state.user?.uid;
          const operationID = crypto.randomUUID();
          return this.connection
            .startOAuth({
              operationID,
              owner: address.id.org,
              repository: address.id.repo,
              requiredScopes: ['repo'],
            })
            .pipe(map(({ authorizationURL }) => ({ authorizationURL, firebaseUID, operationID })));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ authorizationURL, firebaseUID, operationID }) => {
          if (
            generation !== this.requestGeneration() ||
            authGeneration !== this.authGeneration() ||
            firebaseUID !== this.currentFirebaseUID() ||
            !equalProjectRef(ref, this.projectRef())
          )
            return;
          try {
            const url = new URL(authorizationURL);
            if (
              url.protocol !== 'https:' ||
              url.hostname !== 'github.com' ||
              url.pathname !== '/login/oauth/authorize' ||
              url.username ||
              url.password
            )
              throw new Error('Invalid authorization URL');
            const oauthState = url.searchParams.get('state');
            if (!oauthState || oauthState.length > 512 || !firebaseUID) {
              throw new Error('Missing authorization state');
            }
            const pending: PendingGithubReconnect = {
              operationID,
              firebaseUID,
              oauthState,
              returnUrl,
            };
            sessionStorage.setItem(GITHUB_RECONNECT_SESSION_KEY, JSON.stringify(pending));
            window.location.assign(url.href);
          } catch {
            this.reconnecting.set(false);
            this.error.set('GitHub authorization could not be started. Try again.');
          }
        },
        error: (error: unknown) => {
          if (generation !== this.requestGeneration() || authGeneration !== this.authGeneration()) return;
          this.reconnecting.set(false);
          this.error.set(
            error && typeof error === 'object' &&
              'status' in error && (error as { status?: unknown }).status === 503
              ? 'GitHub authorization is not configured for this environment yet.'
              : 'GitHub could not be reconnected. Try again.',
          );
        },
      });
  }
}

export function safeGitHubReconnectReturnUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const url = new URL(value, 'https://datatug.local');
    if (
      url.origin !== 'https://datatug.local' ||
      url.pathname === '/github/callback' ||
      url.pathname.startsWith('/github/callback/') ||
      url.pathname === '/new-project' ||
      url.pathname.startsWith('/new-project/')
    )
      return '/';
    const branch = url.searchParams.get('branch');
    return `${url.pathname}${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`;
  } catch {
    return '/';
  }
}

export function readPendingGithubReconnect(returnedState: string): PendingGithubReconnect | undefined {
  try {
    const raw = sessionStorage.getItem(GITHUB_RECONNECT_SESSION_KEY);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return undefined;
    const pending = value as Partial<PendingGithubReconnect>;
    if (
      typeof pending.operationID !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(pending.operationID) ||
      typeof pending.firebaseUID !== 'string' ||
      typeof pending.oauthState !== 'string' ||
      pending.oauthState !== returnedState ||
      typeof pending.returnUrl !== 'string' ||
      safeGitHubReconnectReturnUrl(pending.returnUrl) !== pending.returnUrl
    )
      return undefined;
    return pending as PendingGithubReconnect;
  } catch {
    return undefined;
  }
}

export function clearPendingGithubReconnect(): void {
  try {
    sessionStorage.removeItem(GITHUB_RECONNECT_SESSION_KEY);
  } catch {
    // The callback remains fail-closed when session storage is unavailable.
  }
}
