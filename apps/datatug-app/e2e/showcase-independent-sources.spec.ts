import type { Page } from '@playwright/test';
import { expect, test } from './helpers/demodb-guard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  installCountryComparisonFixture,
  countryBoardURL,
} from './helpers/country-comparison-fixture';

const title = 'Customer records by country · independent sources';
const comparisonCard = (page: Page) =>
  page
    .locator('sneat-datatug-board-card > ion-card')
    .filter({ hasText: title });
async function seed(page: Page) {
  await page.goto(`${countryBoardURL}?mode=tutorial`);
  const tutorial = page.locator('.tutorial-panel');
  await tutorial.getByRole('button', { name: 'Restart', exact: true }).click();
  for (
    let index = 0;
    index < 20 && !(await comparisonCard(page).count());
    index++
  ) {
    const indicator = tutorial.locator('.tutorial-step .tutorial-eyebrow');
    const before = await indicator.textContent();
    await tutorial
      .getByRole('group', { name: 'Tutorial steps' })
      .getByRole('button', { name: 'Next Step', exact: true })
      .click();
    await expect(indicator).not.toHaveText(before ?? '');
  }
  await expect(
    comparisonCard(page).getByRole('region', {
      name: 'Source northwind',
      exact: true,
    }),
  ).toContainText('21 source rows');
  await expect(
    comparisonCard(page).getByRole('region', {
      name: 'Source chinook',
      exact: true,
    }),
  ).toHaveCount(0);
  await tutorial
    .getByRole('button', { name: 'Take Control', exact: true })
    .click();
  const editor = tutorial.getByRole('group', { name: title, exact: true });
  await editor
    .getByRole('combobox', { name: 'Saved query to add' })
    .selectOption('demodb/chinook-customer-country-counts-server');
  await expect(
    editor.getByRole('button', { name: 'Add source', exact: true }),
  ).toBeDisabled();
  await editor.getByRole('checkbox', { name: /I confirm this query/ }).check();
  await editor.getByRole('button', { name: 'Add source', exact: true }).click();
  return tutorial;
}
const renderedBoard = (page: Page) =>
  page.locator('sneat-datatug-board').evaluate((element) => {
    const ng = (
      window as unknown as {
        ng: { getComponent: (element: Element) => { boardDef: () => unknown } };
      }
    ).ng;
    return ng.getComponent(element).boardDef();
  });
