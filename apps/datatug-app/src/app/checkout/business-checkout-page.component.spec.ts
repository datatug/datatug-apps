import { CheckoutPriceSummaryComponent } from './checkout-price-summary.component';
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
import { SpaceService } from '@sneat/space-services';
import { BehaviorSubject, EMPTY, Observable, of, Subject } from 'rxjs';
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

it('labels TEST activity separately from LIVE access on the return page', async () => {
  const root = await render(
    { spaceID: 'group_1', mode: 'test', session_id: 'cs_test_123' },
    TEST_CHECKOUT_ORIGIN,
    authenticated,
    'buyer',
    false,
    true,
  );
  const state = fixture.componentInstance['state'];
  state.set({ stage: 'business-active', spaceID: 'group_1' });
  fixture.detectChanges();
  expect(root.textContent).toContain('TEST Business access is active');
  expect(root.textContent).toContain('does not activate LIVE access');
  expect(root.textContent).not.toContain('Create a project in this Space');
  state.set({ stage: 'business-ended' });
  fixture.detectChanges();
  expect(root.textContent).toContain('TEST Business access has ended');
});

const authenticated = {
  status: 'authenticated',
  loadingPhase: 'ready',
  token: 'in-memory-test-token',
  user: { uid: 'buyer', email: 'buyer@example.invalid', isAnonymous: false },
} as ISneatAuthState;
const spaces = {
  group_1: {
    title: 'Shared group',
    type: 'group',
    roles: ['owner'],
    userContactID: 'owner-contact',
  },
  member_1: {
    title: 'Member only',
    type: 'company',
    roles: ['member'],
    userContactID: 'member-contact',
  },
  personal_1: {
    title: 'Personal',
    type: 'personal',
    roles: ['owner'],
    userContactID: 'personal-contact',
  },
};
let states: BehaviorSubject<ISneatAuthState>;
let userStates: BehaviorSubject<ISneatUserState>;
let fixture: ComponentFixture<BusinessCheckoutPageComponent>;
let fetcher: ReturnType<typeof vi.fn>;
let spaceCreator: ReturnType<
  typeof vi.fn<(request: unknown) => Observable<{ id: string }>>
