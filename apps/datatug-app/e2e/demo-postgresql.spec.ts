import { BrowserContext, expect, Page, Route, test } from '@playwright/test';
import { playwrightDecodableHeaders } from './helpers/live-fetch-headers';
import { isRateLimited, rateLimitMessage, readBreaker, tripBreaker } from './helpers/demodb-guard-state';
// The catalog is plain TypeScript with no imports; the lib's barrel would pull the whole app into Playwright.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  DEMO_POSTGRESQL_LABEL,
  demoPostgresqlCatalog,
  demoPostgresqlDatasetIds,
} from '../../../libs/datatug/main/src/lib/demo-postgresql/demo-postgresql-catalog';

/**
 * Hosted PostgreSQL DemoDB editions in DataTug, THROUGH the public OpenVaultDB server (acceptance brief
 * demodb-datatug-unified-demo-databases.md steps 13-15): DataTug /demo/ovdb/<dataset>-postgresql reads
 * https://cloud.openvaultdb.com/v1/databases/<dataset>-postgresql, never Neon, with no edit/delete/insert/reset
 * control because the database descriptor reports none of those capabilities.
 *
 * These tests call the REAL live API (nothing replaces the OVDB server or the data), so they need the network and
 * are written to tolerate its behaviour: a cold start takes up to ~6 s and a mount that is still pending answers
 * `503 database_unavailable` for a moment (the app retries with a back-off; every wait below is long, and the
 * config never retries a test: a retry is another round of live requests, and HTTP 429 stops everything). The two failure tests are the exception: they force 503 on the real
 * route to prove the retry and the friendly error, and pass everything else through.
 *
 * The built app is served as https://datatug.app (the browser context maps that origin onto this suite's web server,
 * like demo-sqlite-journey.spec.ts), so the live server sees the production origin and its real CORS allow-list is
 * exercised. Any other host is cut off, and every request the page makes is recorded: the suite asserts the page
 * talked to datatug.app and cloud.openvaultdb.com only (no Neon, no PostgreSQL host).
 */

const DATATUG_ORIGIN = 'https://datatug.app';
const OVDB_HOST = 'cloud.openvaultdb.com';
const OVDB = `https://${OVDB_HOST}`;
const READ_ONLY_LABEL = 'Hosted PostgreSQL (read-only via OpenVaultDB)';
/** A cold start is ~6 s and a pending mount is retried for ~10 s; allow both plus the page. */
const LIVE = 90_000;

/**
 * Request budget: the most requests ONE test may send to cloud.openvaultdb.com (descriptor GET, dtql POSTs and CORS
 * preflights, including the app's own 503 back-off retries). A page that loops fails the test instead of hammering the
 * server. Override with DEMODB_E2E_MAX_OVDB_REQUESTS.
 */
const OVDB_REQUEST_BUDGET = Number(process.env['DEMODB_E2E_MAX_OVDB_REQUESTS'] || 40);
/**
 * The first rate-limit answer (HTTP 429 or a Cloudflare block page) from the OpenVaultDB server trips the breaker kept in a
 * FILE (helpers/demodb-guard-state.ts), so a worker that Playwright starts after a failure still refuses every request.
 * Requests are counted when they are sent and refused once the per-test budget is spent (the app's own 503 back-off
 * retries count like any other request).
 */
let currentSeen: Seen[] = [];
let ovdbSent = 0;
let budgetRefusals = 0;

interface Seen {
  readonly method: string;
  readonly url: string;
}

/** Maps https://datatug.app onto the local build, passes cloud.openvaultdb.com through, cuts off the rest. */
async function openContext(
  context: BrowserContext,
  appBaseUrl: string,
  onOvdb?: (route: Route) => Promise<boolean>,
): Promise<Seen[]> {
  const seen: Seen[] = [];
  currentSeen = seen;
  ovdbSent = 0;
  budgetRefusals = 0;
  context.on('request', (request) =>
    seen.push({ method: request.method(), url: request.url() }),
  );
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === DATATUG_ORIGIN) {
      // The dev/preview server checks the Host header, and some browsers send the original (datatug.app) one.
      const response = await route.fetch({
        url: `${appBaseUrl}${url.pathname}${url.search}`,
        headers: {
          ...route.request().headers(),
          host: new URL(appBaseUrl).host,
        },
      });
      return route.fulfill({ response });
    }
    if (url.hostname === OVDB_HOST) {
      if (readBreaker()) return route.abort();
      if (onOvdb && (await onOvdb(route))) return;
      // Refuse BEFORE sending once the budget is spent: a page that loops (or retries a 503) cannot hammer the server.
      if (ovdbSent >= OVDB_REQUEST_BUDGET) {
        budgetRefusals += 1;
        return route.abort();
      }
      ovdbSent += 1;
      // Never advertise zstd: Playwright cannot decode it, and Firefox would parse the raw bytes as JSON (helpers/live-fetch-headers.ts).
      const response = await route.fetch({ headers: playwrightDecodableHeaders(route.request().headers()) });
      const status = response.status();
      const headers = response.headers();
      const text = status === 200 ? '' : (await response.text()).slice(0, 4096);
      if (isRateLimited(status, headers, text)) tripBreaker(rateLimitMessage(route.request().url(), status, headers['retry-after']));
      return route.fulfill({ response });
    }
    if (url.protocol === 'data:' || url.protocol === 'blob:') {
      return route.continue();
    }
    return route.abort();
  });
  return seen;
}