const transport = 'stream' as const;
test(`ordinary source editing constructs a truthful two-source chart with ${transport} transport`, async ({
  page,
  context,
}, testInfo) => {
  const source = process.env['DATATUG_E2E_GITHUB_FAKE'];
  test.skip(!source, 'paired Demo checkout required');
  if (!source) return;
  const path = join(source, 'demo-project-1/boards/showcase/board.json'),
    before = readFileSync(path, 'utf8');
  const ledger = await installCountryComparisonFixture(
    context,
    source,
    testInfo.project.use.baseURL ?? 'http://localhost',
    { independentSources: true },
  );
  const tutorial = await seed(page);
  const card = comparisonCard(page),
    rows = card
      .getByRole('list', { name: 'Independent source comparison' })
      .locator(':scope > li');
  await expect(rows).toHaveCount(28);
  await expect(
    rows.filter({ has: page.getByText('UK', { exact: true }) }),
  ).toContainText('Missing');
  await expect(
    rows.filter({ has: page.getByText('United Kingdom', { exact: true }) }),
  ).toContainText('Missing');
  const canada = rows.filter({
    has: page.getByText('Canada', { exact: true }),
  });
  await expect(canada).toContainText('3');
  await expect(canada).toContainText('8');
  await expect(card).toContainText('Declared unit: customer records');
  await expect(card).toContainText('nulls excluded');
  expect(
    ledger.posts.filter((value) => value === 'customer-northwind'),
  ).toHaveLength(1);
  expect(
    ledger.posts.filter((value) => value === 'customer-chinook'),
  ).toHaveLength(1);
  const baseline = [...ledger.posts];
  await card
    .getByText('Inspect northwind source rows and terms', { exact: true })
    .click();
  await card
    .getByText('Inspect chinook source rows and terms', { exact: true })
    .click();
  await expect(
    card.getByRole('region', { name: 'Source northwind', exact: true }),
  ).toContainText('21 rows');
  await expect(
    card.getByRole('region', { name: 'Source chinook', exact: true }),
  ).toContainText('24 rows');
  expect(ledger.posts).toEqual(baseline);
  await tutorial
    .getByRole('button', { name: 'Resume Guide', exact: true })
    .click();
  await tutorial
    .getByRole('group', { name: 'Tutorial steps' })
    .getByRole('button', { name: 'Previous', exact: true })
    .click();
  await expect(
    card.getByRole('region', { name: 'Source chinook', exact: true }),
  ).toHaveCount(0);
  await tutorial
    .getByRole('group', { name: 'Tutorial steps' })
    .getByRole('button', { name: 'Next Step', exact: true })
    .click();
  await expect(rows).toHaveCount(28);
  expect(
    ledger.posts.filter((value) => value === 'customer-northwind'),
  ).toHaveLength(1);
  const next = tutorial
    .getByRole('group', { name: 'Tutorial steps' })
    .getByRole('button', { name: 'Next Step', exact: true });
  for (let index = 0; index < 20 && (await next.isEnabled()); index++) {
    const indicator = tutorial.locator('.tutorial-step .tutorial-eyebrow');
    const before = await indicator.textContent();
    await next.click();
    await expect(indicator).not.toHaveText(before ?? '');
  }
  await expect(next).toBeDisabled();
  const federationCard = page
    .locator('sneat-datatug-board-card > ion-card')
    .filter({ hasText: 'Customer records by shared country' });
  await expect(
    federationCard.getByRole('button', { name: 'Retry chart', exact: true }),
  ).toHaveCount(0);
  await expect(federationCard).toContainText('17');
  expect(await renderedBoard(page)).toEqual(JSON.parse(before));
  await page.reload();
  await expect(rows).toHaveCount(28);
  expect(await renderedBoard(page)).toEqual(JSON.parse(before));
  await card.getByText(title, { exact: true }).first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(`independent-${transport}-desktop.png`),
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await card.getByText(title, { exact: true }).first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(`independent-${transport}-mobile.png`),
  });
  await tutorial
    .getByRole('button', { name: 'Show Full Dashboard', exact: true })
    .click();
  await expect(tutorial).toHaveCount(0);
  await expect(rows).toHaveCount(28);
  expect(await renderedBoard(page)).toEqual(JSON.parse(before));
  expect(readFileSync(path, 'utf8')).toBe(before);
  expect(ledger.mutations).toEqual([]);
  expect(ledger.downloads).toEqual([]);
  await testInfo.attach('source-read-boundary', {
    body: JSON.stringify({
      transport,
      posts: ledger.posts,
      mutations: ledger.mutations,
      downloads: ledger.downloads,
      basis:
        'Pinned SQLite-derived customer aggregates plus explicitly simulated valid server declarations/query identity selection; existing real dispatcher, stream parser, held widgets and controls; no public provider request.',
    }),
    contentType: 'application/json',
  });
});
test('retry and cancel target only the failed independent source and ignore its late completion', async ({
  page,
  context,
}, testInfo) => {
  const source = process.env['DATATUG_E2E_GITHUB_FAKE'];
  test.skip(!source, 'paired Demo checkout required');
  if (!source) return;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ledger = await installCountryComparisonFixture(
    context,
    source,
    testInfo.project.use.baseURL ?? 'http://localhost',
    {
      independentSources: true,
      failCustomerChinookOnce: true,
      holdCustomerChinookSecond: gate,
    },
  );
  try {
    await seed(page);
    const card = comparisonCard(page),
      child = card.getByRole('region', { name: 'Source chinook', exact: true });
    await expect(child.getByRole('alert')).toBeVisible();
    await expect(
      card.getByRole('list', { name: 'Independent source comparison' }),
    ).toHaveCount(0);
    await child
      .getByRole('button', { name: 'Retry source', exact: true })
      .click();
    await expect
      .poll(
        () =>
          ledger.posts.filter((value) => value === 'customer-chinook').length,
      )
      .toBe(2);
    await child
      .getByRole('button', { name: 'Cancel source run', exact: true })
      .click();
    release();
    await expect(child.getByRole('alert')).toContainText('cancelled');
    await expect(
      card.getByRole('list', { name: 'Independent source comparison' }),
    ).toHaveCount(0);
    await child
      .getByRole('button', { name: 'Retry source', exact: true })
      .click();
    await expect(
      card
        .getByRole('list', { name: 'Independent source comparison' })
        .locator(':scope > li'),
    ).toHaveCount(28);
    expect(
      ledger.posts.filter((value) => value === 'customer-northwind'),
    ).toHaveLength(1);
    expect(
      ledger.posts.filter((value) => value === 'customer-chinook'),
    ).toHaveLength(3);
    expect(ledger.mutations).toEqual([]);
    expect(ledger.downloads).toEqual([]);
    await testInfo.attach('source-lifecycle-boundary', {
      body: JSON.stringify({
        posts: ledger.posts,
        mutations: ledger.mutations,
        downloads: ledger.downloads,
        basis:
          'Explicit simulated valid server declarations; actual worker and terminal stream parser, failed/deferred/successful Chinook only.',
      }),
      contentType: 'application/json',
    });
  } finally {
    release();
  }
});
