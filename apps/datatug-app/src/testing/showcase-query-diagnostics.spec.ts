import { EventEmitter } from 'node:events';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installFetchDiagnostics,
  installNetworkDiagnostics,
  installShowcaseQueryDiagnostics,
  type FetchDiagnostic,
} from '../../e2e/helpers/showcase-query-diagnostics';

import {
  finalizeShowcaseMeasurement,
  installShowcaseMeasurementLedger,
} from '../../e2e/helpers/showcase-measurement-ledger';

const url = 'https://ovdb.demodb.dev/v1/databases/northwind/dtql';
const diagnosticGlobal = globalThis as typeof globalThis & {
  __datatugQueryDiagnostics?: { dispose(): FetchDiagnostic[] };
};
const dispose = () =>
  diagnosticGlobal.__datatugQueryDiagnostics?.dispose() ?? [];
afterEach(() => {
  dispose();
  vi.unstubAllGlobals();
});

function session() {
  const events = new EventEmitter();
  const send = vi.fn(async () => ({}));
  const detach = vi.fn(async () => undefined);
  return {
    events,
    send,
    detach,
    cdp: {
      on: events.on.bind(events),
      off: events.off.bind(events),
      send,
      detach,
    } as unknown as CDPSession,
  };
}
function requested(requestId: string, address = url) {
  return {
    requestId,
    request: {
      url: address,
      method: 'POST',
      headers: { Authorization: 'secret' },
      postData: 'secret',
    },
    initiator: {
      type: 'script',
      stack: {
        callFrames: [
          {
            functionName: 'executeSavedPublicChartQuery',
            url: 'https://datatug.app/chunk-ABC.js?secret',
            lineNumber: 12,
            columnNumber: 34,
          },
          {
            functionName: 'secret string',
            url: 'https://elsewhere.example/token.js?secret',
            lineNumber: -1,
            columnNumber: NaN,
          },
        ],
      },
    },
  };
}

describe('passive bounded query CDP metadata without network', () => {
  it('detaches partial CDP setup and retains a FAIL receipt before propagating its original rejection', async () => {
    const fake = session();
    const failure = new Error('Network.enable rejected');
    fake.send.mockRejectedValueOnce(failure);
    const context = {
      addInitScript: vi.fn(async () => undefined),
      newCDPSession: vi.fn(async () => fake.cdp),
      on: vi.fn(),
      route: vi.fn(async () => undefined),
    } as unknown as BrowserContext;
    const ledger = await installShowcaseMeasurementLedger(context, {
      maxQueries: 3,
    });
    const receipt: Record<string, unknown> = {};
    const persist = vi.fn(async () => {
      expect(receipt).toMatchObject({
        status: 'FAIL',
        summary: { queryAttempts: 0 },
      });
    });
    await expect(
      (async () => {
        try {
          await installShowcaseQueryDiagnostics(context, {} as Page);
        } finally {
          await finalizeShowcaseMeasurement(ledger, receipt, persist);
        }
      })(),
    ).rejects.toBe(failure);
    expect(persist).toHaveBeenCalledOnce();
    expect(fake.detach).toHaveBeenCalledOnce();
    expect(fake.events.eventNames()).toEqual([]);
  });

  it('correlates headers/data/failure and keeps only sanitized bounded fields', async () => {
    const fake = session();
    const diagnostics = await installNetworkDiagnostics(fake.cdp);
    fake.events.emit('Network.requestWillBeSent', requested('a'));
    fake.events.emit('Network.responseReceived', {
      requestId: 'a',
      response: {
        status: 200,
        protocol: 'h2',
        fromServiceWorker: false,
        headers: { secret: 'secret' },
      },
    });
    fake.events.emit('Network.dataReceived', {
      requestId: 'a',
      dataLength: 100,
      encodedDataLength: 50,
    });
    fake.events.emit('Network.dataReceived', {
      requestId: 'a',
      dataLength: 20,
      encodedDataLength: 10,
    });
    fake.events.emit('Network.loadingFailed', {
      requestId: 'a',
      errorText: 'net::ERR_ABORTED',
      canceled: true,
      blockedReason: 'inspector',
      corsErrorStatus: {
        corsError: 'MissingAllowOriginHeader',
        failedParameter: 'secret',
      },
    });
    expect(diagnostics.rows[0]).toMatchObject({
      endpoint: 'northwind-dtql',
      status: 200,
      protocol: 'h2',
      dataEvents: 2,
      decodedDataBytes: 120,
      encodedDataBytes: 60,
      canceled: true,
      failure: 'net::ERR_ABORTED',
      blockedReason: 'inspector',
      corsError: 'MissingAllowOriginHeader',
      initiator: {
        type: 'script',
        frames: [
          {
            function: 'executeSavedPublicChartQuery',
            script: 'chunk-ABC.js',
            line: 12,
            column: 34,
          },
          { function: 'anonymous-or-other', script: 'other' },
        ],
      },
    });
    expect(JSON.stringify(diagnostics.rows)).not.toMatch(
      /secret|https:|headers|postData|failedParameter/,
    );
    await diagnostics.dispose();
    expect(fake.send.mock.calls).toEqual([['Network.enable']]);
    expect(fake.detach).toHaveBeenCalledOnce();
    expect(fake.events.eventNames()).toEqual([]);
    fake.events.emit('Network.dataReceived', {
      requestId: 'a',
      dataLength: 999,
      encodedDataLength: 999,
    });
    expect(diagnostics.rows[0].dataEvents).toBe(2);
  });

  it('bounds attempts/stack frames and redacts unknown errors, enum values and addresses', async () => {
    const fake = session();
    const diagnostics = await installNetworkDiagnostics(fake.cdp);
    for (const raw of [
      'https://attacker.example/token',
      url + '?token=secret',
      'not a URL',
    ])
      fake.events.emit('Network.requestWillBeSent', requested('ignored', raw));
    for (let index = 0; index < 20; index++) {
      const event = requested(String(index));
      event.initiator.stack.callFrames = Array(20).fill(
        event.initiator.stack.callFrames[0],
      );
      fake.events.emit('Network.requestWillBeSent', event);
    }
    fake.events.emit('Network.loadingFailed', {
      requestId: '0',
      errorText: 'secret',
      blockedReason: 'secret',
      corsErrorStatus: { corsError: 'secret' },
    });
    fake.events.emit('Network.responseReceived', {
      requestId: '0',
      response: { status: 200, protocol: 'secret' },
    });
    fake.events.emit('Network.loadingFinished', {
      requestId: '1',
      encodedDataLength: 1234,
    });
    expect(diagnostics.rows).toHaveLength(12);
    expect(
      diagnostics.rows.every((row) => row.initiator.frames.length === 4),
    ).toBe(true);
    expect(diagnostics.rows[0]).toMatchObject({
      failure: 'other',
      protocol: 'other',
      blockedReason: 'other',
      corsError: 'other',
    });
    expect(diagnostics.rows[1]).toMatchObject({ finishedEncodedBytes: 1234 });
    expect(JSON.stringify(diagnostics.rows)).not.toContain('secret');
    await diagnostics.dispose();
  });
});

