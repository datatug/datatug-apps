import { currentDemoDbOvdbUrl } from '../demodb-ovdb';
import {
  chartEvidenceError,
  type BrowserPublicApiChartRecordset,
  type PublicApiChartReceipt,
  type SourceRight,
  type TypedValue,
} from '@sneat/datatug-semantic';
import {
  QueryType,
  type IQueryDef,
  type ITextQueryRequest,
} from '../../models/definition/query-def';
import {
  executePublishedCountryCounts,
  NORTHWIND_COUNTRY_COUNT_PIN,
} from './public-country-count-admission';
import { executePublicDtql } from './public-dtql-transport';
import {
  fetchOrdersRightsPublication,
  NORTHWIND_ORDERS_PIN,
  sha256Hex,
  verifyPublishedOrders,
} from './public-orders-admission';

export const PUBLIC_ORDERS_QUERY_ID = 'demodb/northwind-orders-full-sqlite';
export const PUBLIC_COUNTRY_COUNTS_QUERY_ID =
  'demodb/northwind-shipping-country-count-sqlite';

/** Routing only; execution always revalidates the loaded saved definition. */
export function isSavedPublicChartQueryId(queryId: string): boolean {
  return (
    queryId === PUBLIC_ORDERS_QUERY_ID ||
    queryId === PUBLIC_COUNTRY_COUNTS_QUERY_ID
  );
}

const integerFields = new Set(['OrderID', 'EmployeeID', 'ShipVia']);
const ordersColumns = NORTHWIND_ORDERS_PIN.fields.map((name) => ({
  name,
  type: integerFields.has(name)
    ? 'integer'
    : name === 'Freight'
      ? 'decimal'
      : 'string',
}));
// The committed saved definition declares JSON Freight as number. Canonical admission
// returns its exact decimal string, so the presentation column uses decimal.
const savedOrdersColumns = ordersColumns.map(({ name, type }) => ({
  name,
  type: name === 'Freight' ? 'number' : type,
}));
const countryColumns = [
  { name: 'ShipCountry', type: 'string' },
  { name: 'orders', type: 'integer' },
];

export class PublicChartQueryError extends Error {}
const reject = (message: string): never => {
  throw new PublicChartQueryError(message);
};
const cancelled = (signal?: AbortSignal): void => {
  if (signal?.aborted) reject('The saved public chart query was cancelled.');
};

/** The caller loads the exact saved query through QueriesService, including its DTQL sidecar. */
async function savedText(
  queryId: string,
  definition: IQueryDef,
  signal?: AbortSignal,
): Promise<string> {
  cancelled(signal);
  if (!isSavedPublicChartQueryId(queryId))
    return reject('The saved query is not an admitted public chart query.');
  const leafId = queryId.slice(queryId.lastIndexOf('/') + 1);
  if (
    !definition ||
    (definition.id !== queryId && definition.id !== leafId) ||
    definition.connectionId !== 'northwind-sqlite' ||
    definition.request?.queryType !== QueryType.DTQL ||
    definition.draft ||
    definition.parameters?.length ||
    definition.targets?.length ||
    definition.federation ||
    definition.publicData
  )
    return reject(
      'The saved public chart query definition has changed identity or execution scope.',
    );
  const text = (definition.request as ITextQueryRequest).text;
  const pin =
    queryId === PUBLIC_ORDERS_QUERY_ID
      ? NORTHWIND_ORDERS_PIN
      : NORTHWIND_COUNTRY_COUNT_PIN;
  if (
    typeof text !== 'string' ||
    (await sha256Hex(new TextEncoder().encode(text))) !== pin.querySha256
  )
    return reject(
      'The saved public chart query text differs from the admitted definition.',
    );
  const columns =
    queryId === PUBLIC_ORDERS_QUERY_ID ? savedOrdersColumns : countryColumns;
  if (
    definition.recordsets &&
    (definition.recordsets.length !== 1 ||
      JSON.stringify(
        definition.recordsets[0].columns.map(({ name, type }) => ({
          name,
          type,
        })),
      ) !== JSON.stringify(columns))
  )
    return reject(
      'The saved public chart query declares a different result projection.',
    );
  cancelled(signal);
  return text;
}

