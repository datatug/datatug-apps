import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import {
  isSneatAccountReady,
  SneatAuthStateService,
  SneatUserService,
} from '@sneat/auth-core';
import { AuthPanelComponent } from '@sneat/auth-ui';
import { Subscription } from 'rxjs';
import type { CheckoutState } from './checkout-contracts';
import { appCheckoutAuth } from './checkout-auth';
import { checkoutApi } from './checkout-api.mjs';
import {
  createReturnFlow,
  createSpaceServiceCheckoutFlow,
} from './checkout-flow.mjs';
import {
  DATATUG_BUSINESS_CHECKOUT_API_ORIGIN,
  isTrustedBusinessCheckoutOrigin,
} from './business-checkout-config';
import { manageableBusinessSpaces } from './business-checkout-spaces';

type BusinessPlanID =
  | 'datatug-business-usage-monthly'
  | 'datatug-business-usage-annual';
type BusinessPeriod = 'monthly' | 'annual';

const planIDForPeriod = (period: BusinessPeriod): BusinessPlanID =>
  period === 'annual'
    ? 'datatug-business-usage-annual'
    : 'datatug-business-usage-monthly';
const periodForPlanID = (planID: string | null): BusinessPeriod | undefined => {
  if (planID === 'datatug-business-usage-monthly') return 'monthly';
  if (planID === 'datatug-business-usage-annual') return 'annual';
  return undefined;
};
const validSpaceID = (value: string | null): value is string =>
  !!value && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validSessionID = (value: string | null): value is string =>
  !!value && /^cs_test_[A-Za-z0-9_]+$/.test(value);

