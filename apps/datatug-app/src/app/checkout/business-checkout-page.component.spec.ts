import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  SneatAuthStateService,
  SneatUserService,
  type ISneatAuthState,
  type ISneatUserState,
} from '@sneat/auth-core';
import { BehaviorSubject, of } from 'rxjs';
import { TEST_CHECKOUT_ORIGIN } from './checkout-config.mjs';
import {
  DATATUG_BUSINESS_CHECKOUT_API_ORIGIN,
  DATATUG_BUSINESS_CHECKOUT_LIVE_API_ORIGIN,
  DATATUG_BUSINESS_CHECKOUT_LIVE_ENABLED,
} from './business-checkout-config';
import { BusinessCheckoutPageComponent } from './business-checkout-page.component';
import template from './business-checkout-page.component.html?raw';

it('embeds the shared auth panel for signed-out Business checkout', () => {
  expect(template).toContain(
    '<sneat-auth-panel [returnTo]="authReturnTo()" [showIntro]="false" />',
  );
  expect(template).not.toContain('Sign in to continue</button>');
});

const authenticated = {
  status: 'authenticated',
  loadingPhase: 'ready',
  token: 'in-memory-test-token',
  user: { uid: 'buyer', email: 'buyer@example.invalid', isAnonymous: false },
} as ISneatAuthState;
const spaces = {
  group_1: { title: 'Shared group', type: 'group', roles: ['owner'] },
  member_1: { title: 'Member only', type: 'company', roles: ['member'] },
  personal_1: { title: 'Personal', type: 'personal', roles: ['owner'] },
};
let states: BehaviorSubject<ISneatAuthState>;
let userStates: BehaviorSubject<ISneatUserState>;
let fixture: ComponentFixture<BusinessCheckoutPageComponent>;
let fetcher: ReturnType<typeof vi.fn>;

function businessQuote(claimed = false) {
  return {
    quoteID: 'quote_1',
    spaceID: 'group_1',
    serviceID: 'datatug',
    planID: 'datatug-business-usage-monthly',
    mode: 'test',
    accountKind: 'organisation',
    amount: { currency: 'eur', list: 9900, due: 9900, taxIncluded: true },
    quantity: 1,
    period: { interval: 'month', count: 1 },
    appliedDiscount: { kind: 'none', percentOff: 0 },
    expiresAtUTC: new Date(Date.now() + 60_000).toISOString(),
    claimed,
  };
}

