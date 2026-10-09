import { checkoutRail } from './checkout-config.mjs';

describe('checkout rails', () => {
  it('selects explicit TEST checkout with only the fixed isolated backend', () => {
    expect(
      checkoutRail(
        '?plan=pro&period=yearly&checkout=test&origin=https://evil.invalid&utm_source=launch',
        false,
        'https://api.sneat.cloud/v0/',
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
        checkoutRail(`?plan=pro&period=${period}`, false, 'https://api.sneat.cloud/v0/'),
      ).toEqual({
        chosen: {
          period,
          plan: period === 'yearly' ? 'datatug-pro-annual' : 'datatug-pro-monthly',
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
      ),
    ).toBeNull();
    for (const selector of ['account=other', 'coupon=free']) {
      expect(checkoutRail(`?plan=pro&period=monthly&${selector}`, false, 'https://api.sneat.cloud/v0/')).toBeNull();
    }
    expect(checkoutRail('?plan=pro&period=monthly&origin=https%3A%2F%2Fevil.invalid&utm_source=launch', false, 'https://api.sneat.cloud/v0/')).toMatchObject({ mode: 'live', apiOrigin: 'https://api.sneat.cloud' });
    expect(checkoutRail('?plan=pro&period=monthly', false, 'http://api.sneat.cloud/v0/')).toBeNull();
    expect(checkoutRail('?plan=pro&period=monthly', false, 'https://buyer@api.sneat.cloud/v0/')).toBeNull();
  });
  it('binds existing TEST and LIVE return sessions to their respective backend and mode', () => {
    const normal = 'https://api.sneat.cloud/v0/';
    expect(
      checkoutRail('?mode=test&session_id=cs_test_paid', true, normal)
        ?.apiOrigin,
    ).toContain('datatug-checkout-test');
    expect(
      checkoutRail('?mode=live&session_id=cs_live_paid', true, normal),
    ).toEqual({
      chosen: { mode: 'live', sessionId: 'cs_live_paid' },
      mode: 'live',
      apiOrigin: 'https://api.sneat.cloud',
    });
    expect(
      checkoutRail('?mode=live&session_id=cs_test_paid', true, normal),
    ).toBeNull();
    expect(
      checkoutRail('?mode=test&session_id=cs_live_paid', true, normal),
    ).toBeNull();
    expect(
      checkoutRail(
        '?mode=live&session_id=cs_live_paid&checkout=test',
        true,
        normal,
      ),
    ).toBeNull();
    for (const selector of ['account=other', 'coupon=free']) {
      expect(checkoutRail(`?mode=live&session_id=cs_live_paid&${selector}`, true, normal)).toBeNull();
    }
    expect(checkoutRail('?mode=live&session_id=cs_live_paid&origin=https%3A%2F%2Fevil.invalid&utm_source=launch', true, normal)).toMatchObject({ mode: 'live', apiOrigin: 'https://api.sneat.cloud' });
  });
});