function rejectPartialFlags(response: unknown): void {
  const body = response as Record<string, unknown>;
  if (body['hasMore'] === true || body['truncated'] === true)
    reject(
      'The public query response explicitly reports partial or truncated rows.',
    );
}

function providerDigest(
  rights: readonly SourceRight[] | undefined,
  sourceId: string,
): string {
  const right = rights?.find((item) => item.sourceId === sourceId);
  const pins = right?.pins.filter((pin) => pin.role === 'provider') ?? [];
  if (pins.length !== 1 || !/^[a-f0-9]{64}$/.test(pins[0].sha256))
    return reject(
      'The verified publisher rights lack one exact provider source digest.',
    );
  return pins[0].sha256;
}

function result(
  recordset: BrowserPublicApiChartRecordset['recordset'],
  receipt: PublicApiChartReceipt,
  sourceRights: BrowserPublicApiChartRecordset['sourceRights'],
  usedSourceIds: BrowserPublicApiChartRecordset['usedSourceIds'],
): BrowserPublicApiChartRecordset {
  const output: BrowserPublicApiChartRecordset = {
    runtime: 'browser-public-api',
    complete: true,
    hasMore: false,
    truncated: false,
    recordset,
    limitations: [],
    bindingsApplied: [],
    sourceRights,
    usedSourceIds,
    provenance: {
      source: receipt.databaseId,
      collection: receipt.logicalCollection,
      queryId: receipt.queryId,
      mode: 'live',
      observedAt: receipt.observedAt,
      endpoint: receipt.endpoint,
      databaseId: receipt.databaseId,
    },
    publicApiReceipt: receipt,
  };
  const error = chartEvidenceError(output);
  if (error) return reject(error);
  return output;
}

function orderValue(value: string | number | null, type: string): TypedValue {
  if (value === null) return { type: 'null', value: null };
  if (type === 'integer') return { type: 'integer', value: String(value) };
  if (type === 'decimal') return { type: 'decimal', value: String(value) };
  if (typeof value !== 'string')
    return reject('The verified Orders result has an unexpected text value.');
  return { type: 'string', value };
}

