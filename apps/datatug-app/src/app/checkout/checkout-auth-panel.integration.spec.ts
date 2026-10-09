import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { ToastController } from '@ionic/angular/toast-controller';
import { SneatApiBaseUrl, SneatApiService } from '@sneat/api';
import {
  ISneatAuthState,
  ISneatUserState,
  SneatAuthStateService,
  SneatUserService,
  UserRecordService,
} from '@sneat/auth-core';
import {
  APP_INFO,
  AnalyticsService,
  ErrorLogger,
  SNEAT_FIREBASE_AUTH,
} from '@sneat/core';
import { RANDOM_ID_OPTIONS } from '@sneat/random';
import { BehaviorSubject, NEVER, of } from 'rxjs';
import { TelegramLoginConfig } from '@sneat/auth-ui';
import { DATATUG_BUSINESS_CHECKOUT_API_ORIGIN } from './business-checkout-config';
import { BusinessCheckoutPageComponent } from './business-checkout-page.component';
import { TEST_CHECKOUT_ORIGIN } from './checkout-config.mjs';
import { CheckoutPageComponent } from './checkout-page.component';

const { mountProvider } = vi.hoisted(() => ({ mountProvider: vi.fn() }));
vi.mock('./checkout-provider.mjs', () => ({
  stripeCheckoutAdapter: async () => ({ mount: mountProvider }),
}));

type CheckoutKind = 'pro' | 'business';

const readyAuth = (uid = 'buyer'): ISneatAuthState =>
  ({
    status: 'authenticated',
    loadingPhase: 'ready',
    token: 'test-auth-state-token',
    user: { uid, email: `${uid}@example.invalid`, isAnonymous: false },
  }) as ISneatAuthState;

const readyUser = (
  uid = 'buyer',
  userRecordStatus: ISneatUserState['userRecordStatus'] = 'ready',
): ISneatUserState =>
  ({
    status: 'authenticated',
    user: { uid, email: `${uid}@example.invalid`, isAnonymous: false },
    record: {
      title: uid,
      spaces: {
        space_1: { title: 'Admin Space', type: 'group', roles: ['owner'] },
      },
    },
    userRecordStatus,
  }) as ISneatUserState;

const proQuote = {
  sessionId: 'cs_test_fixture',
  clientSecret: 'cs_test_fixture_secret_memory',
  mode: 'test',
  accountId: 'buyer',
  accountKind: 'personal',
  amount: { currency: 'eur', list: 19000, due: 13300, taxIncluded: true },
  appliedDiscount: { kind: 'launch', percentOff: 30, duration: 'forever' },
  offer: {
    applied: true,
    reserved: false,
    duration: 'forever',
    percentOff: 30,
  },
};

const businessQuote = {
  quoteID: 'quote_1',
  spaceID: 'space_1',
  serviceID: 'datatug',
  planID: 'datatug-business-usage-monthly',
  mode: 'test',
  accountKind: 'organisation',
  amount: { currency: 'eur', list: 9900, due: 9900, taxIncluded: true },
  quantity: 1,
  period: { interval: 'month', count: 1 },
  appliedDiscount: { kind: 'none', percentOff: 0 },
  expiresAtUTC: new Date(Date.now() + 60_000).toISOString(),
  claimed: false,
};

let fixture:
  | ComponentFixture<CheckoutPageComponent>
  | ComponentFixture<BusinessCheckoutPageComponent>
  | undefined;
let authStates: BehaviorSubject<ISneatAuthState>;
let userStates: BehaviorSubject<ISneatUserState>;
let currentUser: {
  uid: string;
  isAnonymous: boolean;
  getIdToken: () => Promise<string>;
} | null;
let fetcher: ReturnType<typeof vi.fn>;
let retryUserRecordInitialization: ReturnType<typeof vi.fn>;

function proPath(): string {
  return '/subscribe?plan=pro&period=yearly&checkout=test';
}

function businessPath(): string {
  return '/business/checkout?planID=datatug-business-usage-monthly&spaceID=space_1';
}

