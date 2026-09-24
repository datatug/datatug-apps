import { createServer, type Server } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test } from './fixtures/agent-server';

const largeRun = process.env['DATATUG_LARGE_E2E'] === '1';
const rowCount = largeRun ? 120_000 : 205;
const sourcePageSize = largeRun ? 500 : 25;
const visibleSourcePageSize = Math.min(100, sourcePageSize);
const alphaRowIndex = rowCount % 2;
const queryId = 'large-invoices-country-join';

function startOvdb(): Promise<{
  server: Server;
  port: number;
  counts: { invoices: number; countries: number; closed: number };
  setCountryName: (name: string) => void;
}> {
  const counts = { invoices: 0, countries: 0, closed: 0 };
  let countryName = 'Alpha';
  const origin = `http://localhost:${process.env['DATATUG_E2E_PORT'] || '4200'}`;
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, Accept, OVDB-Page-Size, OVDB-Page-Token, OVDB-Page-Close',
    'Content-Type': 'application/json',
  };
  const server = createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, headers);
      response.end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405, headers);
      response.end();
      return;
    }
    if (request.headers['ovdb-page-close'] === 'true') {
      counts.closed++;
      response.writeHead(204, headers);
      response.end();
      return;
    }
    if (request.url === '/v1/databases/countries/dtql') {
      counts.countries++;
      response.writeHead(200, headers);
      response.end(
        JSON.stringify({
          records: [
            { key: '1', data: { id: 1, name: countryName, population: 100 } },
            { key: '2', data: { id: 2, name: 'Beta', population: 200 } },
          ],
          snapshotToken: 'countries-snapshot',
        }),
      );
      return;
    }
    if (request.url === '/v1/databases/orders/dtql') {
      const token = request.headers['ovdb-page-token'];
      const offset = token ? Number(String(token).slice(2)) : 0;
      const pageSize = Number(request.headers['ovdb-page-size'] ?? 500);
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > rowCount ||
        !Number.isSafeInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 500
      ) {
        response.writeHead(400, headers);
        response.end('{}');
        return;
      }
      const count = Math.min(pageSize, sourcePageSize, rowCount - offset);
      const records = Array.from({ length: count }, (_, index) => {
        const id = rowCount - offset - index;
        return {
          key: String(id),
          data: { id, country_id: (id % 2) + 1, amount: 1.25 },
        };
      });
      const next = offset + count;
      counts.invoices++;
      response.writeHead(200, headers);
      response.end(
        JSON.stringify({
          records,
          snapshotToken: 'orders-snapshot',
          ...(next < rowCount ? { nextPageToken: `p-${next}` } : {}),
        }),
      );
      return;
    }
    response.writeHead(404, headers);
    response.end('{}');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve({
        server,
        port: (server.address() as AddressInfo).port,
        counts,
        setCountryName: (name) => {
          countryName = name;
        },
      });
    });
  });
}

