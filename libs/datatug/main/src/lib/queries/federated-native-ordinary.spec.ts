import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ITextQueryRequest } from '../models/definition/query-def';
import { runFederatedQuery } from './federated-query-executor';
import {
  createHostedDemoDbQuery,
  withHostedDemoDbSource,
} from './hosted-demo-db-query';

vi.mock('@dalgo/indexeddb', () => ({
  IndexedDbDatabase: class {
    constructor() {
      throw new Error('Unexpected browser table scan');
    }
  },
}));

function pendingDiscovery() {
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  const fetcher = vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error('Expected the query abort signal.');
        const abort = (): void => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        requestStarted();
      }),
  );
  return { fetcher, started };
}

describe('hosted DemoDB ordinary DTQL responses', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['chinook.Customer', 'chinook', 'CustomerId', 1],
    ['adventureworks.Person.Person', 'adventureworks', 'BusinessEntityID', 42],
  ])(
    'runs %s through one complete database query',
    async (source, database, field, value) => {
      const starter = createHostedDemoDbQuery('new-query');
      const definition =
        source === 'chinook.Customer'
          ? starter
          : withHostedDemoDbSource(starter, source);
      const calls: { url: string; init?: RequestInit }[] = [];
      const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        return url.endsWith(`/${database}`)
          ? Response.json({
              id: database,
              capabilities: { dtql: true, query: true, read: true },
            })
          : Response.json({
              records: [{ data: { [field]: value } }],
              columns: [field],
              execution: { route: 'database', rowsReturned: 1 },
            });
      });
      const result = await runFederatedQuery(
        definition,
        undefined,
        '',
        undefined,
        undefined,
        'full',
        undefined,
        undefined,
        { fetch: fetcher },
      );
      expect(calls.map(({ url }) => url)).toEqual([
        `https://demodb.dev/ovdb/v1/databases/${database}`,
        `https://demodb.dev/ovdb/v1/databases/${database}/dtql`,
      ]);
      expect(calls[1].init?.method).toBe('POST');
      expect(calls[1].init?.body).toBe(
        (definition.request as ITextQueryRequest).text,
      );
      expect(result.recordset.columns.map((column) => column.name)).toEqual([
        field,
      ]);
      expect(result.recordset.rows[0][0]).toEqual({ type: 'number', value });
      expect(result.totalRows).toBe(1);
    },
  );

  it('rejects a mismatched ordinary database identity before the query POST', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: 'adventureworks',
        capabilities: { dtql: true, read: true },
      }),
    );
    await expect(
      runFederatedQuery(
        createHostedDemoDbQuery('new-query'),
        undefined,
        '',
        undefined,
        undefined,
        'full',
        undefined,
        undefined,
        { fetch: fetcher },
      ),
    ).rejects.toThrow(/identity/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('shows a bounded mapped ordinary HTTP error without scanning tables', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith('/chinook')
        ? Response.json({ id: 'chinook', capabilities: { dtql: true, read: true } })
        : Response.json(
            { error: { code: 'unsupported', message: 'The query cannot run.' } },
            { status: 422 },
          ),
    );
    await expect(
      runFederatedQuery(createHostedDemoDbQuery('new-query'), undefined, '',
        undefined, undefined, 'full', undefined, undefined, { fetch: fetcher }),
    ).rejects.toThrow('OVDB query failed (unsupported): The query cannot run.');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('allows capability discovery to use more than 15 seconds within the native query deadline', async () => {
    const start = 100_000;
    let now = start;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    const elapsedAtDiscovery = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/chinook')) {
        now = start + 16_000;
        elapsedAtDiscovery(now - start);
        return Response.json({
          id: 'chinook',
          capabilities: { dtql: true, query: true, read: true },
        });
      }
      return Response.json({
        records: [{ data: { CustomerId: 1 } }],
        columns: ['CustomerId'],
        execution: { route: 'database', rowsReturned: 1 },
      });
    });

    const result = await runFederatedQuery(
      createHostedDemoDbQuery('new-query'),
      undefined,
      '',
      undefined,
      undefined,
      'full',
      undefined,
      undefined,
      { fetch: fetcher, deadline: start + 60_000 },
    );

    expect(elapsedAtDiscovery).toHaveBeenCalledWith(16_000);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.totalRows).toBe(1);
  });

  it('aborts slow capability discovery at the overall deadline before querying or staging rows', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const onOutputPage = vi.fn();
    const onNativeRecord = vi.fn();
    const { fetcher, started } = pendingDiscovery();
    const run = runFederatedQuery(
      createHostedDemoDbQuery('new-query'),
      undefined,
      '',
      onOutputPage,
      undefined,
      'full',
      undefined,
      undefined,
      { fetch: fetcher, deadline: Date.now() + 60_000, onNativeRecord },
    );
    await started;
    deadline.abort(new DOMException('The query exceeded its deadline.', 'TimeoutError'));

    await expect(run).rejects.toThrow('The query exceeded its deadline.');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onOutputPage).not.toHaveBeenCalled();
    expect(onNativeRecord).not.toHaveBeenCalled();
  });

  it('cancels capability discovery before querying or staging rows', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    const cancellation = new AbortController();
    const onOutputPage = vi.fn();
    const onNativeRecord = vi.fn();
    const { fetcher, started } = pendingDiscovery();
    const run = runFederatedQuery(
      createHostedDemoDbQuery('new-query'),
      undefined,
      '',
      onOutputPage,
      cancellation.signal,
      'full',
      undefined,
      undefined,
      { fetch: fetcher, deadline: Date.now() + 60_000, onNativeRecord },
    );
    await started;
    cancellation.abort(new Error('The query was cancelled.'));

    await expect(run).rejects.toThrow('The query was cancelled.');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onOutputPage).not.toHaveBeenCalled();
    expect(onNativeRecord).not.toHaveBeenCalled();
  });
});
