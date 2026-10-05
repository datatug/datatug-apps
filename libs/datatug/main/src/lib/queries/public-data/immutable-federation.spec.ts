import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoundedRunBudget, monotonicTime } from './bounded-run-budget';
import {
  createImmutableFederationFetch,
  type BoundedRuntime,
} from './immutable-federation';
import {
  validateBounds,
  type BoundedFederation,
  type BoundedRecord,
} from './bounded-federation';
import {
  RUNTIME_PIN_HEADERS,
  validateRuntimePins,
  type CompleteRuntimeReadPins,
} from './runtime-read-pins';
import { runFederatedQuery } from '../federated-query-executor';
import { QueryType, type IQueryDef } from '../../models/definition/query-def';
import { publicDataExceptions } from './public-data-scenario';
import { runtimePlanIdentity, saveRuntimePins } from './saved-runtime-pins';
import { readFileSync } from 'node:fs';
import { sha256 } from './canonical-metadata';

const base = 'https://cloud.openvaultdb.com';
const pins: CompleteRuntimeReadPins = {
  providerRevision: 'a'.repeat(40),
  sourceSha256: 'b'.repeat(64),
  servingSha256: 'c'.repeat(64),
  manifestSha256: 'd'.repeat(64),
};
const initial = {
  providerRevision: pins.providerRevision,
  sourceSha256: pins.sourceSha256,
};
const row = (key: string, data: Record<string, unknown>): BoundedRecord => ({
  key,
  data,
});
function bounds(): BoundedFederation & { readonly runtime: BoundedRuntime } {
  return {
    userRows: 1000,
    userOffset: 0,
    identifierKind: 'place',
    identifierLimit: 100,
    resultRows: 5000,
    bytes: 5242880,
    timeoutMs: 10000,
    sources: [
      { database: 'user', name: 'Customer', keyField: 'Country' },
      {
        database: 'geo',
        name: 'Countries',
        keyField: 'raw',
        parent: { database: 'user', name: 'Customer', field: 'Country' },
      },
    ],
    runtime: {
      readProfile: 'bounded-immutable/1',
      databases: { user: initial, geo: initial },
    },
  };
}
function response(
  records: readonly BoundedRecord[],
  responsePins = pins,
): Response {
  return new Response(JSON.stringify({ records }), {
    headers: Object.fromEntries(
      Object.entries(RUNTIME_PIN_HEADERS).map(([name, header]) => [
        header,
        responsePins[name as keyof CompleteRuntimeReadPins],
      ]),
    ),
  });
}
function fixture(
  source: readonly BoundedRecord[],
  target: readonly BoundedRecord[],
  mutation?: (r: Response, name: string) => Response,
) {
  const calls: {
    name: string;
    headers: Headers;
    query: Record<string, unknown>;
    signal?: AbortSignal | null;
  }[] = [];
  const http: typeof fetch = vi.fn(async (_url, init) => {
    const query = JSON.parse(String(init?.body));
    const name = query.from.name;
    calls.push({
      name,
      headers: new Headers(init?.headers),
      query,
      signal: init?.signal,
    });
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
    });
    expect(new Headers(init?.headers).has('OVDB-Page-Size')).toBe(false);
    expect(query.orderBy).toBeUndefined();
    expect(query.limit).toBeLessThanOrEqual(1000);
    let records = name === 'Customer' ? source : target;
    if (query.where)
      records = records.filter((r) =>
        query.where.right.values.includes(r.data[query.where.left.field]),
      );
    const r = response(records.slice(query.offset, query.offset + query.limit));
    return mutation ? mutation(r, name) : r;
  });
  return { calls, http };
}
const budgets: BoundedRunBudget[] = [];
function session(b: BoundedFederation, http: typeof fetch) {
  const budget = new BoundedRunBudget(b.bytes, b.timeoutMs);
  budgets.push(budget);
  return {
    budget,
    transport: createImmutableFederationFetch(base, b, http, budget),
  };
}
async function localRead(
  t: ReturnType<typeof session>['transport'],
  database = 'geo',
  name = 'Countries',
) {
  return t.fetch(`${base}/v1/databases/${database}/dtql`, {
    method: 'POST',
    body: JSON.stringify({ from: { name } }),
  });
}
function definition(b = bounds()): IQueryDef {
  return {
    id: 'bounded-runtime',
    request: {
      queryType: QueryType.DTQL,
      text: JSON.stringify({
        from: {
          database: 'user',
          name: 'Customer',
          alias: 'u',
          joins: [
            {
              type: 'left',
              from: { database: 'geo', name: 'Countries', alias: 'p' },
              on: [
                {
                  left: { source: 'u', field: 'Country' },
                  op: '==',
                  right: { source: 'p', field: 'raw' },
                },
              ],
            },
          ],
        },
      }),
    },
    federation: {
      ovdbBaseUrl: base,
      bounds: b,
      tables: [
        { database: 'user', name: 'Customer', fields: ['Country', 'id'] },
        { database: 'geo', name: 'Countries', fields: ['raw', 'iso'] },
      ],
    },
  } as IQueryDef;
}
afterEach(() => {
  for (const b of budgets.splice(0)) b.close();
  vi.restoreAllMocks();
});
describe('configured immutable federation (synthetic transport, publication gate retained)', () => {
  it('is idle before action, uses one ordinary page per stage, and preserves raw transport keys and NULLs', async () => {
    const f = fixture(
      [
        row('escaped:key', { id: 'native-id', Country: ' USA' }),
        row('null', { Country: null }),
      ],
      [row('public:key', { raw: ' USA', iso: 'US' })],
    );
    const { transport } = session(bounds(), f.http);
    expect(f.calls).toEqual([]);
    await localRead(transport);
    expect(f.calls.map((c) => c.name)).toEqual(['Customer', 'Countries']);
    expect(f.calls[1].query.where).toEqual({
      left: { field: 'raw' },
      op: 'In',
      right: { values: [' USA'] },
    });
    expect(transport.receipt.sources.get('user.Customer')?.[0]).toEqual(
      row('escaped:key', { id: 'native-id', Country: ' USA' }),
    );
    expect(f.calls[0].headers.get('OVDB-Serving-SHA256')).toBeNull();
    expect(f.calls[0].headers.get('OVDB-Manifest-SHA256')).toBeNull();
    expect(Object.fromEntries(transport.receipt.runtime?.pins ?? [])).toEqual({
      user: pins,
      geo: pins,
    });
    await localRead(transport);
    expect(f.calls).toHaveLength(2);
  });
  it('serializes same-database first reads and sends all four captured pins for another collection', async () => {
    const b = bounds();
    const sources = [b.sources[0], { ...b.sources[1], database: 'user' }];
    const same = {
      ...b,
      sources,
      runtime: { ...b.runtime, databases: { user: initial } },
    };
    const f = fixture(
      [row('1', { Country: 'USA' })],
      [row('us', { raw: 'USA' })],
    );
    const { transport } = session(same, f.http);
    await Promise.all([
      localRead(transport, 'user', 'Customer'),
      localRead(transport, 'user', 'Countries'),
    ]);
    expect(f.calls).toHaveLength(2);
    for (const [name, header] of Object.entries(RUNTIME_PIN_HEADERS))
      expect(f.calls[1].headers.get(header)).toBe(
        pins[name as keyof CompleteRuntimeReadPins],
      );
  });
  it.each(
    Object.keys(RUNTIME_PIN_HEADERS) as (keyof CompleteRuntimeReadPins)[],
  )('rejects a changed %s pin before accepting rows', async (name) => {
    const b = {
      ...bounds(),
      runtime: {
        readProfile: 'bounded-immutable/1' as const,
        databases: { user: pins, geo: pins },
      },
    };
    const f = fixture([row('1', { Country: 'USA' })], [], (r) => {
      r.headers.set(
        RUNTIME_PIN_HEADERS[name],
        'e'.repeat(name === 'providerRevision' ? 40 : 64),
      );
      return r;
    });
    const { transport } = session(b, f.http);
    await expect(localRead(transport)).rejects.toThrow(/deployment changed/);
    expect(transport.receipt.sources.size).toBe(0);
    expect(f.calls).toHaveLength(1);
  });
  it('rejects an omitted response pin and half-pinned initial configuration', async () => {
    for (const header of Object.values(RUNTIME_PIN_HEADERS)) {
      const f = fixture([], [], (r) => {
        r.headers.delete(header);
        return r;
      });
      await expect(
        localRead(session(bounds(), f.http).transport),
      ).rejects.toThrow(/pins/);
    }
    for (const value of [
      { ...initial, servingSha256: pins.servingSha256 },
      { ...initial, manifestSha256: pins.manifestSha256 },
      { ...pins, sourceSha256: pins.sourceSha256.toUpperCase() },
      { ...pins, unknown: true },
    ])
      expect(() => validateRuntimePins(value)).toThrow();
    expect(() =>
      validateBounds({
        ...bounds(),
        runtime: {
          readProfile: 'bounded-immutable/1',
          databases: { user: initial },
        },
      }),
    ).toThrow(/Every/);
    expect(() =>
      validateBounds({
        ...bounds(),
        runtime: {
          ...bounds().runtime,
          readProfile: 'unknown',
        } as unknown as BoundedRuntime,
      }),
    ).toThrow(/closed/);
  });
  it('accepts a full page as possibly-more, never sends a sentinel or auto-drains, and marks undetermined matches', async () => {
    const f = fixture(
      [
        row('1', { Country: 'USA' }),
        row('2', { Country: 'Canada' }),
        row('3', { Country: null }),
        row('4', { Country: '' }),
      ],
      Array.from({ length: 1000 }, (_, i) => row(String(i), { raw: 'USA' })),
    );
    const { transport } = session(bounds(), f.http);
    await localRead(transport);
    expect(f.calls).toHaveLength(2);
    expect(transport.receipt.runtime?.pages.get('geo.Countries')).toMatchObject(
      { rows: 1000, possiblyMore: true },
    );
    const diagnostics = publicDataExceptions(
      bounds(),
      transport.receipt.sources,
      transport.receipt.runtime?.pages,
    );
    expect(diagnostics).toMatchObject({
      unresolved: 2,
      unmatched: 0,
      ambiguous: 0,
      multiplied: 0,
      null: 1,
      empty: 1,
      complete: false,
    });
    expect(diagnostics.details[1].status).toBe('unresolved due to truncation');
  });
  it('explicit continuation shares pins, cumulative bytes and original deadline; expired continuation performs no request', async () => {
    const f = fixture(
      [row('1', { Country: 'USA' })],
      [row('a', { raw: 'USA' }), row('b', { raw: 'USA' })],
    );
    const b = {
      ...bounds(),
      runtime: {
        ...bounds().runtime,
        pages: { 'geo.Countries': { limit: 1, offset: 0 } },
      },
    };
    const { transport, budget } = session(b, f.http);
    await localRead(transport);
    const bytes = budget.bytes;
    await transport.readPage('geo.Countries', { limit: 1, offset: 1 });
    expect(f.calls).toHaveLength(3);
    expect(budget.bytes).toBeGreaterThan(bytes);
    expect(f.calls[2].headers.get('OVDB-Manifest-SHA256')).toBe(
      pins.manifestSha256,
    );
    expect(transport.receipt.sources.get('geo.Countries')).toHaveLength(2);
    vi.spyOn(performance, 'now').mockReturnValue(
      budget.deadline - performance.timeOrigin + 1,
    );
    await expect(
      transport.readPage('geo.Countries', { limit: 1, offset: 2 }),
    ).rejects.toThrow(/deadline/);
    expect(f.calls).toHaveLength(3);
  });
  it('counts streamed failure bytes, aborts on cumulative exhaustion, and refuses redirects and snapshot responses', async () => {
    const b = { ...bounds(), bytes: 4 };
    const { transport, budget } = session(
      b,
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('12345'));
              c.close();
            },
          }),
          { status: 503 },
        ),
    );
    await expect(localRead(transport)).rejects.toThrow(/byte bound/);
    expect(budget.bytes).toBe(5);
    expect(budget.signal.aborted).toBe(true);
    for (const mutate of [
      (r: Response) => {
        Object.defineProperty(r, 'redirected', { value: true });
        return r;
      },
      () =>
        new Response(
          JSON.stringify({ records: [], snapshotToken: 'forbidden' }),
          { headers: response([]).headers },
        ),
    ]) {
      const f = fixture([], [], mutate);
      await expect(
        localRead(session(bounds(), f.http).transport),
      ).rejects.toThrow(/redirect|snapshot/);
    }
  });
  it('enforces separate exact network and materialized output boundaries', () => {
    const budget = new BoundedRunBudget(5242880, 10000);
    budgets.push(budget);
    budget.consumeNetwork(5242880);
    expect(budget.bytes).toBe(5242880);
    budget.consumeOutput('x'.repeat(5242878));
    budget.beginOutput();
    budget.consumeOutput('x'.repeat(5242878));
    expect(budget.bytes).toBe(5242880);
    expect(() => budget.consumeOutput('')).toThrow(/materialized/);
    expect(() => budget.consumeNetwork(1)).toThrow();
  });
  it('cancels an active streaming response and prevents every later stage', async () => {
    const f = vi.fn(async () => response([row('1', { Country: 'USA' })]));
    const { transport, budget } = session(bounds(), f);
    budget.controller.abort(new Error('user cancelled'));
    await expect(localRead(transport)).rejects.toThrow(/cancelled/);
    expect(f).not.toHaveBeenCalled();
  });
  it('executes through the supported installed DALgo path and keeps raw NULL/empty/unmatched/multiplied diagnostics and pins', async () => {
    const f = fixture(
      [
        row('1', { Country: 'USA' }),
        row('2', { Country: null }),
        row('3', { Country: '' }),
        row('4', { Country: 'usa' }),
      ],
      [
        row('us1', { raw: 'USA', iso: 'US' }),
        row('us2', { raw: 'USA', iso: 'US' }),
      ],
    );
    const result = await runFederatedQuery(
      definition(),
      undefined,
      '',
      undefined,
      undefined,
      'full',
      undefined,
      undefined,
      { fetch: f.http },
    );
    expect(result.recordset.rows).toHaveLength(5);
    expect(result.publicDataExceptions).toMatchObject({
      denominator: 4,
      null: 1,
      empty: 1,
      unmatched: 1,
      ambiguous: 1,
      multiplied: 1,
      complete: true,
    });
    expect(result.runtimeRead?.pins).toEqual({ user: pins, geo: pins });
    expect(f.calls).toHaveLength(2);
  });
  it('binds saved runtime pins in the existing definition and retains unconditional production closure even with forged eligibility', async () => {
    const d = definition();
    d.publicData = { eligible: true } as IQueryDef['publicData'];
    const f = vi.fn();
    await expect(
      runFederatedQuery(
        d,
        undefined,
        '',
        undefined,
        undefined,
        'full',
        undefined,
        undefined,
        { fetch: f },
      ),
    ).rejects.toThrow(/publication/);
    expect(f).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify(d)).federation.bounds.runtime).toEqual(
      d.federation?.bounds?.runtime,
    );
  });
  it('uses the exact landed ROR user contract and decision pins without inventing an identifier field', () => {
    const contract = JSON.parse(
      readFileSync(
        'libs/datatug/main/src/lib/queries/fixtures/public-data-fabric/native/ror/contract.json',
        'utf8',
      ),
    ).contracts[0];
    expect(contract.source).toMatchObject({
      entity: 'Affiliation',
      property: 'ror_id',
      namespace: 'ROR:URL',
      schema: {
        sha256:
          'cfe958f12d9a70bb7533499b76bf01c9447f81f0862852e460b095bb75e1b9cf',
      },
    });
    expect(contract.decision.document.sha256).toBe(
      'a4caa4b6461230a3fa2ae8548121344cb286cfb98a9e19761a207c9f74479595',
    );
    expect(contract.native.dataset.sha256).toBe(
      'afdf978130ee9899fedb698f0e9d18399efdea40ea92f01f26d6055ef1ed5d38',
    );
    expect(monotonicTime()).toBeGreaterThan(0);
  });
});

