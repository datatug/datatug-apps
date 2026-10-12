import { CheckoutTitle } from './checkout-title';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { IonButton } from '@ionic/angular/ion-button';
import { IonCard } from '@ionic/angular/ion-card';
import { IonCardHeader } from '@ionic/angular/ion-card-header';
import { IonCardTitle } from '@ionic/angular/ion-card-title';
import { IonCardContent } from '@ionic/angular/ion-card-content';
import { IonItem } from '@ionic/angular/ion-item';
import { IonInput } from '@ionic/angular/ion-input';
import { IonSelect } from '@ionic/angular/ion-select';
import { IonSelectOption } from '@ionic/angular/ion-select-option';
import { IonCheckbox } from '@ionic/angular/ion-checkbox';
import { IonChip } from '@ionic/angular/ion-chip';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { SneatApiBaseUrl } from '@sneat/api';
import { SneatAuthStateService, SneatUserService } from '@sneat/auth-core';
import { AuthPanelComponent } from '@sneat/auth-ui';
import { toSignal } from '@angular/core/rxjs-interop';
import { isSneatAccountReady } from '@sneat/auth-core';
import { SPACE_NAV_SERVICE } from '@sneat/space-services';
import { manageableBusinessSpaces } from './business-checkout-spaces';
import { Subscription } from 'rxjs';
import { CheckoutPriceSummaryComponent } from './checkout-price-summary.component';
import { appCheckoutAuth } from './checkout-auth';
import { checkoutApi } from './checkout-api.mjs';
import { checkoutChoice, checkoutRail } from './checkout-config.mjs';
import {
  createCheckoutFlow,
  createReturnFlow,
  errorMessage,
} from './checkout-flow.mjs';
import type {
  CheckoutState,
  CheckoutSelection,
  PurchaseOptions,
} from './checkout-contracts';

// Explicit TEST selection is pinned to its isolated backend. The default LIVE
// rail can only query the configured normal API. URL inputs cannot supply an
// API origin, account, coupon, key or LIVE activation switch.

