import { expect, test } from './helpers/demodb-guard';
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
      const cloudPrefix = '/__datatug_public_ovdb/cloud';
      const localOrigin = new URL(testInfo.project.use.baseURL ?? 'http://localhost').origin;
      const isCloudRead = (url: URL) => (url.origin === 'https://cloud.openvaultdb.com' && url.pathname.startsWith('/v1/')) || (url.origin === localOrigin && url.pathname.startsWith(`${cloudPrefix}/v1/`));
      const requests: string[] = [];
      await context.route(isCloudRead, async route => {
        requests.push(route.request().url());
        const path = new URL(route.request().url()).pathname.replace(cloudPrefix, '');
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
      await context.route(url => url.origin === localOrigin && url.pathname.startsWith('/__datatug_public_ovdb/demodb/'), route => route.abort());
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
      const tabID = await tabs.nth(2).getAttribute('id');
      const panel = inspector.getByRole('tabpanel');
      expect(tabID).toBeTruthy();
      await expect(panel).toHaveAttribute('aria-labelledby', tabID ?? 'missing-tab');
      await expect.poll(() => tabs.nth(2).locator('button').evaluate(el => el.ariaControlsElements?.map(panel => panel.id))).toEqual([await panel.getAttribute('id')]);
      const session = await context.newCDPSession(page);
      const activeTitle = 'Northwind + Chinook · shared countries';
      await expect(panel).toHaveAccessibleName(activeTitle);
      await expect.poll(async () => {
        const ax = await session.send('Accessibility.getFullAXTree');
        const selectedTab = ax.nodes.find(node => node.role?.value === 'tab' && node.name?.value === activeTitle && node.properties?.some(property => property.name === 'selected' && property.value.value === true));
        const activePanel = ax.nodes.find(node => node.role?.value === 'tabpanel' && node.name?.value === activeTitle);
        const controls = selectedTab?.properties?.find(property => property.name === 'controls')?.value.relatedNodes;
        return !!activePanel?.backendDOMNodeId && !!controls?.some(node => node.backendDOMNodeId === activePanel.backendDOMNodeId);
      }).toBe(true);
      await testInfo.attach('native-tab-accessibility-tree', { body: JSON.stringify(await session.send('Accessibility.getFullAXTree')), contentType: 'application/json' });
      await session.detach();
      await expect.poll(() => tabs.nth(2).evaluate(el => {
        const label = el.querySelector('ion-label');
        const box = label?.getBoundingClientRect(), rail = el.parentElement?.getBoundingClientRect();
        return !!rail && !!box && !!label && label.scrollWidth <= label.clientWidth && box.left >= rail.left - 1 && box.right <= rail.right + 1;
      })).toBe(true).catch(async error => {
        await testInfo.attach('selected-tab-geometry', { body: JSON.stringify(await tabs.nth(2).evaluate(el => ({ tab: el.getBoundingClientRect().toJSON(), rail: el.parentElement?.getBoundingClientRect().toJSON(), labelWidth: el.querySelector('ion-label')?.clientWidth, labelScrollWidth: el.querySelector('ion-label')?.scrollWidth }))), contentType: 'application/json' });
        throw error;
      });
      // Selecting this showcase tab auto-runs it; do not accidentally request an explicit second run.
      await expect(inspector).toContainText('17 rows · 3 columns');
      await expect(inspector.getByRole('button', { name: 'Run on board', exact: true })).toBeEnabled();
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
      await expect(inspector.getByRole('button', { name: 'Run on board', exact: true })).toBeEnabled();
      expect(posts).toBe(1);
      await Promise.all([page.waitForResponse(response => isCloudRead(new URL(response.url())) && new URL(response.url()).pathname.replace(cloudPrefix, '') === '/v1/dtql' && response.request().method() === 'POST'), inspector.getByRole('button', { name: 'Run on board', exact: true }).click()]);
      await expect(inspector.getByRole('button', { name: 'Run on board', exact: true })).toBeEnabled();
      expect(posts).toBe(2);
      await inspector.scrollIntoViewIfNeeded();
      await inspector.screenshot({ path: testInfo.outputPath(`inspector-${name}.png`) });
      await page.screenshot({ path: testInfo.outputPath(`board-context-${name}.png`), fullPage: true });
      if (name === 'mobile') {
        const table = inspector.locator('.table-scroll');
        await table.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        await expect.poll(() => inspector.locator('table thead th').last().evaluate(el => {
          const edge = el.getBoundingClientRect(), rail = el.closest('.table-scroll')?.getBoundingClientRect();
          return !!rail && edge.left >= rail.left && edge.right <= rail.right + 1;
        })).toBe(true);
        await table.screenshot({ path: testInfo.outputPath('mobile-comparison-right-columns.png') });
      }
      if (!(await details.evaluate(el => (el as HTMLDetailsElement).open))) await details.locator('summary').click();
      await details.scrollIntoViewIfNeeded();
      await expect(details).toContainText('live · OVDB server');
      await details.screenshot({ path: testInfo.outputPath(`provenance-${name}.png`) });
      expect(posts).toBe(2);
      await testInfo.attach('acceptance-boundary', { body: JSON.stringify({ source: 'captured public anonymous OVDB responses', viewport, posts, requests, expected: 'full-width inspector; readable focused tab;17 rows; live · OVDB server; no invented terms; one query across tab changes; explicit Run sends one additional request', observed: 'all assertions passed' }), contentType: 'application/json' });
    });
  });
}
