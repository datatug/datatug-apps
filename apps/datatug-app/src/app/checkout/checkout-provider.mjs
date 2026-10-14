// The official embedded Checkout UI owns card/payment fields. Only the frozen
// session's client secret reaches Stripe; it is never persisted by this app.
const stripeDiagnosticCodes = new Set([
  'api_connection_error',
  'api_key_expired',
  'api_key_invalid',
  'authentication_required',
  'invalid_request_error',
  'rate_limit',
  'resource_missing',
]);

export class StripeCheckoutStageError extends Error {
  constructor(phase, code) {
    super('Stripe checkout stage failed');
    this.name = 'StripeCheckoutStageError';
    this.phase = phase;
    this.code = code;
  }
}

function stripeDiagnosticCode(error) {
  try {
    if (!error || (typeof error !== 'object' && typeof error !== 'function')) return 'unknown';
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    const code = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    return typeof code === 'string' && stripeDiagnosticCodes.has(code) ? code : 'unknown';
  } catch {
    return 'unknown';
  }
}

function stageError(phase, error) {
  const code = stripeDiagnosticCode(error);
  // Never pass the provider exception itself, its message, or its stack to the
  // console. This event contains only fixed stages and a closed code allowlist.
  console.warn(`stripe_checkout_stage phase=${phase} code=${code}`);
  return new StripeCheckoutStageError(phase, code);
}

export function createStripeCheckoutAdapter(loadStripe) {
  return {
    async mount({ publishableKey, clientSecret, element }) {
      let stripe;
      try {
        stripe = await loadStripe(publishableKey);
      } catch (error) {
        throw stageError('loadStripe', error);
      }
      if (!stripe) throw stageError('loadStripe');

      let checkout;
      try {
        checkout = await stripe.createEmbeddedCheckoutPage({ fetchClientSecret: () => Promise.resolve(clientSecret) });
      } catch (error) {
        throw stageError('session_initialize', error);
      }
      try {
        await checkout.mount(element);
      } catch (error) {
        try { checkout.destroy(); } catch { /* Cleanup failure cannot replace the safe stage diagnostic. */ }
        throw stageError('element_mount', error);
      }
      return { destroy: () => checkout.destroy() };
    },
  };
}

export async function stripeCheckoutAdapter() {
  let loadStripe;
  try {
    ({ loadStripe } = await import('@stripe/stripe-js'));
  } catch (error) {
    throw stageError('loadStripe', error);
  }
  return createStripeCheckoutAdapter(loadStripe);
}
