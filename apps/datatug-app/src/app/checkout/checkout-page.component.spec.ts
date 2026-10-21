import { DatePipe } from '@angular/common';
import { CheckoutPriceSummaryComponent } from './checkout-price-summary.component';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA, Provider } from '@angular/core';
import {
  ActivatedRoute,
  ParamMap,
  RouterLink,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { SneatApiBaseUrl } from '@sneat/api';
import {
  ISneatAuthState,
  SneatAuthStateService,
  SneatUserService,
} from '@sneat/auth-core';
import { BehaviorSubject, of } from 'rxjs';
import { CheckoutPageComponent } from './checkout-page.component';
import { DATATUG_CHECKOUT_FORCE_TEST } from './checkout-force-test';

const mount = vi.fn().mockResolvedValue({ destroy: vi.fn() });
vi.mock('./checkout-provider.mjs', () => ({
  stripeCheckoutAdapter: async () => ({ mount }),
}));
const quote = (
  mode: 'test' | 'live' = 'test',
  plan = 'datatug-pro-monthly',
) => {
  const annual = plan === 'datatug-pro-annual';
  const list = annual ? 19000 : 1900;
  const due = annual ? 13300 : 1330;
  return {
    sessionId: `cs_${mode}_fixture`,
    clientSecret: `cs_${mode}_fixture_secret_memory`,
    mode,
    accountId: 'buyer',
    accountKind: 'personal',
    amount: { currency: 'eur', list, due, taxIncluded: true },
    appliedDiscount: { kind: 'launch', percentOff: 30, duration: 'forever' },
    offer: {
      applied: true,
      reserved: false,
      duration: 'forever',
      percentOff: 30,
    },
  };
};
const authenticated = {
  status: 'authenticated',
  loadingPhase: 'ready',
  token: 'in-memory-test-token',
  user: { uid: 'buyer', email: 'buyer@example.invalid', isAnonymous: false },
} as ISneatAuthState;
let states: BehaviorSubject<ISneatAuthState>;
let queries: BehaviorSubject<ParamMap>;
let fixture: ComponentFixture<CheckoutPageComponent>;
let fetcher: ReturnType<typeof vi.fn>;

it('does not label an opaque payment return as Pro before its plan is known', async () => {
  const root = await render(
    { mode: 'test', session_id: 'cs_test_unknown_plan' },
    false,
    { status: 'notAuthenticated' },
    'buyer',
    {},
    true,
  );
  expect(root.querySelector('h1')?.textContent?.trim()).toBe(
    'Complete your DataTug subscription',
  );
  expect(document.title).toBe('Complete your DataTug subscription');
  expect(root.querySelector('ion-title')?.textContent).not.toContain('Pro');
  expect(fetcher).not.toHaveBeenCalled();

  queries.next(
    convertToParamMap({
      planID: 'datatug-business-usage-annual',
      purchaseId: 'purchase_1',
      checkout: 'test',
    }),
  );
  await fixture.whenStable();
  expect(root.querySelector('h1')?.textContent?.trim()).toBe(
    'Complete your DataTug Business subscription',
  );
  expect(document.title).toBe('Complete your DataTug Business subscription');
});

async function render(
  query: Record<string, string>,
  returning = false,
  initial: ISneatAuthState = authenticated,
  recordUID = 'buyer',
  spaces = {},
  authOnly = false,
  extraProviders: Provider[] = [],
) {
  states = new BehaviorSubject(initial);
  queries = new BehaviorSubject(convertToParamMap(query));
  await TestBed.configureTestingModule({
    imports: [CheckoutPageComponent],
    providers: [
      provideRouter([]),
      { provide: SneatApiBaseUrl, useValue: 'https://api.sneat.cloud/v0/' },
      {
        provide: SneatAuthStateService,
        useValue: {
          authState: states,
          fbAuth: {
            currentUser: {
              uid: initial.user?.uid ?? 'buyer',
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
            user: { ...authenticated.user, uid: recordUID },
            record: { title: 'Buyer', spaces },
            userRecordStatus: 'ready',
          }),
        },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: queries,
          snapshot: {
            data: { checkoutReturn: returning, checkoutAuth: authOnly },
            queryParamMap: convertToParamMap(query),
          },
        },
      },
      ...extraProviders,
    ],
  })
    .overrideComponent(CheckoutPageComponent, {
      set: {
        imports: [RouterLink, CheckoutPriceSummaryComponent, DatePipe],
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
      },
    })
    .compileComponents();
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  fixture = TestBed.createComponent(CheckoutPageComponent);
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

beforeEach(() => {
  mount.mockClear();
  fetcher = vi.fn(async (url: URL, options?: RequestInit) => {
    const requestMode =
      new URLSearchParams(url.search).get('mode') ??
      (url.pathname.endsWith('/session')
        ? JSON.parse(String(options?.body ?? '{}')).mode
        : null);
    const mode = requestMode === 'live' ? 'live' : 'test';
    const data = url.pathname.endsWith('/config')
      ? {
          site: 'datatug',
          mode,
          publishableKey: `pk_${mode}_fixture`,
          plans: ['datatug-pro-monthly', 'datatug-pro-annual'].map((id) => ({
            id,
            accountRequired: true,
            accountKind: 'personal',
            taxIncluded: true,
          })),
        }
      : quote(mode, JSON.parse(String(options?.body ?? '{}')).plan);
    return { ok: true, headers: new Headers(), json: async () => data };
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  fixture?.destroy();
  vi.unstubAllGlobals();
});

it.each([
  {
    query: { plan: 'pro', period: 'monthly' },
    returning: false,
    copy: 'Sign in with your Sneat.co account to review your price and continue to payment.',
  },
  {
    query: { mode: 'test', session_id: 'cs_test_waiting' },
    returning: true,
    copy: 'Sign in with the same Sneat.co account used for your purchase.',
  },
])(
  'shows the right sign-in context before any quote is requested',
  async ({ query, returning, copy }) => {
    const root = await render(
      query,
      returning,
      { status: 'notAuthenticated' },
      'buyer',
      {},
      true,
    );

    expect(root.textContent?.replace(/\s+/g, ' ')).toContain(copy);
    expect(root.querySelector('sneat-auth-panel')).toBeTruthy();
    // New purchasers open on Sign up; a visitor returning from payment already
    // has an account and keeps the default Sign in tab.
    expect(
      (
        root.querySelector('sneat-auth-panel') as HTMLElement & {
          initialMode?: string;
        }
      ).initialMode,
    ).toBe(returning ? undefined : 'sign-up');
    expect(root.textContent).not.toContain(
      'Continue with your DataTug account',
    );
    expect(
      root.querySelector('#checkout-auth-heading a')?.getAttribute('href'),
    ).toBe('https://sneat.co');
    expect(root.querySelector('datatug-checkout-price-summary')).toBeNull();
    expect(root.querySelector('.checkout-art')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('cold auth waits, then renders the quote and mounts only after acknowledgement', async () => {
  const root = await render(
    { plan: 'pro', period: 'monthly', checkout: 'test' },
    false,
    { status: 'authenticating' },
  );
  expect(fetcher).not.toHaveBeenCalled();
  states.next(authenticated);
  await fixture.whenStable();
  expect(root.textContent).toContain('€13.30');
  const quoteCopy = root.textContent?.replace(/\s+/g, ' ') ?? '';
  expect(quoteCopy).toContain(
    'DataTug Pro is in early access. Your subscription starts now, and some paid features are still being completed.',
  );
  expect(quoteCopy).toContain(
    'I understand this is early access and my subscription starts now.',
  );
  expect(quoteCopy).not.toContain('plan limits are not yet enforced');
  expect(mount).not.toHaveBeenCalled();
  const ack = root.querySelector('input');
  if (!ack) throw new Error('Missing quote acknowledgement');
  ack.checked = true;
  ack.dispatchEvent(new Event('change'));
  await fixture.whenStable();
  const pay = Array.from(root.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Continue to payment'),
  );
  if (!pay) throw new Error('Missing payment button');
  pay.click();
  await fixture.whenStable();
  expect(mount).toHaveBeenCalledOnce();
  expect(mount.mock.calls[0][0].clientSecret).toBe(quote().clientSecret);
  expect(root.innerHTML).not.toContain(quote().clientSecret);
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
  'does not quote or enable payment for $name',
  async ({ auth, recordUID }) => {
    const root = await render(
      { plan: 'pro', period: 'monthly' },
      false,
      auth,
      recordUID,
    );
    expect(root.querySelector('sneat-auth-panel')).toBeNull();
    expect(root.querySelector('datatug-checkout-price-summary')).toBeNull();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
      ['/checkout/sign-in'],
      { queryParams: { plan: 'pro', period: 'monthly' }, replaceUrl: true },
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(mount).not.toHaveBeenCalled();
  },
);

it('default LIVE checkout uses authenticated normal API config and session for the selected annual plan', async () => {
  const root = await render({ plan: 'pro', period: 'yearly' }, false, {
    status: 'authenticating',
  });
  expect(fetcher).not.toHaveBeenCalled();
  states.next(authenticated);
  await fixture.whenStable();

  expect(fetcher).toHaveBeenCalledTimes(2);
  const requests = fetcher.mock.calls.map(([url, options]) => ({
    url: new URL(String(url)),
    options,
  }));
  expect(requests.map(({ url }) => url.origin)).toEqual([
    'https://api.sneat.cloud',
    'https://api.sneat.cloud',
  ]);
  expect(requests.map(({ url }) => url.searchParams.get('mode'))).toEqual([
    'live',
    null,
  ]);
  expect(requests[0].url.pathname).toBe('/v0/checkout/config');
  expect(requests[1].url.pathname).toBe('/v0/checkout/session');
  expect(JSON.parse(String(requests[1].options.body))).toEqual({
    site: 'datatug',
    plan: 'datatug-pro-annual',
    mode: 'live',
  });
  expect(requests[1].options.headers.Authorization).toBe(
    'Bearer token-only-header',
  );
  expect(root.textContent).toContain('€133.00');
  expect(root.textContent).toContain('€190.00');
  expect(root.textContent).not.toContain('Test mode');
  expect(
    root.querySelector('a[href="https://datatug.app/en/terms/"]'),
  ).not.toBeNull();
  expect(
    root.querySelector('a[href="https://datatug.app/en/privacy/"]'),
  ).not.toBeNull();
  expect(
    root.querySelector(
      'a[href="https://datatug.app/en/pricing/?period=yearly"]',
    ),
  ).not.toBeNull();
  expect(root.textContent).toContain(
    'Please review these policies before continuing to payment.',
  );
  expect(mount).not.toHaveBeenCalled();
});

it.each(['test', 'live'])(
  'refresh/cold %s return reads only owner-checked status on the correct rail',
  async (mode) => {
    fetcher.mockImplementation(async () => ({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        mode,
        plan: 'datatug-pro-monthly',
        status: 'complete',
        ready: true,
      }),
    }));
    const root = await render({ mode, session_id: `cs_${mode}_paid` }, true);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toContain(
      mode === 'test' ? 'datatug-checkout-test' : 'api.sneat.cloud',
    );
    expect(String(url)).toContain(`mode=${mode}`);
    expect(options.method).toBeUndefined();
    expect(options.headers.Authorization).toBe('Bearer token-only-header');
    expect(root.textContent).toContain('Continue to DataTug');
    expect(document.title).toBe('Complete your DataTug Pro subscription');
    expect(mount).not.toHaveBeenCalled();
  },
);

it('already subscribed exposes the existing return and never offers another purchase retry', async () => {
  fetcher.mockImplementation(async (url: URL) =>
    url.pathname.endsWith('/config')
      ? {
          ok: true,
          headers: new Headers(),
          json: async () => ({
            site: 'datatug',
            mode: 'test',
            publishableKey: 'pk_test_fixture',
            plans: [
              {
                id: 'datatug-pro-monthly',
                accountRequired: true,
                accountKind: 'personal',
                taxIncluded: true,
              },
            ],
          }),
        }
      : {
          ok: false,
          status: 409,
          headers: new Headers(),
          json: async () => ({
            code: 'already_subscribed',
            sessionId: 'cs_test_paid',
          }),
        },
  );
  const root = await render({
    plan: 'pro',
    period: 'monthly',
    checkout: 'test',
  });
  expect(root.textContent).toContain('Check existing purchase');
  expect(root.textContent).not.toContain('Retry this selection');
  expect(mount).not.toHaveBeenCalled();
});

it.each([
  {
    mode: 'live',
    query: { plan: 'pro', period: 'monthly' },
    origin: 'https://api.sneat.cloud',
    failedStage: 'config',
  },
  {
    mode: 'live',
    query: { plan: 'pro', period: 'monthly' },
    origin: 'https://api.sneat.cloud',
    failedStage: 'session',
  },
  {
    mode: 'test',
    query: { plan: 'pro', period: 'monthly', checkout: 'test' },
    origin: 'https://datatug-checkout-test-354fvnqbaa-ey.a.run.app',
    failedStage: 'config',
  },
  {
    mode: 'test',
    query: { plan: 'pro', period: 'monthly', checkout: 'test' },
    origin: 'https://datatug-checkout-test-354fvnqbaa-ey.a.run.app',
    failedStage: 'session',
  },
])(
  '$mode $failedStage errors remain on the selected rail',
  async ({ mode, query, origin, failedStage }) => {
    fetcher.mockImplementation(async (url: URL) => {
      if (failedStage === 'config' || url.pathname.endsWith('/session')) {
        return {
          ok: false,
          status: 503,
          headers: new Headers(),
          json: async () => ({ code: 'checkout_not_configured' }),
        };
      }
      const selectedMode = new URLSearchParams(url.search).get('mode');
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({
          site: 'datatug',
          mode: selectedMode,
          publishableKey: `pk_${selectedMode}_fixture`,
          plans: [
            {
              id: 'datatug-pro-monthly',
              accountRequired: true,
              accountKind: 'personal',
              taxIncluded: true,
            },
          ],
        }),
      };
    });
    const root = await render(query);
    expect(fetcher).toHaveBeenCalledTimes(failedStage === 'config' ? 1 : 2);
    expect(
      fetcher.mock.calls.map(([url]) => new URL(String(url)).origin),
    ).toEqual(
      Array.from({ length: failedStage === 'config' ? 1 : 2 }, () => origin),
    );
    expect(
      new URL(String(fetcher.mock.calls[0][0])).searchParams.get('mode'),
    ).toBe(mode);
    expect(root.textContent).toContain('Checkout is unavailable right now');
    expect(mount).not.toHaveBeenCalled();
  },
);

it('uses emitted query context when the cached route snapshot still has the previous period', async () => {
  const root = await render({
    plan: 'pro',
    period: 'monthly',
    checkout: 'test',
  });
  queries.next(
    convertToParamMap({ plan: 'pro', period: 'yearly', checkout: 'test' }),
  );
  await fixture.whenStable();
  expect(root.textContent).toContain('€133.00');
  expect(
    root.querySelector('[role=tab][aria-selected=true]')?.textContent,
  ).toContain('Yearly');
  expect(root.textContent).not.toContain('2 months free');
  expect(
    root.querySelector(
      'a[href="https://datatug.app/en/pricing/?period=yearly&checkout=test"]',
    ),
  ).not.toBeNull();
  expect(fixture.componentInstance['authReturnTo']()).toBe(
    '/subscribe?plan=pro&period=yearly&checkout=test',
  );
});

const businessPlan = 'datatug-business-usage-monthly';
const startingSituations = [
  [
    'project and company',
    { company_a: { title: 'Acme', type: 'company', roles: ['owner'] } },
  ],
  [
    'company without project',
    { company_a: { title: 'Acme', type: 'company', roles: ['owner'] } },
  ],
  [
    'project without company',
    { personal_a: { title: 'Personal', type: 'personal', roles: ['owner'] } },
  ],
  ['neither project nor company', {}],
] as const;

it.each(startingSituations)(
  'Business pays before space selection: %s',
  async (_name, spaces) => {
    fetcher.mockImplementation(async (url: URL) => ({
      ok: true,
      headers: new Headers(),
      json: async () =>
        url.pathname.endsWith('/config')
          ? {
              site: 'datatug',
              mode: 'test',
              publishableKey: 'pk_test_fixture',
              plans: [
                {
                  id: businessPlan,
                  accountRequired: true,
                  accountKind: 'organisation',
                  taxIncluded: true,
                },
              ],
            }
          : {
              ...quote(),
              accountKind: 'organisation',
              accountId: 'billing-a',
              amount: {
                currency: 'eur',
                list: 9900,
                due: 6930,
                taxIncluded: true,
              },
            },
    }));
    const html = await render(
      { planID: businessPlan, checkout: 'test', purchaseId: 'purchase-a' },
      false,
      authenticated,
      'buyer',
      spaces,
    );
    expect(html.textContent).toContain('€99.00');
    expect(html.textContent).toContain('€69.30');
    expect(html.textContent).toContain('2 months free');
    expect(html.querySelector('select')).toBeNull();
    const session = fetcher.mock.calls.find(([url]) =>
      url.pathname.endsWith('/session'),
    );
    expect(JSON.parse(String(session?.[1]?.body))).toMatchObject({
      plan: businessPlan,
      purchaseId: 'purchase-a',
      mode: 'test',
    });
  },
);

it('paid Business return creates a space once, then keeps Pro unless explicitly chosen', async () => {
  let linked = false,
    commands = 0;
  const purchase = { accountId: 'billing-a', setupRequired: true, paid: true };
  fetcher.mockImplementation(async (url: URL, options?: RequestInit) => ({
    ok: true,
    headers: new Headers(),
    json: async () => {
      if (url.pathname.endsWith('/session-status'))
        return {
          mode: 'test',
          plan: businessPlan,
          status: 'complete',
          ready: true,
          purchase,
        };
      if (url.pathname.endsWith('/purchase-options')) {
        if (options?.method === 'POST') commands++;
        return {
          canCancelPersonal: commands === 0,
          cancellationScheduled: commands > 0,
          personalPaidThroughUTC: '2027-10-12T00:00:00Z',
        };
      }
      if (url.pathname.endsWith('/purchase-setup')) {
        linked = true;
        return { ...purchase, spaceID: 'new-company', setupRequired: false };
      }
      throw new Error('unexpected request');
    },
  }));
  const html = await render({ mode: 'test', session_id: 'cs_test_paid' }, true);
  await fixture.whenStable();
  expect(html.textContent).toContain('Your Business subscription is paid');
  expect(document.title).toBe('Complete your DataTug Business subscription');
  expect(commands).toBe(0);
  const name = html.querySelector('#business-name') as HTMLInputElement;
  name.value = 'New Business';
  name.dispatchEvent(
    new CustomEvent('ionInput', { detail: { value: 'New Business' } }),
  );
  const activate = [
    ...html.querySelectorAll<HTMLElement>('button, ion-button'),
  ].find((x) => x.textContent?.includes('Activate Business'));
  if (!activate) throw new Error('missing activation action');
  activate.click();
  activate.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
  expect(linked).toBe(true);
  expect(
    fetcher.mock.calls.filter(([url]) =>
      url.pathname.endsWith('/purchase-setup'),
    ),
  ).toHaveLength(1);
  expect(html.textContent).toContain('Your Business space is ready');
  expect(commands).toBe(0);
  const choice = html.querySelector('ion-checkbox') as HTMLInputElement;
  expect(choice.checked).toBe(false);
  choice.dispatchEvent(
    new CustomEvent('ionChange', { detail: { checked: true } }),
  );
  await fixture.whenStable();
  const confirm = [
    ...html.querySelectorAll<HTMLElement>('button, ion-button'),
  ].find((x) => x.textContent?.includes('Confirm Pro renewal cancellation'));
  if (!confirm) throw new Error('missing cancellation action');
  confirm.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
  expect(commands).toBe(1);
  expect(html.textContent).toContain('Pro renewal cancellation is scheduled');
});

it.each([
  {
    query: { plan: 'pro', period: 'yearly', checkout: 'test' },
    destination: '/subscribe?plan=pro&period=yearly&checkout=test',
  },
  {
    query: {
      planID: 'datatug-business-usage-annual',
      spaceID: 'company_1',
      purchaseId: 'purchase_1',
      checkout: 'test',
    },
    destination:
      '/business/checkout?planID=datatug-business-usage-annual&checkout=test&spaceID=company_1&purchaseId=purchase_1',
  },
])(
  'auth page resumes the exact selected checkout without requesting a quote',
  async ({ query, destination }) => {
    const root = await render(
      query,
      false,
      { status: 'notAuthenticated' },
      'buyer',
      {},
      true,
    );
    expect(root.textContent).toContain('Complete your DataTug');
    expect(root.querySelector('datatug-checkout-price-summary')).toBeNull();
    states.next(authenticated);
    await fixture.whenStable();
    expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith(
      destination,
      { replaceUrl: true },
    );
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('reused auth page switches from a selection to a purchase return', async () => {
  const root = await render(
    { plan: 'pro', period: 'monthly', checkout: 'test' },
    false,
    { status: 'notAuthenticated' },
    'buyer',
    {},
    true,
  );
  queries.next(
    convertToParamMap({ mode: 'test', session_id: 'cs_test_waiting' }),
  );
  await fixture.whenStable();
  expect(root.textContent?.replace(/\s+/g, ' ')).toContain(
    'Sign in with the same Sneat.co account used for your purchase.',
  );
  states.next(authenticated);
  await fixture.whenStable();
  expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith(
    '/pricing/return?mode=test&session_id=cs_test_waiting',
    { replaceUrl: true },
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it('restores the prior tab title on checkout exit and titles a cached re-entry again', async () => {
  document.title = 'DataTug.app';
  await render({ plan: 'pro', period: 'monthly', checkout: 'test' });
  expect(document.title).toBe('Complete your DataTug Pro subscription');
  fixture.componentInstance.ionViewWillLeave();
  await fixture.whenStable();
  expect(document.title).toBe('DataTug.app');
  fixture.componentInstance.ionViewWillEnter();
  await fixture.whenStable();
  expect(document.title).toBe('Complete your DataTug Pro subscription');
  fixture.destroy();
  expect(document.title).toBe('DataTug.app');
});

describe('checkout page rail with the preview flag', () => {
  const modeOf = () =>
    (
      fixture.componentInstance as unknown as { mode(): 'test' | 'live' }
    ).mode();

  it('ends in TEST mode for a Pro selection when the preview forces TEST', async () => {
    await render(
      { plan: 'pro', period: 'monthly' },
      false,
      authenticated,
      'buyer',
      {},
      false,
      [{ provide: DATATUG_CHECKOUT_FORCE_TEST, useValue: true }],
    );
    expect(modeOf()).toBe('test');
    expect(fetcher.mock.calls.length).toBeGreaterThan(0);
    for (const [url] of fetcher.mock.calls) {
      expect(new URL(String(url)).origin).toBe(
        'https://datatug-checkout-test-354fvnqbaa-ey.a.run.app',
      );
    }
  });

  it('keeps LIVE mode for the same Pro selection with the default flag', async () => {
    await render({ plan: 'pro', period: 'monthly' }, false, authenticated);
    expect(modeOf()).toBe('live');
  });
});