@Component({
  selector: 'datatug-checkout-page',
  imports: [
    IonButton,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonItem,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonCheckbox,
    RouterLink,
    DatePipe,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonChip,
    AuthPanelComponent,
    CheckoutPriceSummaryComponent,
  ],
  templateUrl: './checkout-page.component.html',
  styleUrl: './checkout-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckoutPageComponent implements OnDestroy {
  private readonly documentTitle = inject(Title);
  private readonly priorTitle = this.documentTitle
    .getTitle()
    .startsWith('Complete your DataTug')
    ? 'DataTug.app'
    : this.documentTitle.getTitle();
  private readonly titleActive = signal(true);
  private readonly checkoutTitle = inject(CheckoutTitle);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(SneatAuthStateService);
  private readonly userService = inject(SneatUserService);
  private readonly normalApiBaseUrl = inject(SneatApiBaseUrl);
  private readonly spaceNav = inject(SPACE_NAV_SERVICE, { optional: true });
  private readonly userState = toSignal(this.userService.userState);
  private readonly authState = toSignal(this.auth.authState);
  private api?: ReturnType<typeof checkoutApi>;
  private generation = 0;
  private identityGeneration = 0;
  private lastIdentity?: string;
  protected readonly business = signal(false);
  protected readonly destination = signal('');
  protected readonly spaceName = signal('');
  protected readonly setupBusy = signal(false);
  protected readonly setupError = signal('');
  protected readonly options = signal<PurchaseOptions | null>(null);
  protected readonly cancelPro = signal(false);
  protected readonly optionError = signal('');
  protected readonly optionsBusy = signal(false);
  protected readonly spaces = computed(() =>
    manageableBusinessSpaces(
      isSneatAccountReady(this.authState(), this.userState())
        ? this.userState()?.record?.spaces
        : undefined,
    ).filter((space) => space.type === 'company'),
  );
  protected readonly missingHint = computed(
    () =>
      !!this.destination() &&
      !this.spaces().some((space) => space.id === this.destination()),
  );
  protected readonly mode = signal<'test' | 'live'>('test');
  protected readonly state = signal<CheckoutState>({ stage: 'loading' });
  protected readonly accepted = signal(false);
  protected readonly authReturnTo = signal<string | undefined>(undefined);
  protected readonly retryBlocked = signal(false);
  protected readonly authOnly =
    this.route.snapshot.data['checkoutAuth'] === true;
  protected readonly returning = signal(false);
  protected readonly subscriptionType = signal<'Pro' | 'Business' | ''>('');
  protected readonly subscriptionLabel = computed(
    () =>
      'DataTug' +
      (this.subscriptionType() ? ` ${this.subscriptionType()}` : ''),
  );
  private stopAuthPage?: () => void;
  protected readonly period = signal('monthly');
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
    effect(() => {
      if (this.titleActive())
        this.checkoutTitle.claim(
          this,
          `Complete your ${this.subscriptionLabel()} subscription`,
        );
    });
    this.subscription = this.route.queryParamMap.subscribe((params) =>
      this.start(params),
    );
  }

  private start(params: ParamMap = this.route.snapshot.queryParamMap): void {
    this.returning.set(
      this.route.snapshot.data['checkoutReturn'] === true ||
        (this.authOnly && params.has('session_id')),
    );
    this.generation++;
    this.flow?.dispose();
    this.stopAuthPage?.();
    this.api = undefined;
    this.setupBusy.set(false);
    this.setupError.set('');
    this.options.set(null);
    this.cancelPro.set(false);
    this.optionError.set('');
    this.optionsBusy.set(false);
    clearTimeout(this.retryTimer);
    this.accepted.set(false);
    this.authReturnTo.set(undefined);
    this.retryBlocked.set(false);
    this.existingPurchase.set(null);
    const search = new URLSearchParams();
    for (const key of params.keys) {
      for (const value of params.getAll(key)) search.append(key, value);
    }
    const rail = checkoutRail(
      search.toString(),
      this.returning(),
      this.normalApiBaseUrl,
    );
    const chosen = rail?.chosen;
    const selected = !this.returning()
      ? (chosen as CheckoutSelection | undefined)
      : undefined;
    this.subscriptionType.set(
      selected ? (selected.kind === 'business' ? 'Business' : 'Pro') : '',
    );
    this.business.set(selected?.kind === 'business');
    if (selected?.kind === 'business' && !selected.purchaseId) {
      const purchaseId = crypto.randomUUID();
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { purchaseId },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      return;
    }
    const test =
      checkoutChoice(search.toString(), this.returning())?.test === true;
    this.enabled.set(Boolean(rail));
    this.mode.set(rail?.mode ?? 'test');
    this.back.set(
      'https://datatug.app/en/pricing/?' +
        new URLSearchParams({
          period:
            selected?.period ??
            (search.get('period') === 'yearly' ? 'yearly' : 'monthly'),
          ...(test ? { checkout: 'test' } : {}),
        }),
    );
    if (!rail || !chosen) {
      this.state.set({
        stage: 'unavailable',
        message:
          'Checkout is not available for this selection. Choose a plan on the pricing page.',
      });
      return;
    }
    const intentParams = new URLSearchParams();
    if (!this.returning() && selected) {
      if (selected.kind === 'business')
        intentParams.set('planID', selected.plan);
      else {
        intentParams.set('plan', 'pro');
        intentParams.set('period', selected.period);
      }
      if (rail.mode === 'test') intentParams.set('checkout', 'test');
      if (selected.spaceID) intentParams.set('spaceID', selected.spaceID);
      if (selected.purchaseId)
        intentParams.set('purchaseId', selected.purchaseId);
    }
    const returnPath = this.returning()
      ? `/pricing/return?mode=${rail.mode}&session_id=${encodeURIComponent((chosen as { sessionId: string }).sessionId)}`
      : `${selected?.kind === 'business' ? '/business/checkout' : '/subscribe'}?${intentParams}`;
    this.authReturnTo.set(returnPath);
    const auth = appCheckoutAuth(
      this.auth,
      this.userService,
      this.router,
      returnPath,
      this.subscriptionLabel(),
    );
    if (this.authOnly) {
      this.state.set({ stage: 'loading' });
      const authGeneration = this.generation;
      this.stopAuthPage = auth.observe((user) => {
        if (authGeneration !== this.generation) return;
        if (user) {
          void this.router.navigateByUrl(returnPath, { replaceUrl: true });
        } else this.state.set({ stage: 'sign-in' });
      });
      return;
    }
    const api = checkoutApi(
      { apiOrigin: rail.apiOrigin, mode: rail.mode },
      auth,
    );
    this.api = api;
    const generation = this.generation;
    const render = (state: CheckoutState) => {
      if (state.stage === 'sign-in' || state.status === 401) {
        this.state.set({ stage: 'loading' });
        const navigateToAuth = () =>
          generation === this.generation
            ? this.router.navigate(['/checkout/sign-in'], {
                queryParams: Object.fromEntries(
                  new URL(returnPath, 'https://datatug.app').searchParams,
                ),
                replaceUrl: true,
              })
            : Promise.resolve(false);
        if (state.status === 401)
          void this.auth
            .signOut()
            .then(navigateToAuth)
            .catch(() => {
              if (generation === this.generation)
                this.state.set({
                  stage: 'error',
                  message: 'Unable to refresh your sign-in. Please retry.',
                });
            });
        else void navigateToAuth();
        return;
      }
      if (this.lastIdentity !== state.user?.id) {
        this.lastIdentity = state.user?.id;
        this.identityGeneration++;
        this.setupBusy.set(false);
        this.optionsBusy.set(false);
        this.setupError.set('');
      }
      const identityGeneration = this.identityGeneration;
      if (!state.user) {
        this.destination.set('');
        this.spaceName.set('');
        this.setupError.set('');
        this.setupBusy.set(false);
      }
      if (state.purchase) {
        this.business.set(true);
        this.subscriptionType.set('Business');
        if (!this.destination())
          this.destination.set(state.purchase.spaceHint ?? '');
      } else if (this.returning() && ['pro', 'test'].includes(state.stage))
        this.subscriptionType.set('Pro');
      this.options.set(null);
      this.cancelPro.set(false);
      this.optionError.set('');
      if (state.purchase?.paid)
        void api
          .options(state.purchase.accountId)
          .then((options) => {
            if (
              generation === this.generation &&
              identityGeneration === this.identityGeneration &&
              this.state().user?.id === state.user?.id
            )
              this.options.set(options);
          })
          .catch(() => {
            if (
              generation === this.generation &&
              identityGeneration === this.identityGeneration
            )
              this.optionError.set(
                'Pro renewal options are unavailable. You can keep Pro and manage it later.',
              );
          });
      this.state.set(state);
      this.accepted.set(false);
      clearTimeout(this.retryTimer);
      this.retryBlocked.set(
        state.code === 'offer_busy' || state.code === 'already_subscribed',
      );
      this.existingPurchase.set(
        state.existingSession
          ? `/pricing/return?mode=${rail.mode}&session_id=${encodeURIComponent(state.existingSession)}`
          : null,
      );
      if (state.code === 'offer_busy')
        this.retryTimer = setTimeout(
          () => this.retryBlocked.set(false),
          state.retryAfter ?? 5000,
        );
    };
    if (this.returning()) {
      this.flow = createReturnFlow({
        auth,
        api,
        mode: rail.mode,
        sessionId: (chosen as { sessionId: string }).sessionId,
        render,
      });
    } else {
      const selected = chosen as CheckoutSelection;
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

  protected canChangePeriod(): boolean {
    return (
      !this.returning() &&
      ![
        'mounting',
        'payment',
        'checking',
        'pro',
        'test',
        'setup',
        'business-active',
      ].includes(this.state().stage) &&
      this.state().code !== 'already_subscribed'
    );
  }

  protected choosePeriod(period: 'monthly' | 'yearly'): void {
    if (!this.canChangePeriod() || period === this.period()) return;
    const business = this.business();
    void this.router.navigate(
      [business ? '/business/checkout' : '/subscribe'],
      {
        queryParams: business
          ? {
              planID:
                period === 'yearly'
                  ? 'datatug-business-usage-annual'
                  : 'datatug-business-usage-monthly',
              period: null,
            }
          : { plan: 'pro', period },
        queryParamsHandling: 'merge',
      },
    );
  }

  protected async linkSpace(): Promise<void> {
    const state = this.state(),
      api = this.api,
      purchase = state.purchase;
    if (!api || !purchase?.paid || this.setupBusy() || state.stage !== 'setup')
      return;
    if (!this.destination() && !this.spaceName().trim()) {
      this.setupError.set(
        'Enter your business name or choose an existing business space.',
      );
      return;
    }
    const generation = this.generation,
      identityGeneration = this.identityGeneration;
    this.setupBusy.set(true);
    this.setupError.set('');
    try {
      const linked = await api.setup(
        purchase.accountId,
        this.destination()
          ? { spaceID: this.destination() }
          : { title: this.spaceName().trim() },
      );
      if (
        generation !== this.generation ||
        identityGeneration !== this.identityGeneration ||
        this.state().user?.id !== state.user?.id
      )
        return;
      if (
        !linked.paid ||
        linked.setupRequired ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(linked.spaceID ?? '') ||
        linked.accountId !== purchase.accountId
      )
        throw new Error('invalid_setup');
      this.state.set({
        ...state,
        stage: 'business-active',
        purchase: linked,
        spaceID: linked.spaceID,
      });
    } catch (error) {
      if (
        generation === this.generation &&
        identityGeneration === this.identityGeneration
      )
        this.setupError.set(errorMessage(error));
    } finally {
      if (
        generation === this.generation &&
        identityGeneration === this.identityGeneration
      )
        this.setupBusy.set(false);
    }
  }

  protected async cancelPersonalRenewal(): Promise<void> {
    const state = this.state(),
      api = this.api;
    if (
      !api ||
      !state.purchase?.paid ||
      !this.cancelPro() ||
      !this.options()?.canCancelPersonal ||
      this.optionsBusy()
    )
      return;
    const generation = this.generation,
      identityGeneration = this.identityGeneration;
    this.optionsBusy.set(true);
    this.optionError.set('');
    try {
      const options = await api.options(state.purchase.accountId, true);
      if (
        generation === this.generation &&
        identityGeneration === this.identityGeneration &&
        this.state().user?.id === state.user?.id
      )
        this.options.set(options);
    } catch {
      if (
        generation === this.generation &&
        identityGeneration === this.identityGeneration
      )
        this.optionError.set(
          'The Pro renewal change is not confirmed. Retry this choice, or keep Pro and check its settings later. Your Business purchase remains available.',
        );
    } finally {
      if (
        generation === this.generation &&
        identityGeneration === this.identityGeneration
      )
        this.optionsBusy.set(false);
    }
  }

  protected openSpace(): void {
    const id = this.state().spaceID;
    if (id && this.spaceNav)
      void this.spaceNav.navigateToSpace({ id, type: 'company' });
    else void this.router.navigate(['/home']);
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

  private releaseTitle(): void {
    this.titleActive.set(false);
    this.checkoutTitle.release(
      this,
      `Complete your ${this.subscriptionLabel()} subscription`,
      this.priorTitle,
    );
  }

  ionViewWillLeave(): void {
    this.releaseTitle();
    this.generation++;
    this.leftPage = true;
    this.flow?.dispose();
    this.stopAuthPage?.();
    clearTimeout(this.retryTimer);
  }

  ionViewWillEnter(): void {
    this.titleActive.set(true);
    if (this.leftPage) {
      this.leftPage = false;
      this.start();
    }
  }

  ngOnDestroy(): void {
    this.releaseTitle();
    this.generation++;
    this.subscription.unsubscribe();
    this.flow?.dispose();
    this.stopAuthPage?.();
    clearTimeout(this.retryTimer);
  }
}
