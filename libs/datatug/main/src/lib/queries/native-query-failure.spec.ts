import { describe, expect, it, vi } from 'vitest';
import { QueryType, type IQueryDef } from '../models/definition/query-def';
import { runFederatedQuery } from './federated-query-executor';
import {
  decodeNativeQueryDiagnostic,
  nativeHttpFailure,
  nativeQueryDiagnostic,
  nativeQueryDiagnosticMessage,
  nativeQueryFetch,
  ovdbNetworkFetch,
  NativeQueryFailure,
  withNativeQueryStage,
} from './native-query-failure';

const definition = {
  id: 'q',
  title: 'q',
  request: {
    queryType: QueryType.DTQL,
    text: 'from: {database: db, name: items, alias: i}\ncolumns: [{field: name, source: i}]\n',
  },
  federation: {
    ovdbBaseUrl: 'https://cloud.openvaultdb.com',
    tables: [{ database: 'db', name: 'items', fields: ['name'] }],
  },
} as IQueryDef;
const execute = (fetcher: typeof fetch) =>
  runFederatedQuery(
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

describe('finite native query failure', () => {
  it('retains discovery HTTP status without reading or exposing an arbitrary provider body', async () => {
    const body = 'https://private.invalid/?token=secret SELECT hidden';
    const response = new Response(body, { status: 403 });
    const read = vi.spyOn(response, 'text');
    const fetcher = vi.fn<typeof fetch>(async () => response);
    const error = await execute(fetcher).catch((e) => e);
    expect(error).toBeInstanceOf(NativeQueryFailure);
    expect(nativeQueryDiagnostic(error)).toEqual({
      stage: 'capability_discovery',
      reason: 'http_status',
      status: 403,
    });
    expect(error.message).toContain('HTTP 403');
    expect(error.message).not.toContain(body);
    expect(read).not.toHaveBeenCalled();
    expect(response.bodyUsed).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('retains the exact original fetch rejection locally without claiming CORS is distinguishable from other network failures', async () => {
    const cause = new TypeError('secret URL SQL auth');
    const error = await execute(
      vi.fn<typeof fetch>(async () => {
        throw cause;
      }),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(NativeQueryFailure);
    expect(error.cause).toBe(cause);
    expect(nativeQueryDiagnostic(error)).toEqual({
      stage: 'capability_discovery',
      reason: 'network',
    });
    expect(error.message).not.toContain('secret');
  });
  it('retains capability parse and contract causes within the executor', async () => {
    for (const body of [
      '{bad',
      JSON.stringify({ id: 'wrong', capabilities: { dtql: true } }),
    ]) {
      const error = await execute(
        vi.fn<typeof fetch>(async () => new Response(body)),
      ).catch((e) => e);
      expect(error).toBeInstanceOf(NativeQueryFailure);
      expect(error.cause).toBeInstanceOf(Error);
      expect(nativeQueryDiagnostic(error)).toEqual({
        stage: 'capability_discovery',
        reason: 'invalid_response',
      });
    }
    const cause = new SyntaxError('private parse');
    await expect(
      withNativeQueryStage('capability_discovery', undefined, async () => {
        throw cause;
      }),
    ).rejects.toMatchObject({ cause });
  });
  it('uses finite query HTTP codes and never forwards mapped provider text', () => {
    const error = nativeHttpFailure(
      'query_execution',
      { status: 429, redirected: false },
      'OVDB query failed (query_budget_exceeded): SELECT secret https://private.invalid',
    );
    expect(nativeQueryDiagnostic(error)).toEqual({
      stage: 'query_execution',
      reason: 'http_status',
      status: 429,
      code: 'query_budget_exceeded',
    });
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.message).not.toContain('SELECT');
    expect(
      nativeQueryDiagnostic(
        nativeHttpFailure(
          'query_execution',
          { status: 403, redirected: false },
          'OVDB query failed (secret): private',
        ),
      )?.code,
    ).toBeUndefined();
  });
  it('rejects forged/unknown diagnostics rather than displaying arbitrary values', () => {
    const valid = {
      stage: 'query_execution',
      reason: 'http_status',
      status: 503,
    };
    expect(decodeNativeQueryDiagnostic(valid)).toEqual(valid);
    for (const value of [
      null,
      [],
      Object.create(valid),
      { ...valid, stage: 'private' },
      { ...valid, reason: 'secret' },
      { ...valid, status: 999 },
      { ...valid, status: '403' },
      { ...valid, status: 200 },
      { ...valid, status: undefined },
      { ...valid, code: 'secret' },
      { ...valid, message: 'SELECT token' },
    ]) {
      expect(decodeNativeQueryDiagnostic(value)).toBeUndefined();
      expect(nativeQueryDiagnosticMessage(value)).toBeUndefined();
    }
  });
  it('keeps cancellation unchanged instead of classifying it as a provider failure', async () => {
    const controller = new AbortController(),
      cause = new DOMException('cancelled', 'AbortError');
    controller.abort(cause);
    await expect(
      nativeQueryFetch(
        vi.fn<typeof fetch>(async () => {
          throw cause;
        }),
        'unused',
        { signal: controller.signal },
        'query_execution',
      ),
    ).rejects.toBe(cause);
    await expect(
      withNativeQueryStage(
        'capability_discovery',
        controller.signal,
        async () => {
          throw cause;
        },
      ),
    ).rejects.toBe(cause);
  });

  it('ovdbNetworkFetch maps only the browser network failure', async () => {
    const network = ovdbNetworkFetch(vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch, 'https://ovdb.example.test/x?t=1', {}, 'query_execution');
    await expect(network).rejects.toMatchObject({
      message: 'OVDB query could not be reached. Retry or open the saved query to inspect it.',
      diagnostic: { stage: 'query_execution', reason: 'network' },
    });
    const budget = new Error('Run exceeded its byte bound.');
    await expect(ovdbNetworkFetch(vi.fn(async () => { throw budget; }) as unknown as typeof fetch, 'x', {}, 'query_execution')).rejects.toBe(budget);
  });
});