@Component({
  selector: 'datatug-business-checkout-page',
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    AuthPanelComponent,
  ],
  templateUrl: './business-checkout-page.component.html',
  styleUrl: './business-checkout-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BusinessCheckoutPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(SneatAuthStateService);
  private readonly userService = inject(SneatUserService);
  private readonly configuredApiOrigin = inject(
    DATATUG_BUSINESS_CHECKOUT_API_ORIGIN,
  );
  private readonly userState = toSignal(this.userService.userState);
  private readonly authState = toSignal(this.auth.authState);
  private readonly routeSubscription: Subscription;
  private flow?:
    | ReturnType<typeof createSpaceServiceCheckoutFlow>
    | ReturnType<typeof createReturnFlow>;
  private lastReadySelection = '';
  private leftPage = false;

  protected readonly returning =
    this.route.snapshot.data['businessCheckoutReturn'] === true;
  protected readonly enabled = signal(
    isTrustedBusinessCheckoutOrigin(this.configuredApiOrigin),
  );
  protected readonly selectedSpaceID = signal('');
  protected readonly period = signal<BusinessPeriod>('monthly');
  protected readonly accepted = signal(false);
  protected readonly authReturnTo = signal<string | undefined>(undefined);
  protected readonly state = signal<CheckoutState>({ stage: 'loading' });
  protected readonly selectionLocked = computed(() => {
    const current = this.state();
    return (
      current.retrySameQuote === true ||
      current.quote?.claimed === true ||
      ['creating-session', 'mounting', 'payment'].includes(current.stage)
    );
  });
  protected readonly spaces = computed(() => {
    const authState = this.authState();
    const userState = this.userState();
    return manageableBusinessSpaces(
      isSneatAccountReady(authState, userState)
        ? userState?.record?.spaces
        : undefined,
    );
  });
  protected readonly selectedSpace = computed(() =>
    this.spaces().find((space) => space.id === this.selectedSpaceID()),
  );
  protected readonly apiAvailable = computed(
    () =>
      this.enabled() &&
      isTrustedBusinessCheckoutOrigin(this.configuredApiOrigin),
  );
  @ViewChild('embedded', { static: true })
  private embedded?: ElementRef<HTMLElement>;

  constructor() {
    this.routeSubscription = this.route.queryParamMap.subscribe((params) =>
      this.start(params),
    );
    effect(() => {
      const userID = this.state().user?.id;
      const space = this.selectedSpace();
      const stage = this.state().stage;
      if (this.returning || !userID || !space || stage !== 'select-space')
        return;
      const key = `${userID}:${space.id}:${planIDForPeriod(this.period())}`;
      if (this.lastReadySelection === key) return;
      this.lastReadySelection = key;
      const flow = this.flow;
      if (flow && 'load' in flow) void flow.load();
    });
  }

  private start(params: ParamMap = this.route.snapshot.queryParamMap): void {
    this.flow?.dispose();
    this.accepted.set(false);
    this.authReturnTo.set(undefined);
    this.lastReadySelection = '';
    if (!isTrustedBusinessCheckoutOrigin(this.configuredApiOrigin)) {
      this.state.set({
        stage: 'unavailable',
        message: 'DataTug Business TEST checkout is not configured yet.',
      });
    } else {
      this.state.set({ stage: 'loading' });
    }
    const spaceParam = params.get('spaceID');
    const rawPlanID = params.get('planID');
    const requestedPeriod = periodForPlanID(rawPlanID);
    const invalidPlan =
      !this.returning && rawPlanID !== null && !requestedPeriod;
    const period = this.returning ? undefined : (requestedPeriod ?? 'monthly');
    const spaceID = validSpaceID(spaceParam) ? spaceParam : '';
    this.selectedSpaceID.set(spaceID);
    if (period) this.period.set(period);

    const allowed = this.returning
      ? ['spaceID', 'session_id']
      : ['spaceID', 'planID'];
    const extras = params.keys.some(
      (key) => !allowed.includes(key) || params.getAll(key).length !== 1,
    );
    const canonicalParams = this.returning
      ? {
          ...(spaceID ? { spaceID } : {}),
          ...(validSessionID(params.get('session_id'))
            ? { session_id: params.get('session_id') ?? '' }
            : {}),
        }
      : {
          planID: invalidPlan
            ? (rawPlanID ?? '')
            : planIDForPeriod(this.period()),
          ...(spaceID ? { spaceID } : {}),
        };
    const currentParams = Object.fromEntries(
      params.keys.map((key) => [key, params.get(key)]),
    );
    if (
      extras ||
      JSON.stringify(currentParams) !== JSON.stringify(canonicalParams)
    ) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: canonicalParams,
        replaceUrl: true,
      });
      return;
    }

    if (invalidPlan) {
      this.state.set({
        stage: 'unavailable',
        message:
          'Choose a monthly or annual Business plan to review its TEST quote.',
      });
      return;
    }

    const apiOrigin = this.configuredApiOrigin;
    if (!isTrustedBusinessCheckoutOrigin(apiOrigin)) {
      this.state.set({
        stage: 'unavailable',
        message: 'DataTug Business TEST checkout is not configured yet.',
      });
      return;
    }
    if (this.returning) {
      const sessionID = params.get('session_id');
      if (!spaceID || !validSessionID(sessionID)) {
        this.state.set({
          stage: 'unavailable',
          message:
            'This Business checkout return link is incomplete or invalid.',
        });
        return;
      }
      const returnPath = `/business/checkout/return?spaceID=${encodeURIComponent(spaceID)}&session_id=${encodeURIComponent(sessionID)}`;
      this.authReturnTo.set(returnPath);
      const auth = appCheckoutAuth(
        this.auth,
        this.userService,
        this.router,
        returnPath,
        'DataTug Business checkout',
      );
      const api = checkoutApi({ apiOrigin, mode: 'test' }, auth);
      this.flow = createReturnFlow({
        auth,
        api,
        mode: 'test',
        sessionId: sessionID,
        serviceScope: { spaceID },
        render: (state) => this.render(state),
      });
      this.flow.start();
      return;
    }

    const selection = { spaceID, planID: planIDForPeriod(this.period()) };
    if (!spaceID) {
      this.state.set({
        stage: 'select-space',
        message: 'Choose a Space you administer to review its Business quote.',
      });
    }
    const returnPath = `/business/checkout?planID=${selection.planID}${spaceID ? `&spaceID=${encodeURIComponent(spaceID)}` : ''}`;
    this.authReturnTo.set(returnPath);
    const auth = appCheckoutAuth(
      this.auth,
      this.userService,
      this.router,
      returnPath,
      'DataTug Business checkout',
    );
    const api = checkoutApi({ apiOrigin, mode: 'test' }, auth);
    this.flow = createSpaceServiceCheckoutFlow({
      auth,
      api,
      selection,
      ready: () => !!this.selectedSpace(),
      provider: {
        async mount(options) {
          const { stripeCheckoutAdapter } =
            await import('./checkout-provider.mjs');
          return (await stripeCheckoutAdapter()).mount(options);
        },
      },
      render: (state) => this.render(state),
    });
    this.flow.start();
  }

  private render(state: CheckoutState): void {
    this.state.set(state);
    if (state.stage === 'quote' || state.stage === 'error')
      this.accepted.set(false);
  }

  protected chooseSpace(spaceID: string): void {
    if (this.selectionLocked()) return;
    if (spaceID && !this.spaces().some((space) => space.id === spaceID)) return;
    this.navigateSelection({
      planID: planIDForPeriod(this.period()),
      ...(spaceID ? { spaceID } : {}),
    });
  }

  protected choosePeriod(period: BusinessPeriod): void {
    if (this.returning || !this.apiAvailable() || this.selectionLocked())
      return;
    this.navigateSelection({
      planID: planIDForPeriod(period),
      ...(this.selectedSpaceID() ? { spaceID: this.selectedSpaceID() } : {}),
    });
  }

  private navigateSelection(queryParams: Record<string, string>): void {
    const user = this.state().user;
    this.flow?.dispose();
    this.flow = undefined;
    this.accepted.set(false);
    this.lastReadySelection = '';
    this.state.set({
      stage: queryParams['spaceID'] ? 'loading' : 'select-space',
      user,
    });
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams,
        replaceUrl: true,
      })
      .then((navigated) => {
        if (!navigated) this.start();
      })
      .catch(() => this.start());
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
    if (this.flow && 'refresh' in this.flow) void this.flow.refresh();
    else if (this.flow && 'load' in this.flow) void this.flow.load();
  }

  protected pay(): void {
    if (
      !this.accepted() ||
      !this.embedded ||
      !this.flow ||
      !('acknowledge' in this.flow)
    )
      return;
    void this.flow.acknowledge(this.embedded.nativeElement);
  }

  protected cancel(): void {
    void this.router.navigate(['/']);
  }
  protected backToPricing(): string {
    return 'https://datatug.io/pricing/';
  }

  ionViewWillLeave(): void {
    this.leftPage = true;
    this.flow?.dispose();
  }
  ionViewWillEnter(): void {
    if (this.leftPage) {
      this.leftPage = false;
      this.start();
    }
  }

  ngOnDestroy(): void {
    this.routeSubscription.unsubscribe();
    this.flow?.dispose();
  }
}
