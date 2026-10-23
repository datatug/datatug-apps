import { expect, test } from './helpers/demodb-guard';
import {
  installCountryComparisonFixture,
  countryBoardURL as boardURL,
  countryOrders as orders,
} from './helpers/country-comparison-fixture';
for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 1000 }],
  ['mobile', { width: 375, height: 812 }],
] as const) {
  test.describe(`country comparison ${name}`, () => {
    test.use({ viewport });
    test('selects only held complete Orders, preserves race and request identity, clears and reuses chart/grid', async ({
      page,
      context,
    }, testInfo) => {
      const source = process.env['DATATUG_E2E_GITHUB_FAKE'];
      test.skip(!source, 'paired candidate Demo checkout required');
      if (!source) return;
      const { posts, downloads, mutations, executionSources } =
        await installCountryComparisonFixture(
          context,
          source,
          testInfo.project.use.baseURL ?? 'http://localhost',
        );
      await page.goto(boardURL);
      const paired = page
        .locator('ion-card')
        .filter({ hasText: 'Customer records by shared country' })
        .first();
      const inspector = page
        .locator('ion-card')
        .filter({ hasText: 'Inspect saved query results' })
        .first();
      const race = page
        .locator('ion-card')
        .filter({ hasText: 'Where Northwind orders shipped' })
        .first();
      await expect(paired.locator('.grouped-bars > li')).toHaveCount(17);
      await expect(race).toContainText('830 source orders');
      await expect(inspector).toContainText('830 rows · 14 columns');
      const countryCounts = page
        .locator('ion-card')
        .filter({ hasText: 'Northwind orders by shipping country' })
        .first();
      await expect(countryCounts.locator('.bars > li')).toHaveCount(10);
      await expect(inspector.getByRole('combobox')).toHaveCount(0);
      await expect(paired).toContainText(
        'customer records · common scale from 0 to 13',
      );
      const canada = paired.getByRole('button', {
        name: 'Canada Northwind 3 Chinook 8',
        exact: true,
      });
      const usa = paired.getByRole('button', {
        name: 'USA Northwind 13 Chinook 13',
        exact: true,
      });
      await expect(canada).toBeVisible();
      await race
        .getByRole('combobox', { name: 'Chart value mode' })
        .selectOption('cumulative');
      await race
        .getByRole('spinbutton', { name: 'Top', exact: true })
        .fill('5');
      await race
        .getByRole('spinbutton', { name: 'Top', exact: true })
        .press('Tab');
      await race.getByRole('slider', { name: 'Choose month' }).fill('3');
      const racePosition = await race
        .getByRole('slider', { name: 'Choose month' })
        .inputValue();
      expect(
        executionSources.map(({ database, collection }) => ({
          database,
          collection,
        })),
      ).toEqual([
        { database: 'northwind', collection: 'Customers' },
        { database: 'chinook', collection: 'Customer' },
      ]);
      const originalRow = await inspector
        .locator('table tbody tr')
        .first()
        .innerText();
      const storage = await page.evaluate(() =>
        JSON.stringify({ ...sessionStorage }),
      );
      const baseline = [...posts];
      expect(baseline.filter((value) => value === 'comparison')).toHaveLength(
        1,
      );
      expect(baseline.filter((value) => value === 'orders')).toHaveLength(1);
      await canada.focus();
      await canada.press('Enter');
      await expect(canada).toBeFocused();
      await expect(inspector).toContainText(
        `${orders.filter((row) => row['ShipCountry'] === 'Canada').length} of 830 orders shipped to Canada`,
      );
      await usa.click();
      await expect(inspector).toContainText('122 of 830 orders shipped to USA');
      await canada.click();
      expect(
        await page.evaluate(() => JSON.stringify({ ...sessionStorage })),
      ).toBe(storage);
      await expect(inspector).toContainText('orders shipped to Canada');
      await expect(paired).toContainText('Selected country: Canada');
      const sort = paired.getByRole('combobox', { name: 'Chart order' });
      const interactionStart = performance.now();
      for (const [value, first] of [
        ['country', 'Argentina'],
        ['series:0', 'USA'],
        ['series:1', 'USA'],
        ['difference', 'Germany'],
      ]) {
        await sort.focus();
        await sort.selectOption(value);
        await expect(sort).toBeFocused();
        await expect(paired.locator('.grouped-bars strong').first()).toHaveText(
          first,
        );
        await expect(paired.locator('.grouped-bars > li')).toHaveCount(17);
        await expect(canada).toHaveAttribute('aria-pressed', 'true');
      }
      await paired.getByRole('button', { name: 'Rows', exact: true }).click();
      await expect(paired).toContainText('Selected country: Canada');
      await paired
        .getByRole('button', { name: 'Clear country', exact: true })
        .click();
      await expect(inspector).toContainText('830 rows · 14 columns');
      await paired.getByRole('button', { name: 'Chart', exact: true }).click();
      await expect(sort).toHaveValue('difference');
      await canada.click();
      await race.locator('ion-segment-button[value="trend"]').click();
      const monthly = race.getByRole('region', {
        name: 'Monthly orders trend',
      });
      await expect(monthly).toContainText(
        '830 orders · 23 calendar months · orders per month',
      );
      await expect(monthly).toContainText('boundary months may be partial');
      await expect(monthly.locator('svg')).toBeVisible();
      await monthly.screenshot({
        path: testInfo.outputPath(`monthly-${name}.png`),
      });
      await monthly.locator('summary').click();
      await expect(monthly.locator('tbody tr')).toHaveCount(23);
      await expect(monthly.locator('tfoot td')).toHaveText('830');
      const monthlySum = await monthly
        .locator('tbody td')
        .evaluateAll((cells) =>
          cells.reduce((sum, cell) => sum + Number(cell.textContent), 0),
        );
      expect(monthlySum).toBe(830);
      await race.locator('ion-segment-button[value="grid"]').click();
      await expect(
        race.locator('sneat-datatug-held-result-presentation'),
      ).toContainText('830 rows');
      await race.locator('ion-segment-button[value="chart"]').click();
      await expect(
        race.getByRole('slider', { name: 'Choose month' }),
      ).toHaveValue(racePosition);
      expect(posts).toEqual(baseline);
      expect(
        await page.evaluate(() => JSON.stringify({ ...sessionStorage })),
      ).toBe(storage);
      await testInfo.attach(`bounded-interaction-${name}.json`, {
        contentType: 'application/json',
        body: JSON.stringify({
          fixedRows: 830,
          months: 23,
          groupedRows: 17,
          sortModes: 4,
          wallMilliseconds: performance.now() - interactionStart,
          boundary:
            'fixture browser interaction including Playwright waits and screenshot; not a live server benchmark',
        }),
      });
      await inspector
        .getByRole('button', { name: 'Clear country', exact: true })
        .click();
      await expect(inspector).toContainText('830 rows · 14 columns');
      await expect(inspector).not.toContainText('orders shipped to Canada');
      await expect(inspector.locator('table tbody tr').first()).toHaveText(
        originalRow,
      );
      await paired.getByRole('button', { name: 'Rows', exact: true }).click();
      await expect(paired.locator('table')).toContainText('Canada');
      await paired.getByRole('button', { name: 'Chart', exact: true }).click();
      await expect(paired.locator('.grouped-bars > li')).toHaveCount(17);
      expect(posts).toEqual(baseline);
      expect(downloads).toEqual([]);
      expect(mutations).toEqual([]);
      expect(
        await race.getByRole('slider', { name: 'Choose month' }).inputValue(),
      ).toBe(racePosition);
      await expect(
        race.getByRole('combobox', { name: 'Chart value mode' }),
      ).toHaveValue('cumulative');
      await expect(
        race.getByRole('spinbutton', { name: 'Top', exact: true }),
      ).toHaveValue('5');
      const details = paired.locator('.source-details');
      await details.locator(':scope > summary').click();
      await expect(details).toContainText(
        'https://cloud.openvaultdb.com/v1/dtql',
      );
      await expect(details).toContainText('live · OVDB server');
      await expect(details).not.toContainText('protected');
      await paired.screenshot({
        path: testInfo.outputPath(`paired-${name}.png`),
      });
      await canada.click();
      await inspector.screenshot({
        path: testInfo.outputPath(`linked-orders-${name}.png`),
      });
      await expect(inspector).toContainText('orders shipped to Canada');
      expect(posts).toEqual(baseline);
    });
  });
}

