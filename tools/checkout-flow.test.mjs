import assert from 'node:assert/strict';
import test from 'node:test';
import { selection, returnSelection, checkoutChoice, pricingReturnUrl } from '../apps/datatug-app/src/app/checkout/checkout-config.mjs';
import { CheckoutError, checkoutApi, discountDescription, validQuote, validSpaceServiceQuote } from '../apps/datatug-app/src/app/checkout/checkout-api.mjs';
import { createCheckoutFlow, createReturnFlow } from '../apps/datatug-app/src/app/checkout/checkout-flow.mjs';
import { createStripeCheckoutAdapter, StripeCheckoutStageError } from '../apps/datatug-app/src/app/checkout/checkout-provider.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const configured = { PUBLIC_DATATUG_PRO_CHECKOUT_ENABLED: 'true', PUBLIC_DATATUG_API_ORIGIN: 'https://api.example.invalid', PUBLIC_DATATUG_CHECKOUT_MODE: 'test', PUBLIC_DATATUG_FIREBASE_API_KEY: 'public-test-key', PUBLIC_DATATUG_FIREBASE_AUTH_DOMAIN: 'auth.sneat.co', PUBLIC_DATATUG_FIREBASE_PROJECT_ID: 'sneat-eur3-1', PUBLIC_DATATUG_FIREBASE_APP_ID: 'public-app' };
const serverConfig = { site: 'datatug', mode: 'test', publishableKey: 'pk_test_fake', plans: [{ id: 'datatug-pro-monthly', accountRequired: true, accountKind: 'personal', taxIncluded: true }] };
const quote = (overrides = {}) => ({ sessionId: 'cs_test_one', clientSecret: 'cs_test_one_secret_fake', mode: 'test', accountId: 'personal-buyer', accountKind: 'personal', amount: { currency: 'eur', list: 1900, due: 950, taxIncluded: true }, appliedDiscount: { kind: 'invitation', percentOff: 50, duration: 'repeating', durationMonths: 12 }, offer: { id: 'launch', applied: false, reserved: true, percentOff: 30, duration: 'forever', left: 4 }, ...overrides });

test('Business quote validation accepts only the reviewed 30 percent launch amount in TEST and LIVE', () => {
  for (const mode of ['test', 'live']) {
    for (const plan of [
      { planID: 'datatug-business-usage-monthly', list: 9900, due: 6930, interval: 'month' },
      { planID: 'datatug-business-usage-annual', list: 99000, due: 69300, interval: 'year' },
    ]) {
      const selection = { spaceID: 'datatug-business-space', planID: plan.planID, mode };
      const businessQuote = {
        quoteID: 'business-quote',
        spaceID: selection.spaceID,
        serviceID: 'datatug',
        planID: plan.planID,
        mode,
        accountKind: 'organisation',
        amount: { currency: 'eur', list: plan.list, due: plan.due, taxIncluded: true },
        quantity: 1,
        period: { interval: plan.interval, count: 1 },
        appliedDiscount: { kind: 'launch', percentOff: 30 },
        expiresAtUTC: new Date(Date.now() + 60_000).toISOString(),
        claimed: false,
      };

      assert.equal(validSpaceServiceQuote(businessQuote, selection), true, `${mode} ${plan.interval} launch quote`);
      assert.equal(validSpaceServiceQuote({ ...businessQuote, appliedDiscount: { kind: 'launch', percentOff: 20 } }, selection), false);
      assert.equal(validSpaceServiceQuote({ ...businessQuote, amount: { ...businessQuote.amount, due: plan.due + 1 } }, selection), false);
      assert.equal(validSpaceServiceQuote({ ...businessQuote, mode: mode === 'test' ? 'live' : 'test' }, selection), false);
      assert.equal(validSpaceServiceQuote(businessQuote, { ...selection, mode: 'preview' }), false);
      assert.equal(validSpaceServiceQuote({ ...businessQuote, spaceID: 'other-space' }, selection), false);
      assert.equal(validSpaceServiceQuote({ ...businessQuote, serviceID: 'other-service' }, selection), false);
      const otherPlanID = plan.planID === 'datatug-business-usage-monthly'
        ? 'datatug-business-usage-annual'
        : 'datatug-business-usage-monthly';
      assert.equal(validSpaceServiceQuote({ ...businessQuote, planID: otherPlanID }, selection), false);
    }
  }
});

