import {
  CheckoutError,
  checkoutApi,
  validSpaceServiceQuote,
  validSpaceServiceSession,
  validSpaceServiceStatus,
} from './checkout-api.mjs';
import {
  createReturnFlow,
  createSpaceServiceCheckoutFlow,
} from './checkout-flow.mjs';
import { stripeCheckoutAdapter } from './checkout-provider.mjs';

vi.mock('@stripe/stripe-js', () => {
  throw new Error('private module load details must not escape');
});

const selection = {
  spaceID: 'space_1',
  planID: 'datatug-business-usage-monthly' as const,
};
const quote = (claimed = false) => ({
  quoteID: 'quote_1',
  spaceID: selection.spaceID,
  serviceID: 'datatug',
  planID: selection.planID,
  mode: 'test',
  accountKind: 'organisation',
  amount: { currency: 'eur', list: 9900, due: 9900, taxIncluded: true },
  quantity: 1,
  period: { interval: 'month', count: 1 },
  appliedDiscount: { kind: 'none', percentOff: 0 },
  expiresAtUTC: new Date(Date.now() + 60_000).toISOString(),
  claimed,
});
const session = (providerAmountTotal: number | null = null) => ({
  quoteID: 'quote_1',
  spaceID: selection.spaceID,
  serviceID: 'datatug',
  planID: selection.planID,
  mode: 'test',
  sessionID: 'cs_test_123',
  clientSecret: 'cs_test_123_secret_memory',
  publishableKey: 'pk_test_memory',
  providerAmountTotal,
});
const user = { id: 'buyer', email: 'buyer@example.invalid' };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function authHarness() {
  let observer: ((value: typeof user | null) => void) | undefined;
  return {
    auth: {
      observe(callback: (value: typeof user | null) => void) {
        observer = callback;
        return () => {
          observer = undefined;
        };
      },
      token: async () => 'test-token',
      signIn: async () => undefined,
      signOut: async () => undefined,
    },
    emit: (value: typeof user | null) => observer?.(value),
  };
}

it('validates the fixed Business quote and lets claimed frozen quotes resume after local expiry', () => {
  const expired = { ...quote(true), expiresAtUTC: '2020-01-01T00:00:00.000Z' };
  expect(validSpaceServiceQuote(quote(), selection)).toBe(true);
  expect(validSpaceServiceQuote(expired, selection)).toBe(true);
  expect(
    validSpaceServiceQuote({ ...expired, claimed: false }, selection),
  ).toBe(false);
  expect(
    validSpaceServiceQuote(
      { ...quote(), amount: { ...quote().amount, due: 1 } },
      selection,
    ),
  ).toBe(false);
  expect(
    validSpaceServiceQuote(
      {
        ...quote(),
        amount: {
          currency: 'eur',
          list: 12_345,
          due: 12_345,
          taxIncluded: true,
        },
      },
      selection,
    ),
  ).toBe(true);
  expect(validSpaceServiceQuote({ ...quote(), mode: 'live' }, selection)).toBe(
    false,
  );
});

it('validates only the server quoted LIVE 30 percent launch amount and rail keys', () => {
  const liveSelection = { ...selection, mode: 'live' as const };
  const liveQuote = {
    ...quote(),
    mode: 'live',
    amount: { currency: 'eur', list: 9900, due: 6930, taxIncluded: true },
    appliedDiscount: { kind: 'launch', percentOff: 30 },
  };
  expect(validSpaceServiceQuote(liveQuote, liveSelection)).toBe(true);
  expect(
    validSpaceServiceQuote(
      { ...liveQuote, appliedDiscount: { kind: 'launch', percentOff: 20 } },
      liveSelection,
    ),
  ).toBe(false);
  expect(
    validSpaceServiceQuote(
      { ...liveQuote, amount: { ...liveQuote.amount, due: 7000 } },
      liveSelection,
    ),
  ).toBe(false);
  expect(
    validSpaceServiceSession(
      {
        ...session(6930),
        mode: 'live',
        sessionID: 'cs_live_123',
        clientSecret: 'cs_live_123_secret_memory',
        publishableKey: 'pk_live_memory',
      },
      {
        ...liveSelection,
        quoteID: 'quote_1',
        quotedDueMinor: 6930,
      },
    ),
  ).toBe(true);
  expect(
    validSpaceServiceSession(
      { ...session(), mode: 'test' },
      { ...liveSelection, quoteID: 'quote_1', quotedDueMinor: 6930 },
    ),
  ).toBe(false);
});

