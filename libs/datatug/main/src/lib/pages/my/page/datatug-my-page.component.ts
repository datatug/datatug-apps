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
import { hostedCloudLogsEnabled } from '../../../core/feature-flags';

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
  readonly enableHostedCloudLogs = hostedCloudLogsEnabled();
  private readonly router = inject(Router);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);
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