function fakeAuth() {
  let callback;
  return { observe(fn) { callback = fn; return () => { callback = null; }; }, emit(user) { callback?.(user); }, token: async () => 'test-token', signIn: async () => {}, signOut: async () => {} };
}

test('quote display faithfully describes invitation continuation and rejects malformed money', () => {
  assert.equal(validQuote(quote(), 'test'), true);
  assert.match(discountDescription(quote()), /50% invitation discount for 12 months; then 30% launch discount/);
  assert.doesNotMatch(discountDescription(quote({ offer: { ...quote().offer, reserved: false } })), /then 30%/);
  assert.match(discountDescription(quote({ appliedDiscount: { kind: 'launch', percentOff: 30, duration: 'forever' }, offer: { ...quote().offer, applied: true, reserved: false } })), /launch discount for life/);
  assert.equal(discountDescription(quote({ appliedDiscount: { kind: 'none', percentOff: 0 }, offer: null })), 'List price');
  assert.equal(validQuote(quote({ amount: { ...quote().amount, due: 2000 } }), 'test'), false);
  assert.equal(validQuote(quote({ mode: 'live' }), 'test'), false);
  assert.equal(validQuote(quote({ accountId: '' }), 'test'), false);
  assert.equal(validQuote(quote({ clientSecret: 'cs_test_other_secret_wrong' }), 'test'), false);
});

test('request adapter uses the host checkout routes and fixed buyer payload without leaking the bearer', async () => {
  const seen = [];
  const api = checkoutApi({ apiOrigin: 'https://api.example.invalid', mode: 'test' }, { token: async () => 'only-in-header' }, async (url, options) => {
    seen.push({ url: String(url), options });
    return { ok: true, json: async () => quote(), headers: new Headers() };
  });
  await api.config();
  await api.session('datatug-pro-monthly');
  await api.status('cs_test_one');
  assert.deepEqual(seen.map(({ url, options }) => [url, options.method ?? 'GET']), [
    ['https://api.example.invalid/v0/checkout/config?site=datatug&mode=test', 'GET'],
    ['https://api.example.invalid/v0/checkout/session', 'POST'],
    ['https://api.example.invalid/v0/checkout/session-status?site=datatug&mode=test&session_id=cs_test_one', 'GET'],
  ]);
  assert.deepEqual(JSON.parse(seen[1].options.body), { site: 'datatug', plan: 'datatug-pro-monthly', mode: 'test' });
  assert.equal(seen[0].options.headers.Authorization, undefined);
  for (const item of seen) {
    if (item !== seen[0]) assert.equal(item.options.headers.Authorization, 'Bearer only-in-header');
    assert.equal(item.options.cache, 'no-store');
    assert.equal(item.options.credentials, 'omit');
    assert.doesNotMatch(item.url + (item.options.body ?? ''), /only-in-header|secret_fake/);
  }
  const split = checkoutApi({ apiOrigin: 'https://api.example.invalid', planApiOrigin: 'https://plan.example.invalid', mode: 'test' }, { token: async () => 'only-in-header' }, async (url) => ({ ok: true, json: async () => ({ at: String(url) }), headers: new Headers() }));
  assert.equal((await split.plan()).at, 'https://plan.example.invalid/v0/datatug/plan');
});

test('one signed-in buyer sees frozen quote, acknowledgement mounts that exact session once, sign-out destroys it', async () => {
  const auth = fakeAuth();
  const states = [];
  const mounted = [];
  let destroyed = 0;
  const flow = createCheckoutFlow({ auth, api: { config: async () => serverConfig, session: async () => quote() }, provider: { mount: async (input) => { mounted.push(input); return { destroy: () => { destroyed++; } }; } }, selection: selection('?plan=pro&period=monthly'), mode: 'test', render: (state) => states.push(state) });
  flow.start();
  auth.emit(null);
  assert.equal(states.at(-1).stage, 'sign-in');
  auth.emit({ id: 'buyer', email: 'buyer@example.invalid' });
  await flush();
  assert.equal(states.at(-1).stage, 'quote');
  assert.equal(states.at(-1).quote.due, '€9.50');
  assert.equal(JSON.stringify(states).includes('secret_fake'), false);
  await flow.acknowledge({});
  await flow.acknowledge({});
  assert.equal(mounted.length, 1);
  assert.equal(mounted[0].clientSecret, quote().clientSecret);
  auth.emit(null);
  assert.equal(destroyed, 1);
  assert.equal(states.at(-1).stage, 'sign-in');
  flow.dispose();
});