it('uses the shared bearer/no-store request boundary with exact Space-service payloads', async () => {
  const fetcher = vi.fn(async (url: URL, options?: RequestInit) => {
    void url;
    void options;
    return { ok: true, headers: new Headers(), json: async () => ({}) };
  });
  const api = checkoutApi(
    { apiOrigin: 'https://test.invalid', mode: 'test' },
    { token: async () => 'token' } as never,
    fetcher,
  );
  await api.serviceQuote(selection.spaceID, selection.planID);
  await api.serviceSession(selection.spaceID, 'quote_1');
  await api.serviceStatus(selection.spaceID, 'cs_test_123');
  expect(
    fetcher.mock.calls.map(([url, options]) => [
      String(url),
      options?.method,
      options?.body,
    ]),
  ).toEqual([
    [
      'https://test.invalid/v0/checkout/space-service/quote',
      'POST',
      JSON.stringify(selection),
    ],
    [
      'https://test.invalid/v0/checkout/space-service/session',
      'POST',
      JSON.stringify({ spaceID: selection.spaceID, quoteID: 'quote_1' }),
    ],
    [
      'https://test.invalid/v0/checkout/space-service/session-status?spaceID=space_1&sessionID=cs_test_123',
      undefined,
      undefined,
    ],
  ]);
  for (const [, options] of fetcher.mock.calls) {
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer token' });
    expect(options?.cache).toBe('no-store');
    expect(options?.credentials).toBe('omit');
  }
});

it('waits for explicit acknowledgement before session creation and prevents duplicate clicks', async () => {
  const harness = authHarness();
  let resolveSession!: (value: unknown) => void;
  const api = {
    serviceQuote: vi.fn().mockResolvedValue(quote()),
    serviceSession: vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve;
        }),
    ),
  };
  const mount = vi.fn().mockResolvedValue({ destroy: vi.fn() });
  const states: Record<string, unknown>[] = [];
  const flow = createSpaceServiceCheckoutFlow({
    auth: harness.auth as never,
    api: api as never,
    provider: { mount } as never,
    selection,
    render: (state) => states.push(state),
  });
  flow.start();
  harness.emit(user);
  await flush();
  expect(states.at(-1)?.stage).toBe('quote');
  expect(api.serviceQuote).toHaveBeenCalledOnce();
  expect(api.serviceSession).not.toHaveBeenCalled();

  const element = {} as HTMLElement;
  const first = flow.acknowledge(element);
  const duplicate = flow.acknowledge(element);
  expect(api.serviceSession).toHaveBeenCalledOnce();
  resolveSession(session(null));
  await Promise.all([first, duplicate]);
  expect(mount).toHaveBeenCalledOnce();
  expect(states.at(-1)).toMatchObject({
    stage: 'payment',
    providerAmountTotal: null,
  });
  flow.dispose();
});

it('reports a lazy Stripe module-load failure safely and retries the same quote', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const harness = authHarness();
  const api = {
    serviceQuote: vi.fn().mockResolvedValue(quote()),
    serviceSession: vi.fn().mockResolvedValue(session(null)),
  };
  const states: Record<string, unknown>[] = [];
  const flow = createSpaceServiceCheckoutFlow({
    auth: harness.auth as never,
    api: api as never,
    provider: {
      mount: async (options: unknown) =>
        (await stripeCheckoutAdapter()).mount(options as never),
    } as never,
    selection,
    render: (state) => states.push(state),
  });
  try {
    flow.start();
    harness.emit(user);
    await flush();
    expect(states.at(-1)?.stage).toBe('quote');

    await flow.acknowledge({} as HTMLElement);
    expect(states.at(-1)).toMatchObject({
      stage: 'error',
      retrySameQuote: true,
      message:
        'Checkout is unavailable right now. A previous attempt may still be resolving; retry this same selection later.',
    });

    await flow.acknowledge({} as HTMLElement);
    expect(api.serviceQuote).toHaveBeenCalledOnce();
    expect(api.serviceSession.mock.calls).toEqual([
      [selection.spaceID, 'quote_1'],
      [selection.spaceID, 'quote_1'],
    ]);
    expect(states.at(-1)).toMatchObject({
      stage: 'error',
      retrySameQuote: true,
    });
    expect(JSON.stringify(states)).not.toContain('private module load details');
    expect(warn.mock.calls).toEqual([
      ['stripe_checkout_stage phase=loadStripe code=unknown'],
      ['stripe_checkout_stage phase=loadStripe code=unknown'],
    ]);
  } finally {
    flow.dispose();
    warn.mockRestore();
  }
});

