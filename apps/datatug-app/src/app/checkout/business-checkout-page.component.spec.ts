import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import {
  SneatAuthStateService,
  SneatUserService,
  type ISneatAuthState,
} from '@sneat/auth-core';
import { BehaviorSubject, of } from 'rxjs';
import { DATATUG_BUSINESS_CHECKOUT_API_ORIGIN } from './business-checkout-config';
import { BusinessCheckoutPageComponent } from './business-checkout-page.component';

const authenticated = {
  status: 'authenticated',
  user: { uid: 'buyer', email: 'buyer@example.invalid', isAnonymous: false },
} as ISneatAuthState;
const spaces = {
  group_1: { title: 'Shared group', type: 'group', roles: ['owner'] },
  member_1: { title: 'Member only', type: 'company', roles: ['member'] },
  personal_1: { title: 'Personal', type: 'personal', roles: ['owner'] },
};
let states: BehaviorSubject<ISneatAuthState>;
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

async function render(query: Record<string, string>, apiOrigin: string | null) {
  states = new BehaviorSubject(authenticated);
  await TestBed.configureTestingModule({
    imports: [BusinessCheckoutPageComponent],
    providers: [
      provideRouter([]),
      { provide: DATATUG_BUSINESS_CHECKOUT_API_ORIGIN, useValue: apiOrigin },
      {
        provide: SneatAuthStateService,
        useValue: {
          authState: states,
          fbAuth: {
            currentUser: {
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
          userState: of({
            status: 'authenticated',
            user: authenticated.user,
            record: { spaces },
          }),
        },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: of(convertToParamMap(query)),
          snapshot: {
            data: { businessCheckoutReturn: false },
            queryParamMap: convertToParamMap(query),
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

it('offers only administerable Spaces and does not quote a member-selected Space', async () => {
  const root = await render(
    { planID: 'datatug-business-usage-monthly', spaceID: 'member_1' },
    'https://checkout.test.invalid',
  );
  expect(root.textContent).toContain('Choose a Space');
  expect(root.textContent).toContain('Shared group');
  expect(root.textContent).not.toContain('Member only');
  expect(fetcher).not.toHaveBeenCalled();
});

it('supports a cold deep link, gets the authenticated quote before consent, and displays its selected Space', async () => {
  const root = await render(
    { planID: 'datatug-business-usage-monthly', spaceID: 'group_1' },
    'https://checkout.test.invalid',
  );
  expect(root.textContent).toContain('Your Business TEST quote');
  expect(root.textContent).toContain('Shared group');
  expect(root.textContent).toContain('€99.00');
  expect(root.textContent).toContain('access remains pending reconciliation');
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, options] = fetcher.mock.calls[0];
  expect(String(url)).toBe(
    'https://checkout.test.invalid/v0/checkout/space-service/quote',
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
    'https://checkout.test.invalid',
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
    'https://checkout.test.invalid',
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
    'https://checkout.test.invalid',
  );
  expect(root.querySelector('.change-space')).toBeNull();
  expect(
    Array.from(
      root.querySelectorAll<HTMLButtonElement>('.choices button'),
    ).every((button) => button.disabled),
  ).toBe(true);
  const checkbox = root.querySelector<HTMLInputElement>('.consent input');
  expect(checkbox?.disabled).toBe(false);
  checkbox!.checked = true;
  checkbox!.dispatchEvent(new Event('change'));
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
    'https://checkout.test.invalid',
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
    'https://checkout.test.invalid',
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
    'https://checkout.test.invalid',
  );
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
  const acknowledge = async () => {
    const checkbox = root.querySelector<HTMLInputElement>('.consent input');
    expect(checkbox).not.toBeNull();
    expect(checkbox?.disabled).toBe(false);
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event('change'));
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
