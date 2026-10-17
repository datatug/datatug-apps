export const PRO_PLANS = Object.freeze({
  monthly: 'datatug-pro-monthly',
  yearly: 'datatug-pro-annual',
});

export function selection(search) {
  const params = new URLSearchParams(search);
  const period = params.get('period');
  if (
    params.getAll('plan').length !== 1 ||
    params.getAll('period').length !== 1 ||
    params.get('plan') !== 'pro' ||
    !Object.hasOwn(PRO_PLANS, period) ||
    !checkoutChoice(search) ||
    params.has('account') ||
    params.has('coupon')
  )
    return null;
  return { period, plan: PRO_PLANS[period] };
}

export const BUSINESS_PLANS = Object.freeze({
  monthly: 'datatug-business-usage-monthly',
  yearly: 'datatug-business-usage-annual',
});
export function checkoutSelection(search) {
  const p = new URLSearchParams(search);
  if (!p.has('planID') && p.get('plan') !== 'business')
    return selection(search);
  const period = p.has('planID')
    ? Object.keys(BUSINESS_PLANS).find(
        (key) => BUSINESS_PLANS[key] === p.get('planID'),
      )
    : p.get('period');
  if (
    !period ||
    !Object.hasOwn(BUSINESS_PLANS, period) ||
    !checkoutChoice(search) ||
    p.has('account') ||
    p.has('coupon') ||
    ['planID', 'plan', 'period', 'spaceID', 'purchaseId'].some(
      (key) => p.getAll(key).length > 1,
    ) ||
    (p.has('planID') && p.has('plan')) ||
    (p.has('spaceID') && !/^[A-Za-z0-9_-]{1,128}$/.test(p.get('spaceID'))) ||
    (p.has('purchaseId') && !/^[A-Za-z0-9_-]{1,128}$/.test(p.get('purchaseId')))
  )
    return null;
  if (p.has('planID') && p.has('period') && p.get('period') !== period)
    return null;
  return {
    period,
    plan: BUSINESS_PLANS[period],
    kind: 'business',
    ...(p.has('spaceID') ? { spaceID: p.get('spaceID') } : {}),
    ...(p.has('purchaseId') ? { purchaseId: p.get('purchaseId') } : {}),
  };
}

export function returnSelection(search) {
  const params = new URLSearchParams(search);
  const mode = params.get('mode');
  const sessionId = params.get('session_id');
  if (
    !checkoutChoice(search, true) ||
    params.getAll('mode').length !== 1 ||
    params.getAll('session_id').length !== 1 ||
    (mode !== 'test' && mode !== 'live') ||
    !/^cs_(?:test_|live_)?[A-Za-z0-9_]+$/.test(sessionId ?? '') ||
    params.has('account') ||
    params.has('coupon')
  )
    return null;
  if (sessionId.startsWith('cs_test_') && mode !== 'test') return null;
  if (sessionId.startsWith('cs_live_') && mode !== 'live') return null;
  return { mode, sessionId };
}

// Pricing/subscribe use the Chatwright entry convention. Return links instead
// carry the server's explicit mode; neither path permits ambiguous selectors.
export function checkoutChoice(search, returning = false) {
  const params = new URLSearchParams(search);
  if (
    params.getAll('checkout').length > 1 ||
    params.getAll('mode').length > (returning ? 1 : 0)
  )
    return null;
  if (params.has('checkout') && params.get('checkout') !== 'test') return null;
  if (
    returning &&
    params.has('mode') &&
    params.get('mode') !== 'test' &&
    params.get('mode') !== 'live'
  )
    return null;
  if (
    params.has('checkout') &&
    params.has('mode') &&
    params.get('mode') !== 'test'
  )
    return null;
  return {
    test:
      params.get('checkout') === 'test' ||
      (returning && params.get('mode') === 'test'),
  };
}

export function pricingReturnUrl(period, mode) {
  const params = new URLSearchParams();
  if (period === 'monthly' || period === 'yearly') params.set('period', period);
  if (mode === 'test') params.set('checkout', 'test');
  return '/pricing/' + (params.size ? `?${params}` : '');
}

export const TEST_CHECKOUT_ORIGIN =
  'https://datatug-checkout-test-354fvnqbaa-ey.a.run.app';
// The datatug-cloud-preview bare origin (no `/v0/`) that the Business project
// preview serve configuration sends DataTug API calls to. It is not checkout:
// business-checkout-config.ts never trusts it, so checkout stays on
// TEST_CHECKOUT_ORIGIN. Verify after the service is created.
export const TEST_PREVIEW_PROJECT_ORIGIN =
  'https://datatug-cloud-preview-354fvnqbaa-ey.a.run.app';
export function checkoutRail(search, returning, normalApiBaseUrl) {
  const chosen = returning
    ? returnSelection(search)
    : checkoutSelection(search);
  const choice = checkoutChoice(search, returning);
  if (!chosen || !choice) return null;
  if (choice.test)
    return { chosen, mode: 'test', apiOrigin: TEST_CHECKOUT_ORIGIN };
  if (returning && chosen.mode !== 'live') return null;
  try {
    const url = new URL(normalApiBaseUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return {
      chosen,
      mode: returning ? chosen.mode : 'live',
      apiOrigin: url.origin,
    };
  } catch {
    return null;
  }
}