it('does not mount a session whose provider total differs from the accepted quote', async () => {
  const harness = authHarness();
  const api = {
    serviceQuote: vi.fn().mockResolvedValue(quote()),
    serviceSession: vi.fn().mockResolvedValue(session(99_000)),
  };
  const mount = vi.fn();
  const states: Record<string, unknown>[] = [];
  const flow = createSpaceServiceCheckoutFlow({
    auth: harness.auth as never,
    api: api as never,
    provider: { mount } as never,
    selection,
    render: (state) => states.push(state),
  });
  flow.start();
  harness.emit(user);
  await flush();
  await flow.acknowledge({} as HTMLElement);
  expect(mount).not.toHaveBeenCalled();
  expect(states.at(-1)).toMatchObject({ stage: 'error' });
  flow.dispose();
});

it('allows an expired unclaimed quote to be refreshed instead of retrying it', async () => {
  const harness = authHarness();
  const api = {
    serviceQuote: vi.fn().mockResolvedValue(quote()),
    serviceSession: vi
      .fn()
      .mockRejectedValue(new CheckoutError('quote_expired', 410)),
  };
  const states: Record<string, unknown>[] = [];
  const flow = createSpaceServiceCheckoutFlow({
    auth: harness.auth as never,
    api: api as never,
    provider: { mount: vi.fn() } as never,
    selection,
    render: (state) => states.push(state),
  });
  flow.start();
  harness.emit(user);
  await flush();
  await flow.acknowledge({} as HTMLElement);
  expect(states.at(-1)).toMatchObject({
    stage: 'error',
    code: 'quote_expired',
    retrySameQuote: false,
  });
  expect(states.at(-1)?.quote).toBeUndefined();
  flow.dispose();
});

it('drops an old actor quote when auth changes before the response returns', async () => {
  const harness = authHarness();
  let resolveOld!: (value: unknown) => void;
  let quoteCalls = 0;
  const api = {
    serviceQuote: vi.fn(() => {
      quoteCalls++;
      return quoteCalls === 1
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve(quote());
    }),
    serviceSession: vi.fn(),
  };
  const states: Record<string, unknown>[] = [];
  const flow = createSpaceServiceCheckoutFlow({
    auth: harness.auth as never,
    api: api as never,
    provider: { mount: vi.fn() } as never,
    selection,
    render: (state) => states.push(state),
  });
  flow.start();
  harness.emit(user);
  harness.emit({ ...user, id: 'other' });
  await flush();
  resolveOld({ ...quote(), quoteID: 'stale_quote' });
  await flush();
  expect(api.serviceQuote).toHaveBeenCalledTimes(2);
  expect(
    states.some(
      (state) =>
        (state.quote as { quoteID?: string } | undefined)?.quoteID ===
        'stale_quote',
    ),
  ).toBe(false);
  expect(states.at(-1)?.stage).toBe('quote');
  flow.dispose();
});

it('destroys a provider candidate that resolves after checkout identity invalidation', async () => {
  const harness = authHarness();
  let resolveMount!: (value: { destroy: () => void }) => void;
  const destroyCandidate = vi.fn();
  const mount = vi.fn(
    () =>
      new Promise<{ destroy: () => void }>(
        (resolve) => (resolveMount = resolve),
      ),
  );
  const states: Record<string, unknown>[] = [];
  const flow = createSpaceServiceCheckoutFlow({
    auth: harness.auth as never,
    api: {
      serviceQuote: vi.fn().mockResolvedValue(quote()),
      serviceSession: vi.fn().mockResolvedValue(session()),
    } as never,
    provider: { mount } as never,
    selection,
    render: (state) => states.push(state),
  });
  flow.start();
  harness.emit(user);
  await flush();
  expect(states.at(-1)?.stage).toBe('quote');

  const acknowledgement = flow.acknowledge({} as HTMLElement);
  await flush();
  expect(mount).toHaveBeenCalledOnce();
  harness.emit(null);
  resolveMount({ destroy: destroyCandidate });
  await acknowledgement;

  expect(destroyCandidate).toHaveBeenCalledOnce();
  expect(states.at(-1)?.stage).toBe('sign-in');
  expect(states.some((state) => state.stage === 'payment')).toBe(false);
  flow.dispose();
});