async function render(
  kind: CheckoutKind,
  authState: ISneatAuthState,
  userState: ISneatUserState,
): Promise<HTMLElement> {
  authStates = new BehaviorSubject(authState);
  userStates = new BehaviorSubject(userState);
  currentUser = authState.user?.uid
    ? {
        uid: authState.user.uid,
        isAnonymous: authState.user.isAnonymous === true,
        getIdToken: async () => 'request-bound-token',
      }
    : null;
  retryUserRecordInitialization = vi.fn();

  const authService = {
    authState: authStates,
    authStatus: of(authState.status),
    fbAuth: {
      get currentUser() {
        return currentUser;
      },
    },
    signInWith: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
  };
  const userService = {
    userState: userStates,
    onUserSignedIn: vi.fn(),
    retryUserRecordInitialization,
  };

  await TestBed.configureTestingModule({
    imports: [
      kind === 'pro' ? CheckoutPageComponent : BusinessCheckoutPageComponent,
    ],
    providers: [
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: of(convertToParamMap(query(kind))),
          snapshot: {
            data: { checkoutReturn: false, businessCheckoutReturn: false },
            queryParamMap: convertToParamMap(query(kind)),
          },
        },
      },
      { provide: SneatAuthStateService, useValue: authService },
      { provide: SneatUserService, useValue: userService },
      {
        provide: SneatApiBaseUrl,
        useValue: 'https://api.sneat.cloud/v0/',
      },
      {
        provide: DATATUG_BUSINESS_CHECKOUT_API_ORIGIN,
        useValue: TEST_CHECKOUT_ORIGIN,
      },
      { provide: APP_INFO, useValue: { requiredSpaceType: undefined } },
      {
        provide: AnalyticsService,
        useValue: { logEvent: vi.fn() },
      },
      {
        provide: ErrorLogger,
        useValue: {
          logError: vi.fn(),
          logErrorHandler: () => vi.fn(),
        },
      },
      { provide: SNEAT_FIREBASE_AUTH, useValue: {} },
      {
        provide: SneatApiService,
        useValue: {
          setApiAuthToken: vi.fn(),
          postAsAnonymous: () => NEVER,
          post: () => NEVER,
        },
      },
      {
        provide: UserRecordService,
        useValue: { initUserRecord: () => NEVER },
      },
      { provide: RANDOM_ID_OPTIONS, useValue: { len: 9 } },
      { provide: TelegramLoginConfig, useValue: { botID: '' } },
      {
        provide: ToastController,
        useValue: { create: vi.fn().mockResolvedValue({ present: vi.fn() }) },
      },
    ],
  }).compileComponents();

  if (kind === 'pro') {
    const proFixture = TestBed.createComponent(CheckoutPageComponent);
    fixture = proFixture;
    proFixture.detectChanges();
  } else {
    const businessFixture = TestBed.createComponent(
      BusinessCheckoutPageComponent,
    );
    fixture = businessFixture;
    businessFixture.detectChanges();
  }
  await flush();
  return fixture.nativeElement as HTMLElement;
}

async function flush(): Promise<void> {
  await fixture?.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture?.detectChanges();
  await fixture?.whenStable();
  fixture?.detectChanges();
}

function continuation(kind: CheckoutKind): string {
  return kind === 'pro' ? proPath() : businessPath();
}

function query(kind: CheckoutKind): Record<string, string> {
  return kind === 'pro'
    ? { plan: 'pro', period: 'yearly', checkout: 'test' }
    : {
        planID: 'datatug-business-usage-monthly',
        spaceID: 'space_1',
      };
}

function mountProviderMocks() {
  fetcher = vi.fn(async (url: URL, options?: RequestInit) => {
    if (url.pathname.startsWith('/svg/')) {
      return {
        ok: true,
        headers: new Headers(),
        text: async () => '<svg></svg>',
        json: async () => ({}),
      };
    }
    if (url.pathname.endsWith('/config')) {
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({
          site: 'datatug',
          mode: 'test',
          publishableKey: 'pk_test_fixture',
          plans: [
            {
              id: 'datatug-pro-annual',
              accountRequired: true,
              accountKind: 'personal',
              taxIncluded: true,
            },
          ],
        }),
      };
    }
    if (url.pathname.endsWith('/session')) {
      void options;
      return {
        ok: true,
        headers: new Headers(),
        json: async () => proQuote,
      };
    }
    if (url.pathname.endsWith('/space-service/quote')) {
      return {
        ok: true,
        headers: new Headers(),
        json: async () => businessQuote,
      };
    }
    return {
      ok: false,
      status: 500,
      headers: new Headers(),
      json: async () => ({}),
    };
  });
  vi.stubGlobal('fetch', fetcher);
}

function checkoutRequests() {
  return fetcher.mock.calls.filter(([url]) =>
    new URL(String(url)).pathname.startsWith('/v0/checkout/'),
  );
}

beforeEach(() => {
  mountProvider.mockReset();
  mountProvider.mockResolvedValue({ destroy: vi.fn() });
  localStorage.removeItem('emailForSignIn');
  mountProviderMocks();
});

afterEach(() => {
  fixture?.destroy();
  fixture = undefined;
  vi.unstubAllGlobals();
  TestBed.resetTestingModule();
});

it.each(['pro', 'business'] as const)(
  'mounts the real shared email sign-up and sign-in controls inline for %s',
  async (kind) => {
    const root = await render(
      kind,
      { status: 'notAuthenticated' },
      { status: 'notAuthenticated' },
    );
    const renderedFixture = fixture;
    if (!renderedFixture) {
      throw new Error('Checkout fixture was not rendered');
    }
    const panel = renderedFixture.debugElement.query(
      By.css('sneat-auth-panel'),
    );
    const emailForm = renderedFixture.debugElement.query(
      By.css('sneat-email-login-form'),
    );

    expect(panel).not.toBeNull();
    expect(panel.componentInstance.returnTo()).toBe(continuation(kind));
    expect(emailForm).not.toBeNull();
    expect(emailForm.componentInstance.returnTo()).toBe(continuation(kind));
    expect(root.querySelector('ion-input[name="email"]')).not.toBeNull();
    expect(root.querySelector('ion-input[name="first_name"]')).not.toBeNull();
    expect(root.querySelector('ion-segment-button[value="in"]')).not.toBeNull();
    expect(root.textContent).toContain('Sign up');
    expect(checkoutRequests()).toHaveLength(0);

    root.querySelector<HTMLElement>('ion-segment-button[value="in"]')?.click();
    await flush();
    expect(root.querySelector('ion-input[type="password"]')).not.toBeNull();
    expect(root.textContent?.replace(/\s+/g, ' ')).toContain(
      'Sign in with password',
    );
  },
);

