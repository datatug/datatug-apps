import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { parseDTQL } from '@dalgo/core';
import { QueryType, type IQueryDef } from '../../models/definition/query-def';
import { runFederatedQuery } from '../federated-query-executor';
import {
  createBoundedFederationFetch,
  validateBounds,
  boundedResponseText,
  type BoundedFederation,
  type BoundedRecord,
} from './bounded-federation';
import {
  publicDataExceptions,
  validNativeRorUrl,
} from './public-data-scenario';

const base = 'https://demodb.dev/ovdb';
export const fixtureBounds = (): BoundedFederation => ({
  userRows: 1000,
  userOffset: 0,
  identifierKind: 'place',
  identifierLimit: 100,
  resultRows: 5000,
  bytes: 5 * 1024 * 1024,
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
});
const row = (key: string, data: Record<string, unknown>): BoundedRecord => ({
  key,
  data,
});
const validButHypotheticalRor = (value: number): string => {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  let rest = value;
  let token = '';
  for (let i = 0; i < 7; i++) {
    token = alphabet[rest % 32] + token;
    rest = Math.floor(rest / 32);
  }
  return `https://ror.org/${token}${String(98 - ((value * 100) % 97)).padStart(2, '0')}`;
};
const response = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
function serve(
  source: readonly BoundedRecord[],
  references: readonly BoundedRecord[],
  ignoreFilter = false,
) {
  const calls: {
    name: string;
    where?: {
      left: { field: string };
      right: { values: string[] };
      op: string;
    };
    limit: number;
    offset?: number;
    close: boolean;
  }[] = [];
  const http: typeof fetch = vi.fn(async (_input, init) => {
    expect(init?.redirect).toBe('error');
    const query = JSON.parse(String(init?.body)) as {
      from: { name: string };
      where?: {
        left: { field: string };
        right: { values: string[] };
        op: string;
      };
      limit: number;
      offset?: number;
    };
    const headers = new Headers(init?.headers);
    const close = headers.get('OVDB-Page-Close') === 'true';
    calls.push({
      name: query.from.name,
      where: query.where,
      limit: query.limit,
      offset: query.offset,
      close,
    });
    if (close) return new Response(null, { status: 204 });
    let rows = query.from.name === 'Customer' ? [...source] : [...references];
    if (query.where && !ignoreFilter)
      rows = rows.filter((row) =>
        query.where?.right.values.includes(
          String(row.data[query.where.left.field]),
        ),
      );
    rows = rows.slice(query.offset ?? 0, (query.offset ?? 0) + query.limit);
    const start = Number(headers.get('OVDB-Page-Token') ?? 0);
    const end = Math.min(
      start + Number(headers.get('OVDB-Page-Size')),
      rows.length,
    );
    return response({
      records: rows.slice(start, end),
      snapshotToken: `snapshot-${query.from.name}`,
      ...(end < rows.length ? { nextPageToken: String(end) } : {}),
    });
  });
  return { http, calls };
}
function definition(bounds = fixtureBounds()): IQueryDef {
  return {
    id: 'bounded',
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
      bounds,
      tables: [
        { database: 'user', name: 'Customer', fields: ['Country', 'id'] },
        { database: 'geo', name: 'Countries', fields: ['raw', 'iso'] },
      ],
    },
  } as IQueryDef;
}

