import type { BrowserContext, CDPSession, Page } from '@playwright/test';

const queryEndpoint = (raw: string): string | undefined => {
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash) return;
    if (
      url.origin === 'https://ovdb.demodb.dev' &&
      url.pathname === '/v1/databases/northwind/tugql'
    )
      return 'northwind-tugql';
    if (
      url.origin === 'https://cloud.openvaultdb.com' &&
      url.pathname === '/v1/tugql'
    )
      return 'comparison-tugql';
  } catch {
    /* Unknown addresses are never retained. */
  }
  return;
};
const integer = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const enumValue = (value: string | undefined, allowed: readonly string[]) =>
  value === undefined ? undefined : allowed.includes(value) ? value : 'other';

export interface FetchDiagnostic {
  id: number;
  endpoint: string;
  clockOriginEpochMs: number;
  startedAtMs: number;
  signalInitiallyAborted: boolean;
  signalAbortedAtMs?: number;
  signalReason?: string;
  resolvedAtMs?: number;
  status?: number;
  rejectedAtMs?: number;
  rejection?: string;
}

/** Serialized into the fresh opt-in page. No body, URL, header or Response is retained.
 * Observers can perturb timing; they never change fetch options or its returned promise. */
export function installFetchDiagnostics(): void {
  if (globalThis.window && globalThis.window !== globalThis.window.top) return;
  const target = globalThis as typeof globalThis & {
    __datatugQueryDiagnostics?: { dispose(): FetchDiagnostic[] };
  };
  const original = globalThis.fetch;
  let disposed = false;
  const rows: FetchDiagnostic[] = [];
  const listeners: { signal: AbortSignal; listener: () => void }[] = [];
  const start = performance.now();
  const category = (value: unknown): string => {
    try {
      const name =
        value && typeof value === 'object' && 'name' in value
          ? value.name
          : undefined;
      return typeof name === 'string' &&
        ['AbortError', 'TimeoutError', 'TypeError', 'Error'].includes(name)
        ? name
        : 'other';
    } catch {
      return 'other';
    }
  };
  const wrapped: typeof fetch = function (
    this: unknown,
    ...args: Parameters<typeof fetch>
  ) {
    // Delegate first, with identical receiver and argument objects. Observe only known public POSTs.
    const operation = Reflect.apply(original, this, args) as ReturnType<
      typeof fetch
    >;
    try {
      const [input, init] = args;
      const request = input instanceof Request ? input : undefined;
      const raw =
        request?.url ??
        (typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : '');
      const url = new URL(raw);
      const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
      const endpoint =
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        method === 'POST'
          ? url.origin === 'https://ovdb.demodb.dev' &&
            url.pathname === '/v1/databases/northwind/tugql'
            ? 'northwind-tugql'
            : url.origin === 'https://cloud.openvaultdb.com' &&
                url.pathname === '/v1/tugql'
              ? 'comparison-tugql'
              : undefined
          : undefined;
      if (!endpoint || rows.length >= 12) return operation;
      const signal =
        init?.signal === null ? undefined : (init?.signal ?? request?.signal);
      const row: FetchDiagnostic = {
        id: rows.length + 1,
        endpoint,
        clockOriginEpochMs: performance.timeOrigin + start,
        startedAtMs: performance.now() - start,
        signalInitiallyAborted: signal?.aborted ?? false,
      };
      rows.push(row);
      if (signal) {
        const listener = () => {
          row.signalAbortedAtMs = performance.now() - start;
          row.signalReason = category(signal.reason);
        };
        signal.addEventListener('abort', listener, { once: true });
        listeners.push({ signal, listener });
        if (signal.aborted) listener();
      }
      void operation.then(
        (response) => {
          if (disposed) return;
          row.resolvedAtMs = performance.now() - start;
          row.status = response.status;
        },
        (error: unknown) => {
          if (disposed) return;
          row.rejectedAtMs = performance.now() - start;
          row.rejection = category(error);
        },
      );
    } catch {
      /* Diagnostics must not change a delegated fetch outcome. */
    }
    return operation;
  };
  globalThis.fetch = wrapped;
  target.__datatugQueryDiagnostics = {
    dispose: () => {
      disposed = true;
      for (const { signal, listener } of listeners)
        signal.removeEventListener('abort', listener);
      listeners.length = 0;
      if (globalThis.fetch === wrapped) globalThis.fetch = original;
      delete target.__datatugQueryDiagnostics;
      return rows;
    },
  };
}

