export class CheckoutError extends Error {
  constructor(code, status, retryAfter = null, sessionId = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.sessionId = /^cs_[A-Za-z0-9_]+$/.test(sessionId ?? '') ? sessionId : null;
  }
}

function retryDelay(value) {
  if (typeof value !== 'string' || !value.trim()) return 5000;
  const trimmed = value.trim();
  const delay = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : /^[A-Za-z]{3},\s/.test(trimmed) ? Date.parse(trimmed) - Date.now() : NaN;
  return Number.isFinite(delay) && delay >= 0 ? Math.min(delay, 2_147_483_647) : 5000;
}

// The sole request boundary for short-lived ID tokens. Neither token nor the
// embedded client secret is copied into URLs, storage, markup or telemetry.
export function checkoutApi({ apiOrigin, planApiOrigin = apiOrigin, mode }, auth, fetcher = fetch) {
  async function request(path, options = {}, protectedRequest = false, origin = apiOrigin) {
    const headers = { ...(options.headers ?? {}) };
    if (protectedRequest) {
      const token = await auth.token();
      if (!token) throw new CheckoutError('sign_in_required', 401);
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetcher(new URL(path, origin), { ...options, headers, cache: 'no-store', credentials: 'omit' });
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) throw new CheckoutError(body.code || 'not_available', response.status, retryDelay(response.headers.get('Retry-After')), body.sessionId);
    return body;
  }
  return {
    config: () => request(`/v0/checkout/config?site=datatug&mode=${mode}`),
    session: (plan) => request('/v0/checkout/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site: 'datatug', plan, mode }) }, true),
    status: (sessionId) => request(`/v0/checkout/session-status?site=datatug&mode=${mode}&session_id=${encodeURIComponent(sessionId)}`, {}, true),
    plan: () => request('/v0/datatug/plan', {}, true, planApiOrigin),
  };
}

export function validQuote(quote, mode) {
  const money = quote?.amount;
  const discount = quote?.appliedDiscount;
  if (!/^cs_[A-Za-z0-9_]+$/.test(quote?.sessionId ?? '') || typeof quote?.clientSecret !== 'string' || !quote.clientSecret || quote.mode !== mode || quote.accountKind !== 'personal' || typeof quote.accountId !== 'string' || !quote.accountId) return false;
  if (!quote.clientSecret.startsWith(`${quote.sessionId}_secret_`)) return false;
  if ((quote.sessionId.startsWith('cs_test_') && mode !== 'test') || (quote.sessionId.startsWith('cs_live_') && mode !== 'live')) return false;
  if (money?.currency !== 'eur' || !Number.isSafeInteger(money.list) || !Number.isSafeInteger(money.due) || money.list < 0 || money.due < 0 || money.due > money.list || money.taxIncluded !== true) return false;
  if (!['none', 'launch', 'invitation'].includes(discount?.kind) || !Number.isInteger(discount.percentOff) || discount.percentOff < 0 || discount.percentOff > 100) return false;
  if (discount.kind === 'invitation' && (discount.duration !== 'repeating' || !Number.isInteger(discount.durationMonths) || discount.durationMonths < 1)) return false;
  if (discount.kind === 'launch' && (discount.duration !== 'forever' || quote.offer?.applied !== true)) return false;
  if (quote.offer && (quote.offer.duration !== 'forever' || quote.offer.percentOff !== 30 || typeof quote.offer.reserved !== 'boolean' || typeof quote.offer.applied !== 'boolean')) return false;
  return true;
}

export function discountDescription(quote) {
  const d = quote.appliedDiscount;
  if (d.kind === 'none') return 'List price';
  if (d.kind === 'launch') return `${d.percentOff}% launch discount for life while your paid plan continues`;
  const months = d.durationMonths;
  const initial = `${d.percentOff}% invitation discount for ${months} ${months === 1 ? 'month' : 'months'}`;
  return quote.offer?.reserved ? `${initial}; then ${quote.offer.percentOff}% launch discount for life while your paid plan continues` : initial;
}
