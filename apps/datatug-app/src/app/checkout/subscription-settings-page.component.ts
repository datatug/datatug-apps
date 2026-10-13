import {
  ChangeDetectionStrategy,
  Component,
  ViewChild,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonContent } from '@ionic/angular/ion-content';
import { IonChip } from '@ionic/angular/ion-chip';
import { SubscriptionSettingsComponent } from '@sneat/components';
import { AuthPanelComponent } from '@sneat/auth-ui';
import {
  SneatAuthStateService,
  SneatUserService,
  isSneatAccountReady,
} from '@sneat/auth-core';

@Component({
  selector: 'datatug-subscription-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonChip,
    SubscriptionSettingsComponent,
    AuthPanelComponent,
  ],
  styles: [
    `
      :host main {
        max-width: 960px;
        margin: 0 auto;
        padding: 16px;
      }
      .navigation {
        margin: 16px;
      }
    `,
  ],
  template: `<ion-header
      ><ion-toolbar
        ><ion-title>DataTug · Subscriptions</ion-title>
        @if (mode() === 'test') {
          <ion-chip slot="end" color="warning">Test mode</ion-chip>
        }
      </ion-toolbar></ion-header
    >
    <ion-content
      ><main>
        <p class="navigation">
          <a
            [routerLink]="accountId() ? '/subscriptions' : '/my'"
            [queryParams]="mode() === 'test' ? { checkout: 'test' } : {}"
            >{{
              accountId() ? 'Back to subscriptions' : 'Back to My DataTug'
            }}</a
          >
        </p>
        @if (!valid()) {
          <p role="alert">This subscription link is invalid.</p>
        } @else if (!ready()) {
          <p>
            Sign in with your <a href="https://sneat.co/">Sneat.co</a> account
            to manage your subscriptions.
          </p>
          <sneat-auth-panel [showIntro]="false" [returnTo]="returnTo()" />
        } @else {
          <sneat-subscription-settings
            [accountId]="accountId()"
            [mode]="mode()"
            [transferView]="transferView()"
            [requestId]="requestId()"
          />
          <p class="navigation" role="note">
            Shown prices cover the base subscription. Usage and separate add-ons
            are billed separately where applicable.
          </p>
        }
      </main></ion-content
    >`,
})
export class SubscriptionSettingsPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  @ViewChild(SubscriptionSettingsComponent)
  private settings?: SubscriptionSettingsComponent;
  ionViewWillEnter(): void {
    this.settings?.refresh();
  }
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly auth = toSignal(inject(SneatAuthStateService).authState);
  private readonly routeData = toSignal(this.route.data, {
    initialValue: this.route.snapshot.data,
  });
  private readonly user = toSignal(inject(SneatUserService).userState);
  protected readonly accountId = computed(
    () => this.params().get('accountId') ?? '',
  );
  protected readonly mode = computed(() =>
    this.query().get('checkout') === 'test' ? 'test' : 'live',
  );
  protected readonly requestId = computed(
    () => this.query().get('requestId') ?? '',
  );
  protected readonly transferView = computed(
    () => this.routeData()['subscriptionTransfer'] === true,
  );
  protected readonly ready = computed(() =>
    isSneatAccountReady(this.auth(), this.user()),
  );
  protected readonly returnTo = computed(() => {
    this.params();
    this.query();
    return this.router.url;
  });
  protected readonly valid = computed(() => {
    const q = this.query();
    return (
      (!this.accountId() || /^[A-Za-z0-9_-]{1,128}$/.test(this.accountId())) &&
      q.keys.every(
        (key) =>
          ['checkout', 'requestId'].includes(key) && q.getAll(key).length === 1,
      ) &&
      (!q.has('checkout') || q.get('checkout') === 'test') &&
      (!this.transferView() || /^[A-Za-z0-9_-]{1,128}$/.test(this.requestId()))
    );
  });
}
