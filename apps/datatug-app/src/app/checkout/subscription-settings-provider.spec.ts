import { managedSubscription } from './subscription-settings-provider';
const item = {
  accountId: 'purchase_one',
  planId: 'datatug-business-usage-monthly',
  kind: 'organisation',
  spaceID: 'acme',
  status: 'active',
  paidThroughUTC: '2026-11-13T10:00:00Z',
  scheduledEndUTC: '0001-01-01T00:00:00Z',
  firstPaidUTC: '2026-10-13T10:00:00Z',
  currency: 'eur',
  regularMinor: 9900,
  renewalMinor: 6930,
  discountPercent: 30,
  priceConfirmed: true,
  launchDiscount: true,
  bindingRevision: 1,
  canCancel: true,
  canTransfer: true,
  sessionId: 'cs_test_one',
};
it('maps the receiving space separately from the personal billing account', () => {
  expect(
    managedSubscription(item, 'test', { acme: { title: 'Acme' } }),
  ).toMatchObject({
    label: 'DataTug Business',
    spaceTitle: 'Acme',
    period: 'month',
    currency: 'EUR',
  });
  expect(
    managedSubscription(
      {
        ...item,
        planId: 'datatug-pro-annual',
        kind: 'personal',
        canTransfer: false,
      },
      'test',
    ),
  ).toMatchObject({
    label: 'DataTug Pro',
    spaceTitle: 'Personal space',
    period: 'year',
  });
});
it('rejects cross-rail, malformed prices, non-base plans and Pro transfer capabilities', () => {
  for (const change of [
    { sessionId: 'cs_live_foreign' },
    { renewalMinor: -1 },
    { paidThroughUTC: 'invalid' },
    { kind: 'personal' },
    { planId: 'separate-sso-addon' },
    { discountPercent: 100 },
    { priceConfirmed: true, currency: 'INVALID' },
    { spaceID: '../foreign' },
    { accountId: '../foreign' },
    { accountId: undefined },
    { accountId: 42 },
    { spaceID: 42 },
  ]) {
    expect(() => managedSubscription({ ...item, ...change }, 'test')).toThrow(
      'Invalid subscription',
    );
  }
  expect(() =>
    managedSubscription(
      {
        ...item,
        planId: 'datatug-pro-monthly',
        kind: 'personal',
        canTransfer: true,
      },
      'test',
    ),
  ).toThrow('Invalid subscription');
});