>;

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
    testRailByDefault && query['checkout'] === undefined
      ? {
          ...(query['planID'] ? { planID: query['planID'] } : {}),
          checkout: 'test',
          ...Object.fromEntries(
            Object.entries(query).filter(([key]) => key !== 'planID'),
          ),
        }
      : query;
  states = new BehaviorSubject(initialAuth);
  userStates = new BehaviorSubject<ISneatUserState>({
    status: 'authenticated',
    user: { ...authenticated.user, uid: recordUID } as ISneatUserState['user'],
    record: { title: 'Buyer', spaces },
    userRecordStatus: 'ready',
  } as ISneatUserState);
  spaceCreator = vi.fn();
  await TestBed.configureTestingModule({
    imports: [BusinessCheckoutPageComponent],
    providers: [
      provideRouter([]),
      {
        provide: SpaceService,
        useValue: { createSpace: (request: unknown) => spaceCreator(request) },
      },
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
      set: {
        imports: [RouterLink, CheckoutPriceSummaryComponent],
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
      },
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
  expect(root.textContent).toContain(
    'LIVE Business checkout is not enabled yet.',
  );
  expect(root.textContent).not.toContain('Payment rail');
  expect(
    Array.from(root.querySelectorAll('button')).some((button) =>
      ['LIVE', 'TEST'].includes(button.textContent?.trim() ?? ''),
    ),
  ).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each<Record<string, string | string[]>>([
  { checkout: ['test', 'test'] },
  { checkout: 'test', mode: 'live' },
  { checkout: 'live' },
])(
  'rejects ambiguous Business rail selectors without an API call',
  async (query) => {
    const root = await render(
      { planID: 'datatug-business-usage-monthly', ...query },
      TEST_CHECKOUT_ORIGIN,
    );
    expect(root.textContent).toContain(
      'The checkout rail selector is invalid.',
    );
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('rejects a return whose explicit mode conflicts with its session prefix', async () => {
  const root = await render(
    { spaceID: 'group_1', mode: 'live', session_id: 'cs_test_123' },
    TEST_CHECKOUT_ORIGIN,
    authenticated,
    'buyer',
    false,
    true,
  );
  expect(root.textContent).toContain(
    'does not identify a valid TEST or LIVE session',
  );
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
            record: { title: 'Buyer', spaces },
            userRecordStatus: 'ready',
          }),
        },
      },
    ],
  })
    .overrideComponent(BusinessCheckoutPageComponent, {
      set: {
        imports: [RouterLink, CheckoutPriceSummaryComponent],
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
      },
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
            record: { title: 'Buyer', spaces },
            userRecordStatus: 'ready',
          }),
        },
      },
    ],
  })
    .overrideComponent(BusinessCheckoutPageComponent, {
      set: {
        imports: [RouterLink, CheckoutPriceSummaryComponent],
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
      },
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
  expect(root.textContent).toContain(
    'subscription will be confirmed before Business access is available',
  );
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
      queryParams: {
        planID: 'datatug-business-usage-monthly',
        checkout: 'test',
      },
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
      queryParams: {
        planID: 'datatug-business-usage-monthly',
        checkout: 'test',
      },
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

it.each([
  [
    {
      planID: 'datatug-business-usage-monthly',
      spaceID: 'group_1',
      checkout: 'test',
    },
    true,
    'https://datatug.app/en/pricing/?period=monthly&checkout=test',
  ],
  [
    { planID: 'datatug-business-usage-monthly', spaceID: 'group_1' },
    false,
    'https://datatug.app/en/pricing/?period=monthly',
  ],
])(
  'links back to pricing at %s for query %j',
  async (params, testRailByDefault, expected) => {
    const root = await render(
      params,
      TEST_CHECKOUT_ORIGIN,
      authenticated,
      'buyer',
      testRailByDefault,
    );
    expect(
      root
        .querySelector('nav[aria-label="Checkout navigation"] a')
        ?.getAttribute('href'),
    ).toBe(expected);
  },
);

function requiredElement<T extends Element>(
  root: HTMLElement,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

it('creates a shared Space once, waits for real owner eligibility, and preserves annual TEST selection', async () => {
  const root = await render(
    { planID: 'datatug-business-usage-annual' },
    TEST_CHECKOUT_ORIGIN,
  );
  const creation = new Subject<{ id: string }>();
  spaceCreator.mockReturnValue(creation);
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  const input = requiredElement<HTMLInputElement>(root, '#business-space-name');
  input.value = '  New team  ';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const form = requiredElement<HTMLFormElement>(root, 'form.create-space');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await fixture.whenStable();
  expect(spaceCreator).toHaveBeenCalledExactlyOnceWith({
    type: 'group',
    title: 'New team',
  });
  expect(root.textContent).toContain('Creating Space…');
  creation.next({ id: 'new_group' });
  await fixture.whenStable();
  expect(root.textContent).toContain('Waiting for owner access');
  expect(navigate).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  userStates.next({
    ...userStates.value,
    record: {
      title: 'Buyer',
      spaces: {
        ...spaces,
        new_group: {
          userContactID: 'new-owner-contact',
          type: 'group',
          title: 'New team',
          roles: ['member'],
        },
      },
    },
  } as ISneatUserState);
  await fixture.whenStable();
  expect(navigate).not.toHaveBeenCalled();
  userStates.next({
    ...userStates.value,
    record: {
      title: 'Buyer',
      spaces: {
        ...spaces,
        new_group: {
          userContactID: 'new-owner-contact',
          type: 'group',
          title: 'New team',
          roles: ['owner'],
        },
      },
    },
  } as ISneatUserState);
  await fixture.whenStable();
  expect(navigate).toHaveBeenCalledWith(
    [],
    expect.objectContaining({
      queryParams: {
        planID: 'datatug-business-usage-annual',
        checkout: 'test',
        spaceID: 'new_group',
      },
    }),
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(['account', 'period', 'leave', 'destroy'])(
  'ignores a late Space creation after %s changes',
  async (change) => {
    const root = await render(
      { planID: 'datatug-business-usage-monthly' },
      TEST_CHECKOUT_ORIGIN,
    );
    const creation = new Subject<{ id: string }>();
    spaceCreator.mockReturnValue(creation);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    fixture.componentInstance['spaceName'].set('New Space');
    requiredElement<HTMLFormElement>(root, 'form.create-space').dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    if (change === 'account')
      states.next({
        ...authenticated,
        user: { ...authenticated.user, uid: 'other' },
      } as ISneatAuthState);
    if (change === 'period')
      fixture.componentInstance['choosePeriod']('annual');
    if (change === 'leave') fixture.componentInstance.ionViewWillLeave();
    if (change === 'destroy') fixture.destroy();
    await fixture.whenStable();
    navigate.mockClear();
    creation.next({ id: 'new_group' });
    userStates.next({
      ...userStates.value,
      record: {
        title: 'Buyer',
        spaces: {
          new_group: {
            userContactID: 'new-owner-contact',
            type: 'group',
            title: 'New',
            roles: ['owner'],
          },
        },
      },
    } as ISneatUserState);
    await fixture.whenStable();
    expect(navigate).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('bounds eligibility waiting and retries access without creating a duplicate Space', async () => {
  const root = await render(
    { planID: 'datatug-business-usage-monthly' },
    TEST_CHECKOUT_ORIGIN,
  );
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    spaceCreator.mockReturnValue(of({ id: 'new_group' }));
    fixture.componentInstance['spaceName'].set('New Space');
    requiredElement<HTMLFormElement>(root, 'form.create-space').dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await vi.advanceTimersByTimeAsync(15_001);
    await fixture.whenStable();
    expect(root.textContent).toContain(
      'Owner or admin access has not appeared',
    );
    expect(
      requiredElement<HTMLInputElement>(root, '#business-space-name').disabled,
    ).toBe(true);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    fixture.componentInstance['checkCreatedSpace']();
    userStates.next({
      ...userStates.value,
      record: {
        title: 'Buyer',
        spaces: {
          new_group: {
            userContactID: 'new-owner-contact',
            type: 'group',
            title: 'New',
            roles: ['admin'],
          },
        },
      },
    } as ISneatUserState);
    await fixture.whenStable();
    expect(spaceCreator).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ spaceID: 'new_group' }),
      }),
    );
  } finally {
    vi.useRealTimers();
  }
});

it('sanitizes creation errors and refuses blank or unavailable creation', async () => {
  const root = await render(
    { planID: 'datatug-business-usage-monthly' },
    TEST_CHECKOUT_ORIGIN,
  );
  const creation = new Subject<{ id: string }>();
  spaceCreator.mockReturnValue(creation);
  const form = requiredElement<HTMLFormElement>(root, 'form.create-space');
  fixture.componentInstance['spaceName'].set('  ');
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(spaceCreator).not.toHaveBeenCalled();
  fixture.componentInstance['spaceName'].set('A Space');
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  creation.error(new Error('private backend payload'));
  await fixture.whenStable();
  expect(root.textContent).toContain('Space creation may have completed');
  expect(root.textContent).not.toContain('private backend payload');
  states.next({ status: 'notAuthenticated' });
  await fixture.whenStable();
  fixture.componentInstance['createSpace'](new Event('submit'));
  expect(spaceCreator).toHaveBeenCalledTimes(1);
  expect(root.querySelector('form.create-space')).toBeNull();
});

it.each(['empty', 'invalid-id'])(
  'fences an uncertain %s create response without blind retries',
  async (response) => {
    const root = await render(
      { planID: 'datatug-business-usage-monthly' },
      TEST_CHECKOUT_ORIGIN,
    );
    spaceCreator.mockReturnValue(
      response === 'empty' ? EMPTY : of({ id: '../foreign' }),
    );
    fixture.componentInstance['spaceName'].set('A Space');
    const form = requiredElement<HTMLFormElement>(root, 'form.create-space');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance['spaceCreationStage']()).toBe('idle');
    expect(root.textContent).toContain('Space creation may have completed');
    expect(
      requiredElement<HTMLButtonElement>(root, '.create-space button').disabled,
    ).toBe(true);
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(spaceCreator).toHaveBeenCalledTimes(1);
  },
);

it('fences a timed-out POST and late success across a local period change, while allowing explicit existing-Space selection', async () => {
  const root = await render(
    { planID: 'datatug-business-usage-monthly' },
    TEST_CHECKOUT_ORIGIN,
  );
  const creation = new Subject<{ id: string }>();
  spaceCreator.mockReturnValue(creation);
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  fixture.componentInstance['spaceName'].set('A Space');
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    requiredElement<HTMLFormElement>(root, 'form.create-space').dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await vi.advanceTimersByTimeAsync(30_001);
    await fixture.whenStable();
    expect(root.textContent).toContain('Space creation may have completed');
    creation.next({ id: 'new_group' });
    fixture.componentInstance['start'](
      convertToParamMap({
        planID: 'datatug-business-usage-annual',
        checkout: 'test',
      }),
    );
    await fixture.whenStable();
    fixture.componentInstance['createSpace'](new Event('submit'));
    expect(spaceCreator).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    userStates.next({
      ...userStates.value,
      record: {
        title: 'Buyer',
        spaces: {
          new_group: {
            userContactID: 'new-owner-contact',
            type: 'group',
            title: 'New',
            roles: ['owner'],
          },
        },
      },
    } as ISneatUserState);
    await fixture.whenStable();
    expect(navigate).not.toHaveBeenCalled();
    fixture.componentInstance['chooseSpace']('new_group');
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: {
          planID: 'datatug-business-usage-annual',
          checkout: 'test',
          spaceID: 'new_group',
        },
      }),
    );
  } finally {
    vi.useRealTimers();
  }
});

it('allows retry after a synchronous pre-dispatch failure and denies creation during payment or after leaving', async () => {
  const root = await render(
    { planID: 'datatug-business-usage-monthly' },
    TEST_CHECKOUT_ORIGIN,
  );
  spaceCreator.mockImplementationOnce(() => {
    throw new Error('local unavailable');
  });
  fixture.componentInstance['spaceName'].set('A Space');
  fixture.componentInstance['createSpace'](new Event('submit'));
  await fixture.whenStable();
  expect(root.textContent).toContain('Unable to create a Space. Please retry.');
  expect(fixture.componentInstance['spaceCreationUncertain']()).toBe(false);
  fixture.componentInstance['state'].set({ stage: 'payment' });
  fixture.componentInstance['createSpace'](new Event('submit'));
  expect(spaceCreator).toHaveBeenCalledTimes(1);
  fixture.componentInstance['state'].set({
    stage: 'select-space',
    user: { id: 'buyer', email: null },
  });
  fixture.componentInstance.ionViewWillLeave();
  fixture.componentInstance['createSpace'](new Event('submit'));
  expect(spaceCreator).toHaveBeenCalledTimes(1);
});
