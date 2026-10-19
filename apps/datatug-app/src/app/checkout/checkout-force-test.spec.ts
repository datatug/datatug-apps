import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SneatApiBaseUrl } from '@sneat/api';
import { SneatAuthStateService, SneatUserService } from '@sneat/auth-core';
import {
  SUBSCRIPTION_RECOVERY,
  SUBSCRIPTION_SETTINGS,
} from '@sneat/components';
import { of } from 'rxjs';
import { DATATUG_CHECKOUT_FORCE_TEST } from './checkout-force-test';
import { provideCheckoutPurchaseRecovery } from './checkout-purchase-recovery';
import { provideSubscriptionSettings } from './subscription-settings-provider';

const TEST_ORIGIN = 'https://datatug-checkout-test-354fvnqbaa-ey.a.run.app';
const NORMAL_BASE = 'https://api.example.invalid/v0/';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  purchases: vi.fn(),
  subscriptions: vi.fn(),
}));
vi.mock('./checkout-auth', () => ({ appCheckoutAuth: () => ({}) }));
vi.mock('./checkout-api.mjs', () => ({
  checkoutApi: (rail: unknown) => {
    mocks.api(rail);
    return { purchases: mocks.purchases, subscriptions: mocks.subscriptions };
  },
}));

// `forced` undefined means the token is not provided, so the production default
// (false) applies. `false` and `true` provide it explicitly.
function configure(forced: boolean | undefined): void {
  TestBed.configureTestingModule({
    providers: [
      provideCheckoutPurchaseRecovery(),
      provideSubscriptionSettings(),
      { provide: SneatApiBaseUrl, useValue: NORMAL_BASE },
      { provide: SneatAuthStateService, useValue: {} },
      {
        provide: SneatUserService,
        useValue: {
          userState: of({ status: 'authenticated', record: { spaces: {} } }),
        },
      },
      { provide: Router, useValue: {} },
      ...(forced === undefined
        ? []
        : [{ provide: DATATUG_CHECKOUT_FORCE_TEST, useValue: forced }]),
    ],
  });
}

let fetchStub: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.purchases.mockResolvedValue({ items: [] });
  mocks.subscriptions.mockResolvedValue({ items: [] });
  fetchStub = vi.fn();
  vi.stubGlobal('fetch', fetchStub);
});
afterEach(() => vi.unstubAllGlobals());

describe('purchase recovery port, from the real provider', () => {
  it('refuses LIVE with no request when the preview forces TEST', async () => {
    configure(true);
    const port = TestBed.inject(SUBSCRIPTION_RECOVERY);
    await expect(port.load('live', undefined)).rejects.toThrow(
      'Invalid recovery rail',
    );
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.purchases).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('lists TEST purchases at the TEST checkout origin when the preview forces TEST', async () => {
    configure(true);
    await TestBed.inject(SUBSCRIPTION_RECOVERY).load('test', undefined);
    expect(mocks.api).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'test', apiOrigin: TEST_ORIGIN }),
    );
    expect(mocks.purchases).toHaveBeenCalledTimes(1);
  });

  it('goes LIVE to the normal HTTPS origin with the default flag', async () => {
    configure(undefined);
    await TestBed.inject(SUBSCRIPTION_RECOVERY).load('live', undefined);
    expect(mocks.api).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'live',
        apiOrigin: 'https://api.example.invalid',
      }),
    );
  });
});

describe('subscription settings port, from the real provider', () => {
  it('refuses LIVE with no request when the preview forces TEST', async () => {
    configure(true);
    const port = TestBed.inject(SUBSCRIPTION_SETTINGS);
    await expect(port.load('live', undefined)).rejects.toThrow(
      'Invalid subscription rail',
    );
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.subscriptions).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('lists TEST subscriptions at the TEST checkout origin when the preview forces TEST', async () => {
    configure(true);
    await TestBed.inject(SUBSCRIPTION_SETTINGS).load('test', undefined);
    expect(mocks.api).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'test', apiOrigin: TEST_ORIGIN }),
    );
    expect(mocks.subscriptions).toHaveBeenCalledTimes(1);
  });

  it('goes LIVE to the normal HTTPS origin with the default flag', async () => {
    configure(undefined);
    await TestBed.inject(SUBSCRIPTION_SETTINGS).load('live', undefined);
    expect(mocks.api).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'live',
        apiOrigin: 'https://api.example.invalid',
      }),
    );
  });
});
