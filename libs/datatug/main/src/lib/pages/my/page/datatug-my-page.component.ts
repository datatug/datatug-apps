import { Component, ViewChild, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SubscriptionRecoveryComponent } from '@sneat/components';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';
import { HostedCloudLogsAccessService } from '../cloud-logs/hosted-cloud-logs-access.service';

@Component({
  selector: 'sneat-datatug-my',
  templateUrl: './datatug-my-page.component.html',
  imports: [
    FormsModule,
    RouterLink,
    SubscriptionRecoveryComponent,
    DatatugServicesStoreModule,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonTitle,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonInput,
    IonButton,
    IonNote,
  ],
})
export class DatatugMyPageComponent {
  readonly hostedCloudLogsAccess = inject(HostedCloudLogsAccessService);
  readonly enableHostedCloudLogs = computed(
    () => this.hostedCloudLogsAccess.state().status === 'allowed',
  );
  private readonly router = inject(Router);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);
  readonly cloudLogsAccessMessage = computed(() => {
    if (this.hostedCloudLogsAccess.state().status === 'allowed') return '';
    switch (this.query()?.get('cloudLogsAccess')) {
      case 'denied':
        return 'Your account does not have access to hosted Google Cloud Logs.';
      case 'disabled':
        return 'Hosted Google Cloud Logs is not available in this build.';
      case 'signed-out':
        return 'Sign in again to check access to hosted Google Cloud Logs.';
      case 'auth-unavailable':
        return 'We could not verify your sign-in. Reload to retry or sign in again.';
      default:
        return '';
    }
  });

  retryHostedCloudLogsAccess(): void {
    this.hostedCloudLogsAccess.retry();
  }

  retryAuthenticationCheck(): void {
    window.location.reload();
  }
  protected readonly subscriptionQuery = computed(() =>
    this.query()?.get('checkout') === 'test' ? { checkout: 'test' } : {},
  );
  @ViewChild(SubscriptionRecoveryComponent)
  private recovery?: SubscriptionRecoveryComponent;
  ionViewWillEnter(): void {
    this.recovery?.refresh();
  }

  // First-slice entry point for the read-only "explore my raw data" viewer
  // (see space-explorer-page.component.ts). A "my spaces" list isn't wired
  // up in datatug-apps yet, so the user types the spaceId they already know
  // from Sneat — see
  // backstage/docs/roadmaps/datatug-transparency-explorer.md §6.
  protected readonly exploreSpaceId = signal('');

  protected goExplore(): void {
    const spaceId = this.exploreSpaceId().trim();
    if (!spaceId) {
      return;
    }
    this.router.navigate(['/explore', spaceId]);
  }

  // Entry point for the read-only GitHub/inGitDB vault variant of the
  // explorer (see vault-explorer-page.component.ts) — the repo/branch/token
  // are entered on that page itself, so no input is needed here.
  protected goExploreVault(): void {
    this.router.navigate(['/explore-vault']);
  }
}