test('Stripe checkout diagnostics expose only a fixed stage and allowlisted code', async () => {
  const logs = [];
  const originalWarn = console.warn;
  console.warn = (...args) => logs.push(args);
  const input = { publishableKey: 'pk_test_private_fixture', clientSecret: 'cs_test_secret_private_fixture', element: {} };
  const hostile = (code) => Object.assign(new Error('secret-bearing provider message'), {
    code,
    stack: 'secret-bearing stack', request: { token: 'private-token' },
    response: { client_secret: 'private-response-secret' }, url: 'https://private.invalid/session',
  });
  const cases = [
    ['loadStripe', async () => createStripeCheckoutAdapter(async () => { throw hostile('api_key_invalid'); })],
    ['session_initialize', async () => createStripeCheckoutAdapter(async () => ({
      createEmbeddedCheckoutPage: async () => { throw hostile('unlisted_provider_code'); },
    }))],
    ['element_mount', async () => createStripeCheckoutAdapter(async () => ({
      createEmbeddedCheckoutPage: async () => ({ mount: async () => { throw hostile('resource_missing'); }, destroy() {} }),
    }))],
  ];

  try {
    for (const [phase, makeAdapter] of cases) {
      const before = logs.length;
      const adapter = await makeAdapter();
      await assert.rejects(adapter.mount(input), (error) => {
        assert.ok(error instanceof StripeCheckoutStageError);
        assert.equal(error.phase, phase);
        assert.equal(error.code, phase === 'loadStripe' ? 'api_key_invalid' : phase === 'element_mount' ? 'resource_missing' : 'unknown');
        assert.equal(error.message, 'Stripe checkout stage failed');
        return true;
      });
      const code = phase === 'loadStripe' ? 'api_key_invalid' : phase === 'element_mount' ? 'resource_missing' : 'unknown';
      assert.deepEqual(logs.slice(before), [[`stripe_checkout_stage phase=${phase} code=${code}`]]);
    }
    let getterReads = 0;
    const accessorError = hostile('unused');
    Object.defineProperty(accessorError, 'code', { get() {
      getterReads++;
      throw new Error('private-token from getter');
    } });
    const accessorAdapter = createStripeCheckoutAdapter(async () => { throw accessorError; });
    await assert.rejects(accessorAdapter.mount(input), (error) => {
      assert.ok(error instanceof StripeCheckoutStageError);
      assert.equal(error.phase, 'loadStripe');
      assert.equal(error.code, 'unknown');
      return true;
    });
    assert.equal(getterReads, 0, 'provider accessors must not execute while producing diagnostics');
    assert.deepEqual(logs.at(-1), ['stripe_checkout_stage phase=loadStripe code=unknown']);
    assert.doesNotMatch(JSON.stringify(logs), /secret-bearing|private-token|client_secret|private\.invalid|pk_test_private|cs_test_secret/);
  } finally {
    console.warn = originalWarn;
  }
});

test('Stripe stage failures keep the existing retry message and never render provider exception data', async () => {
  const auth = fakeAuth();
  const states = [];
  const logs = [];
  const originalWarn = console.warn;
  console.warn = (...args) => logs.push(args);
  const provider = createStripeCheckoutAdapter(async () => ({
    createEmbeddedCheckoutPage: async () => ({
      mount: async () => { throw Object.assign(new Error('cs_test_secret should never appear'), { code: 'raw-secret-code' }); },
      destroy() {},
    }),
  }));
  const flow = createCheckoutFlow({
    auth,
    api: { config: async () => serverConfig, session: async () => quote() },
    provider,
    selection: selection('?plan=pro&period=monthly'),
    mode: 'test',
    render: (state) => states.push(state),
  });
  try {
    flow.start(); auth.emit({ id: 'buyer', email: 'buyer@example.invalid' }); await flush();
    await flow.acknowledge({});
    assert.equal(states.at(-1).stage, 'error');
    assert.equal(states.at(-1).message, 'The payment form could not load. Retry this same selection.');
    assert.doesNotMatch(JSON.stringify(states), /cs_test_secret|raw-secret-code/);
    assert.deepEqual(logs, [['stripe_checkout_stage phase=element_mount code=unknown']]);
  } finally {
    flow.dispose();
    console.warn = originalWarn;
  }
});