describe('explicit immutable save and hostile transport boundaries', () => {
  it('keeps observation time descriptive while binding every executed query and bound', () => {
    const d = definition();
    const observed = {
      ...d,
      publicData: { observedAt: 'earlier', model: { sha256: 'old' } },
    } as unknown as IQueryDef;
    const refreshed = {
      ...observed,
      publicData: { ...observed.publicData, observedAt: 'later' },
    } as IQueryDef;
    expect(runtimePlanIdentity(refreshed)).toBe(runtimePlanIdentity(observed));
    expect(
      runtimePlanIdentity({
        ...refreshed,
        publicData: { ...refreshed.publicData, model: { sha256: 'changed' } },
      } as unknown as IQueryDef),
    ).not.toBe(runtimePlanIdentity(observed));
    expect(
      runtimePlanIdentity({
        ...d,
        federation: {
          ...d.federation,
          bounds: { ...d.federation?.bounds, userRows: 1 },
        },
      } as IQueryDef),
    ).not.toBe(runtimePlanIdentity(d));
  });
  it('saves all four pins only after the exact executed plan and rejects changed bounds/query/manifest', async () => {
    const d = definition();
    const f = fixture([], []);
    const result = await runFederatedQuery(
      d,
      undefined,
      '',
      undefined,
      undefined,
      'full',
      undefined,
      undefined,
      { fetch: f.http },
    );
    // Empty driver skips the dependent source; partial pin coverage cannot be saved.
    expect(() => saveRuntimePins(d, d, result)).toThrow(/every declared/);
    const receipt = {
      ...result,
      runtimeRead: { pins: { user: pins, geo: pins }, pages: {} },
    };
    const saved = saveRuntimePins(d, d, receipt);
    expect(saved.federation?.bounds?.runtime?.databases).toEqual({
      user: pins,
      geo: pins,
    });
    expect(d.federation?.bounds?.runtime?.databases.user).toEqual(initial);
    const changed = {
      ...d,
      request: { ...d.request, text: '{}' },
    } as IQueryDef;
    expect(() => saveRuntimePins(changed, d, receipt)).toThrow(/plan changed/);
    const stale = {
      ...receipt,
      runtimeRead: {
        pins: {
          user: { ...pins, providerRevision: 'e'.repeat(40) },
          geo: pins,
        },
        pages: {},
      },
    };
    expect(() => saveRuntimePins(d, d, stale)).toThrow(/pins changed/);
  });
  it('refuses undeclared routes, hostile qualified paths, malformed raw rows and invalid ordinary limits before fetch', async () => {
    const f = fixture([], []);
    const { transport } = session(bounds(), f.http);
    for (const url of [
      `${base}/v1/databases/geo/records/Countries/key`,
      `${base}/v1/databases/geo%2F..%2Fother/dtql`,
      `https://evil.example/v1/databases/geo/dtql`,
    ])
      await expect(
        transport.fetch(url, {
          method: 'POST',
          body: '{"from":{"name":"Countries"}}',
        }),
      ).rejects.toThrow(/declared|bounded/);
    expect(f.calls).toHaveLength(0);
    for (const limit of [0, 1001, 1.5])
      expect(() =>
        validateBounds({
          ...bounds(),
          runtime: {
            ...bounds().runtime,
            pages: { 'geo.Countries': { limit, offset: 0 } },
          },
        }),
      ).toThrow(/ordinary page/);
    const malformed = fixture(
      [],
      [],
      (r) =>
        new Response('{"records":[{"key":"bad","data":null}]}', {
          headers: r.headers,
        }),
    );
    await expect(
      localRead(session(bounds(), malformed.http).transport),
    ).rejects.toThrow(/malformed/);
  });
  it('refuses a tiny final result that masks an intermediate join expansion above 5000 rows', async () => {
    const d = definition();
    d.request = {
      queryType: QueryType.DTQL,
      text: JSON.stringify({
        from: {
          database: 'user',
          name: 'Customer',
          alias: 'u',
          joins: [
            {
              type: 'left',
              from: { database: 'geo', name: 'Countries', alias: 'p' },
              on: [
                {
                  left: { source: 'u', field: 'Country' },
                  op: '==',
                  right: { source: 'p', field: 'raw' },
                },
              ],
            },
          ],
        },
        limit: 1,
      }),
    } as IQueryDef['request'];
    const f = fixture(
      Array.from({ length: 100 }, (_, i) => row(`u${i}`, { Country: 'USA' })),
      Array.from({ length: 51 }, (_, i) => row(`p${i}`, { raw: 'USA' })),
    );
    await expect(
      runFederatedQuery(
        d,
        undefined,
        '',
        undefined,
        undefined,
        'full',
        undefined,
        undefined,
        { fetch: f.http },
      ),
    ).rejects.toThrow(/row bound/);
  });
  it('cancels a pending body reader with the shared run signal', async () => {
    const cancelled = vi.fn();
    const headers = response([]).headers;
    const http: typeof fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('{'));
            },
            cancel: cancelled,
          }),
          { headers },
        ),
    );
    const { transport, budget } = session(bounds(), http);
    const promise = localRead(transport);
    const assertion = expect(promise).rejects.toThrow(/user cancellation/);
    await vi.waitFor(() => expect(http).toHaveBeenCalledOnce());
    budget.controller.abort(new Error('user cancellation'));
    await assertion;
    expect(cancelled).toHaveBeenCalled();
  });
});