for (const scenario of ['retry', 'partial-orders', 'synthetic-zero'] as const) {
  test(`country comparison ${scenario} exposes an honest recovery state`, async ({
    page,
    context,
  }, testInfo) => {
    const source = process.env['DATATUG_E2E_GITHUB_FAKE'];
    test.skip(!source, 'paired candidate required');
    if (!source) return;
    const ledger = await installCountryComparisonFixture(
      context,
      source,
      testInfo.project.use.baseURL ?? 'http://localhost',
      {
        failRootOnce: scenario === 'retry',
        partialOrders: scenario === 'partial-orders',
        syntheticZero: scenario === 'synthetic-zero',
      },
    );
    await page.goto(boardURL);
    const paired = page
      .locator('ion-card')
      .filter({ hasText: 'Customer records by shared country' })
      .first();
    const inspector = page
      .locator('ion-card')
      .filter({ hasText: 'Inspect saved query results' })
      .first();
    if (scenario === 'retry') {
      await expect(paired.getByRole('alert').first()).toBeVisible();
      await expect(paired.locator('.grouped-bars > li')).toHaveCount(0);
      expect(
        ledger.posts.filter((value) => value === 'comparison'),
      ).toHaveLength(1);
      await paired
        .getByRole('button', { name: /^Retry chart · / })
        .click();
      await expect(paired.locator('.grouped-bars > li')).toHaveCount(17);
      expect(
        ledger.posts.filter((value) => value === 'comparison'),
      ).toHaveLength(2);
    } else {
      await expect(paired.locator('.grouped-bars > li')).toHaveCount(17);
      if (scenario === 'partial-orders') {
        const race = page
          .locator('ion-card')
          .filter({ hasText: 'Where Northwind orders shipped' })
          .first();
        await race.locator('ion-segment-button[value="trend"]').click();
        const monthly = race.getByRole('region', {
          name: 'Monthly orders trend',
        });
        await expect(monthly.getByRole('alert')).toBeVisible();
        await expect(monthly.locator('table')).toHaveCount(0);
        await paired
          .getByRole('button', {
            name: 'Canada Northwind 3 Chinook 8',
            exact: true,
          })
          .click();
        await expect(inspector).toContainText(
          'Country filtering is unavailable',
        );
        await expect(inspector).not.toContainText('of 830 orders shipped to');
      } else {
        await expect(inspector).toContainText('830 rows · 14 columns');
        await paired
          .getByRole('button', { name: /^United Kingdom Northwind/ })
          .click();
        await expect(inspector).toContainText(
          '0 of 830 orders shipped to United Kingdom',
        );
        await expect(inspector).toContainText('No rows returned.');
        await inspector
          .getByRole('button', { name: 'Clear country', exact: true })
          .click();
        await expect(inspector).toContainText('830 rows · 14 columns');
      }
      expect(
        ledger.posts.filter((value) => value === 'comparison'),
      ).toHaveLength(1);
      expect(ledger.posts.filter((value) => value === 'orders')).toHaveLength(
        1,
      );
    }
    expect(ledger.downloads).toEqual([]);
    expect(ledger.mutations).toEqual([]);
  });
}