it('accepts a nullable provider total and reports completed Test checkout only as pending reconciliation', async () => {
  const testStatus = {
    spaceID: selection.spaceID,
    serviceID: 'datatug',
    planID: selection.planID,
    mode: 'test',
    sessionID: 'cs_test_123',
    status: 'complete',
    providerAmountTotal: null,
    accessStatus: 'pending_reconciliation',
  };
  expect(
    validSpaceServiceSession(session(null), {
      ...selection,
      quoteID: 'quote_1',
      quotedDueMinor: 9900,
    }),
  ).toBe(true);
  expect(
    validSpaceServiceSession(session(9901), {
      ...selection,
      quoteID: 'quote_1',
      quotedDueMinor: 9900,
    }),
  ).toBe(false);
  expect(
    validSpaceServiceStatus(testStatus, {
      spaceID: selection.spaceID,
      sessionID: 'cs_test_123',
    }),
  ).toBe(true);
  const harness = authHarness();
  const states: Record<string, unknown>[] = [];
  const flow = createReturnFlow({
    auth: harness.auth as never,
    api: { serviceStatus: vi.fn().mockResolvedValue(testStatus) } as never,
    mode: 'test',
    sessionId: 'cs_test_123',
    serviceScope: { spaceID: selection.spaceID },
    wait: async () => undefined,
    render: (state) => states.push(state),
  });
  flow.start();
  harness.emit(user);
  await flush();
  expect(states.at(-1)).toMatchObject({
    stage: 'test-complete',
    status: testStatus,
  });
  expect(states.at(-1)?.stage).not.toBe('pro');
  flow.dispose();
});

it('keeps expired Business return sessions in a non-entitled state', async () => {
  const harness = authHarness();
  const states: Record<string, unknown>[] = [];
  const flow = createReturnFlow({
    auth: harness.auth as never,
    api: {
      serviceStatus: vi.fn().mockResolvedValue({
        spaceID: selection.spaceID,
        serviceID: 'datatug',
        planID: selection.planID,
        mode: 'test',
        sessionID: 'cs_test_123',
        status: 'expired',
        providerAmountTotal: null,
        accessStatus: 'pending_reconciliation',
      }),
    } as never,
    mode: 'test',
    sessionId: 'cs_test_123',
    serviceScope: { spaceID: selection.spaceID },
    render: (state) => states.push(state),
  });
  flow.start();
  harness.emit(user);
  await flush();
  expect(states.at(-1)?.stage).toBe('expired');
  flow.dispose();
});

it('keeps an open Business return pending after bounded status polling', async () => {
  const harness = authHarness();
  const states: Record<string, unknown>[] = [];
  const status = {
    spaceID: selection.spaceID,
    serviceID: 'datatug',
    planID: selection.planID,
    mode: 'test',
    sessionID: 'cs_test_123',
    status: 'open',
    providerAmountTotal: null,
    accessStatus: 'pending_reconciliation',
  };
  const serviceStatus = vi.fn().mockResolvedValue(status);
  const flow = createReturnFlow({
    auth: harness.auth as never,
    api: { serviceStatus } as never,
    mode: 'test',
    sessionId: 'cs_test_123',
    serviceScope: { spaceID: selection.spaceID },
    wait: async () => undefined,
    render: (state) => states.push(state),
  });
  flow.start();
  harness.emit(user);
  await flush();
  expect(serviceStatus).toHaveBeenCalledTimes(5);
  expect(states.at(-1)).toMatchObject({ stage: 'pending' });
  expect(states.at(-1)?.stage).not.toBe('pro');
  flow.dispose();
});