/** The hosts the page talked to (data: and blob: aside). */
const hostsOf = (seen: readonly Seen[]): string[] =>
  [
    ...new Set(
      seen
        .map(({ url }) => new URL(url))
        .filter((url) => /^https?:$/.test(url.protocol))
        .map((url) => url.hostname),
    ),
  ].sort();

function expectOnlyDataTugAndOvdb(seen: readonly Seen[]): void {
  const hosts = hostsOf(seen);
  expect(hosts).toContain(OVDB_HOST);
  expect(
    hosts.filter((host) => host !== OVDB_HOST && host !== 'datatug.app'),
  ).toEqual([]);
  // No database host, whatever it is called.
  expect(
    hosts.filter((host) => /neon|postgres|pooler|\.tech$/i.test(host)),
  ).toEqual([]);
}

/** Everything the page asked OVDB for: the descriptor, then reads — never a write, batch, reset or direct record call. */
function expectOnlyReads(seen: readonly Seen[]): void {
  const ovdb = seen.filter(({ url }) => new URL(url).hostname === OVDB_HOST);
  expect(ovdb.length).toBeGreaterThan(0);
  for (const { method, url } of ovdb) {
    const { pathname } = new URL(url);
    const read =
      (method === 'GET' &&
        /^\/v1\/databases\/[a-z]+-postgresql$/.test(pathname)) ||
      (method === 'POST' &&
        /^\/v1\/databases\/[a-z]+-postgresql\/dtql$/.test(pathname)) ||
      method === 'OPTIONS';
    expect(read, `${method} ${pathname} is not a read`).toBe(true);
  }
}

/** No control of any kind that could change data. */
async function expectNoMutationControls(page: Page): Promise<void> {
  for (const id of [
    'reset-database',
    'record-edit',
    'record-delete',
    'record-save',
    'record-cancel',
  ]) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }
  await expect(
    page.locator(
      '[data-testid^="record-input-"], [data-testid^="record-null-"]',
    ),
  ).toHaveCount(0);
  await expect(
    page.locator('ion-input, input:not([type="hidden"]), textarea, select'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: /^(edit|delete|insert|add|save|reset|remove)\b/i,
    }),
  ).toHaveCount(0);
}

// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
  const asked = currentSeen.filter(({ url }) => new URL(url).hostname === OVDB_HOST).length;
  currentSeen = [];
  testInfo.annotations.push({
    type: 'demodb-requests',
    description: JSON.stringify({
      mode: 'live',
      hosts: { [OVDB_HOST]: { total: asked, handled: asked, fixture: 0, memo: 0, live: ovdbSent, refused: budgetRefusals, escaped: 0 } },
    }),
  });
  const tripped = readBreaker();
  if (tripped) throw new Error(tripped);
  expect(budgetRefusals, `requests to ${OVDB_HOST} refused because this test spent its budget of ${OVDB_REQUEST_BUDGET}`).toBe(0);
});

const openEdition = async (page: Page, databaseId: string, path = '') => {
  await page.goto(`${DATATUG_ORIGIN}/demo/ovdb/${databaseId}${path}`);
};

