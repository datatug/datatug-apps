import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { SneatApiBaseUrl } from '@sneat/api';
import { SneatAuthStateService, SneatUserService } from '@sneat/auth-core';
import { AuthPanelComponent } from '@sneat/auth-ui';
import { Subscription } from 'rxjs';
import { appCheckoutAuth } from './checkout-auth';
import { checkoutApi } from './checkout-api.mjs';
import { checkoutChoice, checkoutRail } from './checkout-config.mjs';
import { createCheckoutFlow, createReturnFlow } from './checkout-flow.mjs';
import type { CheckoutState } from './checkout-contracts';

// Explicit TEST selection is pinned to its isolated backend. The default LIVE
// rail can only query the configured normal API. URL inputs cannot supply an
// API origin, account, coupon, key or LIVE activation switch.

@Component({
  selector: 'datatug-checkout-page',
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    AuthPanelComponent,
  ],
  templateUrl: './checkout-page.component.html',
  styleUrl: './checkout-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckoutPageComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(SneatAuthStateService);
  private readonly userService = inject(SneatUserService);
  private readonly normalApiBaseUrl = inject(SneatApiBaseUrl);
  protected readonly mode = signal<'test' | 'live'>('test');
  protected readonly state = signal<CheckoutState>({ stage: 'loading' });
  protected readonly accepted = signal(false);
  protected readonly authReturnTo = signal<string | undefined>(undefined);
  protected readonly retryBlocked = signal(false);
  protected readonly returning =
    this.route.snapshot.data['checkoutReturn'] === true;
  protected readonly period = signal('');
  protected readonly enabled = signal(false);
  protected readonly existingPurchase = signal<string | null>(null);
  protected readonly back = signal('https://datatug.app/en/pricing/');
  @ViewChild('embedded', { static: true })
  private embedded?: ElementRef<HTMLElement>;
  private flow?:
    | ReturnType<typeof createCheckoutFlow>
    | ReturnType<typeof createReturnFlow>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private leftPage = false;
  private readonly subscription: Subscription;

  constructor() {
    this.subscription = this.route.queryParamMap.subscribe(() => this.start());
  }

  private start(): void {
    this.flow?.dispose();
    clearTimeout(this.retryTimer);
    this.accepted.set(false);
    this.authReturnTo.set(undefined);
    this.retryBlocked.set(false);
    this.existingPurchase.set(null);
    const search = new URLSearchParams();
    for (const key of this.route.snapshot.queryParamMap.keys) {
      for (const value of this.route.snapshot.queryParamMap.getAll(key))
        search.append(key, value);
    }
    const rail = checkoutRail(
      search.toString(),
      this.returning,
      this.normalApiBaseUrl,
    );
    const chosen = rail?.chosen;
    const test =
      checkoutChoice(search.toString(), this.returning)?.test === true;
    this.enabled.set(Boolean(rail));
    this.mode.set(rail?.mode ?? 'test');
    this.back.set(
      'https://datatug.app/en/pricing/' + (test ? '?checkout=test' : ''),
    );
    if (!rail || !chosen) {
      this.state.set({
        stage: 'unavailable',
        message:
          'Pro checkout is not available for this selection. Choose a Pro plan on the pricing page.',
      });
      return;
    }
    const returnPath = this.returning
      ? `/pricing/return?mode=${rail.mode}&session_id=${encodeURIComponent((chosen as { sessionId: string }).sessionId)}`
      : `/subscribe?plan=pro&period=${(chosen as { period: string }).period}${rail.mode === 'test' ? '&checkout=test' : ''}`;
    this.authReturnTo.set(returnPath);
    const auth = appCheckoutAuth(
      this.auth,
      this.userService,
      this.router,
      returnPath,
    );
    const api = checkoutApi(
      { apiOrigin: rail.apiOrigin, mode: rail.mode },
      auth,
    );
    const render = (state: CheckoutState) => {
      this.state.set(state);
      this.accepted.set(false);
      clearTimeout(this.retryTimer);
      this.retryBlocked.set(
        state.code === 'offer_busy' || state.code === 'already_subscribed',
      );
      this.existingPurchase.set(
        state.existingSession?.startsWith('cs_test_')
          ? `/pricing/return?mode=test&session_id=${encodeURIComponent(state.existingSession)}`
          : null,
      );
      if (state.code === 'offer_busy')
        this.retryTimer = setTimeout(
          () => this.retryBlocked.set(false),
          state.retryAfter ?? 5000,
        );
    };
    if (this.returning) {
      this.flow = createReturnFlow({
        auth,
        api,
        mode: rail.mode,
        sessionId: (chosen as { sessionId: string }).sessionId,
        render,
      });
    } else {
      const selected = chosen as { period: 'monthly' | 'yearly'; plan: string };
      this.period.set(selected.period);
      this.flow = createCheckoutFlow({
        auth,
        api,
        selection: selected,
        mode: rail.mode,
        render,
        provider: {
          async mount(options) {
            const { stripeCheckoutAdapter } =
              await import('./checkout-provider.mjs');
            return (await stripeCheckoutAdapter()).mount(options);
          },
        },
      });
    }
    this.flow.start();
  }

  protected async signOut(): Promise<void> {
    try {
      await this.flow?.signOut();
    } catch {
      this.state.set({
        stage: 'error',
        message: 'Unable to switch accounts. Please retry.',
      });
    }
  }

  protected retry(): void {
    if (this.retryBlocked()) return;
    if (this.flow && 'load' in this.flow) void this.flow.load();
    else if (this.flow && 'refresh' in this.flow) void this.flow.refresh();
  }

  protected pay(): void {
    if (
      this.accepted() &&
      this.embedded &&
      this.flow &&
      'acknowledge' in this.flow
    )
      void this.flow.acknowledge(this.embedded.nativeElement);
  }

  ionViewWillLeave(): void {
    this.leftPage = true;
    this.flow?.dispose();
    clearTimeout(this.retryTimer);
  }

  ionViewWillEnter(): void {
    if (this.leftPage) {
      this.leftPage = false;
      this.start();
    }
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    this.flow?.dispose();
    clearTimeout(this.retryTimer);
  }
}