describe('bounded fetch signal observer without body or network access', () => {
  it('delegates identical receiver/arguments and original promise, observes headers then abort without reading/cancelling', async () => {
    const body = vi.fn(() => {
      throw new Error('Body must not be inspected');
    });
    const response = Object.defineProperty({ status: 200 }, 'body', {
      get: body,
    }) as Response;
    const operation = Promise.resolve(response);
    const fetch = vi.fn<typeof globalThis.fetch>(() => operation);
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const abort = vi.spyOn(controller, 'abort');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const options = {
      method: 'POST',
      body: 'secret',
      headers: { Authorization: 'secret' },
      signal: controller.signal,
    };
    const receiver = { receiver: true };
    installFetchDiagnostics();
    expect(globalThis.fetch.call(receiver, url, options)).toBe(operation);
    await operation;
    expect(fetch.mock.contexts).toEqual([receiver]);
    expect(fetch.mock.calls[0]).toEqual([url, options]);
    expect(fetch.mock.calls[0][1]).toBe(options);
    controller.abort(new DOMException('secret message', 'AbortError'));
    remove.mockClear(); // The once-listener also removes itself when abort fires.
    const rows = dispose();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 200,
      endpoint: 'northwind-dtql',
      signalReason: 'AbortError',
    });
    expect(rows[0].signalAbortedAtMs).toBeGreaterThanOrEqual(
      rows[0].resolvedAtMs ?? 0,
    );
    expect(JSON.stringify(rows)).not.toMatch(/secret|https:|body|headers/);
    expect(body).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledOnce(); // Only the deliberate test caller aborts.
    expect(remove).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toBe(fetch);
  });

  it('retains bounded signal references and ignores unknown endpoints without adding calls', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => ({ status: 200 }) as Response,
    );
    vi.stubGlobal('fetch', fetch);
    installFetchDiagnostics();
    const controllers = Array.from({ length: 20 }, () => new AbortController());
    const adds = controllers.map((controller) =>
      vi.spyOn(controller.signal, 'addEventListener'),
    );
    const removes = controllers.map((controller) =>
      vi.spyOn(controller.signal, 'removeEventListener'),
    );
    for (const controller of controllers)
      await globalThis.fetch(url, {
        method: 'POST',
        signal: controller.signal,
      });
    await globalThis.fetch(url + '?token=secret', { method: 'POST' });
    await globalThis.fetch('https://elsewhere.example/secret', {
      method: 'POST',
    });
    const rows = dispose();
    expect(rows).toHaveLength(12);
    expect(fetch).toHaveBeenCalledTimes(22);
    expect(adds.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(12);
    expect(removes.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(
      12,
    );
    expect(controllers.every((controller) => !controller.signal.aborted)).toBe(
      true,
    );
  });

  it('observes sanitized rejection categories while preserving the original rejected promise', async () => {
    const error = Object.assign(new Error('secret message'), {
      name: 'secret name',
    });
    const operation = Promise.reject(error);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(() => operation),
    );
    installFetchDiagnostics();
    const actual = globalThis.fetch(url, { method: 'POST' });
    expect(actual).toBe(operation);
    await expect(actual).rejects.toBe(error);
    const rows = dispose();
    expect(rows[0]).toMatchObject({ rejection: 'other' });
    expect(rows[0].rejectedAtMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(rows)).not.toContain('secret');
  });
});