async function render(
  query: Record<string, string | string[]>,
  apiOrigin: string | null,
  initialAuth: ISneatAuthState = authenticated,
  recordUID = 'buyer',
  testRailByDefault = true,
  returning = false,
) {
  const routeQuery =
    testRailByDefault && query.checkout === undefined
      ? { ...query, checkout: 'test' }
      : query;
  states = new BehaviorSubject(initialAuth);
  userStates = new BehaviorSubject<ISneatUserState>({
    status: 'authenticated',
    user: { ...authenticated.user, uid: recordUID } as ISneatUserState['user'],
    record: { spaces },
    userRecordStatus: 'ready',
  } as ISneatUserState);
  await TestBed.configureTestingModule({
    imports: [BusinessCheckoutPageComponent],
    providers: [
      provideRouter([]),
      { provide: DATATUG_BUSINESS_CHECKOUT_API_ORIGIN, useValue: apiOrigin },
      { provide: DATATUG_BUSINESS_CHECKOUT_LIVE_API_ORIGIN, useValue: null },
      { provide: DATATUG_BUSINESS_CHECKOUT_LIVE_ENABLED, useValue: false },
      {
        provide: SneatAuthStateService,
        useValue: {
          authState: states,
          fbAuth: {
            currentUser: {
              uid: initialAuth.user?.uid ?? 'buyer',
              isAnonymous: false,
              getIdToken: async () => 'token-only-header',
            },
          },
          signOut: async () => states.next({ status: 'notAuthenticated' }),
        },
      },
      {
        provide: SneatUserService,
        useValue: {
          userState: userStates,
        },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: of(convertToParamMap(routeQuery)),
          snapshot: {
            data: { businessCheckoutReturn: returning },
            queryParamMap: convertToParamMap(routeQuery),
          },
        },
      },
    ],
  })
    .overrideComponent(BusinessCheckoutPageComponent, {
      set: { imports: [RouterLink], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    })
    .compileComponents();
  fixture = TestBed.createComponent(BusinessCheckoutPageComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

beforeEach(() => {
  fetcher = vi.fn(async (url: URL, options?: RequestInit) => {
    void url;
    void options;
    return {
      ok: true,
      headers: new Headers(),
      json: async () => businessQuote(),
    };
  });
  vi.stubGlobal('fetch', fetcher);
});

afterEach(() => {
  fixture?.destroy();
  vi.unstubAllGlobals();
  TestBed.resetTestingModule();
});

it('keeps the cold route closed and makes no request until an API origin is configured', async () => {
  const root = await render(
    { planID: 'datatug-business-usage-monthly', spaceID: 'group_1' },
    null,
  );
  expect(root.textContent).toContain(
    'DataTug Business TEST checkout is not configured yet.',
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it('defaults to the closed LIVE rail and requires an explicit TEST selection', async () => {
  const root = await render(
    { planID: 'datatug-business-usage-monthly', spaceID: 'group_1' },
    TEST_CHECKOUT_ORIGIN,
    authenticated,
    'buyer',
    false,
  );
  expect(root.textContent).toContain('LIVE Business checkout is not enabled yet.');
  expect(root.querySelector('button[aria-pressed="true"]')?.textContent).toContain('LIVE');
  expect(fetcher).not.toHaveBeenCalled();
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
  const testRail = Array.from(root.querySelectorAll('button')).find((button) =>
    button.textContent?.trim() === 'TEST',
  );
  testRail?.click();
  expect(navigate).toHaveBeenCalledWith(
    [],
    expect.objectContaining({
      queryParams: {
        planID: 'datatug-business-usage-monthly',
        checkout: 'test',
        spaceID: 'group_1',
      },
    }),
  );
});

it.each([
  { checkout: ['test', 'test'] },
  { checkout: 'test', mode: 'live' },
  { checkout: 'live' },
])('rejects ambiguous Business rail selectors without an API call', async (query) => {
  const root = await render(
    { planID: 'datatug-business-usage-monthly', ...query },
    TEST_CHECKOUT_ORIGIN,
  );
  expect(root.textContent).toContain('The checkout rail selector is invalid.');
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects a return whose explicit mode conflicts with its session prefix', async () => {
  const root = await render(
    { spaceID: 'group_1', mode: 'live', session_id: 'cs_test_123' },
    TEST_CHECKOUT_ORIGIN,
    authenticated,
    'buyer',
    false,
    true,
  );
  expect(root.textContent).toContain('does not identify a valid TEST or LIVE session');
  expect(fetcher).not.toHaveBeenCalled();
});

it('shows the unavailable state on a real cold route before query normalization can stall', async () => {
  states = new BehaviorSubject(authenticated);
  await TestBed.configureTestingModule({
    imports: [BusinessCheckoutPageComponent],
    providers: [
      provideRouter([
        { path: 'business/checkout', component: BusinessCheckoutPageComponent },
      ]),
      {
        provide: DATATUG_BUSINESS_CHECKOUT_API_ORIGIN,
        useValue: null,
      },
      {
        provide: SneatAuthStateService,
        useValue: {
          authState: states,
          fbAuth: { currentUser: { isAnonymous: false } },
          signOut: async () => states.next({ status: 'notAuthenticated' }),
        },
      },
      {
        provide: SneatUserService,
        useValue: {
          userState: of({
            status: 'authenticated',
            user: authenticated.user,
            record: { spaces },
            userRecordStatus: 'ready',
          }),
        },
      },
    ],
  })
    .overrideComponent(BusinessCheckoutPageComponent, {
      set: { imports: [RouterLink], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    })
    .compileComponents();

  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(
    '/business/checkout',
    BusinessCheckoutPageComponent,
  );
  await harness.fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.fixture.whenStable();

  expect(harness.routeNativeElement?.textContent).toContain(
    'LIVE Business checkout is not enabled yet.',
  );
  expect(harness.routeNativeElement?.textContent).not.toContain(
    'Checking the Business LIVE quote',
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it('continues a real cold configured route after canonicalizing its default plan', async () => {
  states = new BehaviorSubject(authenticated);
  await TestBed.configureTestingModule({
    imports: [BusinessCheckoutPageComponent],
    providers: [
      provideRouter([
        { path: 'business/checkout', component: BusinessCheckoutPageComponent },
      ]),
      {
        provide: DATATUG_BUSINESS_CHECKOUT_API_ORIGIN,
        useValue: TEST_CHECKOUT_ORIGIN,
      },
      {
        provide: SneatAuthStateService,
        useValue: {
          authState: states,
          fbAuth: { currentUser: { isAnonymous: false } },
          signOut: async () => states.next({ status: 'notAuthenticated' }),
        },
      },
      {
        provide: SneatUserService,
        useValue: {
          userState: of({
            status: 'authenticated',
            user: authenticated.user,
            record: { spaces },
            userRecordStatus: 'ready',
          }),
        },
      },
    ],
  })
    .overrideComponent(BusinessCheckoutPageComponent, {
      set: { imports: [RouterLink], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    })
    .compileComponents();

  const harness = await RouterTestingHarness.create();
  const router = TestBed.inject(Router);
  await harness.navigateByUrl(
    '/business/checkout?checkout=test',
    BusinessCheckoutPageComponent,
  );
  await harness.fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.fixture.whenStable();

  expect(router.url).toBe(
    '/business/checkout?planID=datatug-business-usage-monthly&checkout=test',
  );
  expect(harness.routeNativeElement?.textContent).toContain('Choose a Space');
  expect(harness.routeNativeElement?.textContent).not.toContain(
    'Checking the Business TEST quote',
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it('offers only administerable Spaces and does not quote a member-selected Space', async () => {
  const root = await render(
    { planID: 'datatug-business-usage-monthly', spaceID: 'member_1' },
    TEST_CHECKOUT_ORIGIN,
  );
  expect(root.textContent).toContain('Choose a Space');
  expect(root.textContent).toContain('Shared group');
  expect(root.textContent).not.toContain('Member only');
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  {
    name: 'token failure',
    auth: { ...authenticated, loadingPhase: 'failed' } as ISneatAuthState,
    recordUID: 'buyer',
  },
  {
    name: 'a stale prior-account record',
    auth: authenticated,
    recordUID: 'previous-buyer',
  },
])(
  'keeps the quote and Space list closed for $name',
  async ({ auth, recordUID }) => {
    const root = await render(
      { planID: 'datatug-business-usage-monthly', spaceID: 'group_1' },
      TEST_CHECKOUT_ORIGIN,
      auth,
      recordUID,
    );
    expect(root.textContent).toContain('Choose a Space');
    expect(root.textContent).not.toContain('Shared group');
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('supports a cold deep link, gets the authenticated quote before consent, and displays its selected Space', async () => {
  const root = await render(
    { planID: 'datatug-business-usage-monthly', spaceID: 'group_1' },
    TEST_CHECKOUT_ORIGIN,
  );
  expect(root.textContent).toContain('Your Business TEST quote');
  expect(root.textContent).toContain('Shared group');
  expect(root.textContent).toContain('€99.00');
  expect(root.textContent).toContain('access remains pending reconciliation');
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, options] = fetcher.mock.calls[0];
  expect(String(url)).toBe(
    `${TEST_CHECKOUT_ORIGIN}/v0/checkout/space-service/quote`,
  );
  expect(options?.headers).toMatchObject({
    Authorization: 'Bearer token-only-header',
  });
  expect(options?.body).toBe(
    JSON.stringify({
      spaceID: 'group_1',
      planID: 'datatug-business-usage-monthly',
    }),
  );
});

it('allows Space reselection from the quote review before consent', async () => {
  const root = await render(
    { planID: 'datatug-business-usage-monthly', spaceID: 'group_1' },
    TEST_CHECKOUT_ORIGIN,
  );
  expect(root.textContent).toContain('Your Business TEST quote');
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  const changeSpace = root.querySelector<HTMLButtonElement>('.change-space');
  expect(changeSpace).not.toBeNull();
  changeSpace?.click();
  expect(navigate).toHaveBeenCalledWith(
    [],
    expect.objectContaining({
      queryParams: { planID: 'datatug-business-usage-monthly' },
    }),
  );
});

it('keeps a claimed quote locked after durable recovery', async () => {
  fetcher.mockImplementation(async () => ({
    ok: true,
    headers: new Headers(),
    json: async () => businessQuote(true),
  }));
  const root = await render(
    { planID: 'datatug-business-usage-monthly', spaceID: 'group_1' },
    TEST_CHECKOUT_ORIGIN,
  );
  expect(root.textContent).toContain('Your Business TEST quote');
  expect(root.querySelector('.change-space')).toBeNull();
  expect(
    Array.from(
      root.querySelectorAll<HTMLButtonElement>('.choices button'),
    ).every((button) => button.disabled),
  ).toBe(true);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
  root.querySelector<HTMLButtonElement>('.choices button')?.click();
  expect(navigate).not.toHaveBeenCalled();
});

it('allows consent for a cold claimed quote without replacing its frozen claim', async () => {
  fetcher.mockImplementation(async (url: URL) => {
    if (url.pathname.endsWith('/quote')) {
      return {
        ok: true,
        headers: new Headers(),
        json: async () => businessQuote(true),
      };
    }
    return {
      ok: false,
      status: 503,
      headers: new Headers({ 'Retry-After': '2' }),
      json: async () => ({ code: 'checkout_resolving' }),
    };
  });
  const root = await render(
    { planID: 'datatug-business-usage-monthly', spaceID: 'group_1' },
    TEST_CHECKOUT_ORIGIN,
  );
  expect(root.querySelector('.change-space')).toBeNull();
  expect(
    Array.from(
      root.querySelectorAll<HTMLButtonElement>('.choices button'),
    ).every((button) => button.disabled),
  ).toBe(true);
  const checkbox = root.querySelector<HTMLInputElement>('.consent input');
  expect(checkbox?.disabled).toBe(false);
  if (!checkbox) throw new Error('Expected consent checkbox');
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change'));
  fixture.detectChanges();
  const quoteSection = Array.from(root.querySelectorAll('section')).find(
    (section) => section.querySelector('#quote-heading'),
  );
  quoteSection?.querySelector<HTMLButtonElement>('button')?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();

  const quoteCalls = fetcher.mock.calls.filter(([url]) =>
    url.pathname.endsWith('/quote'),
  );
  const sessionCalls = fetcher.mock.calls.filter(([url]) =>
    url.pathname.endsWith('/session'),
  );
  expect(quoteCalls).toHaveLength(1);
  expect(sessionCalls).toHaveLength(1);
  expect(JSON.parse(String(sessionCalls[0][1]?.body))).toEqual({
    spaceID: 'group_1',
    quoteID: 'quote_1',
  });
});

it('allows Space reselection before consent and invalidates the previous quote request', async () => {
  let resolveFetch!: (response: {
    ok: boolean;
    headers: Headers;
    json: () => Promise<unknown>;
  }) => void;
  fetcher.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
  );
  const root = await render(
    { planID: 'datatug-business-usage-monthly', spaceID: 'group_1' },
    TEST_CHECKOUT_ORIGIN,
  );
  expect(fetcher).toHaveBeenCalledOnce();
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  root.querySelector<HTMLButtonElement>('.change-space')?.click();
  expect(navigate).toHaveBeenCalledWith(
    [],
    expect.objectContaining({
      queryParams: { planID: 'datatug-business-usage-monthly' },
    }),
  );
  resolveFetch({
    ok: true,
    headers: new Headers(),
    json: async () => businessQuote(),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  expect(fixture.componentInstance['state']().stage).toBe('select-space');
  expect(fixture.nativeElement.textContent).not.toContain(
    'Your Business TEST quote',
  );
});

it('locks Space and billing-period changes during session creation and same-quote recovery', async () => {
  const root = await render(
    { planID: 'datatug-business-usage-monthly', spaceID: 'group_1' },
    TEST_CHECKOUT_ORIGIN,
  );
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
  const state = fixture.componentInstance['state'];
  state.set({ stage: 'creating-session', user: { id: 'buyer', email: null } });
  fixture.detectChanges();
  expect(
    Array.from(
      root.querySelectorAll<HTMLButtonElement>('.choices button'),
    ).every((button) => button.disabled),
  ).toBe(true);
  expect(root.querySelector('.change-space')).toBeNull();
  state.set({
    stage: 'error',
    retrySameQuote: true,
    quote: { list: '€99.00', due: '€99.00', interval: 'month' },
  });
  fixture.detectChanges();
  expect(
    Array.from(
      root.querySelectorAll<HTMLButtonElement>('.choices button'),
    ).every((button) => button.disabled),
  ).toBe(true);
  expect(root.querySelector('.change-space')).toBeNull();
  root.querySelector<HTMLButtonElement>('.choices button')?.click();
  expect(navigate).not.toHaveBeenCalled();
});

it('re-acknowledges and retries the same frozen quote after session failure', async () => {
  fetcher.mockImplementation(async (url: URL) => {
    if (url.pathname.endsWith('/quote')) {
      return {
        ok: true,
        headers: new Headers(),
        json: async () => businessQuote(),
      };
    }
    return {
      ok: false,
      status: 503,
      headers: new Headers({ 'Retry-After': '2' }),
      json: async () => ({ code: 'checkout_resolving' }),
    };
  });
  const root = await render(
    { planID: 'datatug-business-usage-monthly', spaceID: 'group_1' },
    TEST_CHECKOUT_ORIGIN,
  );
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
  const acknowledge = async () => {
    const checkbox = root.querySelector<HTMLInputElement>('.consent input');
    expect(checkbox).not.toBeNull();
    expect(checkbox?.disabled).toBe(false);
    if (!checkbox) throw new Error('Expected consent checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const quoteSection = Array.from(root.querySelectorAll('section')).find(
      (section) => section.querySelector('#quote-heading'),
    );
    quoteSection?.querySelector<HTMLButtonElement>('button')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  };

  await acknowledge();
  expect(fixture.componentInstance['state']()).toMatchObject({
    stage: 'error',
    retrySameQuote: true,
  });
  expect(root.querySelector('.change-space')).toBeNull();
  expect(navigate).not.toHaveBeenCalled();

  const firstSessionBody = JSON.parse(
    String(
      fetcher.mock.calls.find(([url]) => url.pathname.endsWith('/session'))?.[1]
        ?.body,
    ),
  );
  await acknowledge();

  const quoteCalls = fetcher.mock.calls.filter(([url]) =>
    url.pathname.endsWith('/quote'),
  );
  const sessionCalls = fetcher.mock.calls.filter(([url]) =>
    url.pathname.endsWith('/session'),
  );
  expect(quoteCalls).toHaveLength(1);
  expect(sessionCalls).toHaveLength(2);
  expect(
    sessionCalls.map(([, options]) => JSON.parse(String(options?.body))),
  ).toEqual([firstSessionBody, firstSessionBody]);
});
