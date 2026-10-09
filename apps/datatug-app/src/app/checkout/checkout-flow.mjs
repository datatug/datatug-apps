import {
  CheckoutError,
  discountDescription,
  validQuote,
  validSpaceServiceQuote,
  validSpaceServiceSession,
  validSpaceServiceStatus,
} from './checkout-api.mjs';
import { StripeCheckoutStageError } from './checkout-provider.mjs';

export function money(cents) {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}

export function errorMessage(error) {
  const code = error instanceof CheckoutError ? error.code : '';
  if (error instanceof CheckoutError && error.status === 401)
    return 'Please sign in again to continue.';
  if (code === 'checkout_resolving')
    return 'Your previous checkout is still being checked. Retry this same selection in a moment.';
  if (code === 'offer_busy')
    return 'Launch offer places are being checked. Please wait, then retry.';
  if (code === 'already_subscribed')
    return 'You already have a paid plan. Check your plan before starting another purchase.';
  if (code === 'space_admin_required')
    return 'You need an owner or admin role for this Space to continue.';
  if (code === 'test_buyer_not_eligible')
    return 'This TEST checkout is not available for this account.';
  if (code === 'already_active')
    return 'DataTug Business is already active for this Space.';
  if (code === 'checkout_reconciliation_required')
    return 'This checkout is pending reconciliation. Business access is not activated yet.';
  if (code === 'quote_expired')
    return 'This quote expired before a checkout session was created. Review a fresh quote to continue.';
  return 'Checkout is unavailable right now. A previous attempt may still be resolving; retry this same selection later.';
}

// Shared auth, generation, busy and disposal lifecycle for both Pro and
// Space-service checkout. Each auth change or replacement quote invalidates
// earlier async continuations before they can render another buyer's data or
// mount a stale client secret.
function createCheckoutLifecycle(auth, onInvalidate) {
  let generation = 0;
  let user = null;
  let busy = false;
  let disposed = false;
  let observed = false;
  let unsubscribe = () => undefined;
  const fresh = (n) => !disposed && n === generation;
  const invalidate = () => {
    generation++;
    busy = false;
    onInvalidate();
  };
  const begin = (replace = false) => {
    if (busy || !user || disposed) return null;
    if (replace) invalidate();
    busy = true;
    return generation;
  };
  const finish = (n) => {
    if (fresh(n)) busy = false;
  };
  function start(onUser) {
    unsubscribe = auth.observe((nextUser) => {
      if (observed && nextUser?.id === user?.id) return;
      observed = true;
      invalidate();
      user = nextUser;
      onUser(user);
    });
  }
  function dispose() {
    disposed = true;
    invalidate();
    unsubscribe();
  }
  return {
    start,
    dispose,
    invalidate,
    fresh,
    begin,
    finish,
    user: () => user,
    busy: () => busy,
    signIn: async (resume) => {
      await auth.signIn();
      if (user) await resume();
    },
    signOut: () => auth.signOut(),
  };
}

