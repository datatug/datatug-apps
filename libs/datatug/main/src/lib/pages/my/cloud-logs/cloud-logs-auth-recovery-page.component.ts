import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AuthStatuses,
  SneatAuthStateService,
  initialSneatAuthState,
  type AuthProviderID,
} from '@sneat/auth-core';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { preserveCloudLogsReturnForAuthRecovery } from './cloud-logs-auth-return';

const signInProviders: readonly {
  readonly id: AuthProviderID;
  readonly label: string;
}[] = [
  { id: 'google.com', label: 'Google' },
  { id: 'microsoft.com', label: 'Microsoft' },
  { id: 'github.com', label: 'GitHub' },
];

@Component({
  selector: 'sneat-datatug-cloud-logs-auth-recovery-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonButton,
    IonContent,
    IonHeader,
    IonNote,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar color="light">
        <ion-title>Sign-in recovery</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <h1>Sign-in is taking longer than expected</h1>
      <p>
        We could not verify your Sneat session yet. Cloud Logs stays closed
        until sign-in is ready. After signing in, continue to Cloud Logs to
        check your access again.
      </p>

      @if (isSignedIn()) {
        <ion-note role="status" aria-live="polite">
          Your Sneat session is ready. Continue to check Cloud Logs access.
        </ion-note>
        <ion-button expand="block" (click)="continueToCloudLogs()">
          Continue to Cloud Logs
        </ion-button>
      } @else {
        <h2>Sign in with</h2>
        @for (provider of signInProviders; track provider.id) {
          <ion-button
            expand="block"
            [disabled]="!!signingWith()"
            (click)="signIn(provider.id)"
          >
            @if (signingWith() === provider.id) {
              <ion-spinner name="lines-small" slot="start" />
            }
            {{ provider.label }}
          </ion-button>
        }
      }

      @if (callbackPreservationUnavailable()) {
        <ion-note role="alert">
          This tab could not keep the pending Cloud Logs return. After sign-in,
          start the Google connection again.
        </ion-note>
      }
      @if (error()) {
        <ion-note role="alert">{{ error() }}</ion-note>
      }

      <ion-button
        class="ion-margin-top"
        expand="block"
        fill="outline"
        color="medium"
        (click)="reloadSignInCheck()"
      >
        Reload sign-in check
      </ion-button>
    </ion-content>
  `,
})
export class CloudLogsAuthRecoveryPageComponent {
  readonly signInProviders = signInProviders;
  private readonly auth = inject(SneatAuthStateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authState = toSignal(this.auth.authState, {
    initialValue: initialSneatAuthState,
  });
  readonly isSignedIn = computed(() => {
    const state = this.authState();
    return (
      state.status === AuthStatuses.authenticated &&
      state.loadingPhase === 'ready' &&
      !!state.user?.uid
    );
  });
  readonly signingWith = signal<AuthProviderID | undefined>(undefined);
  readonly error = signal('');
  readonly callbackPreservationUnavailable = signal(false);

  constructor() {
    this.callbackPreservationUnavailable.set(
      preserveCloudLogsReturnForAuthRecovery() === 'unavailable',
    );
  }

  async signIn(provider: AuthProviderID): Promise<void> {
    if (this.signingWith()) return;
    this.signingWith.set(provider);
    this.error.set('');
    try {
      await this.auth.signInWith(provider);
    } catch {
      // Provider errors can contain redirect details; show a generic recovery action.
      this.error.set('Sign-in could not be started. Try again or reload this check.');
    } finally {
      this.signingWith.set(undefined);
    }
  }

  continueToCloudLogs(): void {
    if (this.isSignedIn()) {
      void this.router.navigateByUrl(this.cloudLogsReturnPath());
    }
  }

  reloadSignInCheck(): void {
    if (typeof window !== 'undefined') window.location.reload();
  }

  private cloudLogsReturnPath(): string {
    const fragment = this.route.snapshot.fragment;
    return fragment === '/my/cloud-logs' ? fragment : '/my/cloud-logs';
  }
}