describe('bounded public-data federation preparation (fixture requests, not deployed acceptance)', () => {
  it('uses the installed DALgo In dialect and retains byte-exact literals', () => {
    const query = parseDTQL(
      {
        from: { name: 'Countries' },
        where: {
          left: { field: 'raw' },
          op: 'In',
          right: { values: [' USA', 'USA', 'usa'] },
        },
        limit: 5000,
      },
      { tables: [{ name: 'Countries', fields: ['raw'] }] },
      { maxLimit: 5000 },
    );
    expect(query.filters).toHaveLength(1);
    expect(() =>
      parseDTQL(
        {
          from: { name: 'Countries' },
          where: {
            left: { field: 'wrong' },
            op: 'In',
            right: { values: ['USA'] },
          },
        },
        { tables: [{ name: 'Countries', fields: ['raw'] }] },
      ),
    ).toThrow();
  });
  it('does no network work before action, loads the driver first even when DALgo asks for the reference first, and filters native keys', async () => {
    const runtime = serve(
      [
        row('1', { Country: 'USA' }),
        row('2', { Country: ' USA' }),
        row('3', { Country: null }),
        row('4', { Country: '' }),
      ],
      [
        row('us', { raw: 'USA', iso: 'US' }),
        row('ca', { raw: 'Canada', iso: 'CA' }),
      ],
    );
    const transport = createBoundedFederationFetch(
      base,
      fixtureBounds(),
      runtime.http,
      new AbortController().signal,
    );
    expect(runtime.calls).toEqual([]);
    const page = await transport.fetch(`${base}/v1/databases/geo/dtql`, {
      method: 'POST',
      body: JSON.stringify({ from: { name: 'Countries' } }),
      headers: { 'OVDB-Page-Size': '100' },
    });
    expect((await page.json()).records).toHaveLength(1);
    expect(
      runtime.calls.filter((call) => !call.close).map((call) => call.name),
    ).toEqual(['Customer', 'Countries']);
    expect(
      runtime.calls.find((call) => call.name === 'Countries')?.where?.right
        .values,
    ).toEqual(['USA', ' USA']);
    expect(runtime.calls.filter((call) => call.close)).toHaveLength(2);
  });
  it('executes actual installed browser DALgo against bounded fixture pages and keeps NULL/empty/unmatched denominators', async () => {
    const runtime = serve(
      [
        row('1', { id: '1', Country: 'USA' }),
        row('2', { id: '2', Country: null }),
        row('3', { id: '3', Country: '' }),
        row('4', { id: '4', Country: 'usa' }),
      ],
      [row('us', { raw: 'USA', iso: 'US' })],
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
      { fetch: runtime.http },
    );
    expect(result.recordset.rows).toHaveLength(4);
    expect(result.publicDataExceptions).toMatchObject({
      denominator: 4,
      nonNull: 3,
      null: 1,
      empty: 1,
      unmatched: 1,
      matched: 1,
    });
    expect(result.publicDataExceptions?.details[3]).toMatchObject({
      raw: 'usa',
      status: 'unmatched',
    });
    expect(result.publicDataBytes).toBeGreaterThan(0);
  });
  it('rejects a runtime that ignores the native key filter and never falls back to a static scan', async () => {
    const runtime = serve(
      [row('1', { Country: 'USA' })],
      [row('ca', { raw: 'Canada' })],
      true,
    );
    await expect(
      runFederatedQuery(
        definition(),
        undefined,
        '',
        undefined,
        undefined,
        'full',
        undefined,
        undefined,
        { fetch: runtime.http },
      ),
    ).rejects.toThrow(/did not enforce/);
    expect(runtime.calls.filter((call) => !call.close)).toHaveLength(2);
  });
  it('accepts the exact 1000-row/100-key boundary and rejects 101 distinct place or 51 ROR IDs', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) =>
      row(String(i), { Country: String(i % 100) }),
    );
    const runtime = serve(rows, []);
    await runFederatedQuery(
      definition(),
      undefined,
      '',
      undefined,
      undefined,
      'full',
      undefined,
      undefined,
      { fetch: runtime.http },
    );
    expect(
      runtime.calls.filter((call) => call.name === 'Customer' && !call.close),
    ).toHaveLength(10);
    for (const [count, kind, cap] of [
      [101, 'place', 100],
      [51, 'ror', 50],
    ] as const) {
      const tooMany = serve(
        Array.from({ length: count }, (_, i) =>
          row(String(i), {
            Country: kind === 'ror' ? validButHypotheticalRor(i) : String(i),
          }),
        ),
        [],
      );
      await expect(
        runFederatedQuery(
          definition({
            ...fixtureBounds(),
            identifierKind: kind,
            ...(kind === 'ror' ? { nativeNamespace: 'ROR:URL' as const } : {}),
            identifierLimit: cap,
          }),
          undefined,
          '',
          undefined,
          undefined,
          'full',
          undefined,
          undefined,
          { fetch: tooMany.http },
        ),
      ).rejects.toThrow(/identifier bound/);
      expect(tooMany.calls.some((call) => call.name === 'Countries')).toBe(
        false,
      );
    }
    expect(() =>
      validateBounds({ ...fixtureBounds(), userRows: 1001 }),
    ).toThrow(/user rows/);
    expect(() =>
      validateBounds({ ...fixtureBounds(), resultRows: 5001 }),
    ).toThrow(/results/);
    expect(() =>
      validateBounds({ ...fixtureBounds(), bytes: 5 * 1024 * 1024 + 1 }),
    ).toThrow(/bytes/);
    expect(() =>
      validateBounds({ ...fixtureBounds(), timeoutMs: 10001 }),
    ).toThrow(/deadline/);
    const branched = fixtureBounds();
    expect(() =>
      validateBounds({
        ...branched,
        sources: [
          ...branched.sources,
          {
            database: 'geo',
            name: 'Branches',
            keyField: 'raw',
            parent: { database: 'user', name: 'Customer', field: 'Country' },
          },
        ],
      }),
    ).toThrow(/immediately preceding/);
  });
  it('enforces cumulative bytes, redirect refusal, cancellation and snapshot expiry', async () => {
    const runtime = serve(
      [row('1', { Country: 'USA' })],
      [row('us', { raw: 'USA' })],
    );
    await expect(
      runFederatedQuery(
        definition({ ...fixtureBounds(), bytes: 80 }),
        undefined,
        '',
        undefined,
        undefined,
        'full',
        undefined,
        undefined,
        { fetch: runtime.http },
      ),
    ).rejects.toThrow(/byte bound/);
    const redirected = response({ records: [] });
    Object.defineProperty(redirected, 'redirected', { value: true });
    await expect(boundedResponseText(redirected, 1000)).rejects.toThrow(
      /redirect/,
    );
    const aborted = new AbortController();
    aborted.abort(new Error('cancelled by user'));
    await expect(
      runFederatedQuery(
        definition(),
        undefined,
        '',
        undefined,
        aborted.signal,
        'full',
        undefined,
        undefined,
        { fetch: runtime.http },
      ),
    ).rejects.toThrow(/cancelled/);
    await expect(
      runFederatedQuery(
        definition(),
        undefined,
        '',
        undefined,
        undefined,
        'full',
        undefined,
        undefined,
        { fetch: async () => new Response('{}', { status: 410 }) },
      ),
    ).rejects.toThrow(/expired/);
    expect(() =>
      createBoundedFederationFetch(
        'https://unexpected.example',
        fixtureBounds(),
        runtime.http,
        new AbortController().signal,
      ),
    ).toThrow(/allowlist/);
  });
  it('distinguishes ambiguous and multiplied source matches from NULL/empty/missing, and counts repeated ROR affiliations once each', () => {
    const bounds = fixtureBounds();
    const sources = new Map([
      [
        'user.Customer',
        [
          row('n', { Country: null }),
          row('e', { Country: '' }),
          row('u', { Country: 'Unknown' }),
          row('a', { Country: 'USA' }),
        ],
      ],
      ['geo.Countries', [row('1', { raw: 'USA' }), row('2', { raw: 'USA' })]],
    ]);
    expect(publicDataExceptions(bounds, sources)).toMatchObject({
      denominator: 4,
      null: 1,
      empty: 1,
      unmatched: 1,
      ambiguous: 1,
      multiplied: 1,
    });
    const native = 'https://ror.org/000025p04';
    expect(
      publicDataExceptions(
        { ...bounds, identifierKind: 'ror', identifierLimit: 50 },
        new Map([
          [
            'user.Customer',
            [row('a1', { Country: native }), row('a3', { Country: native })],
          ],
          [
            'geo.Countries',
            [
              row(native, {
                raw: native,
                locations: [{ ordinal: 0 }, { ordinal: 1 }],
              }),
            ],
          ],
        ]),
      ),
    ).toMatchObject({ denominator: 2, matched: 2, multiplied: 0 });
  });
  it('checks exact native ROR representation and checksum without confusing valid-but-absent membership or withdrawn status', () => {
    for (const value of [
      'https://ror.org/000025p04',
      'https://ror.org/000000098',
      'https://ror.org/0006jh821',
    ])
      expect(validNativeRorUrl(value)).toBe(true);
    for (const value of [
      'https://ror.org/000025p05',
      'https://ror.org/100000096',
      ' https://ror.org/000025p04',
      'https://ROR.org/000025p04',
      '000025p04',
    ])
      expect(validNativeRorUrl(value)).toBe(false);
    const bounds = {
      ...fixtureBounds(),
      identifierKind: 'ror' as const,
      identifierLimit: 50,
    };
    const result = publicDataExceptions(
      bounds,
      new Map([
        [
          'user.Customer',
          [
            row('absent', { Country: 'https://ror.org/000000098' }),
            row('withdrawn', { Country: 'https://ror.org/0006jh821' }),
          ],
        ],
        [
          'geo.Countries',
          [row('w', { raw: 'https://ror.org/0006jh821', status: 'withdrawn' })],
        ],
      ]),
    );
    expect(result).toMatchObject({ unmatched: 1, matched: 1, invalid: 0 });
    expect(result.details[1].targetStatus).toBe('withdrawn');
  });
  it('never requests malformed ROR values, retains them as invalid and queries checksum-valid absent references separately', async () => {
    const runtime = serve(
      [
        row('1', { Country: 'https://ror.org/000025p04' }),
        row('2', { Country: ' https://ror.org/000025p04' }),
        row('3', { Country: 'https://ror.org/000025p05' }),
        row('4', { Country: 'https://ror.org/000000098' }),
      ],
      [row('active', { raw: 'https://ror.org/000025p04', status: 'active' })],
    );
    const result = await runFederatedQuery(
      definition({
        ...fixtureBounds(),
        identifierKind: 'ror',
        nativeNamespace: 'ROR:URL',
        identifierLimit: 50,
      }),
      undefined,
      '',
      undefined,
      undefined,
      'full',
      undefined,
      undefined,
      { fetch: runtime.http },
    );
    expect(
      runtime.calls.find((call) => call.name === 'Countries' && !call.close)
        ?.where?.right.values,
    ).toEqual(['https://ror.org/000025p04', 'https://ror.org/000000098']);
    expect(result.publicDataExceptions).toMatchObject({
      denominator: 4,
      matched: 1,
      invalid: 2,
      unmatched: 1,
    });
    expect(result.publicDataExceptions?.details[1].raw).toBe(
      ' https://ror.org/000025p04',
    );
    expect(() =>
      validateBounds({ ...fixtureBounds(), identifierKind: 'ror' }),
    ).toThrow(/explicit reviewed/);
  });
  it('rejects a checksum-valid nonzero ROR prefix before any target request, while querying the valid absent control', async () => {
    const malformed = 'https://ror.org/100000096';
    const absent = 'https://ror.org/000000098';
    for (const raw of [malformed, absent]) {
      const runtime = serve([row('1', { Country: raw })], []);
      const result = await runFederatedQuery(
        definition({
          ...fixtureBounds(),
          identifierKind: 'ror',
          nativeNamespace: 'ROR:URL',
          identifierLimit: 50,
        }),
        undefined,
        '',
        undefined,
        undefined,
        'full',
        undefined,
        undefined,
        { fetch: runtime.http },
      );
      const targetCalls = runtime.calls.filter(
        (call) => call.name === 'Countries' && !call.close,
      );
      expect(result.publicDataExceptions?.details[0].raw).toBe(raw);
      if (raw === malformed) {
        expect(targetCalls).toEqual([]);
        expect(result.publicDataExceptions).toMatchObject({
          denominator: 1,
          invalid: 1,
          unmatched: 0,
        });
      } else {
        expect(targetCalls[0].where?.right.values).toEqual([absent]);
        expect(result.publicDataExceptions).toMatchObject({
          denominator: 1,
          invalid: 0,
          unmatched: 1,
        });
      }
    }
  });
  it('refuses duplicate raw response properties before they erase source identity', async () => {
    await expect(
      runFederatedQuery(
        definition(),
        undefined,
        '',
        undefined,
        undefined,
        'full',
        undefined,
        undefined,
        {
          fetch: async () =>
            new Response(
              '{"records":[{"key":"1","data":{"Country":"USA","Country":"Canada"}}]}',
            ),
        },
      ),
    ).rejects.toThrow(/Duplicate/);
  });
});
