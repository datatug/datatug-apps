import { checkoutRail, checkoutSelection } from './checkout-config.mjs';
const TEST_ORIGIN = 'https://datatug-checkout-test-354fvnqbaa-ey.a.run.app';
const normal = 'https://api.sneat.cloud/v0/';

describe('checkout rails', () => {
  it('selects explicit TEST checkout with only the fixed isolated backend', () => {
    expect(
      checkoutRail(
        '?plan=pro&period=yearly&checkout=test&origin=https://evil.invalid&utm_source=launch',
        false,
        'https://api.sneat.cloud/v0/',
        false,
      ),
    ).toEqual({
      chosen: { plan: 'datatug-pro-annual', period: 'yearly' },
      mode: 'test',
      apiOrigin: 'https://datatug-checkout-test-354fvnqbaa-ey.a.run.app',
    });
  });
  it.each(['monthly', 'yearly'])(
    'uses the normal HTTPS API for a default LIVE %s selection',
    (period) => {
      expect(
        checkoutRail(
          `?plan=pro&period=${period}`,
          false,
          'https://api.sneat.cloud/v0/',
          false,
        ),
      ).toEqual({
        chosen: {
          period,
          plan:
            period === 'yearly' ? 'datatug-pro-annual' : 'datatug-pro-monthly',
        },
        mode: 'live',
        apiOrigin: 'https://api.sneat.cloud',
      });
    },
  );

  it('rejects unsupported LIVE selectors and non-HTTPS API configuration', () => {
    expect(
      checkoutRail(
        '?plan=pro&period=monthly&checkout=live',
        false,
        'https://api.sneat.cloud/v0/',
        false,
      ),
    ).toBeNull();
    for (const selector of ['account=other', 'coupon=free']) {
      expect(
        checkoutRail(
          `?plan=pro&period=monthly&${selector}`,
          false,
          'https://api.sneat.cloud/v0/',
          false,
        ),
      ).toBeNull();
    }
    expect(
      checkoutRail(
        '?plan=pro&period=monthly&origin=https%3A%2F%2Fevil.invalid&utm_source=launch',
        false,
        'https://api.sneat.cloud/v0/',
        false,
      ),
    ).toMatchObject({ mode: 'live', apiOrigin: 'https://api.sneat.cloud' });
    expect(
      checkoutRail(
        '?plan=pro&period=monthly',
        false,
        'http://api.sneat.cloud/v0/',
        false,
      ),
    ).toBeNull();
    expect(
      checkoutRail(
        '?plan=pro&period=monthly',
        false,
        'https://buyer@api.sneat.cloud/v0/',
        false,
      ),
    ).toBeNull();
  });
  it('binds existing TEST and LIVE return sessions to their respective backend and mode', () => {
    const normal = 'https://api.sneat.cloud/v0/';
    expect(
      checkoutRail('?mode=test&session_id=cs_test_paid', true, normal, false)
        ?.apiOrigin,
    ).toContain('datatug-checkout-test');
    expect(
      checkoutRail('?mode=live&session_id=cs_live_paid', true, normal, false),
    ).toEqual({
      chosen: { mode: 'live', sessionId: 'cs_live_paid' },
      mode: 'live',
      apiOrigin: 'https://api.sneat.cloud',
    });
    expect(
      checkoutRail('?mode=live&session_id=cs_test_paid', true, normal, false),
    ).toBeNull();
    expect(
      checkoutRail('?mode=test&session_id=cs_live_paid', true, normal, false),
    ).toBeNull();
    expect(
      checkoutRail(
        '?mode=live&session_id=cs_live_paid&checkout=test',
        true,
        normal,
        false,
      ),
    ).toBeNull();
    for (const selector of ['account=other', 'coupon=free']) {
      expect(
        checkoutRail(
          `?mode=live&session_id=cs_live_paid&${selector}`,
          true,
          normal,
          false,
        ),
      ).toBeNull();
    }
    expect(
      checkoutRail(
        '?mode=live&session_id=cs_live_paid&origin=https%3A%2F%2Fevil.invalid&utm_source=launch',
        true,
        normal,
        false,
      ),
    ).toMatchObject({ mode: 'live', apiOrigin: 'https://api.sneat.cloud' });
  });
});