describe('approved page and identifier bounds', () => {
  it('accepts exactly 1000 users and 100 place identifiers but refuses 101 before a target request', async () => {
    for (const count of [100, 101]) {
      const f = fixture(
        Array.from({ length: 1000 }, (_, i) =>
          row(String(i), { Country: String(i % count) }),
        ),
        [],
      );
      const { transport } = session(bounds(), f.http);
      if (count === 100) {
        await localRead(transport);
        expect(transport.receipt.sources.get('user.Customer')).toHaveLength(
          1000,
        );
        expect(f.calls).toHaveLength(2);
      } else {
        await expect(localRead(transport)).rejects.toThrow(/identifier bound/);
        expect(f.calls).toHaveLength(1);
      }
    }
  });
  it('uses reviewed ROR URL syntax, caps exact references at 50 and retains invalid input diagnostics', async () => {
    const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
    const ror = (n: number) => {
      let rest = n;
      let token = '';
      for (let i = 0; i < 7; i++) {
        token = alphabet[rest % 32] + token;
        rest = Math.floor(rest / 32);
      }
      return `https://ror.org/${token}${String(98 - ((n * 100) % 97)).padStart(2, '0')}`;
    };
    const b = {
      ...bounds(),
      identifierKind: 'ror' as const,
      nativeNamespace: 'ROR:URL' as const,
      identifierLimit: 50,
    };
    for (const count of [50, 51]) {
      const f = fixture(
        Array.from({ length: count }, (_, i) =>
          row(String(i), { Country: ror(i) }),
        ),
        [],
      );
      const { transport } = session(b, f.http);
      if (count === 50) {
        await localRead(transport);
        expect(f.calls).toHaveLength(2);
      } else {
        await expect(localRead(transport)).rejects.toThrow(/identifier bound/);
        expect(f.calls).toHaveLength(1);
      }
    }
    const f = fixture(
      [
        row('1', { Country: 'https://ror.org/000025p05' }),
        row('2', { Country: ' https://ror.org/000025p04' }),
        row('3', { Country: 'https://ror.org/000000098' }),
      ],
      [],
    );
    const { transport } = session(b, f.http);
    await localRead(transport);
    expect(
      publicDataExceptions(
        b,
        transport.receipt.sources,
        transport.receipt.runtime?.pages,
      ),
    ).toMatchObject({ invalid: 2, unmatched: 1 });
  });
  it('caps explicit continuation at a cumulative 5000 intermediate rows with no sentinel or extra fetch', async () => {
    const b = bounds();
    const f = fixture(
      [row('u', { Country: 'USA' })],
      Array.from({ length: 5000 }, (_, i) => row(String(i), { raw: 'USA' })),
    );
    const { transport } = session(b, f.http);
    await localRead(transport);
    for (const offset of [1000, 2000, 3000, 4000])
      await transport.readPage('geo.Countries', { limit: 1000, offset });
    expect(transport.receipt.sources.get('geo.Countries')).toHaveLength(4999);
    // Driver and public intermediate inputs share the same 5000-row ceiling.
    await expect(
      transport.readPage('geo.Countries', { limit: 1, offset: 4999 }),
    ).rejects.toThrow(/intermediate-row/);
    expect(f.calls).toHaveLength(6);
  });
});