test('distinct inspector tabs run lazily once, reuse held rows and preserve explicit refresh', async ({
  page,
  context,
}, testInfo) => {
  const source = process.env['DATATUG_E2E_GITHUB_FAKE'];
  test.skip(!source, 'paired candidate required');
  if (!source) return;
  const ledger = await installCountryComparisonFixture(
    context,
    source,
    testInfo.project.use.baseURL ?? 'http://localhost',
  );
  await page.goto(boardURL);
  const inspector = page
    .locator('ion-card')
    .filter({ hasText: 'Inspect saved query results' })
    .first();
  await expect(inspector).toContainText('830 rows · 14 columns');
  expect(
    ledger.posts.filter((value) => value === 'inspector-counts'),
  ).toHaveLength(0);
  const tabs = inspector.locator('ion-segment-button');
  await tabs.nth(1).click();
  await expect(inspector).toContainText('21 rows · 2 columns');
  await expect(
    inspector.getByRole('button', { name: /^Refresh on board · / }),
  ).toBeEnabled();
  expect(
    ledger.posts.filter((value) => value === 'inspector-counts'),
  ).toHaveLength(1);
  await tabs.nth(0).click();
  await expect(inspector).toContainText('830 rows · 14 columns');
  await tabs.nth(1).click();
  await expect(inspector).toContainText('21 rows · 2 columns');
  expect(
    ledger.posts.filter((value) => value === 'inspector-counts'),
  ).toHaveLength(1);
  await inspector
    .getByRole('button', { name: /^Refresh on board · / })
    .click();
  await expect
    .poll(
      () => ledger.posts.filter((value) => value === 'inspector-counts').length,
    )
    .toBe(2);
  await expect(
    inspector.getByRole('button', { name: /^Refresh on board · / }),
  ).toBeEnabled();
  expect(
    ledger.posts.filter((value) => value === 'inspector-counts'),
  ).toHaveLength(2);
  expect(ledger.downloads).toEqual([]);
  expect(ledger.mutations).toEqual([]);
});
