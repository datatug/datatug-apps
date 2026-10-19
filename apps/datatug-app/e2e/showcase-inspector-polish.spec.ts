import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeGithub } from './helpers/fake-github';

// Public read snapshots isolate presentation checks from live CORS/availability.
// SQLite, query reruns and fabricated licence/profile metadata are not substitutes.
const snapshot = JSON.parse(readFileSync(join(process.cwd(), 'apps/datatug-app/e2e/fixtures/ovdb-inspector-snapshot.json'), 'utf8'));
for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 375, height: 812 }]] as const) {
  test.describe(`showcase inspector ${name}`, () => {
    test.use({ viewport });
    test('keeps long tabs readable, selection keyboard accessible and held results reusable', async ({ page, context }, testInfo) => {
      const source = process.env['DATATUG_E2E_GITHUB_FAKE'];
      test.skip(!source, 'requires the paired committed demo checkout');
      if (!source) return;
      await installFakeGithub(context, [{ fullName: 'datatug/datatug-demo-project', dir: source }]);
      let posts = 0;
      await context.route('https://cloud.openvaultdb.com/v1/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/v1/dtql' && route.request().method() === 'POST') {
          posts++;
          expect(route.request().postData()).toBe(readFileSync(join(source, 'demo-project-1/queries/demodb/customer-country-comparison-server.query.dtql'), 'utf8'));
          await route.fulfill({ json: snapshot.comparison });
        } else if (path === '/v1/databases/northwind') await route.fulfill({ json: snapshot.northwind });
        else if (path === '/v1/databases/chinook') await route.fulfill({ json: snapshot.chinook });
        else await route.abort();
      });
      // Unrelated auto charts may show their normal network error; this is a held-result layout check.
      await context.route('https://*.demodb.dev/**', route => route.abort());
      await page.goto('/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/board/showcase');
      const inspector = page.locator('ion-card').filter({ hasText: 'Inspect saved query results' }).first();
      await expect(inspector).toBeVisible();
      await expect.poll(() => inspector.locator('xpath=../..').evaluate(el => el.clientWidth / (el.parentElement?.clientWidth ?? 1))).toBeGreaterThan(0.98);
      const segment = inspector.locator('ion-segment');
      await expect(segment).toHaveJSProperty('scrollable', true);
      const tabs = segment.locator('ion-segment-button');
      await expect(tabs).toHaveCount(4);
      await tabs.nth(0).locator('button').focus();
      await tabs.nth(0).locator('button').press('ArrowRight');
      await expect(segment).toHaveJSProperty('value', 'id:sqlite-countries');
      await expect(tabs.nth(1).locator('button')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(segment).toHaveJSProperty('value', 'id:shared-customer-countries');
      await expect(tabs.nth(2).locator('button')).toBeFocused();
      await expect.poll(() => tabs.nth(2).evaluate(el => {
        const label = el.querySelector('ion-label');
        const box = el.getBoundingClientRect(), rail = el.parentElement?.getBoundingClientRect();
        return !!rail && !!label && label.scrollWidth <= label.clientWidth && box.left >= rail.left - 1 && box.right <= rail.right + 1;
      })).toBe(true);
      await inspector.getByRole('button', { name: 'Run on board', exact: true }).click();
      await expect(inspector).toContainText('17 rows · 3 columns');
      const details = inspector.locator('.source-details');
      await details.locator('summary').click();
      await expect(details).toContainText('live · OVDB server');
      await expect(details).toContainText('Source data terms not declared.');
      await expect(details).not.toContainText('protected');
      await expect(inspector.locator('table thead')).toContainText('northwindCustomers');
      await expect(inspector.locator('table thead')).toContainText('chinookCustomers');
      expect(posts).toBe(1);
      await tabs.nth(1).click();
      await tabs.nth(2).click();
      await expect(inspector).toContainText('17 rows · 3 columns');
      expect(posts).toBe(1);
      await inspector.scrollIntoViewIfNeeded();
      await inspector.screenshot({ path: testInfo.outputPath(`inspector-${name}.png`) });
      await page.screenshot({ path: testInfo.outputPath(`board-context-${name}.png`), fullPage: true });
      await testInfo.attach('acceptance-boundary', { body: JSON.stringify({ source: 'captured public anonymous OVDB responses', viewport, posts, expected: 'full-width inspector; readable focused tab;17 rows; live · OVDB server; no invented terms; one query across tab changes', observed: 'all assertions passed' }), contentType: 'application/json' });
    });
  });
}
