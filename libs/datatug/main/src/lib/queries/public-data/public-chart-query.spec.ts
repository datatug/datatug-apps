import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chartEvidenceError } from '@sneat/datatug-semantic';
import { QueryType, type IQueryDef } from '../../models/definition/query-def';
import {
  executeSavedPublicInspectQuery,
  isSavedPublicChartQueryId,
  isSavedPublicInspectQueryId,
  PUBLIC_POSTGRESQL_COUNTRY_COUNTS_QUERY_ID,
  executeSavedPublicChartQuery,
  PUBLIC_COUNTRY_COUNTS_QUERY_ID,
  PUBLIC_ORDERS_QUERY_ID,
} from './public-chart-query';
import { NORTHWIND_ORDERS_PIN, sha256Hex } from './public-orders-admission';
import {
  NORTHWIND_COUNTRY_COUNT_PIN,
  verifyPublishedCountryCounts,
} from './public-country-count-admission';

// Synthetic provider fixtures exercise real hashing, transport and Orders admission.
// Only immutable policy pins and the separately tested country executor are replaced.
const testPolicy = vi.hoisted(() => ({
  orders: {} as Record<string, unknown>,
  country: vi.fn(),
}));
vi.mock('./public-orders-admission', async (original) => {
  const module = await original<typeof import('./public-orders-admission')>();
  return {
    ...module,
    NORTHWIND_ORDERS_PIN: new Proxy(
      { ...module.NORTHWIND_ORDERS_PIN },
      {
        get: (target, key) =>
          testPolicy.orders[String(key)] ?? Reflect.get(target, key),
      },
    ),
  };
});
vi.mock('./public-country-count-admission', async (original) => ({
  ...(await original<typeof import('./public-country-count-admission')>()),
  executePublishedCountryCounts: testPolicy.country,
}));
const encoder = new TextEncoder();
const query =
  'from: {name: Orders}\norderBy: [{field: OrderID}]\ncolumns: [{field: OrderID}, {field: CustomerID}, {field: EmployeeID}, {field: OrderDate}, {field: RequiredDate}, {field: ShippedDate}, {field: ShipVia}, {field: Freight}, {field: ShipName}, {field: ShipAddress}, {field: ShipCity}, {field: ShipRegion}, {field: ShipPostalCode}, {field: ShipCountry}]\nlimit: 1000\n';
const countryQuery =
  'from: {name: Orders}\ngroupBy: [{field: ShipCountry}]\norderBy: [{field: ShipCountry}]\ncolumns: [{field: ShipCountry}, {aggregate: {function: count, args: [{star: true}]}, as: orders}]\nlimit: 100\n';
// Exact declared projection from datatug-demo-project commit 9c64250 query JSON.
const savedOrdersColumns = NORTHWIND_ORDERS_PIN.fields.map((name) => ({
  name,
  type: ['OrderID', 'EmployeeID', 'ShipVia'].includes(name)
    ? 'integer'
    : name === 'Freight'
      ? 'number'
      : 'string',
}));
const definition = (id = PUBLIC_ORDERS_QUERY_ID, text = query): IQueryDef =>
  ({
    recordsets: [
      {
        columns:
          id === PUBLIC_ORDERS_QUERY_ID
            ? savedOrdersColumns
            : [
                { name: 'ShipCountry', type: 'string' },
                { name: 'orders', type: 'integer' },
              ],
      },
    ],
    id: id.split('/').at(-1) ?? id,
    connectionId: 'northwind-sqlite',
    request: { queryType: QueryType.DTQL, text },
  }) as unknown as IQueryDef;