describe('partial coverage proof', () => {
  it('does not label a short page after a skipped offset as complete', async () => {
    const b = {
      ...bounds(),
      runtime: {
        ...bounds().runtime,
        pages: { 'geo.Countries': { limit: 2, offset: 1 } },
      },
    };
    const f = fixture(
      [row('u', { Country: 'USA' })],
      [row('first', { raw: 'USA' }), row('second', { raw: 'USA' })],
    );
    const { transport } = session(b, f.http);
    await localRead(transport);
    expect(transport.receipt.runtime?.pages.get('geo.Countries')).toMatchObject(
      { possiblyMore: false, complete: false },
    );
    expect(
      publicDataExceptions(
        b,
        transport.receipt.sources,
        transport.receipt.runtime?.pages,
      ),
    ).toMatchObject({ unresolved: 1, unmatched: 0, complete: false });
  });
});

describe('independent r1 bound admission regressions', () => {
  it('does not start another network request when decoded bytes exactly exhaust the shared budget', async () => {
    const source = [row('u', { Country: 'USA' })];
    const f = fixture(source, [row('t', { raw: 'USA' })]);
    const b = {
      ...bounds(),
      bytes: new TextEncoder().encode(JSON.stringify({ records: source }))
        .byteLength,
    };
    const { transport } = session(b, f.http);
    await expect(localRead(transport)).rejects.toThrow(/byte bound/);
    expect(f.calls).toHaveLength(1);
  });
  it('honors a configured place identifier cap below the absolute 100 ceiling', async () => {
    const f = fixture(
      [row('a', { Country: 'USA' }), row('b', { Country: 'Canada' })],
      [],
    );
    const { transport } = session({ ...bounds(), identifierLimit: 1 }, f.http);
    await expect(localRead(transport)).rejects.toThrow(/identifier bound/);
    expect(f.calls).toHaveLength(1);
  });
});

