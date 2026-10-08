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
const quote = {
  sessionId: 'cs_test_fixture',
  clientSecret: 'cs_test_fixture_secret_memory',
  mode: 'test',
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
};
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
  fetcher = vi.fn(async (url: URL) => {
    const data = url.pathname.endsWith('/config')
      ? {
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
        }
      : quote;
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
  expect(mount.mock.calls[0][0].clientSecret).toBe(quote.clientSecret);
  expect(root.innerHTML).not.toContain(quote.clientSecret);
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

it('new LIVE checkout stays closed before auth/API/provider work', async () => {
  await render({ plan: 'pro', period: 'monthly' });
  expect(fetcher).not.toHaveBeenCalled();
  expect(mount).not.toHaveBeenCalled();
});