test('latest Stripe embedded page retries the same frozen session without the obsolete method', async () => {
  const auth = fakeAuth();
  const states = [];
  const secrets = [];
  const element = {};
  let mounts = 0;
  let destroys = 0;
  let attempt = 0;
  const originalWarn = console.warn;
  console.warn = () => {};
  // The current SDK exposes only createEmbeddedCheckoutPage. Calling the
  // removed initEmbeddedCheckout would fail before fetching a client secret.
  const provider = createStripeCheckoutAdapter(async () => ({
    createEmbeddedCheckoutPage: async ({ fetchClientSecret }) => {
      secrets.push(await fetchClientSecret());
      if (++attempt === 1) throw new Error('fixture initialization failure');
      return { mount: (target) => { assert.equal(target, element); mounts++; }, destroy: () => { destroys++; } };
    },
  }));
  const flow = createCheckoutFlow({ auth,
    api: { config: async () => serverConfig, session: async () => quote() },
    provider, selection: selection('?plan=pro&period=monthly'), mode: 'test',
    render: (state) => states.push(state),
  });
  try {
    flow.start(); auth.emit({ id: 'buyer' }); await flush();
    await flow.acknowledge(element);
    assert.equal(states.at(-1).stage, 'error');
    await flow.load();
    await flow.acknowledge(element);
    assert.equal(states.at(-1).stage, 'payment');
    assert.deepEqual(secrets, [quote().clientSecret, quote().clientSecret]);
    assert.equal(mounts, 1);
    auth.emit(null);
    assert.equal(destroys, 1);
  } finally {
    flow.dispose();
    console.warn = originalWarn;
  }
});

test('only current TEST initialize or mount failures expose the session support reference', async () => {
  for (const phase of ['session_initialize', 'element_mount', 'loadStripe']) {
    const auth = fakeAuth();
    const states = [];
    const flow = createCheckoutFlow({
      auth,
      api: { config: async () => serverConfig, session: async () => quote() },
      provider: { mount: async () => { throw new StripeCheckoutStageError(phase, 'unknown'); } },
      selection: selection('?plan=pro&period=monthly'), mode: 'test', render: (state) => states.push(state),
    });
    flow.start(); auth.emit({ id: 'buyer' }); await flush();
    await flow.acknowledge({});
    assert.equal(states.at(-1).stage, 'error');
    assert.equal(states.at(-1).supportReference, phase === 'loadStripe' ? null : 'cs_test_one');
    assert.doesNotMatch(JSON.stringify(states), /secret_fake/);
    await flow.load();
    assert.equal(states.at(-1).stage, 'quote');
    assert.equal(states.at(-1).supportReference, undefined, 'retry clears the rendered reference');
    auth.emit(null);
    assert.equal(states.at(-1).stage, 'sign-in');
    assert.equal(states.at(-1).supportReference, undefined, 'auth change clears the rendered reference');
    flow.dispose();
  }

  const auth = fakeAuth();
  const states = [];
  const liveQuote = quote({ sessionId: 'cs_live_one', clientSecret: 'cs_live_one_secret_fake', mode: 'live' });
  const flow = createCheckoutFlow({
    auth,
    api: { config: async () => ({ ...serverConfig, mode: 'live', publishableKey: 'pk_live_fake' }), session: async () => liveQuote },
    provider: { mount: async () => { throw new StripeCheckoutStageError('element_mount', 'unknown'); } },
    selection: selection('?plan=pro&period=monthly'), mode: 'live', render: (state) => states.push(state),
  });
  flow.start(); auth.emit({ id: 'buyer' }); await flush();
  await flow.acknowledge({});
  assert.equal(states.at(-1).stage, 'error');
  assert.equal(states.at(-1).supportReference, null, 'LIVE session IDs are never exposed');
  flow.dispose();
});