test.describe('Chinook (PostgreSQL) in DataTug through OpenVaultDB', () => {
  test('opens from its route, lists the tables, reads Artist rows, and is read-only', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    if (!baseURL) throw new Error('Playwright baseURL is required');
    const seen = await openContext(context, baseURL);
    const chinook = demoPostgresqlCatalog.chinook;

    await openEdition(page, chinook.databaseId);
    // Table list, with the read-only labelling.
    await expect(page.getByTestId('ovdb-table-list')).toBeVisible({
      timeout: LIVE,
    });
    await expect(page.getByTestId('ovdb-status')).toHaveText(READ_ONLY_LABEL);
    expect(READ_ONLY_LABEL).toBe(DEMO_POSTGRESQL_LABEL);
    await expect(page.getByTestId('ovdb-database-header')).toContainText(
      'read-only',
    );
    await expect(page.getByTestId('ovdb-database-header')).not.toContainText(
      'editable',
    );
    await expect(page.getByTestId('demo-ovdb-readonly')).toContainText(
      'holds no database credentials',
    );
    await expect(
      page.getByTestId('ovdb-table-list').locator('[data-testid^="table-"]'),
    ).toHaveCount(chinook.tableCount);
    for (const table of ['Album', 'Artist', 'Track', 'Invoice', 'Customer']) {
      await expect(page.getByTestId(`table-${table}`)).toBeVisible();
    }
    await expectNoMutationControls(page);

    // Rows of Artist, read through OVDB.
    await page.getByTestId('table-Artist').click();
    await expect(page).toHaveURL(
      `${DATATUG_ORIGIN}/demo/ovdb/chinook-postgresql/table/Artist`,
    );
    await expect(page.getByTestId('ovdb-rows')).toBeVisible({ timeout: LIVE });
    await expect(page.getByTestId('ovdb-rows')).toContainText('AC/DC');
    await expect(page.getByTestId('ovdb-rows').locator('th')).toHaveText([
      'ArtistId',
      'Name',
    ]);
    expect(await page.locator('[data-testid^="row-"]').count()).toBeGreaterThan(
      50,
    );
    await expectNoMutationControls(page);

    // A record opens read-only: its fields are text, there is nothing to press.
    await page.getByTestId('row-0').click();
    await expect(page.getByTestId('ovdb-record')).toBeVisible();
    await expect(page.getByTestId('ovdb-record')).toContainText('ArtistId');
    await expect(page.getByTestId('ovdb-record')).toContainText('bigint');
    await expect(
      page.getByTestId('ovdb-record').locator('ion-button, button'),
    ).toHaveCount(0);
    await expectNoMutationControls(page);

    // A forced write attempt through the UI is impossible: the keyboard shortcuts a row could take do nothing.
    const before = seen.length;
    await page.getByTestId('row-1').focus();
    for (const key of ['Delete', 'Backspace', 'e', 'Control+s'])
      await page.keyboard.press(key);
    await page.getByTestId('row-1').dblclick();
    await page.waitForTimeout(500);
    expect(
      seen
        .slice(before)
        .filter(
          ({ url }) =>
            new URL(url).hostname === OVDB_HOST &&
            !/\/dtql$|\/v1\/databases\/chinook-postgresql$/.test(
              new URL(url).pathname,
            ),
        ),
    ).toEqual([]);
    await expectNoMutationControls(page);

    // Everything went through the public server only.
    expectOnlyDataTugAndOvdb(seen);
    expectOnlyReads(seen);
    expect(
      seen.some(
        ({ method, url }) =>
          method === 'POST' &&
          url === `${OVDB}/v1/databases/chinook-postgresql/dtql`,
      ),
    ).toBe(true);
    expect(
      seen.some(({ url }) => url === `${OVDB}/v1/databases/chinook-postgresql`),
    ).toBe(true);
  });

  test('a table address and a reload open the same rows; an unknown table is explained', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    if (!baseURL) throw new Error('Playwright baseURL is required');
    await openContext(context, baseURL);
    await openEdition(page, 'chinook-postgresql', '/table/Genre');
    await expect(page.getByTestId('ovdb-rows')).toContainText('Rock', {
      timeout: LIVE,
    });
    await page.reload();
    await expect(page.getByTestId('ovdb-rows')).toContainText('Rock', {
      timeout: LIVE,
    });
    await openEdition(page, 'Chinook-PostgreSQL', '/table/NoSuchTable');
    await expect(page.getByTestId('ovdb-unknown-table')).toBeVisible({
      timeout: LIVE,
    });
    await expectNoMutationControls(page);
  });

  test('the edition list offers every hosted database; an unknown id is explained', async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw new Error('Playwright baseURL is required');
    const seen = await openContext(context, baseURL);
    await page.goto(`${DATATUG_ORIGIN}/demo/ovdb`);
    await expect(page.getByTestId('demo-ovdb-editions')).toBeVisible({
      timeout: 60_000,
    });
    for (const id of demoPostgresqlDatasetIds) {
      await expect(page.getByTestId(`edition-${id}`)).toHaveAttribute(
        'href',
        `/demo/ovdb/${id}-postgresql`,
      );
    }
    await page.goto(`${DATATUG_ORIGIN}/demo/ovdb/chinook`);
    await expect(page.getByTestId('demo-ovdb-editions')).toContainText(
      'There is no hosted DemoDB database “chinook”',
    );
    // Neither page opens a database, so neither touches the server.
    expect(
      seen.filter(({ url }) => new URL(url).hostname === OVDB_HOST),
    ).toEqual([]);
  });

  test('waits out a database that is still mounting: 503 database_unavailable is retried', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    if (!baseURL) throw new Error('Playwright baseURL is required');
    let refused = 0;
    // The first two reads of the descriptor are answered like a pending mount; everything else is the live server.
    await openContext(context, baseURL, async (route) => {
      const request = route.request();
      if (request.method() === 'GET' && refused < 2) {
        refused++;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': DATATUG_ORIGIN },
          body: JSON.stringify({
            error: { code: 'database_unavailable', message: 'mounting' },
          }),
        });
        return true;
      }
      return false;
    });
    await openEdition(page, 'chinook-postgresql');
    await expect(page.getByTestId('ovdb-table-list')).toBeVisible({
      timeout: LIVE,
    });
    expect(refused).toBe(2);
  });

  test('says so, and offers Try again, when the database stays unavailable', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    if (!baseURL) throw new Error('Playwright baseURL is required');
    let unavailable = true;
    await openContext(context, baseURL, async (route) => {
      if (unavailable && route.request().method() === 'GET') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': DATATUG_ORIGIN },
          body: JSON.stringify({
            error: { code: 'database_unavailable', message: 'mounting' },
          }),
        });
        return true;
      }
      return false;
    });
    await openEdition(page, 'chinook-postgresql');
    await expect(page.getByTestId('demo-ovdb-failed')).toContainText(
      /waking up or temporarily unavailable/,
      { timeout: LIVE },
    );
    await expect(page.getByTestId('ovdb-table-list')).toHaveCount(0);
    unavailable = false;
    await page.getByTestId('demo-ovdb-retry').click();
    await expect(page.getByTestId('ovdb-table-list')).toBeVisible({
      timeout: LIVE,
    });
    await expect(page.getByTestId('demo-ovdb-failed')).toHaveCount(0);
  });
});

