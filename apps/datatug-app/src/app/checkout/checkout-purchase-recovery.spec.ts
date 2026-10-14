import { purchaseRecoveryPort } from './checkout-purchase-recovery';
import { SneatAuthStateService, SneatUserService } from '@sneat/auth-core';
import { Router } from '@angular/router';

const mocks = vi.hoisted(() => ({
  purchases: vi.fn(),
  token: vi.fn(),
  observe: vi.fn(),
  api: vi.fn(),
}));
vi.mock('./checkout-auth', () => ({ appCheckoutAuth: () => mocks }));
vi.mock('./checkout-api.mjs', () => ({
  checkoutApi: (...args: unknown[]) => {
    mocks.api(...args);
    return { purchases: mocks.purchases };
  },
}));
function port() {
  return purchaseRecoveryPort(
    {} as SneatAuthStateService,
    {} as SneatUserService,
    {} as Router,
    'https://api.example.invalid',
  );
}
const item = {
  accountId: 'purchase-one',
  sessionId: 'cs_test_one',
  planId: 'datatug-business-usage-monthly',
  state: 'setup_required',
};
beforeEach(() => vi.clearAllMocks());
it('lists authenticated purchases from the fixed TEST rail and returns only navigation selectors', async () => {
  mocks.purchases.mockResolvedValue({ items: [item], next: 'billing_next' });
  const result = await port().load('test', 'billing_previous');
  expect(mocks.api.mock.calls[0][0]).toMatchObject({
    mode: 'test',
    apiOrigin: 'https://datatug-checkout-test-354fvnqbaa-ey.a.run.app',
  });
  expect(mocks.purchases).toHaveBeenCalledWith('billing_previous');
  expect(result).toEqual({
    items: [
      {
        id: 'purchase-one',
        description: 'Purchase reference purchase-one',
        label: 'DataTug Business · Monthly',
        action: 'Finish Business setup',
        path: '/pricing/return',
        query: { mode: 'test', session_id: 'cs_test_one' },
      },
    ],
    next: 'billing_next',
  });
});
it('rejects cross-rail returns, unsupported plans and malformed pagination', async () => {
  for (const page of [
    { items: [{ ...item, sessionId: 'cs_live_one' }] },
    { items: [{ ...item, planId: 'datatug-pro-monthly' }] },
    { items: [item], next: '../foreign' },
    { items: [null] },
    { items: [{ ...item, accountId: 123 }] },
  ]) {
    mocks.purchases.mockResolvedValue(page);
    await expect(port().load('test', '')).rejects.toThrow('Invalid recovery');
  }
});
it('observes the normal identity without introducing sign-in or storing a token', () => {
  const stop = vi.fn();
  mocks.observe.mockImplementation((callback) => {
    callback({ id: 'buyer' });
    return stop;
  });
  const receive = vi.fn();
  expect(port().observeIdentity(receive)).toBe(stop);
  expect(receive).toHaveBeenCalledWith('buyer');
  expect(mocks.token).not.toHaveBeenCalled();
});

it('identifies same-plan purchases by date, amount, destination and stable reference', async () => {
  mocks.purchases.mockResolvedValue({
    items: [
      {
        ...item,
        purchasedAtUTC: '2026-10-13T09:00:00Z',
        currency: 'eur',
        amountPaidMinor: 6930,
        spaceReference: 'acme',
      },
    ],
  });
  const result = await port().load('test', '');
  expect(result.items[0].description).toContain('69.30');
  expect(result.items[0].description).toContain('Intended space: acme');
  expect(result.items[0].description).toContain('Reference hase-one');
  mocks.purchases.mockResolvedValue({
    items: [
      {
        ...item,
        purchasedAtUTC: 'invalid',
        currency: 'eur',
        amountPaidMinor: 6930,
      },
    ],
  });
  await expect(port().load('test', '')).rejects.toThrow(
    'Invalid recovery details',
  );
});