test('disposed checkout ignores a delayed TEST mount failure', async () => {
  const auth = fakeAuth();
  const states = [];
  let rejectMount;
  const mount = new Promise((_, reject) => { rejectMount = reject; });
  const flow = createCheckoutFlow({
    auth,
    api: { config: async () => serverConfig, session: async () => quote() },
    provider: { mount: async () => mount },
    selection: selection('?plan=pro&period=monthly'), mode: 'test', render: (state) => states.push(state),
  });
  flow.start(); auth.emit({ id: 'buyer' }); await flush();
  const pending = flow.acknowledge({});
  flow.dispose();
  rejectMount(new StripeCheckoutStageError('element_mount', 'unknown'));
  await pending;
  assert.equal(states.some((state) => state.supportReference), false);
});

test('stale session response after buyer changes cannot render or mount old buyer quote', async () => {
  const auth = fakeAuth();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const states = [];
  let mounts = 0;
  const flow = createCheckoutFlow({ auth, api: { config: async () => serverConfig, session: async () => pending }, provider: { mount: async () => { mounts++; return { destroy() {} }; } }, selection: selection('?plan=pro&period=monthly'), mode: 'test', render: (state) => states.push(state) });
  flow.start();
  auth.emit({ id: 'first', email: 'first@example.invalid' });
  await flush();
  auth.emit(null);
  release(quote());
  await flush();
  assert.equal(states.at(-1).stage, 'sign-in');
  assert.equal(states.some((state) => state.stage === 'quote'), false);
  await flow.acknowledge({});
  assert.equal(mounts, 0);
  flow.dispose();
});

test('test return never claims live Pro; live success requires this session to be ready', async () => {
  const auth = fakeAuth();
  const stages = [];
  let planCalls = 0;
  const api = { status: async () => ({ status: 'complete', mode: 'test', plan: 'datatug-pro-monthly', ready: true }), plan: async () => { planCalls++; return { payer: 'personal', accountId: 'personal-buyer', plan: 'pro', effectivePlan: 'pro', status: 'active' }; } };
  const testFlow = createReturnFlow({ auth, api, mode: 'test', sessionId: 'cs_test_one', render: (state) => stages.push(state.stage) });
  testFlow.start(); auth.emit({ id: 'buyer', email: 'buyer@example.invalid' }); await flush();
  assert.equal(stages.at(-1), 'test'); assert.equal(planCalls, 0); testFlow.dispose();
  const liveAuth = fakeAuth();
  const liveStages = [];
  const liveFlow = createReturnFlow({ auth: liveAuth, api: { status: async () => ({ status: 'complete', mode: 'live', plan: 'datatug-pro-monthly', ready: true }), plan: async () => { planCalls++; return { payer: 'personal', accountId: 'personal-buyer', plan: 'pro', effectivePlan: 'pro', status: 'active' }; } }, mode: 'live', sessionId: 'cs_live_one', render: (state) => liveStages.push(state.stage) });
  liveFlow.start(); liveAuth.emit({ id: 'buyer', email: 'buyer@example.invalid' }); await flush();
  assert.equal(liveStages.at(-1), 'pro'); assert.equal(planCalls, 0); liveFlow.dispose();
});

test('test return only calls a completed Pro session a test checkout', async () => {
  for (const status of [
    { status: 'open', mode: 'test', plan: 'datatug-pro-monthly', ready: true },
    { status: 'expired', mode: 'test', plan: 'datatug-pro-monthly', ready: true },
    { status: 'complete', mode: 'test', plan: 'datatug-team-monthly', ready: true },
  ]) {
    const auth = fakeAuth();
    const stages = [];
    const flow = createReturnFlow({ auth, api: { status: async () => status }, mode: 'test', sessionId: 'cs_test_one', render: (state) => stages.push(state.stage), wait: async () => {} });
    flow.start(); auth.emit({ id: 'buyer', email: 'buyer@example.invalid' }); await flush();
    assert.equal(stages.includes('test'), false);
    assert.equal(stages.at(-1), status.plan === 'datatug-team-monthly' ? 'error' : 'pending');
    flow.dispose();
  }
});

