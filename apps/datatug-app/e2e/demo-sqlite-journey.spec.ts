import { BrowserContext } from '@playwright/test';
import { DEMODB_HOST, expect, test } from './helpers/demodb-guard';
// The catalog is plain TypeScript with no Angular imports; the lib's barrel would pull the whole app into Playwright.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  demoSqliteCatalog,
  demoSqliteDatasetIds,
  isLargeDemoSqliteDataset,
} from '../../../libs/datatug/main/src/lib/queries/demo-sqlite-catalog';

/**
 * Cross-site journey, from a DemoDB dataset page to a running local SQLite copy in DataTug:
 *
 *   1. open <dataset>.demodb.dev            (a real DemoDB page)
 *   2. its primary call to action is "Explore SQLite in DataTug" (no "WASM" in the wording), first in the hero
 *   3. click it                              -> DataTug /demo/sqlite/<dataset> (the exact URL DemoDB links to)
 *   4. the local SQLite copy initialises     -> the table list of that dataset
 *
 * The CTA hrefs are absolute (https://datatug.app/...), so the browser context maps both origins instead of
 * touching real hosts: https://datatug.app/** is answered by THIS suite's built DataTug app (the web server in
 * playwright.demo-sqlite.config.ts), and the DemoDB hosts are either the pinned local fixtures (default; the live
 * demodb.dev only with DEMODB_E2E_MODE=live) or a locally
 * built DemoDB website served by `wrangler dev --env local` (set DEMODB_SITE_LOCAL_URL=http://localhost:<port>,
 * whose <dataset>.localhost hosts the Worker serves; see demo-db/websites). Everything else is cut off.
 *
 * Not covered here: DataTug's real production hosting (datatug.app's deploy and DNS), TLS, and the DemoDB
 * websites' own markup contract beyond the CTA (see demo-db/websites scripts/test-dataset-contract.mjs).
 */

const DATATUG_ORIGIN = 'https://datatug.app';
const DEMODB = DEMODB_HOST;
const LOCAL_SITE = process.env['DEMODB_SITE_LOCAL_URL']?.replace(/\/$/, '');
const CTA_TEXT = 'Explore SQLite in DataTug';

/** Maps the two absolute origins onto the local servers; the DemoDB side only when a local site is given. */
async function mapOrigins(
  context: BrowserContext,
  appBaseUrl: string,
): Promise<void> {
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
    if (DEMODB.test(url.hostname)) {
      // No local site: fall through to the guard (helpers/demodb-guard.ts), which answers the DemoDB pages and
      // files from the local fixtures (or, only with DEMODB_E2E_MODE=live, from the live hosts, once per URL).
      if (!LOCAL_SITE) return route.fallback();
      const local = new URL(LOCAL_SITE);
      const sub =
        url.hostname === 'demodb.dev'
          ? 'localhost'
          : url.hostname.replace(/\.demodb\.dev$/, '.localhost');
      const target = `${local.protocol}//${sub}:${local.port}${url.pathname}${url.search}`;
      const response = await route.fetch({
        url: target,
        headers: { ...route.request().headers(), host: new URL(target).host },
      });
      return route.fulfill({ response });
    }
    if (
      url.origin === new URL(appBaseUrl).origin ||
      url.protocol === 'data:' ||
      url.protocol === 'blob:'
    ) {
      return route.continue();
    }
    return route.abort();
  });
}

for (const id of demoSqliteDatasetIds) {
  const large = isLargeDemoSqliteDataset(demoSqliteCatalog[id]);
  test(`${id}: DemoDB page -> "${CTA_TEXT}" -> DataTug /demo/sqlite/${id}${large ? ' (stops at the download confirmation)' : ' -> local SQLite initialises'}`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    if (!baseURL) throw new Error('Playwright baseURL is required for this journey');
    await mapOrigins(context, baseURL);
    const requested: string[] = [];
    context.on('request', (request) => requested.push(request.url()));

    // 1-2. The DemoDB page: the primary call to action, first, worded without WASM.
    await page.goto(`https://${id}.demodb.dev/`);
    const actions = page.locator('.hero-actions');
    const first = actions.locator('a').first();
    await expect(first).toHaveText(CTA_TEXT);
    await expect(first).toHaveClass(/\bbutton-primary\b/);
    await expect(first).toHaveAttribute(
      'href',
      `${DATATUG_ORIGIN}/demo/sqlite/${id}`,
    );
    expect(await first.innerText()).not.toMatch(/wasm/i);
    await expect(actions.locator('a.button-primary')).toHaveCount(1);

    // 3. Click: DataTug opens the same dataset.
    await first.click();
    await expect(page).toHaveURL(`${DATATUG_ORIGIN}/demo/sqlite/${id}`);

    if (large) {
      // AdventureWorks asks before it downloads 126.8 MB (or, with no OPFS, is refused), and has downloaded nothing yet.
      await expect(
        page
          .getByTestId('demo-sqlite-confirm-large')
          .or(page.getByTestId('demo-sqlite-unsupported')),
      ).toBeVisible({ timeout: 60_000 });
      expect(
        requested.filter((url) => url.endsWith(`/data/${id}.sqlite`)),
      ).toEqual([]);
      return;
    }
    // 4. The local SQLite copy initialises: the dataset's tables.
    await expect(page.getByTestId('ovdb-table-list')).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByTestId('ovdb-status')).toHaveText(
      /^Local copy (ready|\(memory only\))$/,
    );
    await expect(
      page
        .getByTestId('ovdb-table-list')
        .locator('[data-testid^="table-"]')
        .first(),
    ).toBeVisible();
    expect(requested.some((url) => url.endsWith(`/data/${id}.sqlite`))).toBe(
      true,
    );
  });
}
