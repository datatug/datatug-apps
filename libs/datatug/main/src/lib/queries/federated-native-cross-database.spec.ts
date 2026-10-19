import { describe, expect, it, vi } from 'vitest';
import {
  QueryType,
  type IQueryDef,
  type ITextQueryRequest,
} from '../models/definition/query-def';
import { runFederatedQuery } from './federated-query-executor';

vi.mock('@dalgo/indexeddb', () => ({
  IndexedDbDatabase: class {
    constructor() {
      throw new Error('Unexpected browser source scan');
    }
  },
}));

const base = 'https://cloud.openvaultdb.com';
const definition: IQueryDef = {
  id: 'comparison',
  title: 'Customer records by shared country',
  request: {
    queryType: QueryType.DTQL,
    text: `from:
  database: northwind
  name: Customers
  alias: n
  joins:
    - from: {database: chinook, name: Customer, alias: c}
      on: [{left: {field: Country, source: n}, op: '==', right: {field: Country, source: c}}]
groupBy: [{field: Country, source: n}]
columns:
  - {field: Country, source: n, as: country}
  - {aggregate: {function: count, distinct: true, args: [{field: CustomerID, source: n}]}, as: northwindCustomers}
  - {aggregate: {function: count, distinct: true, args: [{field: CustomerId, source: c}]}, as: chinookCustomers}
orderBy: [{field: Country, source: n}]
limit: 100
`,
  } as ITextQueryRequest,
  federation: {
    ovdbBaseUrl: base,
    tables: [
      {
        database: 'northwind',
        name: 'Customers',
        fields: ['Country', 'CustomerID'],
      },
      {
        database: 'chinook',
        name: 'Customer',
        fields: ['Country', 'CustomerId'],
      },
    ],
  },
  recordsets: [
    {
      name: 'comparison',
      columns: [
        { name: 'country', type: 'string' },
        { name: 'northwindCustomers', type: 'integer' },
        { name: 'chinookCustomers', type: 'integer' },
      ],
    },
  ],
};

const envelope = () => ({
  complete: true,
  records: [
    { data: { country: 'Canada', northwindCustomers: 3, chinookCustomers: 8 } },
  ],
  columns: ['country', 'northwindCustomers', 'chinookCustomers'],
  execution: {
    route: 'in-memory',
    rowsReturned: 1,
    sources: [
      { database: 'northwind', collection: 'Customers' },
      { database: 'chinook', collection: 'Customer' },
    ],
  },
});

function fetcherFor(body: unknown = envelope()) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeTruthy();
    if (url === `${base}/v1/dtql`) return Response.json(body);
    const database = url.split('/').at(-1);
    expect(['northwind', 'chinook']).toContain(database);
    expect(init?.method).not.toBe('POST');
    return Response.json({ id: database, capabilities: { dtql: true } });
  });
}
const run = (
  fetcher: typeof fetch,
  observer = {},
  query = definition,
  signal?: AbortSignal,
) =>
  runFederatedQuery(
    query,
    undefined,
    '',
    undefined,
    signal,
    'full',
    undefined,
    undefined,
    { fetch: fetcher, ...observer },
  );

