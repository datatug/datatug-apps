import {
  chartEvidenceError,
  type BrowserSqliteChartRecordset,
  type SourceRight,
} from '@sneat/datatug-semantic';
import {
  QueryType,
  type ITextQueryRequest,
} from '../../models/definition/query-def';
import { BrowserSqliteQueryService } from '../browser-sqlite-query.service';
import {
  QueryDispatchError,
  type QueryDispatchRequest,
} from '../query-dispatch';
import { sha256Hex } from './public-orders-admission';

const NORTHWIND = {
  id: 'northwind-sqlite',
  database: 'northwind',
  collection: 'Orders',
  url: '/assets/showcase/northwind.sqlite',
  bytes: 602112,
  sha256: '279b34136771aee75d802094b3329515a2b01da65d2a20a4a9e3b58c29b4fd20',
  repository: 'https://github.com/demo-db/northwind',
  revision: '76fe0a1ccc82b6c0c5a035d76c9df7522713d618',
  path: 'artifacts/northwind.sqlite',
  license: {
    spdx: 'MIT',
    url: 'https://github.com/demo-db/northwind/blob/de7f81c591abccc30fb9a0a58f44be9fd7265cd6/data-source/LICENSE.md',
  },
  attribution:
    'Northwind source data derived from jpwhite3/northwind-SQLite3, copyright (c) 2016 JP White. The bundled MIT notice applies.',
};
const CHINOOK = {
  id: 'chinook-sqlite',
  database: 'chinook',
  collection: 'Customer',
  url: '/assets/showcase/chinook.sqlite',
  bytes: 1007616,
  sha256: '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15',
  repository: 'https://github.com/demo-db/chinook',
  revision: '85ad3b4d4014dd5a6ee506410beee99771801811',
  path: 'artifacts/data/chinook.sqlite',
  license: {
    spdx: 'MIT',
    url: 'https://github.com/demo-db/chinook/blob/85ad3b4d4014dd5a6ee506410beee99771801811/data-source/LICENSE.md',
  },
  attribution:
    'Chinook sample data by Luis Rocha and contributors. Copyright (c) 2008-2024 Luis Rocha. The bundled MIT notice applies.',
};
const QUERIES = {
  'demodb/northwind-orders-browser-sqlite': {
    fixture: NORTHWIND,
    rows: 830,
    querySha256:
      'a1b3d75996c5ffa611ee2f7e9c49234a142cdd1595e7249056621b010d1daab5',
    names: [
      'OrderID',
      'CustomerID',
      'EmployeeID',
      'OrderDate',
      'RequiredDate',
      'ShippedDate',
      'ShipVia',
      'Freight',
      'ShipName',
      'ShipAddress',
      'ShipCity',
      'ShipRegion',
      'ShipPostalCode',
      'ShipCountry',
    ],
    types: [
      'integer',
      'string',
      'integer',
      'string',
      'string',
      'string',
      'integer',
      'number',
      'string',
      'string',
      'string',
      'string',
      'string',
      'string',
    ],
  },
  'demodb/northwind-country-counts-browser-sqlite': {
    fixture: NORTHWIND,
    rows: 21,
    querySha256:
      '4ad98f415bb0f2a87efc481703418c93ae5bebff4903e6dc83c631f8edf28d26',
    names: ['ShipCountry', 'orders'],
    types: ['string', 'integer'],
  },
  'demodb/chinook-billing-browser-sqlite': {
    fixture: CHINOOK,
    rows: 10,
    querySha256:
      'fdf80f3949f4a1c31e2e317e5356455ce97e769484a197b5736eb0463baf93a1',
    names: [
      'CustomerId',
      'CustomerName',
      'Country',
      'InvoiceCount',
      'TotalCents',
    ],
    types: ['integer', 'string', 'string', 'integer', 'integer'],
  },
} as const;

export function isBrowserShowcaseQueryId(
  id: string,
): id is keyof typeof QUERIES {
  return Object.hasOwn(QUERIES, id);
}