/** Narrow browser adapter. Project metadata never supplies rights, pins, endpoints or execution profiles. */
export async function executeSavedPublicChartQuery(
  queryId: string,
  definition: IQueryDef,
  options: {
    readonly fetch?: typeof globalThis.fetch;
    readonly signal?: AbortSignal;
  } = {},
): Promise<BrowserPublicApiChartRecordset> {
  const text = await savedText(queryId, definition, options.signal);
  if (queryId === PUBLIC_COUNTRY_COUNTS_QUERY_ID) {
    const admitted = await executePublishedCountryCounts(text, options);
    cancelled(options.signal);
    const pin = NORTHWIND_COUNTRY_COUNT_PIN;
    return result(
      {
        columns: countryColumns.map((column) => ({ ...column })),
        rows: admitted.rows.map(([country, orders]) => [
          { type: 'string', value: country },
          { type: 'integer', value: String(orders) },
        ]),
      },
      {
        endpoint: admitted.provenance.endpoint,
        serverId: pin.serverId,
        databaseId: admitted.provenance.databaseId,
        logicalCollection: 'Orders',
        collectionId: admitted.provenance.collectionId,
        queryId,
        rowsReturned: admitted.rows.length,
        observedAt: admitted.provenance.observedAt,
        sourceVerification: {
          kind: 'execution-source',
          executionSources: [
            { database: pin.databaseId, collection: pin.collectionId },
          ],
        },
        rightsPublication: {
          url: admitted.provenance.publicationUrl,
          sha256: admitted.provenance.publicationSha256,
          sourceId: pin.sourceId,
          providerSourceSha256: providerDigest(
            admitted.sourceRights,
            pin.sourceId,
          ),
        },
      },
      admitted.sourceRights,
      admitted.usedSourceIds,
    );
  }
  const pin = NORTHWIND_ORDERS_PIN;
  const publication = await fetchOrdersRightsPublication(options);
  cancelled(options.signal);
  // The request goes to the current OVDB host; the receipt keeps the pinned (published)
  // endpoint, which must stay under the publication's serverId.
  const execution = await executePublicDtql(
    text,
    {
      endpoint: currentDemoDbOvdbUrl(pin.endpoint),
      databaseId: pin.databaseId,
      collectionId: pin.recordset,
      requireExecutionSource: false,
      maxRows: pin.rows,
      expectedFields: pin.fields,
    },
    options,
  );
  rejectPartialFlags(execution.raw);
  const admitted = await verifyPublishedOrders(
    pin.endpoint,
    text,
    execution.raw,
    publication,
    pin,
  );
  cancelled(options.signal);
  return result(
    {
      columns: ordersColumns.map((column) => ({ ...column })),
      rows: admitted.rows.map((row) =>
        row.map((value, index) => orderValue(value, ordersColumns[index].type)),
      ),
    },
    {
      endpoint: pin.endpoint,
      serverId: pin.serverId,
      databaseId: pin.databaseId,
      logicalCollection: pin.recordset,
      collectionId: pin.recordset,
      queryId,
      rowsReturned: admitted.rows.length,
      observedAt: execution.observedAt,
      sourceVerification: {
        kind: 'publisher-digest',
        canonicalRowsSha256: admitted.canonicalRowsSha256,
      },
      rightsPublication: {
        ...admitted.rightsPublication,
        providerSourceSha256: providerDigest(
          admitted.sourceRights,
          pin.sourceId,
        ),
        canonicalRowsSha256: admitted.canonicalRowsSha256,
      },
    },
    admitted.sourceRights,
    admitted.usedSourceIds,
  );
}

export const PUBLIC_POSTGRESQL_COUNTRY_COUNTS_QUERY_ID =
  'demodb/northwind-shipping-country-count-postgresql';
const postgresql = Object.freeze({
  endpoint:
    'https://cloud.openvaultdb.com/v1/databases/northwind-postgresql/dtql',
  serverId: 'https://cloud.openvaultdb.com',
  databaseId: 'northwind-postgresql',
  collectionId: 'pg1_AAAACW5vcnRod2luZAAAAAZPcmRlcnM',
  querySha256:
    'df5a020a273bfde0f7771c5a405ca1985500b791d48e5d84598226e4dc3bf214',
  canonicalRowsSha256:
    '10180147a7752d4006c28d438d7deed96461336b865156036c2c017f5c82b235',
});

/** A grid result with physical execution evidence and explicitly unavailable source terms. */
export interface BrowserPublicInspectRecordset extends Pick<
  BrowserPublicApiChartRecordset,
  | 'runtime'
  | 'recordset'
  | 'provenance'
  | 'complete'
  | 'hasMore'
  | 'truncated'
  | 'limitations'
  | 'bindingsApplied'
> {
  readonly sourceRights: readonly [];
  readonly usedSourceIds: readonly string[];
  readonly publicApiReceipt: Omit<PublicApiChartReceipt, 'rightsPublication'>;
  readonly rightsStatus: 'unavailable';
  readonly rightsUnavailableReason: string;
}

/** PostgreSQL inspector routing only; these rows have no chart admission. */
export function isSavedPublicInspectQueryId(queryId: string): boolean {
  return queryId === PUBLIC_POSTGRESQL_COUNTRY_COUNTS_QUERY_ID;
}