it('grants the active return state only for a matching LIVE paid status', async () => {
  const harness = authHarness();
  const states: Record<string, unknown>[] = [];
  const status = {
    spaceID: selection.spaceID,
    serviceID: 'datatug',
    planID: selection.planID,
    mode: 'live',
    sessionID: 'cs_live_123',
    status: 'complete',
    providerAmountTotal: 6930,
    accessStatus: 'active',
  };
  expect(
    validSpaceServiceStatus(status, {
      spaceID: selection.spaceID,
      sessionID: 'cs_live_123',
      mode: 'live',
    }),
  ).toBe(true);
  expect(
    validSpaceServiceStatus({ ...status, mode: 'test' }, {
      spaceID: selection.spaceID,
      sessionID: 'cs_live_123',
      mode: 'live',
    }),
  ).toBe(false);
  const flow = createReturnFlow({
    auth: harness.auth as never,
    api: { serviceStatus: vi.fn().mockResolvedValue(status) } as never,
    mode: 'live',
    sessionId: 'cs_live_123',
    serviceScope: { spaceID: selection.spaceID, mode: 'live' },
    wait: async () => undefined,
    render: (state) => states.push(state),
  });
  flow.start();
  harness.emit(user);
  await flush();
  expect(states.at(-1)).toMatchObject({
    stage: 'business-active',
    spaceID: selection.spaceID,
  });
  flow.dispose();
});

it('shows native TEST active access only for the matching Space, service, mode and session', async () => {
  const status = {
    spaceID: selection.spaceID,
    serviceID: 'datatug',
    planID: selection.planID,
    mode: 'test',
    sessionID: 'cs_test_123',
    status: 'complete',
    providerAmountTotal: 6930,
    accessStatus: 'active',
  };
  for (const [candidate, expected] of [
    [status, 'business-active'],
    [{ ...status, accessStatus: 'pending_reconciliation' }, 'test-complete'],
    [{ ...status, serviceID: 'other' }, 'error'],
    [{ ...status, spaceID: 'other' }, 'error'],
    [{ ...status, sessionID: 'cs_test_other' }, 'error'],
    [{ ...status, mode: 'live' }, 'error'],
  ] as const) {
    const harness = authHarness();
    const states: Record<string, unknown>[] = [];
    const flow = createReturnFlow({
      auth: harness.auth as never,
      api: { serviceStatus: vi.fn().mockResolvedValue(candidate) } as never,
      mode: 'test',
      sessionId: 'cs_test_123',
      serviceScope: { spaceID: selection.spaceID, mode: 'test' },
      wait: async () => undefined,
      render: (state) => states.push(state),
    });
    flow.start();
    harness.emit(user);
    await flush();
    expect(states.at(-1)?.stage).toBe(expected);
    flow.dispose();
  }
});

it('shows a matching ended TEST service without implying active access', async () => {
  const harness = authHarness();
  const states: Record<string, unknown>[] = [];
  const status = {
    spaceID: selection.spaceID,
    serviceID: 'datatug',
    planID: selection.planID,
    mode: 'test',
    sessionID: 'cs_test_123',
    status: 'complete',
    providerAmountTotal: 6930,
    accessStatus: 'ended',
  };
  const flow = createReturnFlow({
    auth: harness.auth as never,
    api: { serviceStatus: vi.fn().mockResolvedValue(status) } as never,
    mode: 'test',
    sessionId: 'cs_test_123',
    serviceScope: { spaceID: selection.spaceID, mode: 'test' },
    render: (state) => states.push(state),
  });
  flow.start();
  harness.emit(user);
  await flush();
  expect(states.at(-1)?.stage).toBe('business-ended');
  flow.dispose();
});

it('keeps ended and unverified LIVE access out of the active state', async () => {
  for (const accessStatus of ['ended', 'pending_reconciliation']) {
    const harness = authHarness();
    const states: Record<string, unknown>[] = [];
    const status = {
      spaceID: selection.spaceID,
      serviceID: 'datatug',
      planID: selection.planID,
      mode: 'live',
      sessionID: 'cs_live_123',
      status: 'complete',
      providerAmountTotal: 6930,
      accessStatus,
    };
    const flow = createReturnFlow({
      auth: harness.auth as never,
      api: { serviceStatus: vi.fn().mockResolvedValue(status) } as never,
      mode: 'live',
      sessionId: 'cs_live_123',
      serviceScope: { spaceID: selection.spaceID, mode: 'live' },
      wait: async () => undefined,
      render: (state) => states.push(state),
    });
    flow.start();
    harness.emit(user);
    await flush();
    expect(states.at(-1)?.stage).toBe(
      accessStatus === 'ended' ? 'business-ended' : 'pending',
    );
    expect(states.at(-1)?.stage).not.toBe('business-active');
    flow.dispose();
  }
});