test('a completed later purchase cannot become ready from an older Pro plan', async () => {
  const auth = fakeAuth();
  const stages = [];
  let reads = 0;
  let planReads = 0;
  const flow = createReturnFlow({ auth, api: {
    status: async () => { reads++; return { status: 'complete', mode: 'live', plan: 'datatug-pro-monthly', ready: false }; },
    plan: async () => { planReads++; return { payer: 'personal', accountId: 'personal-buyer', plan: 'pro', effectivePlan: 'pro', status: 'active' }; },
  }, mode: 'live', sessionId: 'cs_live_later', render: (state) => stages.push(state.stage), wait: async () => {} });
  flow.start(); auth.emit({ id: 'buyer', email: 'buyer@example.invalid' }); await flush();
  assert.equal(reads, 5);
  assert.equal(stages.at(-1), 'pending');
  assert.equal(stages.includes('pro'), false);
  assert.equal(planReads, 0);
  flow.dispose();
});

test('return polls one authenticated session until literal readiness and never trusts absent or string readiness', async () => {
  for (const sequence of [[undefined, null, 'true', false, true], [false, false, false, false, false]]) {
    const auth = fakeAuth();
    const stages = [];
    const ids = [];
    const waits = [];
    const flow = createReturnFlow({ auth, api: { status: async (id) => {
      ids.push(id);
      return { status: 'complete', mode: 'live', plan: 'datatug-pro-annual', ready: sequence[ids.length - 1] };
    } }, mode: 'live', sessionId: 'cs_live_same', render: (state) => stages.push(state.stage), wait: async (ms) => { waits.push(ms); } });
    flow.start(); auth.emit({ id: 'buyer', email: 'buyer@example.invalid' }); await flush();
    assert.deepEqual(ids, Array(5).fill('cs_live_same'));
    assert.deepEqual(waits, Array(4).fill(2000));
    assert.equal(stages.at(-1), sequence.at(-1) === true ? 'pro' : 'pending');
    flow.dispose();
  }
});

test('return invalidates a delayed ready response on sign-out or disposal', async () => {
  for (const cancel of ['sign-out', 'dispose']) {
    const auth = fakeAuth();
    const stages = [];
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const flow = createReturnFlow({ auth, api: { status: async () => pending }, mode: 'live', sessionId: 'cs_live_old', render: (state) => stages.push(state.stage) });
    flow.start(); auth.emit({ id: 'old', email: 'old@example.invalid' }); await flush();
    if (cancel === 'sign-out') auth.emit(null); else flow.dispose();
    release({ status: 'complete', mode: 'live', plan: 'datatug-pro-monthly', ready: true });
    await flush();
    assert.equal(stages.includes('pro'), false);
    if (cancel === 'sign-out') assert.equal(stages.at(-1), 'sign-in');
    flow.dispose();
  }
});

test('return refuses wrong mode or plan and never promotes an incomplete session', async () => {
  for (const status of [
    { status: 'complete', mode: 'test', plan: 'datatug-pro-monthly', ready: true },
    { status: 'complete', mode: 'live', plan: 'datatug-team-monthly', ready: true },
    { status: 'open', mode: 'live', plan: 'datatug-pro-monthly', ready: true },
  ]) {
    const auth = fakeAuth();
    const stages = [];
    let calls = 0;
    const flow = createReturnFlow({ auth, api: { status: async () => { calls++; return status; } }, mode: 'live', sessionId: 'cs_live_one', render: (state) => stages.push(state.stage), wait: async () => {} });
    flow.start(); auth.emit({ id: 'buyer', email: 'buyer@example.invalid' }); await flush();
    assert.equal(stages.includes('pro'), false);
    assert.equal(stages.at(-1), status.status === 'open' ? 'pending' : 'error');
    assert.equal(calls, status.status === 'open' ? 5 : 1);
    flow.dispose();
  }
});

