import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SneatAuthStateService } from '@sneat/auth-core';
import { IonButton, IonButtons, IonCard, IonCardContent, IonIcon, IonItemDivider, IonLabel } from '@ionic/angular';
import { closeOutline, logoGithub, warningOutline } from 'ionicons/icons';
import { filter, switchMap, take, map } from 'rxjs';
import { IProjectRef, equalProjectRef } from '../../core/project-context';
import { readGithubProjectId } from '@datatug/project-address';
import {
  GithubReauthorizationReason,
  ProjectQueryApiService,
} from '../../services/project/project-query-api.service';
import { GithubConnectionService } from '../../services/repo/github/github-connection.service';
import { Router } from '@angular/router';
import { sha256Hex, isSha256Hex } from './sha256-hex';

export interface PendingGithubReconnect {
  readonly operationID: string;
  readonly firebaseUID: string;
  /** SHA-256 hash of the OAuth state; the state itself is never stored. */
  readonly oauthStateHash: string;
  readonly returnUrl: string;
  readonly requiredScopes: readonly ('repo' | 'workflow')[];
}

export const GITHUB_RECONNECT_SESSION_KEY = 'datatug:github:reconnect';

@Component({
  selector: 'sneat-datatug-github-reauthorization-banner',
  imports: [IonButton, IonButtons, IonCard, IonCardContent, IonIcon, IonItemDivider, IonLabel],
  styles: `
    /* The app's global divider rule (styles.scss) paints every divider light; this status header keeps Ionic's
       warning colour, with its own contrast colour for the icon and title in light and dark mode. */
    .reauthorization-header {
      --background: var(--ion-color-warning);
      --color: var(--ion-color-warning-contrast);
      background: var(--ion-color-warning);
      color: var(--ion-color-warning-contrast);
    }
    .reauthorization-title {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }
    /* Message and action share one line on wide screens; the button wraps
       below, right-aligned, on a narrow one. */
    .reauthorization-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 16px;
    }
    .reauthorization-text {
      flex: 1 1 18rem;
    }
    .reauthorization-text p {
      margin: 0;
    }
    .reauthorization-text p + p {
      margin-top: 8px;
    }
    .reauthorization-row ion-button {
      flex: 0 0 auto;
      margin: 0 0 0 auto;
    }
  `,
  template: `
    @if (required()) {
      @if (reason() === 'expired') {
        <ion-card data-testid="github-reauthorization">
          <!-- A status card: the warning header (Ionic warning colour and its contrast colour for the icon and title)
               marks it as an alert; the body stays neutral. -->
          <ion-item-divider color="warning" class="reauthorization-header">
            <ion-icon slot="start" [icon]="warningIcon" aria-hidden="true" />
            <ion-label><h2 class="reauthorization-title">GitHub access expired.</h2></ion-label>
          </ion-item-divider>
          <ion-card-content class="reauthorization-row">
            <div class="reauthorization-text">
              <p>Reconnect to continue. GitHub authorization applies to your account; it is not limited to this repository.</p>
              @if (error()) {
                <p role="alert">{{ error() }}</p>
              }
            </div>
            <ion-button fill="outline" [disabled]="reconnecting()" (click)="reconnect()">
              {{ reconnecting() ? 'Connecting…' : 'Reconnect GitHub' }}
            </ion-button>
          </ion-card-content>
        </ion-card>
      } @else if (!hintDismissed()) {
        <!-- Not connected yet, or access refused with no reason given: a neutral card, never "expired" without
             evidence. On a public repository reads work anonymously, so it is a dismissible hint. -->
        <ion-card data-testid="github-connect" [attr.data-reason]="reason()">
          <ion-item-divider color="light">
            <ion-icon slot="start" [icon]="githubIcon" aria-hidden="true" />
            <ion-label
              ><h2 class="reauthorization-title">
                {{ connectTitle() }}
              </h2></ion-label
            >
            @if (softHint()) {
              <ion-buttons slot="end">
                <ion-button color="medium" aria-label="Dismiss" title="Dismiss" (click)="dismissHint()">
                  <ion-icon [icon]="closeIcon" aria-hidden="true" />
                </ion-button>
              </ion-buttons>
            }
          </ion-item-divider>
          <ion-card-content class="reauthorization-row">
            <div class="reauthorization-text">
              <p>{{ connectMessage() }}</p>
              @if (error()) {
                <p role="alert">{{ error() }}</p>
              }
            </div>
            <ion-button fill="outline" [disabled]="reconnecting()" (click)="reconnect()">
              {{ reconnecting() ? 'Connecting…' : 'Connect GitHub' }}
            </ion-button>
          </ion-card-content>
        </ion-card>
      }
    }
  `,
})
export class GitHubReauthorizationBannerComponent {
  readonly projectRef = input.required<IProjectRef>();
  /** The repository reads anonymously (public): a missing connection is then a soft, dismissible hint. */
  readonly publicRepository = input(false);
  protected readonly warningIcon = warningOutline;
  protected readonly githubIcon = logoGithub;
  protected readonly closeIcon = closeOutline;
  readonly reason = signal<GithubReauthorizationReason>('expired');
  readonly softHint = computed(
    () => this.reason() === 'not_connected' && this.publicRepository(),
  );
  protected readonly connectTitle = computed(() => {
    switch (this.reason()) {
      case 'access_denied':
        return 'GitHub access needed';
      case 'scope_required':
        return 'GitHub permission needed';
      default:
        return 'Connect GitHub';
    }
  });
  protected readonly connectMessage = computed(() => {
    switch (this.reason()) {
      case 'access_denied':
        return 'GitHub did not allow DataTug to use this repository with your current access. Connect GitHub to grant access.';
      case 'scope_required':
        return this.requiredScopes().includes('workflow')
          ? "This also needs GitHub's workflow permission. Connect GitHub again to grant it."
          : 'DataTug needs more GitHub permissions for this repository. Connect GitHub again to grant them.';
      default:
        return this.publicRepository()
          ? 'Connect GitHub to edit this project or open private repositories.'
          : 'This repository needs GitHub access. Connect GitHub to open it in DataTug.';
    }
  });
  private readonly dismissals = signal<readonly string[]>([]);
  /** A dismissed public-repository hint stays hidden for this project for the rest of the browser session. */
  readonly hintDismissed = computed(() => {
    if (!this.softHint()) return false;
    const key = connectHintKey(this.projectRef());
    return this.dismissals().includes(key) || readConnectHintDismissed(key);
  });
  dismissHint(): void {
    const key = connectHintKey(this.projectRef());
    this.dismissals.update((keys) => [...keys, key]);
    try {
      sessionStorage.setItem(key, '1');
    } catch {
      // Storage may be unavailable (private mode); the dismissal still holds for this page.
    }
  }
  readonly returnUrl = input<string | undefined>();
  private readonly requiredRef = signal<IProjectRef | undefined>(undefined);
  readonly required = computed(() => {
    const ref = this.requiredRef();
    return !!ref && equalProjectRef(ref, this.projectRef());
  });
  readonly reconnecting = signal(false);
  readonly error = signal('');
  readonly requiredScopes = signal<readonly ('repo' | 'workflow')[]>(['repo']);

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
      .subscribe((request) => {
        if (equalProjectRef(request.ref, this.projectRef())) {
          this.requiredRef.set(request.ref);
          this.requiredScopes.set(request.requiredScopes);
          // Without a typed reason there is no evidence of expiry.
          this.reason.set(request.reason ?? 'access_denied');
        }
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
    const returnUrl = safeGitHubReconnectReturnUrl(this.returnUrl() ?? this.router.url);
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
              requiredScopes: this.requiredScopes(),
            })
            .pipe(map(({ authorizationURL }) => ({ authorizationURL, firebaseUID, operationID })));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ authorizationURL, firebaseUID, operationID }) => {
          const isCurrent = () =>
            generation === this.requestGeneration() &&
            authGeneration === this.authGeneration() &&
            firebaseUID === this.currentFirebaseUID() &&
            equalProjectRef(ref, this.projectRef());
          const startFailed = () => {
            this.reconnecting.set(false);
            this.error.set('GitHub authorization could not be started. Try again.');
          };
          if (!isCurrent()) return;
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
            const requiredScopes = this.requiredScopes();
            sha256Hex(oauthState).then(
              (oauthStateHash) => {
                if (!isCurrent()) return;
                try {
                  const pending: PendingGithubReconnect = {
                    operationID,
                    firebaseUID,
                    oauthStateHash,
                    returnUrl,
                    requiredScopes,
                  };
                  sessionStorage.setItem(GITHUB_RECONNECT_SESSION_KEY, JSON.stringify(pending));
                  window.location.assign(url.href);
                } catch {
                  startFailed();
                }
              },
              () => {
                if (isCurrent()) startFailed();
              },
            );
          } catch {
            startFailed();
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

const CONNECT_HINT_KEY_PREFIX = 'datatug:github:connect-hint-dismissed:';

function connectHintKey(ref: IProjectRef): string {
  return `${CONNECT_HINT_KEY_PREFIX}${ref.storeId}/${ref.projectId}`;
}

function readConnectHintDismissed(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function safeGitHubReconnectReturnUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const url = new URL(value, 'https://datatug.local');
    if (url.origin !== 'https://datatug.local' || url.pathname === '/github/callback' || url.pathname.startsWith('/github/callback/'))
      return '/';
    if (url.pathname === '/new-project')
      return url.searchParams.get('store') === 'github' && [...url.searchParams.keys()].every((key) => key === 'store')
        ? '/new-project?store=github'
        : '/';
    if (url.pathname.startsWith('/new-project/')) return '/';
    const branch = url.searchParams.get('branch');
    const projectApi = url.searchParams.get('projectApi');
    if (url.searchParams.getAll('branch').length > 1 || url.searchParams.getAll('projectApi').length > 1) return '/';
    if (projectApi !== null && (projectApi !== 'cloud' || !branch)) return '/';
    const safeParams = new URLSearchParams();
    if (projectApi) safeParams.set('projectApi', projectApi);
    if (branch) safeParams.set('branch', branch);
    const query = safeParams.toString();
    return `${url.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return '/';
  }
}

export function readPendingGithubReconnect(
  returnedStateHash: string | undefined,
): PendingGithubReconnect | undefined {
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
      !returnedStateHash ||
      !isSha256Hex(pending.oauthStateHash) ||
      pending.oauthStateHash !== returnedStateHash ||
      typeof pending.returnUrl !== 'string' ||
      !Array.isArray(pending.requiredScopes) ||
      !pending.requiredScopes.includes('repo') ||
      pending.requiredScopes.some((scope) => scope !== 'repo' && scope !== 'workflow') ||
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
