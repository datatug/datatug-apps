import { expect, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export const countryFixture = (name: string) =>
  readFileSync(
    join(process.cwd(), 'apps/datatug-app/e2e/fixtures', name),
    'utf8',
  );
export const countryBoardURL =
  '/project/github.com/datatug/datatug-demo-project/demo-project-1/-/board/showcase';
export const countryOrders = JSON.parse(
  countryFixture('northwind-orders-records.json'),
) as Record<string, unknown>[];
const customerCounts = JSON.parse(countryFixture('customer-country-source-counts.json')) as Record<string, { rows: { country: string; customers: number }[] }>;
const snapshot = JSON.parse(countryFixture('ovdb-inspector-snapshot.json'));
const publication = countryFixture('northwind-orders-rights.json');
const countPublication = countryFixture('northwind-country-count-rights.json');
const countQuery = JSON.parse(countPublication).admission.query as string;
const counts = [
  ...new Set(countryOrders.map((row) => String(row['ShipCountry']))),
]
  .sort()
  .map((ShipCountry) => ({
    ShipCountry,
    orders: countryOrders.filter((row) => row['ShipCountry'] === ShipCountry)
      .length,
  }));
const countsEnvelope = (rows: typeof counts) => ({
  complete: true,
  columns: ['ShipCountry', 'orders'],
  records: rows.map((data) => ({ data })),
  execution: {
    rowsReturned: 21,
    sources: [{ database: 'northwind', collection: 'Orders' }],
  },
});
const fields = JSON.parse(publication).admission.fields as string[];

/** Captured public root result and actual pinned provider Orders; no production data substitution. */
export async function installCountryComparisonFixture(
  context: BrowserContext,
  source: string,
  baseURL: string,
  options: {
    failRootOnce?: boolean;
    partialOrders?: boolean;
    syntheticZero?: boolean;
    failCustomerChinookOnce?: boolean;
    holdCustomerChinookSecond?: Promise<void>;
    customerOrdinary?: boolean;
    independentSources?: boolean;
  } = {},
) {
  // Follow the actual saved contract for all canonical callers, including older country/tutorial tests.
  // Structured declarations below are simulated; production publication remains a separate receipt.
  const rootDefinition = JSON.parse(readFileSync(join(source, 'demo-project-1/queries/demodb/customer-country-comparison-server.query.json'), 'utf8'));
  const simulatedProvider = !!options.independentSources || !!rootDefinition.federation?.expectedServerIdentity;
  const customerDefinitions = simulatedProvider ? Object.fromEntries(['northwind', 'chinook'].map((database) => [database, JSON.parse(readFileSync(join(source, `demo-project-1/queries/demodb/${database}-customer-country-counts-server.query.json`), 'utf8'))])) : {};
  const configuredIds = [...new Set([rootDefinition, ...Object.values(customerDefinitions)].map((definition) => definition.federation?.expectedServerIdentity?.serverId).filter(Boolean))];
  if (configuredIds.length > 1) throw new Error('Customer fixture definitions select different server identities.');
  const fixtureServerId = configuredIds[0] || 'showcase-fixture-server';
  const terms = (database: string) => {
    const collection = database === 'northwind' ? 'Customers' : 'Customer';
    const expected = customerDefinitions[database]?.federation?.expectedSourceRights;
    const sourceRights = expected?.length ? expected : [{ sourceId: `ovdb:${encodeURIComponent(fixtureServerId)}/${database}/${collection}`, source: { serverId: fixtureServerId, databaseId: database, recordset: collection }, declaration: { text: 'Simulated source reuse terms for fixture acceptance. Not a production declaration.' }, declarationScope: 'recordset', declaredAt: { serverId: fixtureServerId, databaseId: database, recordset: collection }, evidenceOrigin: 'server-declared', pins: [], transformations: [] }];
    return { sourceRights, usedSourceIds: sourceRights.map((right: { sourceId: string }) => right.sourceId) };
  };
  if (simulatedProvider) await context.route((url) => ['raw.githubusercontent.com', 'cdn.jsdelivr.net'].includes(url.hostname) && /\/queries\/demodb\/(?:northwind|chinook)-customer-country-counts-server\.query\.json$/.test(url.pathname), (route) => {
    const database = route.request().url().includes('/northwind-customer-') ? 'northwind' : 'chinook';
    const definition = structuredClone(customerDefinitions[database]);
    definition.federation.expectedServerIdentity ??= { baseUrl: definition.federation.ovdbBaseUrl, serverId: fixtureServerId };
    return route.fulfill({ json: definition, headers: { 'access-control-allow-origin': '*' } });
  });
  // The demo project and the demo-db/northwind rights publications (byte-identical to fixtures/northwind-*-rights.json)
  // are answered by the guard from the GitHub pins (e2e/github-pins.json).
  const posts: string[] = [],
    downloads: string[] = [],
    mutations: string[] = [],
    rootBodies: string[] = [];
  context.on('request', (request) => {
    const url = new URL(request.url()),
      method = request.method();
    if (/\.(?:sqlite|wasm)(?:$|\?)/.test(url.href)) downloads.push(url.href);
    const queryPath = url.pathname.replace(
      /^\/__(?:datatug_public_ovdb)\/(?:cloud|demodb)/,
      '',
    );
    const queryRead =
      method === 'POST' &&
      (['https://cloud.openvaultdb.com', 'https://ovdb.demodb.dev'].includes(
        url.origin,
      ) ||
        (url.origin === new URL(baseURL).origin &&
          url.pathname.startsWith('/__datatug_public_ovdb/'))) &&
      /^\/v1\/(?:databases\/[^/]+\/)?dtql$/.test(queryPath);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !queryRead)
      mutations.push(`${method} ${url.href}`);
  });
  const local = new URL(baseURL).origin;
  const rootText = readFileSync(
    join(
      source,
      'demo-project-1/queries/demodb/customer-country-comparison-server.query.dtql',
    ),
    'utf8',
  );
  await context.route(
    (url) =>
      url.origin === 'https://cloud.openvaultdb.com' ||
      (url.origin === local &&
        url.pathname.startsWith('/__datatug_public_ovdb/cloud/')),
    async (route) => {
      const path = new URL(route.request().url()).pathname.replace(
        '/__datatug_public_ovdb/cloud',
        '',
      );
      const customerDatabase = path === '/v1/databases/northwind/dtql' ? 'northwind' : path === '/v1/databases/chinook/dtql' ? 'chinook' : undefined;
      if (customerDatabase && route.request().method() === 'POST') {
        const body = route.request().postData() ?? '';
        const query = readFileSync(join(source, `demo-project-1/queries/demodb/${customerDatabase}-customer-country-counts-server.query.dtql`), 'utf8');
        expect(body).toBe(query);
        posts.push('customer-' + customerDatabase);
        const attempt = posts.filter((value) => value === 'customer-' + customerDatabase).length;
        if (customerDatabase === 'chinook' && options.failCustomerChinookOnce && attempt === 1)
          return route.fulfill({ status: 503, body: 'fixture source refusal' });
        if (customerDatabase === 'chinook' && options.holdCustomerChinookSecond && attempt === 2)
          await options.holdCustomerChinookSecond;
        const rows = customerCounts[customerDatabase].rows;
        // Pinned SQLite-derived real aggregates in the public transport envelope, not a captured server receipt.
        return route.fulfill({ contentType: route.request().headers()['accept']?.includes('application/vnd.openvaultdb.query-stream+json') ? 'application/vnd.openvaultdb.query-stream+json' : 'application/json', json: { records: rows.map((data) => ({ data })), columns: ['country', 'customers'], complete: true, execution: { route: 'database', rowsReturned: rows.length, sources: [{ database: customerDatabase, collection: customerDatabase === 'northwind' ? 'Customers' : 'Customer' }] }, ...(simulatedProvider ? terms(customerDatabase) : {}) } });
      }
      if (path === '/v1/dtql' && route.request().method() === 'POST') {
        const body = route.request().postData() ?? '';
        rootBodies.push(body);
        expect(body).toBe(rootText);
        posts.push('comparison');
        if (
          options.failRootOnce &&
          posts.filter((value) => value === 'comparison').length === 1
        )
          return route.fulfill({
            status: 503,
            body: 'fixture temporary refusal',
          });
        const result = structuredClone(snapshot.comparison);
        if (simulatedProvider) {
          // Preserve captured root rows; simulate the coordinated new provider inventory/usage only.
          result.sourceRights = [...terms('northwind').sourceRights, ...terms('chinook').sourceRights];
          result.usedSourceIds = result.sourceRights.map((right: { sourceId: string }) => right.sourceId);
        }
        // Deliberately synthetic negative fixture only: real captured labels all have shipping matches.
        if (options.syntheticZero)
          result.records[0].data.country = 'United Kingdom';
        return route.fulfill({ json: result });
      }
      if (path === '/v1/databases/northwind')
        return route.fulfill({ json: { ...snapshot.northwind, ...(simulatedProvider ? { serverId: fixtureServerId, sourceRights: terms('northwind').sourceRights } : {}), capabilities: { ...snapshot.northwind.capabilities, dtql: true, dtqlStreaming: !options.customerOrdinary, dtqlStreamingErrors: !options.customerOrdinary } } });
      if (path === '/v1/databases/chinook')
        return route.fulfill({ json: { ...snapshot.chinook, ...(simulatedProvider ? { serverId: fixtureServerId, sourceRights: terms('chinook').sourceRights } : {}), capabilities: { ...snapshot.chinook.capabilities, dtql: true, dtqlStreaming: !options.customerOrdinary, dtqlStreamingErrors: !options.customerOrdinary } } });
      return route.abort();
    },
  );
  await context.route(
    (url) =>
      url.origin === 'https://ovdb.demodb.dev' ||
      (url.origin === local &&
        url.pathname.startsWith('/__datatug_public_ovdb/demodb/')),
    async (route) => {
      const path = new URL(route.request().url()).pathname.replace(
        '/__datatug_public_ovdb/demodb',
        '',
      );
      if (
        route.request().method() === 'GET' &&
        path === '/v1/databases/northwind'
      )
        return route.fulfill({
          json: {
            ...snapshot.northwind,
            capabilities: {
              ...snapshot.northwind.capabilities,
              dtqlStreaming: false,
              dtqlStreamingErrors: false,
            },
          },
        });
      if (route.request().method() !== 'POST') return route.abort();
      const body = route.request().postData() ?? '';
      const text = body.startsWith('{') ? JSON.parse(body).query : body;
      if (text === countQuery) {
        posts.push('countries');
        return route.fulfill({ json: countsEnvelope(counts) });
      }
      const distinctQuery = readFileSync(
        join(
          source,
          'demo-project-1/queries/demodb/northwind-country-counts-server.query.dtql',
        ),
        'utf8',
      );
      if (text === distinctQuery) {
        posts.push('inspector-counts');
        return route.fulfill({
          json: countsEnvelope(
            [...counts].sort(
              (a, b) =>
                b.orders - a.orders ||
                a.ShipCountry.localeCompare(b.ShipCountry),
            ),
          ),
        });
      }
      if (text === countryFixture('northwind-orders-query.dtql')) {
        posts.push('orders');
        return route.fulfill({
          json: {
            complete: !options.partialOrders,
            columns: fields,
            records: countryOrders.map((data) => ({ data })),
          },
        });
      }
      return route.abort();
    },
  );
  return {
    posts,
    downloads,
    mutations,
    rootBodies,
    executionSources: snapshot.comparison.execution.sources as {
      database: string;
      collection: string;
    }[],
  };
}