const rights = () => [
  {
    sourceId: NORTHWIND_ORDERS_PIN.sourceId,
    source: {
      serverId: NORTHWIND_ORDERS_PIN.serverId,
      databaseId: 'northwind',
      recordset: 'Orders',
    },
    declaration: { spdx: 'MIT' },
    declarationScope: 'recordset',
    declaredAt: {
      serverId: NORTHWIND_ORDERS_PIN.serverId,
      databaseId: 'northwind',
      recordset: 'Orders',
    },
    evidenceOrigin: 'publisher-verified',
    pins: [
      {
        role: 'provider',
        repository: 'https://github.com/demo-db/northwind',
        revision: 'a'.repeat(40),
        path: 'data-source/source.sqlite',
        sha256: 'b'.repeat(64),
        bytes: 602112,
      },
    ],
    transformations: [],
  },
];

async function fixture() {
  const fields = NORTHWIND_ORDERS_PIN.fields;
  const rows = Array.from({ length: 830 }, (_, index) =>
    fields.map((field) =>
      field === 'OrderID'
        ? 10248 + index
        : ['EmployeeID', 'ShipVia'].includes(field)
          ? 1
          : field.endsWith('Date')
            ? '2016-07-04'
            : field === 'Freight'
              ? '10.5'
              : field === 'ShipRegion'
                ? null
                : 'France',
    ),
  );
  const querySha256 = await sha256Hex(encoder.encode(query));
  const canonicalRowsSha256 = await sha256Hex(
    encoder.encode(JSON.stringify(rows)),
  );
  const publication = encoder.encode(
    JSON.stringify({
      admission: {
        endpoint: NORTHWIND_ORDERS_PIN.endpoint,
        querySha256,
        canonicalRowsSha256,
        rows: 830,
        complete: true,
        fields,
      },
      sourceRights: rights(),
      usedSourceIds: [NORTHWIND_ORDERS_PIN.sourceId],
    }),
  );
  Object.assign(testPolicy.orders, {
    querySha256,
    canonicalRowsSha256,
    publicationSha256: await sha256Hex(publication),
  });
  const response = {
    columns: fields,
    complete: true,
    records: rows.map((row) => ({
      data: Object.fromEntries(
        fields.map((field, index) => [field, row[index]]),
      ),
    })),
  };
  const calls: { url: string; init?: RequestInit }[] = [];
  const transport: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(
      String(input) === NORTHWIND_ORDERS_PIN.publicationUrl
        ? publication
        : JSON.stringify(response),
    );
  };
  return { response, publication, transport, calls };
}

beforeEach(() => {
  testPolicy.orders = {};
  testPolicy.country.mockReset();
});