test('pages a cross-database join on demand and stores the full result', async ({
  page,
  incidentAgentServer,
}) => {
  test.setTimeout(120_000);
  const ovdb = await startOvdb();
  try {
    const queryDir = join(incidentAgentServer.demoDir, 'queries', 'sales');
    writeFileSync(
      join(queryDir, `${queryId}.query.json`),
      JSON.stringify({
        id: queryId,
        title: 'Large invoices joined to countries',
        type: 'DTQL',
        federation: {
          ovdbBaseUrl: `http://127.0.0.1:${ovdb.port}`,
          tables: [
            {
              database: 'orders',
              name: 'Invoice',
              fields: ['id', 'country_id', 'amount'],
            },
            {
              database: 'countries',
              name: 'Country',
              fields: ['id', 'name', 'population'],
            },
          ],
        },
        recordsets: [
          {
            columns: [
              { name: 'id', type: 'number' },
              { name: 'amount', type: 'number' },
              { name: 'country', type: 'string' },
              { name: 'population', type: 'number' },
            ],
          },
        ],
      }),
    );
    writeFileSync(
      join(queryDir, `${queryId}.query.dtql`),
      `from:
  database: orders
  name: Invoice
  alias: i
  joins:
    - type: left
      from: {database: countries, name: Country, alias: c}
      on: [{left: {field: country_id, source: i}, op: '==', right: {field: id, source: c}}]
columns:
  - {field: id, source: i}
  - {field: amount, source: i}
  - {field: name, source: c, as: country}
  - {field: population, source: c}
`,
    );

    await page.goto(
      `/store/${incidentAgentServer.storeId}/project/datatug-demo-project/query/${queryId}?id=sales/${queryId}`,
    );
    await expect(
      page.getByText('Visible rows loads the first result page'),
    ).toBeVisible();
    expect(
      await page
        .locator('ion-select[label="Result mode"]')
        .evaluate(
          (element) => (element as HTMLElement & { value: string }).value,
        ),
    ).toBe('visible');
    await page.locator('ion-button').filter({ hasText: 'Run query' }).click();
    const pages = page.getByLabel('Result pages');
    await expect(pages).toContainText('Rows 1–100');
    await expect(page.locator('table.run-result-table tbody tr')).toHaveCount(
      100,
    );
    await expect(
      page
        .locator('table.run-result-table tbody tr')
        .nth(alphaRowIndex)
        .locator('td')
        .nth(2),
    ).toContainText('Alpha');
    expect(ovdb.counts).toMatchObject({
      invoices: Math.ceil(100 / visibleSourcePageSize),
      countries: 1,
    });

    ovdb.setCountryName('Gamma');
    await pages.getByText('Next').click();
    await expect(pages).toContainText('Rows 101–200');
    await expect(
      page
        .locator('table.run-result-table tbody tr')
        .nth(alphaRowIndex)
        .locator('td')
        .nth(2),
    ).toContainText('Alpha');
    expect(ovdb.counts.invoices).toBe(Math.ceil(200 / visibleSourcePageSize));
    await pages.getByText('Previous').click();
    await expect(pages).toContainText('Rows 1–100');
    expect(ovdb.counts.invoices).toBe(Math.ceil(200 / visibleSourcePageSize));

    await page.locator('ion-select[label="Result mode"]').click();
    await page.getByRole('radio', { name: 'Full result' }).click();
    await page.getByRole('button', { name: 'OK' }).click();
    await page.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        __federatedProgress?: string[];
      };
      state.__federatedProgress = [];
      new MutationObserver(() => {
        const text = document
          .querySelector('[role="status"]')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim();
        if (text && state.__federatedProgress?.at(-1) !== text)
          state.__federatedProgress?.push(text);
      }).observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    await page.locator('ion-button').filter({ hasText: 'Run query' }).click();
    await expect(pages).toContainText(`Rows 1–100 of ${rowCount}`, {
      timeout: 90_000,
    });
    await expect(
      page
        .locator('table.run-result-table tbody tr')
        .nth(alphaRowIndex)
        .locator('td')
        .nth(2),
    ).toContainText('Gamma');
    expect(ovdb.counts).toMatchObject({
      invoices:
        Math.ceil(200 / visibleSourcePageSize) +
        Math.ceil(rowCount / sourcePageSize),
      countries: 2,
    });
    expect(ovdb.counts.closed).toBeGreaterThanOrEqual(4);
    const progress = await page.evaluate(
      () =>
        (globalThis as typeof globalThis & { __federatedProgress?: string[] })
          .__federatedProgress ?? [],
    );
    expect(
      progress.some((item) =>
        item.includes(
          `loaded ${rowCount + 2} rows; processed ${rowCount} rows`,
        ),
      ),
    ).toBe(true);

    const lastRow = await page.evaluate(async (lastIndex) => {
      const name = (await indexedDB.databases()).find((database) =>
        database.name?.startsWith('datatug-output-'),
      )?.name;
      if (!name) throw new Error('The browser did not retain result pages.');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<unknown>((resolve, reject) => {
          const request = database
            .transaction('rows', 'readonly')
            .objectStore('rows')
            .get(lastIndex);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    }, rowCount);
    expect(lastRow).toEqual([
      { type: 'number', value: 1 },
      { type: 'number', value: 1.25 },
      { type: 'string', value: 'Beta' },
      { type: 'number', value: 200 },
    ]);
    await page.evaluate(async () => {
      const debug = (
        globalThis as typeof globalThis & {
          ng?: {
            getComponent: (element: Element) => {
              federatedQuery: { dispose: () => Promise<void> };
            };
          };
        }
      ).ng;
      const element = document.querySelector('sneat-datatug-sql-editor');
      if (!debug || !element)
        throw new Error('The query component is unavailable for cleanup.');
      await debug.getComponent(element).federatedQuery.dispose();
    });
    expect(
      await page.evaluate(async () =>
        (await indexedDB.databases()).filter((database) =>
          database.name?.startsWith('datatug-'),
        ),
      ),
    ).toEqual([]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      ovdb.server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
