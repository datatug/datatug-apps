import { CheckoutError, discountDescription, validQuote } from './checkout-api.mjs';
import { StripeCheckoutStageError } from './checkout-provider.mjs';

export function money(cents) {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

export function errorMessage(error) {
  const code = error instanceof CheckoutError ? error.code : '';
  if (error instanceof CheckoutError && error.status === 401) return 'Please sign in again to continue.';
  if (code === 'checkout_resolving') return 'Your previous checkout is still being checked. Retry this same selection in a moment.';
  if (code === 'offer_busy') return 'Launch offer places are being checked. Please wait, then retry.';
  if (code === 'already_subscribed') return 'You already have a paid plan. Check your plan before starting another purchase.';
  return 'Checkout is unavailable right now. A previous attempt may still be resolving; retry this same selection later.';
}

// The page owns exactly one live quote and embedded form. Each auth change,
// retry or disposal invalidates earlier async continuations before they can
// render another buyer's quote or mount a stale client secret.
export function createCheckoutFlow({ auth, api, provider, selection, mode, render }) {
  let generation = 0;
  let user = null;
  let quote = null;
  let config = null;
  let embedded = null;
  let busy = false;
  let disposed = false;
  let observed = false;
  let unsubscribe = () => undefined;
  const fresh = (n) => !disposed && n === generation;
  const destroy = () => { embedded?.destroy(); embedded = null; };
  const invalidate = () => { generation++; busy = false; quote = null; config = null; destroy(); };

  async function load() {
    if (busy || !user || disposed) return;
    invalidate();
    const n = generation;
    busy = true;
    render({ stage: 'loading', user, selection });
    try {
      const nextConfig = await api.config();
      if (!fresh(n)) return;
      const plan = nextConfig.plans?.find((item) => item.id === selection.plan);
      if (nextConfig.site !== 'datatug' || nextConfig.mode !== mode || !nextConfig.publishableKey?.startsWith(mode === 'test' ? 'pk_test_' : 'pk_live_') || plan?.accountRequired !== true || plan.accountKind !== 'personal' || plan.taxIncluded !== true) throw new Error('invalid_checkout_config');
      const nextQuote = await api.session(selection.plan);
      if (!fresh(n)) return;
      if (!validQuote(nextQuote, mode)) throw new Error('invalid_checkout_quote');
      config = nextConfig;
      quote = nextQuote;
      render({ stage: 'quote', user, selection, quote: { list: money(quote.amount.list), due: money(quote.amount.due), taxIncluded: quote.amount.taxIncluded, discount: discountDescription(quote), mode } });
    } catch (error) {
      if (fresh(n)) render({ stage: 'error', user, selection, message: errorMessage(error), code: error instanceof CheckoutError ? error.code : '', status: error instanceof CheckoutError ? error.status : 0, retryAfter: error instanceof CheckoutError ? error.retryAfter : null, existingSession: error instanceof CheckoutError ? error.sessionId : null });
    } finally { if (fresh(n)) busy = false; }
  }

  async function acknowledge(element) {
    if (!quote || !config || !user || disposed || embedded || busy) return;
    const n = generation;
    busy = true;
    render({ stage: 'mounting', user, selection });
    try {
      const candidate = await provider.mount({ publishableKey: config.publishableKey, clientSecret: quote.clientSecret, element });
      if (!fresh(n)) { candidate.destroy(); return; }
      embedded = candidate;
      render({ stage: 'payment', user, selection, mode });
    } catch (error) {
      if (fresh(n)) {
        const supportReference = mode === 'test'
          && error instanceof StripeCheckoutStageError
          && (error.phase === 'session_initialize' || error.phase === 'element_mount')
          && /^cs_test_[A-Za-z0-9]+$/.test(quote.sessionId)
          ? quote.sessionId : null;
        render({ stage: 'error', user, selection, message: 'The payment form could not load. Retry this same selection.', retryAfter: null, supportReference });
      }
    } finally { if (fresh(n)) busy = false; }
  }

  function start() {
    unsubscribe = auth.observe((nextUser) => {
      if (observed && nextUser?.id === user?.id) return;
      observed = true;
      invalidate();
      user = nextUser;
      render({ stage: user ? 'loading' : 'sign-in', user, selection });
      if (user) void load();
    });
  }
  function dispose() { disposed = true; invalidate(); unsubscribe(); }
  return { start, load, acknowledge, signIn: async () => { await auth.signIn(); if (user) await load(); }, signOut: () => auth.signOut(), dispose };
}

export function createReturnFlow({ auth, api, mode, sessionId, render, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let generation = 0;
  let user = null;
  let disposed = false;
  let observed = false;
  let busy = false;
  let unsubscribe = () => undefined;
  const fresh = (n) => !disposed && n === generation;
  async function refresh() {
    if (!user || busy || disposed) return;
    busy = true;
    const n = generation;
    try {
      render({ stage: 'checking', user });
      for (let attempt = 0; attempt < 5 && fresh(n); attempt++) {
        const status = await api.status(sessionId);
        if (!fresh(n)) return;
        if (status.mode !== mode) throw new Error('mode_mismatch');
        if (status.status === 'expired') { render({ stage: 'pending', user, message: 'This payment session expired. Check your plan or return to pricing.' }); return; }
        if (status.plan !== 'datatug-pro-monthly' && status.plan !== 'datatug-pro-annual') throw new Error('unexpected_purchase_plan');
        if (mode === 'test' && status.status === 'complete') { render({ stage: 'test', user }); return; }
        if (status.status === 'complete' && status.ready === true) { render({ stage: 'pro', user }); return; }
        if (attempt < 4) await wait(2000);
      }
      if (fresh(n)) render({ stage: 'pending', user, message: 'Payment is being processed. Your plan is not confirmed yet; check again shortly.' });
    } catch (error) {
      if (fresh(n)) render({ stage: 'error', user, message: errorMessage(error), status: error instanceof CheckoutError ? error.status : 0 });
    } finally { if (fresh(n)) busy = false; }
  }
  function start() {
    unsubscribe = auth.observe((nextUser) => {
      if (observed && nextUser?.id === user?.id) return;
      observed = true;
      generation++;
      busy = false;
      user = nextUser;
      render({ stage: user ? 'checking' : 'sign-in', user });
      if (user) void refresh();
    });
  }
  function dispose() { disposed = true; generation++; unsubscribe(); }
  return { start, refresh, signIn: async () => { await auth.signIn(); if (user) await refresh(); }, signOut: () => auth.signOut(), dispose };
}
