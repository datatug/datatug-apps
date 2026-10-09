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
