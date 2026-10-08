import { checkoutRail } from './checkout-config.mjs';

describe('checkout rails', () => {
  it('selects explicit TEST checkout with only the fixed isolated backend', () => {
    expect(
      checkoutRail(
        '?plan=pro&period=yearly&checkout=test&origin=https://evil.invalid',
        false,
        'https://api.sneat.cloud/v0/',
      ),
    ).toEqual({
      chosen: { plan: 'datatug-pro-annual', period: 'yearly' },
      mode: 'test',
      apiOrigin: 'https://datatug-checkout-test-354fvnqbaa-ey.a.run.app',
    });
  });
  it('keeps all new LIVE purchases disabled', () => {
    expect(
      checkoutRail(
        '?plan=pro&period=monthly',
        false,
        'https://api.sneat.cloud/v0/',
      ),
    ).toBeNull();
    expect(
      checkoutRail(
        '?plan=pro&period=monthly&checkout=live',
        false,
        'https://api.sneat.cloud/v0/',
      ),
    ).toBeNull();
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
  });
});