/** Admit only reviewed saved SQL; execution and fixture verification belong to the generic service. */
export async function executeBrowserShowcaseQuery(
  browser: BrowserSqliteQueryService,
  request: QueryDispatchRequest,
): Promise<BrowserSqliteChartRecordset> {
  const { definition, queryId } = request;
  if (!queryId || !isBrowserShowcaseQueryId(queryId))
    throw new QueryDispatchError(
      'This saved query is not an admitted browser showcase query.',
    );
  const pin = QUERIES[queryId];
  const fixture = pin.fixture;
  const expectedColumns = pin.names.map((name, index) => ({
    name,
    type: pin.types[index],
  }));
  if (
    (definition.id !== queryId && definition.id !== queryId.split('/').pop()) ||
    definition.connectionId !== fixture.id ||
    definition.request.queryType !== QueryType.SQL ||
    definition.draft ||
    definition.parameters?.length ||
    definition.targets?.length ||
    definition.federation ||
    definition.publicData ||
    (definition.recordsets &&
      (definition.recordsets.length !== 1 ||
        JSON.stringify(
          definition.recordsets[0].columns.map(({ name, type }) => ({
            name,
            type,
          })),
        ) !== JSON.stringify(expectedColumns))) ||
    (await sha256Hex(
      new TextEncoder().encode((definition.request as ITextQueryRequest).text),
    )) !== pin.querySha256
  )
    throw new QueryDispatchError(
      'The saved browser showcase query differs from its admitted SQL definition.',
    );
  if (
    (request.environment !== undefined && request.environment !== 'dev') ||
    Object.keys(request.parameters ?? {}).length ||
    request.runtimeBinding ||
    request.runtimeSelectionId ||
    (request.target && request.target.kind !== 'browser-sqlite')
  )
    throw new QueryDispatchError(
      'This showcase query requires its pinned browser SQLite runtime.',
    );
  const result = await browser.execute(
    {
      projectRef: request.projectRef,
      definition,
      target: { kind: 'browser-sqlite' },
      environment: 'dev',
      connection: {
        id: fixture.id,
        title: fixture.database,
        storage: 'sqlite',
        environments: ['dev'],
        fixtureSha256: fixture.sha256,
        browserFixture: { url: fixture.url, bytes: fixture.bytes },
      },
    },
    { ...request, environment: 'dev' },
  );
  if (
    result.browserExecution?.runtime !== 'sqlite-fixture' ||
    result.browserExecution.fixtureSha256 !== fixture.sha256 ||
    result.truncated ||
    result.hasMore ||
    result.recordset.rows.length !== pin.rows ||
    JSON.stringify(result.recordset.columns.map(({ name }) => name)) !==
      JSON.stringify(pin.names)
  )
    throw new QueryDispatchError(
      'The browser showcase result differs from the complete pinned projection.',
    );
  const serverId = fixture.repository;
  const source = {
    serverId,
    databaseId: fixture.database,
    recordset: fixture.collection,
  };
  const sourceId = `ovdb:${encodeURIComponent(serverId)}/${fixture.database}/${fixture.collection}`;
  const rights: SourceRight = {
    sourceId,
    source,
    declaration: fixture.license,
    declarationScope: 'database',
    declaredAt: { serverId, databaseId: fixture.database },
    evidenceOrigin: 'publisher-verified',
    pins: [
      {
        role: 'provider',
        repository: fixture.repository,
        revision: fixture.revision,
        path: fixture.path,
        sha256: fixture.sha256,
        bytes: fixture.bytes,
      },
    ],
    attribution: { text: fixture.attribution, url: fixture.repository },
    transformations: [
      queryId === 'demodb/chinook-billing-browser-sqlite'
        ? 'Customer and Invoice join; invoice totals rounded to integer cents, grouped per customer, top ten.'
        : queryId === 'demodb/northwind-country-counts-browser-sqlite'
          ? 'Count all Orders grouped by ShipCountry.'
          : 'Complete Orders projection ordered by OrderID.',
    ],
  };
  const observedAt = result.provenance.observedAt;
  const admitted: BrowserSqliteChartRecordset = {
    runtime: 'browser-sqlite',
    complete: true,
    hasMore: false,
    truncated: false,
    recordset: { ...result.recordset, columns: expectedColumns },
    limitations: result.limitations,
    bindingsApplied: result.bindingsApplied,
    sourceRights: [rights],
    usedSourceIds: [sourceId],
    provenance: {
      source: fixture.database,
      collection: fixture.collection,
      queryId,
      mode: 'snapshot',
      observedAt,
    },
    sqliteReceipt: {
      fixtureSha256: fixture.sha256,
      fixtureBytes: fixture.bytes,
      sourceId,
      queryId,
      rowsReturned: pin.rows,
      observedAt,
    },
  };
  const error = chartEvidenceError(admitted);
  if (error) throw new QueryDispatchError(error);
  return admitted;
}