export async function executeSavedPublicInspectQuery(
  queryId: string,
  definition: IQueryDef,
  options: {
    readonly fetch?: typeof globalThis.fetch;
    readonly signal?: AbortSignal;
  } = {},
): Promise<BrowserPublicInspectRecordset> {
  cancelled(options.signal);
  if (
    !isSavedPublicInspectQueryId(queryId) ||
    !definition ||
    (definition.id !== queryId &&
      definition.id !== 'northwind-shipping-country-count-postgresql') ||
    definition.connectionId !== 'northwind-postgresql' ||
    definition.request?.queryType !== QueryType.DTQL ||
    definition.draft ||
    definition.parameters?.length ||
    definition.targets?.length ||
    definition.federation ||
    definition.publicData
  )
    return reject(
      'The saved public inspector query definition has changed identity or execution scope.',
    );
  const text = (definition.request as ITextQueryRequest).text;
  if (
    typeof text !== 'string' ||
    (await sha256Hex(new TextEncoder().encode(text))) !== postgresql.querySha256
  )
    return reject(
      'The saved public inspector query text differs from the admitted definition.',
    );
  if (
    definition.recordsets &&
    (definition.recordsets.length !== 1 ||
      JSON.stringify(
        definition.recordsets[0].columns.map(({ name, type }) => ({
          name,
          type,
        })),
      ) !== JSON.stringify(countryColumns))
  )
    return reject(
      'The saved public inspector query declares a different result projection.',
    );
  cancelled(options.signal);
  const executed = await executePublicDtql(
    text,
    {
      ...postgresql,
      requireExecutionSource: true,
      maxRows: 21,
      expectedFields: ['ShipCountry', 'orders'],
    },
    options,
  );
  rejectPartialFlags(executed.raw);
  let previous = '';
  let total = 0;
  const rows = executed.records.map(({ data }): readonly [string, number] => {
    const country = data['ShipCountry'];
    const orders = data['orders'];
    if (
      typeof country !== 'string' ||
      !country ||
      country.trim() !== country ||
      country <= previous ||
      typeof orders !== 'number' ||
      !Number.isSafeInteger(orders) ||
      orders <= 0
    )
      return reject(
        'The public inspector aggregate has invalid country counts.',
      );
    previous = country;
    total += orders;
    return [country, orders];
  });
  if (
    rows.length !== 21 ||
    total !== 830 ||
    (await sha256Hex(new TextEncoder().encode(JSON.stringify(rows)))) !==
      postgresql.canonicalRowsSha256
  )
    return reject(
      'The public inspector aggregate differs from the pinned complete result.',
    );
  cancelled(options.signal);
  return {
    runtime: 'browser-public-api',
    complete: true,
    hasMore: false,
    truncated: false,
    limitations: [],
    bindingsApplied: [],
    sourceRights: [],
    usedSourceIds: [
      `ovdb:${encodeURIComponent(postgresql.serverId)}/${postgresql.databaseId}/${postgresql.collectionId}`,
    ],
    rightsStatus: 'unavailable',
    rightsUnavailableReason:
      'No verified publisher source rights are available for this PostgreSQL result.',
    recordset: {
      columns: countryColumns.map((column) => ({ ...column })),
      rows: rows.map(([country, orders]) => [
        { type: 'string', value: country },
        { type: 'integer', value: String(orders) },
      ]),
    },
    provenance: {
      source: postgresql.databaseId,
      collection: 'Orders',
      queryId,
      mode: 'live',
      observedAt: executed.observedAt,
      endpoint: postgresql.endpoint,
      databaseId: postgresql.databaseId,
    },
    publicApiReceipt: {
      endpoint: postgresql.endpoint,
      serverId: postgresql.serverId,
      databaseId: postgresql.databaseId,
      logicalCollection: 'Orders',
      collectionId: postgresql.collectionId,
      queryId,
      rowsReturned: rows.length,
      observedAt: executed.observedAt,
      sourceVerification: {
        kind: 'execution-source',
        executionSources: executed.executionSources,
      },
    },
  };
}
