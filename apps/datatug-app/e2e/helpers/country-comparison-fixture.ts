import { expect, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeGithub } from './fake-github';
export const countryFixture = (name: string) =>
  readFileSync(
    join(process.cwd(), 'apps/datatug-app/e2e/fixtures', name),
    'utf8',
  );
export const countryBoardURL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/board/showcase';
export const countryOrders = JSON.parse(
  countryFixture('northwind-orders-records.json'),
) as Record<string, unknown>[];
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
  } = {},
) {
  await installFakeGithub(context, [
    { fullName: 'datatug/datatug-demo-project', dir: source },
  ]);
  await context.route(
    'https://raw.githubusercontent.com/demo-db/northwind/**/source-rights.json',
    (route) =>
      route.fulfill({ contentType: 'application/json', body: publication }),
  );
  await context.route(
    'https://raw.githubusercontent.com/demo-db/northwind/**/shipping-country-count-rights.json',
    (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: countPublication,
      }),
  );
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
        // Deliberately synthetic negative fixture only: real captured labels all have shipping matches.
        if (options.syntheticZero)
          result.records[0].data.country = 'United Kingdom';
        return route.fulfill({ json: result });
      }
      if (path === '/v1/databases/northwind')
        return route.fulfill({ json: snapshot.northwind });
      if (path === '/v1/databases/chinook')
        return route.fulfill({ json: snapshot.chinook });
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