it('preserves Business purchase identity, destination and mode independently of billing period', () => {
  expect(
    checkoutSelection(
      '?planID=datatug-business-usage-annual&checkout=test&spaceID=acme&purchaseId=request-a',
    ),
  ).toEqual({
    period: 'yearly',
    plan: 'datatug-business-usage-annual',
    kind: 'business',
    spaceID: 'acme',
    purchaseId: 'request-a',
  });
  expect(
    checkoutRail(
      '?planID=datatug-business-usage-monthly&checkout=test&purchaseId=request-a',
      false,
      'https://api.sneat.cloud',
      false,
    ),
  ).toMatchObject({
    mode: 'test',
    apiOrigin: 'https://datatug-checkout-test-354fvnqbaa-ey.a.run.app',
  });
  for (const suffix of [
    '&spaceID=bad/space',
    '&purchaseId=bad/id',
    '&purchaseId=a&purchaseId=b',
    '&period=monthly',
    '&plan=pro',
    '&checkout=live',
  ])
    expect(
      checkoutSelection('?planID=datatug-business-usage-annual' + suffix),
    ).toBeNull();
});

describe('checkout rails with forceTest (the Business project preview build)', () => {
  it('selects TEST for a default Pro selection, which is LIVE without the flag', () => {
    expect(
      checkoutRail('?plan=pro&period=monthly', false, normal, false),
    ).toMatchObject({ mode: 'live' });
    expect(
      checkoutRail('?plan=pro&period=monthly', false, normal, true),
    ).toEqual({
      chosen: { period: 'monthly', plan: 'datatug-pro-monthly' },
      mode: 'test',
      apiOrigin: TEST_ORIGIN,
    });
  });

  it('selects TEST for a Business selection, whatever the query string', () => {
    expect(
      checkoutRail('?plan=business&period=yearly', false, normal, true),
    ).toMatchObject({ mode: 'test', apiOrigin: TEST_ORIGIN });
    expect(
      checkoutRail(
        '?planID=datatug-business-usage-monthly&spaceID=space_1',
        false,
        normal,
        true,
      ),
    ).toMatchObject({ mode: 'test', apiOrigin: TEST_ORIGIN });
  });

  it('never selects LIVE, even with an explicit LIVE-looking query, and still needs a valid selection', () => {
    for (const search of [
      '?plan=pro&period=monthly&checkout=live',
      '?plan=pro&period=monthly&origin=https%3A%2F%2Fevil.invalid',
      '?plan=pro&period=monthly&account=other',
    ]) {
      const rail = checkoutRail(search, false, normal, true);
      expect(rail === null || rail.mode === 'test').toBe(true);
      expect(rail === null || rail.apiOrigin === TEST_ORIGIN).toBe(true);
    }
    expect(
      checkoutRail(
        '?plan=pro&period=monthly&account=other',
        false,
        normal,
        true,
      ),
    ).toBeNull();
    expect(checkoutRail('?plan=unknown', false, normal, true)).toBeNull();
  });

  it('refuses a LIVE return session instead of rebinding it to TEST', () => {
    expect(
      checkoutRail('?mode=live&session_id=cs_live_paid', true, normal, true),
    ).toBeNull();
    expect(
      checkoutRail('?mode=test&session_id=cs_test_paid', true, normal, true),
    ).toMatchObject({ mode: 'test', apiOrigin: TEST_ORIGIN });
  });

  it('keeps the default rail unchanged when the flag is false', () => {
    expect(
      checkoutRail('?plan=pro&period=monthly', false, normal, false),
    ).toEqual(checkoutRail('?plan=pro&period=monthly', false, normal, false));
  });
});