// The page owns exactly one live quote and embedded form. Pro and Business
// share the same auth lifecycle and Stripe mounting boundary; their quote and
// consent-to-session policies remain separate.
export function createCheckoutFlow({
  auth,
  api,
  provider,
  selection,
  mode,
  render,
}) {
  let quote = null;
  let config = null;
  let embedded = null;
  const destroy = () => {
    embedded?.destroy();
    embedded = null;
  };
  const lifecycle = createCheckoutLifecycle(auth, () => {
    quote = null;
    config = null;
    destroy();
  });

  async function load() {
    const n = lifecycle.begin(true);
    if (n === null) return;
    const user = lifecycle.user();
    render({ stage: 'loading', user, selection });
    try {
      const nextConfig = await api.config();
      if (!lifecycle.fresh(n)) return;
      const plan = nextConfig.plans?.find((item) => item.id === selection.plan);
      if (
        nextConfig.site !== 'datatug' ||
        nextConfig.mode !== mode ||
        !nextConfig.publishableKey?.startsWith(
          mode === 'test' ? 'pk_test_' : 'pk_live_',
        ) ||
        plan?.accountRequired !== true ||
        plan.accountKind !== 'personal' ||
        plan.taxIncluded !== true
      )
        throw new Error('invalid_checkout_config');
      const nextQuote = await api.session(selection.plan);
      if (!lifecycle.fresh(n)) return;
      if (!validQuote(nextQuote, mode))
        throw new Error('invalid_checkout_quote');
      config = nextConfig;
      quote = nextQuote;
      render({
        stage: 'quote',
        user,
        selection,
        quote: {
          list: money(quote.amount.list),
          due: money(quote.amount.due),
          taxIncluded: quote.amount.taxIncluded,
          discount: discountDescription(quote),
          mode,
        },
      });
    } catch (error) {
      if (lifecycle.fresh(n))
        render({
          stage: 'error',
          user,
          selection,
          message: errorMessage(error),
          code: error instanceof CheckoutError ? error.code : '',
          status: error instanceof CheckoutError ? error.status : 0,
          retryAfter: error instanceof CheckoutError ? error.retryAfter : null,
          existingSession:
            error instanceof CheckoutError ? error.sessionId : null,
        });
    } finally {
      lifecycle.finish(n);
    }
  }

  async function acknowledge(element) {
    if (!quote || !config || embedded) return;
    const n = lifecycle.begin();
    if (n === null) return;
    const user = lifecycle.user();
    render({ stage: 'mounting', user, selection });
    try {
      const candidate = await provider.mount({
        publishableKey: config.publishableKey,
        clientSecret: quote.clientSecret,
        element,
      });
      if (!lifecycle.fresh(n)) {
        candidate.destroy();
        return;
      }
      embedded = candidate;
      render({ stage: 'payment', user, selection, mode });
    } catch (error) {
      if (lifecycle.fresh(n)) {
        const supportReference =
          mode === 'test' &&
          error instanceof StripeCheckoutStageError &&
          (error.phase === 'session_initialize' ||
            error.phase === 'element_mount') &&
          /^cs_test_[A-Za-z0-9]+$/.test(quote.sessionId)
            ? quote.sessionId
            : null;
        render({
          stage: 'error',
          user,
          selection,
          message:
            'The payment form could not load. Retry this same selection.',
          retryAfter: null,
          supportReference,
        });
      }
    } finally {
      lifecycle.finish(n);
    }
  }

  return {
    start: () =>
      lifecycle.start((user) => {
        render({ stage: user ? 'loading' : 'sign-in', user, selection });
        if (user) void load();
      }),
    load,
    acknowledge,
    signIn: () => lifecycle.signIn(load),
    signOut: () => lifecycle.signOut(),
    dispose: () => lifecycle.dispose(),
  };
}

export function createSpaceServiceCheckoutFlow({
  auth,
  api,
  provider,
  selection,
  render,
  ready = () => true,
}) {
  let quote = null;
  let embedded = null;
  const destroy = () => {
    embedded?.destroy();
    embedded = null;
  };
  const lifecycle = createCheckoutLifecycle(auth, () => {
    quote = null;
    destroy();
  });

  async function load() {
    const n = lifecycle.begin(true);
    if (n === null) return;
    const user = lifecycle.user();
    if (!ready()) {
      lifecycle.finish(n);
      render({ stage: 'select-space', user, selection });
      return;
    }
    render({ stage: 'loading', user, selection });
    try {
      const nextQuote = await api.serviceQuote(
        selection.spaceID,
        selection.planID,
      );
      if (!lifecycle.fresh(n)) return;
      if (!validSpaceServiceQuote(nextQuote, selection))
        throw new Error('invalid_service_quote');
      quote = nextQuote;
      render({
        stage: 'quote',
        user,
        selection,
        quote: {
          list: money(quote.amount.list),
          due: money(quote.amount.due),
          interval: quote.period.interval,
          claimed: quote.claimed,
        },
      });
    } catch (error) {
      if (lifecycle.fresh(n))
        render({
          stage: 'error',
          user,
          selection,
          message: errorMessage(error),
          code: error instanceof CheckoutError ? error.code : '',
          status: error instanceof CheckoutError ? error.status : 0,
        });
    } finally {
      lifecycle.finish(n);
    }
  }

  async function acknowledge(element) {
    if (!quote || embedded) return;
    const n = lifecycle.begin();
    if (n === null) return;
    const user = lifecycle.user();
    render({
      stage: 'creating-session',
      user,
      selection,
      quote: {
        list: money(quote.amount.list),
        due: money(quote.amount.due),
        interval: quote.period.interval,
        claimed: quote.claimed,
      },
    });
    try {
      const session = await api.serviceSession(
        selection.spaceID,
        quote.quoteID,
      );
      if (!lifecycle.fresh(n)) return;
      if (
        !validSpaceServiceSession(session, {
          ...selection,
          quoteID: quote.quoteID,
          quotedDueMinor: quote.amount.due,
        })
      )
        throw new Error('invalid_service_session');
      const candidate = await provider.mount({
        publishableKey: session.publishableKey,
        clientSecret: session.clientSecret,
        element,
      });
      if (!lifecycle.fresh(n)) {
        candidate.destroy();
        return;
      }
      embedded = candidate;
      render({
        stage: 'payment',
        user,
        selection,
        providerAmountTotal: session.providerAmountTotal,
      });
    } catch (error) {
      if (lifecycle.fresh(n)) {
        const quoteExpired =
          error instanceof CheckoutError && error.code === 'quote_expired';
        if (quoteExpired) quote = null;
        render({
          stage: 'error',
          user,
          selection,
          ...(quote
            ? {
                quote: {
                  list: money(quote.amount.list),
                  due: money(quote.amount.due),
                  interval: quote.period.interval,
                  claimed: quote.claimed,
                },
              }
            : {}),
          retrySameQuote: !quoteExpired,
          message: errorMessage(error),
          code: error instanceof CheckoutError ? error.code : '',
          status: error instanceof CheckoutError ? error.status : 0,
        });
      }
    } finally {
      lifecycle.finish(n);
    }
  }

  return {
    start: () =>
      lifecycle.start((user) => {
        render({
          stage: user ? (ready() ? 'loading' : 'select-space') : 'sign-in',
          user,
          selection,
        });
        if (user && ready()) void load();
      }),
    load,
    acknowledge,
    signIn: () => lifecycle.signIn(load),
    signOut: () => lifecycle.signOut(),
    dispose: () => lifecycle.dispose(),
  };
}