it('keeps a Business deep link unquoted while its selected Space record is loading', async () => {
  const root = await render(
    'business',
    readyAuth(),
    readyUser('buyer', 'loading'),
  );
  expect(root.querySelector('sneat-auth-panel')).not.toBeNull();
  expect(root.textContent).toContain('Preparing your account');
  expect(checkoutRequests()).toHaveLength(0);

  userStates.next(readyUser());
  await flush();

  expect(root.textContent).toContain('Your Business TEST quote');
  expect(
    checkoutRequests().filter(([url]) =>
      new URL(String(url)).pathname.endsWith('/space-service/quote'),
    ),
  ).toHaveLength(1);
  expect(
    fetcher.mock.calls.some(([url]) =>
      new URL(String(url)).pathname.endsWith('/space-service/session'),
    ),
  ).toBe(false);
});

it.each(['pro', 'business'] as const)(
  'offers setup retry and resumes a quote only after the persisted record is ready for %s',
  async (kind) => {
    const root = await render(kind, readyAuth(), readyUser('buyer', 'failed'));
    expect(root.textContent).toContain('Retry account setup');
    expect(checkoutRequests()).toHaveLength(0);
    root.querySelector('ion-button')?.click();
    expect(retryUserRecordInitialization).toHaveBeenCalledOnce();

    userStates.next(readyUser());
    await flush();
    expect(checkoutRequests().length).toBeGreaterThan(0);
    expect(root.textContent).toContain(
      kind === 'pro' ? '€133.00' : 'Your Business TEST quote',
    );
    expect(root.textContent).not.toContain('Retry account setup');
    expect(
      root.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked,
    ).toBe(false);
    expect(mountProvider).not.toHaveBeenCalled();
  },
);

it.each(['pro', 'business'] as const)(
  'restores shared credentials on token failure and resumes checkout after same-UID recovery for %s',
  async (kind) => {
    const root = await render(
      kind,
      { ...readyAuth(), loadingPhase: 'failed', token: 'old-token' },
      readyUser(),
    );
    expect(root.querySelector('sneat-email-login-form')).not.toBeNull();
    expect(checkoutRequests()).toHaveLength(0);

    authStates.next(readyAuth());
    await flush();
    expect(checkoutRequests().length).toBeGreaterThan(0);
    expect(root.textContent).toContain(
      kind === 'pro' ? '€133.00' : 'Your Business TEST quote',
    );
    expect(
      root.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked,
    ).toBe(false);
    expect(mountProvider).not.toHaveBeenCalled();
  },
);

it.each(['pro', 'business'] as const)(
  'shows the shared form on HTTP 401 and recovers on the same checkout for %s',
  async (kind) => {
    let rejectOnce = true;
    fetcher.mockImplementation(async (url: URL) => {
      const protectedPath =
        kind === 'pro'
          ? url.pathname.endsWith('/session')
          : url.pathname.endsWith('/space-service/quote');
      if (protectedPath && rejectOnce) {
        rejectOnce = false;
        return {
          ok: false,
          status: 401,
          headers: new Headers(),
          json: async () => ({ code: 'sign_in_required' }),
        };
      }
      if (url.pathname.endsWith('/config')) {
        return {
          ok: true,
          headers: new Headers(),
          json: async () => ({
            site: 'datatug',
            mode: 'test',
            publishableKey: 'pk_test_fixture',
            plans: [
              {
                id: 'datatug-pro-annual',
                accountRequired: true,
                accountKind: 'personal',
                taxIncluded: true,
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        headers: new Headers(),
        json: async () =>
          url.pathname.endsWith('/session') ? proQuote : businessQuote,
      };
    });
    const root = await render(kind, readyAuth(), readyUser());
    expect(root.querySelector('sneat-email-login-form')).not.toBeNull();
    expect(root.querySelector('ion-input[name="email"]')).not.toBeNull();

    authStates.next({ status: 'notAuthenticated' });
    userStates.next({ status: 'notAuthenticated' });
    await flush();
    currentUser = {
      uid: 'buyer',
      isAnonymous: false,
      getIdToken: async () => 'request-bound-token',
    };
    authStates.next(readyAuth());
    userStates.next(readyUser());
    await flush();

    expect(checkoutRequests().length).toBeGreaterThan(0);
    expect(root.textContent).toContain(
      kind === 'pro' ? '€133.00' : 'Your Business TEST quote',
    );
    expect(
      root.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked,
    ).toBe(false);
    expect(mountProvider).not.toHaveBeenCalled();
  },
);