test('retryable API errors respect server Retry-After and use a safe fallback when absent or invalid', async () => {
  for (const [header, expected] of [[null, 5000], ['', 5000], ['invalid', 5000], ['-1', 5000], ['60', 60_000], ['3600', 3_600_000], ['999999999999', 2_147_483_647]]) {
    const api = checkoutApi({ apiOrigin: 'https://api.example.invalid', mode: 'test' }, { token: async () => 'token' }, async () => ({ ok: false, status: 409, json: async () => ({ code: 'offer_busy' }), headers: new Headers(header === null ? {} : { 'Retry-After': header }) }));
    await assert.rejects(api.session('datatug-pro-monthly'), (error) => error instanceof CheckoutError && error.code === 'offer_busy' && error.retryAfter === expected);
  }
  const future = new Date(Date.now() + 120_000).toUTCString();
  const api = checkoutApi({ apiOrigin: 'https://api.example.invalid', mode: 'test' }, { token: async () => 'token' }, async () => ({ ok: false, status: 409, json: async () => ({ code: 'checkout_resolving' }), headers: new Headers({ 'Retry-After': future }) }));
  await assert.rejects(api.session('datatug-pro-monthly'), (error) => error instanceof CheckoutError && error.retryAfter >= 118_000 && error.retryAfter <= 120_000);
});

test('completed existing purchase exposes only a validated session lookup', async () => {
  const auth = fakeAuth();
  const states = [];
  const api = { config: async () => serverConfig, session: async () => { throw new CheckoutError('already_subscribed', 409, null, 'cs_test_prior'); } };
  const flow = createCheckoutFlow({ auth, api, provider: { mount: async () => { throw new Error('must not mount'); } }, selection: selection('?plan=pro&period=monthly'), mode: 'test', render: (state) => states.push(state) });
  flow.start(); auth.emit({ id: 'buyer', email: 'buyer@example.invalid' }); await flush();
  assert.equal(states.at(-1).code, 'already_subscribed');
  assert.equal(states.at(-1).existingSession, 'cs_test_prior');
  flow.dispose();
  assert.equal(new CheckoutError('already_subscribed', 409, null, 'cs_test_x/path').sessionId, null);
});

test('expired authentication offers sign-in again and retries the same Pro selection', async () => {
  const auth = fakeAuth();
  const states = [];
  let calls = 0;
  const flow = createCheckoutFlow({ auth, api: { config: async () => serverConfig, session: async () => {
    calls++;
    if (calls === 1) throw new CheckoutError('unauthorized', 401);
    return quote();
  } }, provider: { mount: async () => { throw new Error('must not mount'); } }, selection: selection('?plan=pro&period=monthly'), mode: 'test', render: (state) => states.push(state) });
  flow.start(); auth.emit({ id: 'buyer', email: 'buyer@example.invalid' }); await flush();
  assert.equal(states.at(-1).status, 401);
  assert.equal(states.at(-1).stage, 'error');
  await flow.signIn();
  assert.equal(calls, 2);
  assert.equal(states.at(-1).stage, 'quote');
  flow.dispose();
});

test('unknown, foreign and pending return cannot claim Pro, with bounded polling and manual retry', async () => {
  const auth = fakeAuth();
  const states = [];
  let reads = 0;
  const flow = createReturnFlow({ auth, api: { status: async () => { reads++; return { status: 'complete', mode: 'live', plan: 'datatug-pro-monthly', ready: 'true' }; } }, mode: 'live', sessionId: 'cs_live_one', render: (state) => states.push(state.stage), wait: async () => {} });
  flow.start(); auth.emit({ id: 'buyer', email: 'buyer@example.invalid' }); await flush();
  assert.equal(reads, 5);
  assert.equal(states.at(-1), 'pending');
  assert.equal(states.includes('pro'), false);
  flow.dispose();
  const foreignAuth = fakeAuth();
  const foreign = createReturnFlow({ auth: foreignAuth, api: { status: async () => { throw new CheckoutError('not_found', 404); } }, mode: 'live', sessionId: 'cs_live_foreign', render: (state) => states.push(state.stage) });
  foreign.start(); foreignAuth.emit({ id: 'foreign', email: 'foreign@example.invalid' }); await flush();
  assert.equal(states.at(-1), 'error');
  assert.equal(states.includes('pro'), false);
  foreign.dispose();
});