type NetworkDiagnostic = {
  id: number;
  endpoint: string;
  clockOriginEpochMs: number;
  startedAtMs: number;
  initiator: {
    type: string;
    frames: {
      function: string;
      script: string;
      line?: number;
      column?: number;
    }[];
  };
  status?: number;
  protocol?: string;
  fromServiceWorker?: boolean;
  responseAtMs?: number;
  dataEvents: number;
  decodedDataBytes: number;
  encodedDataBytes: number;
  finishedAtMs?: number;
  finishedEncodedBytes?: number;
  failedAtMs?: number;
  failure?: string;
  canceled?: boolean;
  blockedReason?: string;
  corsError?: string;
};

/** Passive, bounded CDP metadata. The separate ledger remains the only pass/fail authority. */
export async function installNetworkDiagnostics(session: CDPSession) {
  const start = performance.now();
  const rows: NetworkDiagnostic[] = [];
  const requests = new Map<string, NetworkDiagnostic>();
  const elapsed = () => performance.now() - start;
  const scriptName = (raw: string) => {
    try {
      const url = new URL(raw);
      const name = url.pathname.split('/').pop() ?? '';
      return url.origin === 'https://datatug.app' &&
        /^[A-Za-z0-9._-]{1,100}\.m?js$/.test(name)
        ? name
        : 'other';
    } catch {
      return 'other';
    }
  };
  const onRequest = (event: {
    requestId: string;
    request: { url: string; method: string };
    initiator: {
      type: string;
      stack?: {
        callFrames: {
          functionName: string;
          url: string;
          lineNumber: number;
          columnNumber: number;
        }[];
      };
    };
  }) => {
    const endpoint = queryEndpoint(event.request.url);
    if (!endpoint || event.request.method !== 'POST' || rows.length >= 12)
      return;
    const row: NetworkDiagnostic = {
      id: rows.length + 1,
      endpoint,
      clockOriginEpochMs: performance.timeOrigin + start,
      startedAtMs: elapsed(),
      initiator: {
        type:
          enumValue(event.initiator.type, [
            'parser',
            'script',
            'preload',
            'SignedExchange',
            'preflight',
            'other',
          ]) ?? 'other',
        frames: (event.initiator.stack?.callFrames ?? [])
          .slice(0, 4)
          .map((frame) => ({
            function: /^[A-Za-z_$][A-Za-z0-9_$.]{0,79}$/.test(
              frame.functionName,
            )
              ? frame.functionName
              : 'anonymous-or-other',
            script: scriptName(frame.url),
            line: integer(frame.lineNumber),
            column: integer(frame.columnNumber),
          })),
      },
      dataEvents: 0,
      decodedDataBytes: 0,
      encodedDataBytes: 0,
    };
    rows.push(row);
    requests.set(event.requestId, row);
  };
  const onResponse = (event: {
    requestId: string;
    response: {
      status: number;
      protocol?: string;
      fromServiceWorker?: boolean;
    };
  }) => {
    const row = requests.get(event.requestId);
    if (!row) return;
    row.status = integer(event.response.status);
    row.protocol = enumValue(event.response.protocol, [
      'h2',
      'h3',
      'http/1.1',
      'http/1.0',
    ]);
    row.fromServiceWorker = event.response.fromServiceWorker === true;
    row.responseAtMs = elapsed();
  };
  const onData = (event: {
    requestId: string;
    dataLength: number;
    encodedDataLength: number;
  }) => {
    const row = requests.get(event.requestId);
    if (!row) return;
    row.dataEvents = Math.min(row.dataEvents + 1, Number.MAX_SAFE_INTEGER);
    row.decodedDataBytes = Math.min(
      row.decodedDataBytes + (integer(event.dataLength) ?? 0),
      Number.MAX_SAFE_INTEGER,
    );
    row.encodedDataBytes = Math.min(
      row.encodedDataBytes + (integer(event.encodedDataLength) ?? 0),
      Number.MAX_SAFE_INTEGER,
    );
  };
  const onFinished = (event: {
    requestId: string;
    encodedDataLength: number;
  }) => {
    const row = requests.get(event.requestId);
    if (!row) return;
    row.finishedAtMs = elapsed();
    row.finishedEncodedBytes = integer(event.encodedDataLength);
  };
  const onFailed = (event: {
    requestId: string;
    errorText: string;
    canceled?: boolean;
    blockedReason?: string;
    corsErrorStatus?: { corsError: string };
  }) => {
    const row = requests.get(event.requestId);
    if (!row) return;
    row.failedAtMs = elapsed();
    row.failure = enumValue(event.errorText, [
      'net::ERR_ABORTED',
      'net::ERR_FAILED',
      'net::ERR_CONNECTION_CLOSED',
      'net::ERR_CONTENT_LENGTH_MISMATCH',
      'net::ERR_HTTP2_PROTOCOL_ERROR',
      'net::ERR_NETWORK_CHANGED',
      'net::ERR_TIMED_OUT',
    ]);
    row.canceled = event.canceled === true;
    row.blockedReason = enumValue(event.blockedReason, [
      'other',
      'csp',
      'mixed-content',
      'origin',
      'inspector',
      'subresource-filter',
      'content-type',
      'coep-frame-resource-needs-coep-header',
      'coop-sandboxed-iframe-cannot-navigate-to-coop-page',
      'corp-not-same-origin',
      'corp-not-same-origin-after-defaulted-to-same-origin-by-coep',
      'corp-not-same-site',
    ]);
    row.corsError = enumValue(event.corsErrorStatus?.corsError, [
      'DisallowedByMode',
      'InvalidResponse',
      'WildcardOriginNotAllowed',
      'MissingAllowOriginHeader',
      'MultipleAllowOriginValues',
      'InvalidAllowOriginValue',
      'AllowOriginMismatch',
      'InvalidAllowCredentials',
      'CorsDisabledScheme',
      'PreflightInvalidStatus',
      'PreflightDisallowedRedirect',
      'PreflightWildcardOriginNotAllowed',
      'PreflightMissingAllowOriginHeader',
      'PreflightMultipleAllowOriginValues',
      'PreflightInvalidAllowOriginValue',
      'PreflightAllowOriginMismatch',
      'PreflightInvalidAllowCredentials',
      'PreflightMissingAllowExternal',
      'PreflightInvalidAllowExternal',
      'InvalidAllowMethodsPreflightResponse',
      'InvalidAllowHeadersPreflightResponse',
      'MethodDisallowedByPreflightResponse',
      'HeaderDisallowedByPreflightResponse',
      'RedirectContainsCredentials',
      'InsecurePrivateNetwork',
      'InvalidPrivateNetworkAccess',
      'UnexpectedPrivateNetworkAccess',
      'PreflightMissingAllowPrivateNetwork',
      'PreflightInvalidAllowPrivateNetwork',
      'PreflightPrivateNetworkExternalNotSupported',
      'PreflightMissingPrivateNetworkAccessId',
      'PreflightMissingPrivateNetworkAccessName',
      'PrivateNetworkAccessPermissionUnavailable',
      'PrivateNetworkAccessPermissionDenied',
      'LocalNetworkAccessPermissionDenied',
    ]);
  };
  await session.send('Network.enable');
  session.on('Network.requestWillBeSent', onRequest);
  session.on('Network.responseReceived', onResponse);
  session.on('Network.dataReceived', onData);
  session.on('Network.loadingFinished', onFinished);
  session.on('Network.loadingFailed', onFailed);
  return {
    rows,
    async dispose() {
      session.off('Network.requestWillBeSent', onRequest);
      session.off('Network.responseReceived', onResponse);
      session.off('Network.dataReceived', onData);
      session.off('Network.loadingFinished', onFinished);
      session.off('Network.loadingFailed', onFailed);
      await session.detach();
    },
  };
}

export async function installShowcaseQueryDiagnostics(
  context: BrowserContext,
  page: Page,
) {
  await context.addInitScript(installFetchDiagnostics);
  const session = await context.newCDPSession(page);
  let network: Awaited<ReturnType<typeof installNetworkDiagnostics>>;
  try {
    network = await installNetworkDiagnostics(session);
  } catch (error) {
    await session.detach().catch(() => undefined);
    throw error;
  }
  return {
    async finish() {
      let fetch: FetchDiagnostic[] = [];
      let fetchUnavailable = false;
      try {
        fetch = await page.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __datatugQueryDiagnostics?: { dispose(): FetchDiagnostic[] };
              }
            ).__datatugQueryDiagnostics?.dispose() ?? [],
        );
      } catch {
        fetchUnavailable = true;
      } finally {
        await network.dispose();
      }
      return {
        network: network.rows,
        fetch,
        fetchUnavailable,
        limitation:
          'Observers can perturb timing. Timestamps are observer arrival times relative to the supplied per-realm epoch origin, not exact browser wire timing. No bodies/headers/options or request outcomes are changed.',
      };
    },
  };
}