describe('native cross-database OVDB execution', () => {
  it('runs one whole root query with typed rows and every physical source, without client scans', async () => {
    const fetcher = fetcherFor();
    const result = await run(fetcher);
    const posts = fetcher.mock.calls.filter(
      ([, init]) => init?.method === 'POST',
    );
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe(`${base}/v1/dtql`);
    expect(posts[0][1]?.body).toBe(
      (definition.request as ITextQueryRequest).text,
    );
    expect(result.recordset.columns).toEqual(
      definition.recordsets?.[0].columns,
    );
    expect(result.recordset.rows).toEqual([
      [
        { type: 'string', value: 'Canada' },
        { type: 'integer', value: '3' },
        { type: 'integer', value: '8' },
      ],
    ]);
    expect(result.ordinarySources).toEqual(envelope().execution.sources);
    expect(result.ordinaryComplete).toBe(true);
    expect(result.provenance.source).toBe(`${base}/v1/dtql (direct OVDB)`);
    expect(result.nativeDirect).toBe(true);
  });

  it.each([
    [
      'missing complete',
      (value: Record<string, unknown>) => {
        delete value['complete'];
      },
    ],
    [
      'missing count',
      (value: Record<string, unknown>) => {
        delete (value['execution'] as Record<string, unknown>)['rowsReturned'];
      },
    ],
    [
      'wrong route',
      (value: Record<string, unknown>) => {
        (value['execution'] as Record<string, unknown>)['route'] = 'database';
      },
    ],
    [
      'missing source',
      (value: Record<string, unknown>) => {
        (value['execution'] as Record<string, unknown>)['sources'] = [
          envelope().execution.sources[0],
        ];
      },
    ],
    [
      'extra source',
      (value: Record<string, unknown>) => {
        (value['execution'] as Record<string, unknown>)['sources'] = [
          ...envelope().execution.sources,
          { database: 'private', collection: 'People' },
        ];
      },
    ],
    [
      'duplicate source',
      (value: Record<string, unknown>) => {
        (value['execution'] as Record<string, unknown>)['sources'] = [
          ...envelope().execution.sources,
          envelope().execution.sources[0],
        ];
      },
    ],
    [
      'cursor',
      (value: Record<string, unknown>) => {
        value['nextCursor'] = 'more';
      },
    ],
    [
      'missing column',
      (value: Record<string, unknown>) => {
        value['records'] = [{ data: { country: 'Canada' } }];
      },
    ],
    [
      'wrong type',
      (value: Record<string, unknown>) => {
        value['records'] = [
          {
            data: { country: 123, northwindCustomers: 3, chinookCustomers: 8 },
          },
        ];
      },
    ],
    [
      'fractional count',
      (value: Record<string, unknown>) => {
        value['records'] = [
          {
            data: {
              country: 'Canada',
              northwindCustomers: 3.2,
              chinookCustomers: 8,
            },
          },
        ];
      },
    ],
  ])(
    'rejects %s before any row or first-record callback',
    async (_name, mutate) => {
      const body = envelope();
      mutate(body);
      const onNativeRecord = vi.fn();
      const onFirstRecord = vi.fn();
      const fetcher = fetcherFor(body);
      await expect(
        run(fetcher, { onNativeRecord, onFirstRecord }),
      ).rejects.toThrow();
      expect(onNativeRecord).not.toHaveBeenCalled();
      expect(onFirstRecord).not.toHaveBeenCalled();
      expect(
        fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
      ).toHaveLength(1);
    },
  );

  it('validates the last row before staging the first and rejects heterogeneous inferred types', async () => {
    const body = envelope();
    body.records.push({
      data: {
        country: 'USA',
        northwindCustomers: 13,
        chinookCustomers: 'bad' as unknown as number,
      },
    });
    body.execution.rowsReturned = 2;
    const sink = vi.fn();
    await expect(
      run(
        fetcherFor(body),
        { onNativeRecord: sink },
        { ...definition, recordsets: undefined },
      ),
    ).rejects.toThrow('inconsistent');
    expect(sink).not.toHaveBeenCalled();
  });

  it('infers scalar types without saved projection metadata', async () => {
    const result = await run(
      fetcherFor(),
      {},
      { ...definition, recordsets: undefined },
    );
    expect(result.recordset.columns).toEqual([
      { name: 'country', type: 'string' },
      { name: 'northwindCustomers', type: 'number' },
      { name: 'chinookCustomers', type: 'number' },
    ]);
  });

  it('preserves exact quoted integers alongside numeric integers under declared types', async () => {
    const body = envelope();
    body.records.push({
      data: {
        country: 'USA',
        northwindCustomers: '9007199254740993' as unknown as number,
        chinookCustomers: 13,
      },
    });
    body.execution.rowsReturned = 2;
    const result = await run(fetcherFor(body));
    expect(result.recordset.rows[1][1]).toEqual({
      type: 'integer',
      value: '9007199254740993',
    });
  });

  it('preflights distinct source rights under the admitted server identity', async () => {
    const fetcher = fetcherFor();
    fetcher.mockImplementation(async (input) =>
      String(input).endsWith('/dtql')
        ? Response.json(envelope())
        : Response.json({
            id: String(input).split('/').at(-1),
            serverId: base,
            capabilities: { dtql: true },
          }),
    );
    if (!definition.federation)
      throw new Error('Expected federation definition');
    await run(
      fetcher,
      {},
      {
        ...definition,
        federation: {
          ...definition.federation,
          expectedServerIdentity: { baseUrl: base, serverId: base },
        },
      },
    );
    expect(
      fetcher.mock.calls.filter(([input]) =>
        String(input).endsWith('/northwind'),
      ),
    ).toHaveLength(2);
    expect(
      fetcher.mock.calls.filter(([input]) =>
        String(input).endsWith('/chinook'),
      ),
    ).toHaveLength(2);
  });

  it('refuses unsupported capability without a POST or client fallback', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ id: 'northwind', capabilities: { dtql: false } }),
    );
    await expect(run(fetcher)).rejects.toThrow('requires DTQL');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('surfaces server refusal without a second execution or client fallback', async () => {
    const fetcher = fetcherFor();
    const implementation = fetcher.getMockImplementation();
    if (!implementation) throw new Error('Expected mock transport');
    fetcher.mockImplementation((input, init) =>
      String(input).endsWith('/v1/dtql')
        ? Promise.resolve(
            Response.json(
              {
                error: {
                  code: 'unsupported',
                  message: 'Cannot execute this query.',
                },
              },
              { status: 422 },
            ),
          )
        : implementation(input, init),
    );
    await expect(run(fetcher)).rejects.toThrow('Cannot execute this query');
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
  });

  it.each(['discovery', 'query'] as const)(
    'cancels a stalled %s response without exposing rows',
    async (stage) => {
      const controller = new AbortController();
      const sink = vi.fn();
      let started!: () => void;
      const pending = new Promise<void>((resolve) => {
        started = resolve;
      });
      const normal = fetcherFor();
      const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        if (stage === 'discovery' || String(input).endsWith('/v1/dtql')) {
          started();
          return new Response(new ReadableStream<Uint8Array>(), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return normal(input, init);
      });
      const result = run(
        fetcher,
        { onNativeRecord: sink },
        definition,
        controller.signal,
      );
      await pending;
      controller.abort(new Error('cancelled root query'));
      await expect(result).rejects.toThrow('cancelled root query');
      expect(sink).not.toHaveBeenCalled();
    },
  );
});