describe('repaired network and chosen identifier admission boundaries', () => {
  it('rejects a response one decoded byte over the cap without dispatching its dependent', async () => {
    const source = [row('u', { Country: 'USA' })];
    const f = fixture(source, []);
    const b = {
      ...bounds(),
      bytes:
        new TextEncoder().encode(JSON.stringify({ records: source }))
          .byteLength - 1,
    };
    const { transport, budget } = session(b, f.http);
    await expect(localRead(transport)).rejects.toThrow(/byte bound/);
    expect(f.calls).toHaveLength(1);
    expect(budget.bytes).toBe(b.bytes + 1);
    expect(budget.signal.aborted).toBe(true);
  });
  it('accepts the exact-cap response and cached local reads but refuses continuation before dispatch', async () => {
    const source = [row('u', { Country: 'USA' })];
    const f = fixture(source, []);
    const b = {
      ...bounds(),
      bytes: new TextEncoder().encode(JSON.stringify({ records: source }))
        .byteLength,
    };
    const { transport, budget } = session(b, f.http);
    expect(
      await (await localRead(transport, 'user', 'Customer')).json(),
    ).toEqual({ records: source });
    expect(budget.bytes).toBe(b.bytes);
    expect(budget.signal.aborted).toBe(false);
    await expect(
      transport.readPage('user.Customer', { limit: 1, offset: 1 }),
    ).rejects.toThrow(/byte bound/);
    expect(f.calls).toHaveLength(1);
    expect(
      await (await localRead(transport, 'user', 'Customer')).json(),
    ).toEqual({ records: source });
    expect(budget.signal.aborted).toBe(false);
  });

  async function jsonDriverBounds(text: string): Promise<BoundedFederation> {
    const b = bounds();
    return {
      ...b,
      bytes: new TextEncoder().encode(text).byteLength,
      driver: {
        kind: 'https-json',
        database: 'user',
        name: 'Customer',
        key: 'id',
        selected: 'Country',
        data: {
          repository: 'https://github.com/datatug/datatug-apps',
          revision: 'e7362033ec79c6663d7dbe0483b62fab01f7b9cd',
          path: 'source/fixture.json',
          sha256: await sha256(text),
        },
        fields: [
          { name: 'id', property: 'id', datatype: 'string', nullable: false },
          {
            name: 'Country',
            property: 'Country',
            datatype: 'string',
            nullable: false,
          },
        ],
      },
      runtime: { ...b.runtime, databases: { geo: initial } },
    };
  }
  it('guards the actual JSON-driver fetch before dispatch when the shared counter is already exhausted', async () => {
    const text = JSON.stringify([{ id: 'u', Country: 'USA' }]);
    const http = vi.fn(async () => new Response(text));
    const { transport, budget } = session(await jsonDriverBounds(text), http);
    budget.consumeNetwork(budget.maximumBytes);
    await expect(localRead(transport, 'user', 'Customer')).rejects.toThrow(
      /byte bound/,
    );
    expect(http).not.toHaveBeenCalled();
    expect(budget.signal.aborted).toBe(false);
  });
  it('retains the authenticated exact-cap JSON driver while refusing its dependent request', async () => {
    const text = JSON.stringify([{ id: 'u', Country: 'USA' }]);
    const http = vi.fn(async () => new Response(text));
    const { transport, budget } = session(await jsonDriverBounds(text), http);
    await expect(localRead(transport)).rejects.toThrow(/byte bound/);
    expect(http).toHaveBeenCalledOnce();
    expect(budget.bytes).toBe(budget.maximumBytes);
    expect(
      await (await localRead(transport, 'user', 'Customer')).json(),
    ).toEqual({ records: [row('u', { id: 'u', Country: 'USA' })] });
  });
  it('accepts the exact chosen initial place cap, including repeated raw keys', async () => {
    const f = fixture(
      [row('a', { Country: 'USA' }), row('b', { Country: 'USA' })],
      [row('t', { raw: 'USA' })],
    );
    const { transport } = session({ ...bounds(), identifierLimit: 1 }, f.http);
    await localRead(transport);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1].query).toMatchObject({
      where: { right: { values: ['USA'] } },
    });
  });
  it.each([100, 101])(
    'keeps the later-stage absolute place cap at 100 for %i keys',
    async (count) => {
      const b = bounds();
      const configured = {
        ...b,
        identifierLimit: 1,
        sources: [
          ...b.sources,
          {
            database: 'geo',
            name: 'Places',
            keyField: 'id',
            parent: { database: 'geo', name: 'Countries', field: 'place' },
          },
        ],
      };
      const calls: string[] = [];
      const http: typeof fetch = vi.fn(async (_url, init) => {
        const query = JSON.parse(String(init?.body));
        calls.push(query.from.name);
        if (query.from.name === 'Customer')
          return response([row('u', { Country: 'USA' })]);
        if (query.from.name === 'Countries')
          return response(
            Array.from({ length: count }, (_, i) =>
              row(`c${i}`, { raw: 'USA', place: `p${i}` }),
            ),
          );
        expect(query.where.right.values).toHaveLength(100);
        return response([]);
      });
      const { transport } = session(configured, http);
      if (count === 100) {
        await localRead(transport, 'geo', 'Places');
        expect(calls).toEqual(['Customer', 'Countries', 'Places']);
      } else {
        await expect(localRead(transport, 'geo', 'Places')).rejects.toThrow(
          /identifier bound/,
        );
        expect(calls).toEqual(['Customer', 'Countries']);
      }
    },
  );
});
