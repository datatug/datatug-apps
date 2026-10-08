import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import {
  ActivatedRoute,
  RouterLink,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { SneatApiBaseUrl } from '@sneat/api';
import { ISneatAuthState, SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, of } from 'rxjs';
import { CheckoutPageComponent } from './checkout-page.component';

const mount = vi.fn().mockResolvedValue({ destroy: vi.fn() });
vi.mock('./checkout-provider.mjs', () => ({
  stripeCheckoutAdapter: async () => ({ mount }),
}));
const quote = (mode: 'test' | 'live' = 'test') => ({
  sessionId: `cs_${mode}_fixture`,
  clientSecret: `cs_${mode}_fixture_secret_memory`,
  mode,
  accountId: 'buyer',
  accountKind: 'personal',
  amount: { currency: 'eur', list: 1900, due: 1330, taxIncluded: true },
  appliedDiscount: { kind: 'launch', percentOff: 30, duration: 'forever' },
  offer: {
    applied: true,
    reserved: false,
    duration: 'forever',
    percentOff: 30,
  },
});
const authenticated = {
  status: 'authenticated',
  user: { uid: 'buyer', email: 'buyer@example.invalid', isAnonymous: false },
} as ISneatAuthState;
let states: BehaviorSubject<ISneatAuthState>;
let fixture: ComponentFixture<CheckoutPageComponent>;
let fetcher: ReturnType<typeof vi.fn>;

async function render(
  query: Record<string, string>,
  returning = false,
  initial: ISneatAuthState = authenticated,
) {
  states = new BehaviorSubject(initial);
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
              isAnonymous: false,
              getIdToken: async () => 'token-only-header',
            },
          },
          signOut: async () => states.next({ status: 'notAuthenticated' }),
        },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: of(convertToParamMap(query)),
          snapshot: {
            data: { checkoutReturn: returning },
            queryParamMap: convertToParamMap(query),
          },
        },
      },
    ],
  })
    .overrideComponent(CheckoutPageComponent, {
      set: { imports: [RouterLink], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    })
    .compileComponents();
  fixture = TestBed.createComponent(CheckoutPageComponent);
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

beforeEach(() => {
  mount.mockClear();
  fetcher = vi.fn(async (url: URL, options?: RequestInit) => {
    const requestMode = new URLSearchParams(url.search).get('mode')
      ?? (url.pathname.endsWith('/session')
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
      : quote(mode);
    return { ok: true, headers: new Headers(), json: async () => data };
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  fixture?.destroy();
  vi.unstubAllGlobals();
});

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
  expect(mount).not.toHaveBeenCalled();
  const ack = root.querySelector('input');
  if (!ack) throw new Error('Missing quote acknowledgement');
  ack.checked = true;
  ack.dispatchEvent(new Event('change'));
  await fixture.whenStable();
  const pay = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('Continue to payment'));
  if (!pay) throw new Error('Missing payment button');
  pay.click();
  await fixture.whenStable();
  expect(mount).toHaveBeenCalledOnce();
  expect(mount.mock.calls[0][0].clientSecret).toBe(quote().clientSecret);
  expect(root.innerHTML).not.toContain(quote().clientSecret);
});

it('default LIVE checkout uses authenticated normal API config and session for the selected annual plan', async () => {
  const root = await render(
    { plan: 'pro', period: 'yearly' },
    false,
    { status: 'authenticating' },
  );
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
  expect(root.textContent).toContain('€13.30');
  expect(root.textContent).not.toContain('Test mode');
  expect(root.textContent).toContain('These pages are drafts');
  expect(root.querySelector('a[href="https://datatug.io/terms/"]')).not.toBeNull();
  expect(root.querySelector('a[href="https://datatug.io/privacy/"]')).not.toBeNull();
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
])('$mode $failedStage errors remain on the selected rail', async ({ mode, query, origin, failedStage }) => {
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
        plans: [{
          id: 'datatug-pro-monthly',
          accountRequired: true,
          accountKind: 'personal',
          taxIncluded: true,
        }],
      }),
    };
  });
  const root = await render(query);
  expect(fetcher).toHaveBeenCalledTimes(failedStage === 'config' ? 1 : 2);
  expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).origin)).toEqual(
    Array.from({ length: failedStage === 'config' ? 1 : 2 }, () => origin),
  );
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('mode')).toBe(mode);
  expect(root.textContent).toContain('Checkout is unavailable right now');
  expect(mount).not.toHaveBeenCalled();
});