// One smoke journey per hosted edition, driven by the catalog: the route opens, the tables listed are the catalog's
// count, and one table shows rows. Live data, so tolerant to cold starts (LIVE waits), with no test retries.
for (const id of demoPostgresqlDatasetIds) {
  const edition = demoPostgresqlCatalog[id];
  test(`${id}: ${edition.route} lists ${edition.tableCount} tables and shows rows of ${edition.sampleTable}, read-only, via ${OVDB_HOST}`, async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    // Minimum live traffic: every edition is smoke-tested in Chromium; Firefox repeats only Chinook (the
    // hand-written tests above also run in both browsers).
    test.skip(testInfo.project.name !== 'chromium' && id !== 'chinook', 'Firefox repeats only the Chinook edition.');
    test.setTimeout(240_000);
    if (!baseURL) throw new Error('Playwright baseURL is required');
    const seen = await openContext(context, baseURL);

    await openEdition(page, edition.databaseId);
    await expect(page.getByTestId('ovdb-table-list')).toBeVisible({
      timeout: LIVE,
    });
    await expect(page.getByTestId('ovdb-status')).toHaveText(READ_ONLY_LABEL);
    await expect(
      page.getByTestId('ovdb-table-list').locator('[data-testid^="table-"]'),
    ).toHaveCount(edition.tableCount);
    await expect(
      page.getByTestId(`table-${edition.sampleTable}`),
    ).toBeVisible();

    await page.getByTestId(`table-${edition.sampleTable}`).click();
    await expect(page.getByTestId('ovdb-rows')).toBeVisible({ timeout: LIVE });
    await expect(page.getByTestId('row-0')).toBeVisible();
    expect((await page.getByTestId('row-0').innerText()).trim()).not.toBe('');
    await expectNoMutationControls(page);

    expectOnlyDataTugAndOvdb(seen);
    expectOnlyReads(seen);
    expect(
      seen.some(
        ({ url }) => url === `${OVDB}/v1/databases/${edition.databaseId}/dtql`,
      ),
    ).toBe(true);
  });
}