describe('saved public chart query adapter', () => {
  it('executes the loaded text and returns 830 complete typed rows with a verified publisher receipt', async () => {
    const source = await fixture();
    expect(await sha256Hex(encoder.encode(query))).toBe(
      'ba8e43a239489bfb17761990658909b969c9d4939dd8aa008615c867671b2c52',
    );
    const result = await executeSavedPublicChartQuery(
      PUBLIC_ORDERS_QUERY_ID,
      definition(),
      { fetch: source.transport },
    );
    expect(result.recordset.columns).toHaveLength(14);
    expect(result.recordset.rows).toHaveLength(830);
    expect(result.recordset.rows[0][0]).toEqual({
      type: 'integer',
      value: '10248',
    });
    expect(result.recordset.rows[0][3]).toEqual({
      type: 'string',
      value: '2016-07-04',
    });
    expect(result.recordset.rows[0][7]).toEqual({
      type: 'decimal',
      value: '10.5',
    });
    expect(result.recordset.rows[0][11]).toEqual({ type: 'null', value: null });
    expect(result).toMatchObject({
      runtime: 'browser-public-api',
      complete: true,
      hasMore: false,
      truncated: false,
    });
    expect(result.publicApiReceipt).toMatchObject({
      queryId: PUBLIC_ORDERS_QUERY_ID,
      rowsReturned: 830,
      sourceVerification: {
        kind: 'publisher-digest',
        canonicalRowsSha256: testPolicy.orders['canonicalRowsSha256'],
      },
      rightsPublication: {
        providerSourceSha256: 'b'.repeat(64),
        sha256: testPolicy.orders['publicationSha256'],
      },
    });
    expect(chartEvidenceError(result)).toBeUndefined();
    expect(result).not.toHaveProperty('execution');
    expect(result.provenance).not.toHaveProperty('executionProfile');
    expect(source.calls.map(({ url }) => url)).toEqual([
      NORTHWIND_ORDERS_PIN.publicationUrl,
      NORTHWIND_ORDERS_PIN.endpoint,
    ]);
    expect(JSON.parse(String(source.calls[1].init?.body))).toEqual({ query });
  });

  it('rejects forged identity, connection, language, text, scope and projection before network access', async () => {
    const source = await fixture();
    for (const changed of [
      { ...definition(), id: 'other' },
      { ...definition(), connectionId: 'northwind-postgres' },
      { ...definition(), request: { queryType: QueryType.SQL, text: query } },
      definition(PUBLIC_ORDERS_QUERY_ID, `${query}# changed`),
      { ...definition(), draft: true },
      { ...definition(), targets: [{ host: 'other' }] },
      {
        ...definition(),
        recordsets: [
          {
            name: 'fake',
            columns: [{ name: 'ShipCountry', type: 'string' as const }],
          },
        ],
      },
    ])
      await expect(
        executeSavedPublicChartQuery(PUBLIC_ORDERS_QUERY_ID, changed, {
          fetch: source.transport,
        }),
      ).rejects.toThrow(/saved public chart query/i);
    await expect(
      executeSavedPublicChartQuery(
        'other/northwind-orders-full-sqlite',
        definition(),
        { fetch: source.transport },
      ),
    ).rejects.toThrow(/not an admitted/);
    expect(source.calls).toHaveLength(0);
  });

  it('rejects forged rows, incomplete responses, wrong physical source and altered publisher bytes', async () => {
    const source = await fixture();
    const forged = structuredClone(source.response);
    forged.records[0].data['ShipCountry'] = 'Germany';
    const responses = [
      forged,
      { ...source.response, complete: false },
      { ...source.response, hasMore: true },
      { ...source.response, truncated: true },
      {
        ...source.response,
        execution: {
          rowsReturned: 830,
          sources: [{ database: 'other', collection: 'Orders' }],
        },
      },
    ];
    for (const body of responses) {
      const fetcher: typeof fetch = async (input) =>
        new Response(
          String(input) === NORTHWIND_ORDERS_PIN.publicationUrl
            ? source.publication
            : JSON.stringify(body),
        );
      await expect(
        executeSavedPublicChartQuery(PUBLIC_ORDERS_QUERY_ID, definition(), {
          fetch: fetcher,
        }),
      ).rejects.toThrow();
    }
    const fetcher: typeof fetch = async (input) =>
      new Response(
        String(input) === NORTHWIND_ORDERS_PIN.publicationUrl
          ? '{}'
          : JSON.stringify(source.response),
      );
    await expect(
      executeSavedPublicChartQuery(PUBLIC_ORDERS_QUERY_ID, definition(), {
        fetch: fetcher,
      }),
    ).rejects.toThrow(/pinned artifact/);
  });

  it('preserves cancellation before reads and after publication, before execution', async () => {
    const source = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeSavedPublicChartQuery(PUBLIC_ORDERS_QUERY_ID, definition(), {
        fetch: source.transport,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/);
    expect(source.calls).toHaveLength(0);
    const during = new AbortController();
    const fetcher: typeof fetch = async () => {
      during.abort();
      return new Response(source.publication);
    };
    await expect(
      executeSavedPublicChartQuery(PUBLIC_ORDERS_QUERY_ID, definition(), {
        fetch: fetcher,
        signal: during.signal,
      }),
    ).rejects.toThrow(/cancelled/);
  });

  it('maps admitted country counts with execution-source evidence and verified provider rights', async () => {
    const rows: [string, number][] = [
      ['France', 400],
      ['UK', 430],
    ];
    const pin = NORTHWIND_COUNTRY_COUNT_PIN;
    const canonicalRowsSha256 = await sha256Hex(
      encoder.encode(JSON.stringify(rows)),
    );
    const publication = encoder.encode(
      JSON.stringify({
        format: 'demodb-observed-aggregate-rights/v1',
        sourceRights: rights(),
        usedSourceIds: [pin.sourceId],
        admission: {
          endpoint: pin.endpoint,
          query: countryQuery,
          querySha256: pin.querySha256,
          complete: true,
          rows: 2,
          totalOrders: 830,
          canonicalRowsSha256,
          fields: ['ShipCountry', 'orders'],
          executionSource: { database: 'northwind', collection: 'Orders' },
        },
      }),
    );
    const admitted = await verifyPublishedCountryCounts(
      countryQuery,
      {
        columns: ['ShipCountry', 'orders'],
        complete: true,
        execution: {
          rowsReturned: 2,
          sources: [{ database: 'northwind', collection: 'Orders' }],
        },
        records: rows.map(([ShipCountry, orders]) => ({
          data: { ShipCountry, orders },
        })),
      },
      publication,
      {
        ...pin,
        rows: 2,
        canonicalRowsSha256,
        publicationSha256: await sha256Hex(publication),
      },
    );
    testPolicy.country.mockResolvedValue(admitted);
    const controller = new AbortController();
    const output = await executeSavedPublicChartQuery(
      PUBLIC_COUNTRY_COUNTS_QUERY_ID,
      definition(PUBLIC_COUNTRY_COUNTS_QUERY_ID, countryQuery),
      { signal: controller.signal },
    );
    expect(testPolicy.country).toHaveBeenCalledWith(countryQuery, {
      signal: controller.signal,
    });
    expect(output.recordset.rows[0]).toEqual([
      { type: 'string', value: 'France' },
      { type: 'integer', value: '400' },
    ]);
    expect(output.sourceRights).toEqual(admitted.sourceRights);
    expect(output.publicApiReceipt.sourceVerification).toEqual({
      kind: 'execution-source',
      executionSources: [{ database: 'northwind', collection: 'Orders' }],
    });
    expect(chartEvidenceError(output)).toBeUndefined();
    testPolicy.country.mockResolvedValue({ ...admitted, sourceRights: [] });
    await expect(
      executeSavedPublicChartQuery(
        PUBLIC_COUNTRY_COUNTS_QUERY_ID,
        definition(PUBLIC_COUNTRY_COUNTS_QUERY_ID, countryQuery),
      ),
    ).rejects.toThrow(/provider source digest/);
  });
});

const pgQuery = countryQuery.replace(
  'from: {name: Orders}',
  'from: {schema: northwind, name: Orders}',
);
const pgDefinition = (): IQueryDef => ({
  ...definition(PUBLIC_POSTGRESQL_COUNTRY_COUNTS_QUERY_ID, pgQuery),
  connectionId: 'northwind-postgresql',
});
// Complete count vector captured by the pinned source receipt; never runtime input.
const pgRows: readonly (readonly [string, number])[] = [
  ['Argentina', 16],
  ['Austria', 40],
  ['Belgium', 19],
  ['Brazil', 83],
  ['Canada', 30],
  ['Denmark', 18],
  ['Finland', 22],
  ['France', 77],
  ['Germany', 122],
  ['Ireland', 19],
  ['Italy', 28],
  ['Mexico', 28],
  ['Norway', 6],
  ['Poland', 7],
  ['Portugal', 13],
  ['Spain', 23],
  ['Sweden', 37],
  ['Switzerland', 18],
  ['UK', 56],
  ['USA', 122],
  ['Venezuela', 46],
];
const pgResponse = () => ({
  complete: true,
  columns: ['ShipCountry', 'orders'],
  execution: {
    rowsReturned: 21,
    sources: [
      {
        database: 'northwind-postgresql',
        collection: 'pg1_AAAACW5vcnRod2luZAAAAAZPcmRlcnM',
      },
    ],
  },
  records: pgRows.map(([ShipCountry, orders]) => ({
    data: { ShipCountry, orders },
  })),
});

describe('saved PostgreSQL inspector adapter', () => {
  it('returns complete typed grid rows, physical provenance and explicit unavailable rights', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const transport: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(pgResponse()));
    };
    const result = await executeSavedPublicInspectQuery(
      PUBLIC_POSTGRESQL_COUNTRY_COUNTS_QUERY_ID,
      pgDefinition(),
      { fetch: transport },
    );
    expect(result.recordset.rows).toHaveLength(21);
    expect(result.recordset.rows[0]).toEqual([
      { type: 'string', value: 'Argentina' },
      { type: 'integer', value: '16' },
    ]);
    expect(result).toMatchObject({
      rightsStatus: 'unavailable',
      sourceRights: [],
      complete: true,
      hasMore: false,
      truncated: false,
    });
    expect(result.publicApiReceipt).not.toHaveProperty('rightsPublication');
    expect(result.provenance).toMatchObject({
      databaseId: 'northwind-postgresql',
      collection: 'Orders',
    });
    expect(result.provenance).not.toHaveProperty('executionProfile');
    expect(chartEvidenceError(result)).toMatch(/source-rights evidence/);
    expect(
      isSavedPublicChartQueryId(PUBLIC_POSTGRESQL_COUNTRY_COUNTS_QUERY_ID),
    ).toBe(false);
    expect(
      isSavedPublicInspectQueryId(PUBLIC_POSTGRESQL_COUNTRY_COUNTS_QUERY_ID),
    ).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://cloud.openvaultdb.com/v1/databases/northwind-postgresql/dtql',
    );
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ query: pgQuery });
  });

  it('fails closed on changed definition or text before fetching', async () => {
    const transport = vi.fn<typeof fetch>();
    for (const changed of [
      { ...pgDefinition(), id: 'other' },
      { ...pgDefinition(), connectionId: 'northwind-sqlite' },
      {
        ...pgDefinition(),
        request: { queryType: QueryType.DTQL, text: countryQuery },
      },
    ])
      await expect(
        executeSavedPublicInspectQuery(
          PUBLIC_POSTGRESQL_COUNTRY_COUNTS_QUERY_ID,
          changed,
          { fetch: transport },
        ),
      ).rejects.toThrow(/saved public inspector/);
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects missing or spoofed physical source, partial pages, forged counts and provider failures', async () => {
    const full = pgResponse();
    const forged = pgResponse();
    forged.records[0].data.orders++;
    for (const body of [
      { ...full, execution: undefined },
      { ...full, complete: false },
      { ...full, truncated: true },
      { ...full, hasMore: true },
      { ...full, nextCursor: 'more' },
      {
        ...full,
        execution: {
          rowsReturned: 21,
          sources: [{ database: 'northwind', collection: 'Orders' }],
        },
      },
      {
        ...full,
        records: full.records.slice(1),
        execution: { ...full.execution, rowsReturned: 20 },
      },
      forged,
    ])
      await expect(
        executeSavedPublicInspectQuery(
          PUBLIC_POSTGRESQL_COUNTRY_COUNTS_QUERY_ID,
          pgDefinition(),
          {
            fetch: async () => new Response(JSON.stringify(body)),
          },
        ),
      ).rejects.toThrow();
    await expect(
      executeSavedPublicInspectQuery(
        PUBLIC_POSTGRESQL_COUNTRY_COUNTS_QUERY_ID,
        pgDefinition(),
        {
          fetch: async () => {
            throw new TypeError('Failed to fetch');
          },
        },
      ),
    ).rejects.toThrow(/Failed to fetch/);
    const controller = new AbortController();
    controller.abort();
    const transport = vi.fn<typeof fetch>();
    await expect(
      executeSavedPublicInspectQuery(
        PUBLIC_POSTGRESQL_COUNTRY_COUNTS_QUERY_ID,
        pgDefinition(),
        {
          fetch: transport,
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow(/cancelled/);
    expect(transport).not.toHaveBeenCalled();
  });
});