export function createReturnFlow({
  auth,
  api,
  mode,
  sessionId,
  render,
  serviceScope,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const lifecycle = createCheckoutLifecycle(auth, () => undefined);
  async function refresh() {
    const n = lifecycle.begin();
    if (n === null) return;
    const user = lifecycle.user();
    try {
      render({ stage: 'checking', user });
      for (let attempt = 0; attempt < 5 && lifecycle.fresh(n); attempt++) {
        const status = serviceScope
          ? await api.serviceStatus(serviceScope.spaceID, sessionId)
          : await api.status(sessionId);
        if (!lifecycle.fresh(n)) return;
        if (serviceScope) {
          if (
            !validSpaceServiceStatus(status, {
              spaceID: serviceScope.spaceID,
              sessionID: sessionId,
            })
          )
            throw new Error('invalid_service_status');
          if (status.status === 'expired') {
            render({ stage: 'expired', user, status });
            return;
          }
          if (status.status === 'complete') {
            render({ stage: 'test-complete', user, status });
            return;
          }
        } else {
          if (status.mode !== mode) throw new Error('mode_mismatch');
          if (status.status === 'expired') {
            render({
              stage: 'pending',
              user,
              message:
                'This payment session expired. Check your plan or return to pricing.',
            });
            return;
          }
          if (
            status.plan !== 'datatug-pro-monthly' &&
            status.plan !== 'datatug-pro-annual'
          )
            throw new Error('unexpected_purchase_plan');
          if (mode === 'test' && status.status === 'complete') {
            render({ stage: 'test', user });
            return;
          }
          if (status.status === 'complete' && status.ready === true) {
            render({ stage: 'pro', user });
            return;
          }
        }
        if (attempt < 4) await wait(2000);
      }
      if (lifecycle.fresh(n))
        render({
          stage: 'pending',
          user,
          message: serviceScope
            ? 'Test checkout is still processing. Business access is pending reconciliation.'
            : 'Payment is being processed. Your plan is not confirmed yet; check again shortly.',
        });
    } catch (error) {
      if (lifecycle.fresh(n))
        render({
          stage: 'error',
          user,
          message: errorMessage(error),
          status: error instanceof CheckoutError ? error.status : 0,
        });
    } finally {
      lifecycle.finish(n);
    }
  }
  return {
    start: () =>
      lifecycle.start((user) => {
        render({ stage: user ? 'checking' : 'sign-in', user });
        if (user) void refresh();
      }),
    refresh,
    signIn: () => lifecycle.signIn(refresh),
    signOut: () => lifecycle.signOut(),
    dispose: () => lifecycle.dispose(),
  };
}
