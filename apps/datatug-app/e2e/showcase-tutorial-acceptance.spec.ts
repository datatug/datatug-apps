import { type Page } from '@playwright/test';
import { expect, test } from './helpers/demodb-guard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  installCountryComparisonFixture,
  countryBoardURL,
} from './helpers/country-comparison-fixture';

// Exact ordinary UI input in this local development build, plus visible card order.
// No private runtime mutation: all transitions below use the visitor's controls.
const renderedBoard = (page: Page) =>
  page.locator('sneat-datatug-board').evaluate((element) => {
    const ng = (
      window as unknown as Window & {
        ng: { getComponent: (element: Element) => { boardDef: () => unknown } };
      }
    ).ng;
    return ng.getComponent(element).boardDef();
  });
const cardTitles = (page: Page) =>
  page
    .locator('sneat-datatug-board-card > ion-card > .board-card-header > ion-item > ion-label')
    .allTextContents();

async function changeStep(
  tutorial: ReturnType<Page['locator']>,
  direction: 'Next Step' | 'Previous',
) {
  const indicator = tutorial.locator('.tutorial-step .tutorial-eyebrow');
  const before = await indicator.textContent();
  await tutorial
    .getByRole('group', { name: 'Tutorial steps' })
    .getByRole('button', { name: direction, exact: true })
    .click();
  await expect(indicator).not.toHaveText(before ?? '');
}
async function ordersPanel(inspector: ReturnType<Page['locator']>) {
  const ordersTab = inspector.getByRole('tab', {
    name: 'Northwind · server orders',
    exact: true,
  });
  await expect(ordersTab).toHaveCount(1);
  // Restored tutorial tab choices may point at a different saved query.
  if ((await ordersTab.getAttribute('aria-selected')) !== 'true')
    await ordersTab.click();
  await expect(ordersTab).toHaveAttribute('aria-selected', 'true');
  await expect(inspector).toContainText('830 rows · 14 columns');
}

test('every guided stage opens the canonical full board without storing country selection or writing project data', async ({
  page,
  context,
}, testInfo) => {
  const source = process.env['DATATUG_E2E_GITHUB_FAKE'];
  test.skip(!source, 'paired candidate required');
  if (!source) return;
  test.setTimeout(120_000);
  const before = readFileSync(
    join(source, 'demo-project-1/boards/showcase/board.json'),
    'utf8',
  );
  const canonical = JSON.parse(before);
  const ledger = await installCountryComparisonFixture(
    context,
    source,
    testInfo.project.use.baseURL ?? 'http://localhost',
  );
  await page.goto(countryBoardURL);
  const expectedTitles = canonical.rows.flatMap(
    (row: { cards: { title: string }[] }) =>
      row.cards.map((card) => card.title),
  );
  await expect.poll(() => cardTitles(page)).toEqual(expectedTitles);
  expect(await renderedBoard(page)).toEqual(canonical);
  let stageCount = 0,
    totalSteps = 1;
  for (let stage = 0; stage < totalSteps; stage++) {
    await page.goto(`${countryBoardURL}?mode=tutorial`);
    const tutorial = page.locator('.tutorial-panel');
    await expect(
      tutorial.getByRole('button', { name: 'Restart', exact: true }),
    ).toBeVisible();
    await tutorial
      .getByRole('button', { name: 'Restart', exact: true })
      .click();
    await expect(
      page.getByRole('region', { name: 'Your empty tutorial canvas' }),
    ).toBeVisible();
    totalSteps = Number(
      (
        await tutorial.locator('.tutorial-step .tutorial-eyebrow').textContent()
      )?.match(/of\s+(\d+)/)?.[1],
    );
    expect(totalSteps).toBeGreaterThanOrEqual(7);
    const next = tutorial
      .getByRole('group', { name: 'Tutorial steps' })
      .getByRole('button', { name: 'Next Step', exact: true });
    let advanced = 0;
    while (advanced < stage && (await next.isEnabled())) {
      await changeStep(tutorial, 'Next Step');
      advanced++;
    }
    expect(advanced).toBe(stage);
    stageCount++;
    if (stage > 0) {
      await changeStep(tutorial, 'Previous');
      await changeStep(tutorial, 'Next Step');
    }
    await tutorial
      .getByRole('button', { name: 'Show Full Dashboard', exact: true })
      .click();
    await expect(tutorial).toHaveCount(0);
    await expect.poll(() => cardTitles(page)).toEqual(expectedTitles);
    expect(await renderedBoard(page)).toEqual(canonical);
  }
  expect(stageCount).toBe(totalSteps);
  const paired = page
    .locator('ion-card')
    .filter({ hasText: 'Customer records by shared country' })
    .first();
  const inspector = page
    .locator('ion-card')
    .filter({ hasText: 'Inspect saved query results' })
    .first();
  await expect(paired.locator('.grouped-bars > li')).toHaveCount(17);
  await expect(inspector).toContainText('830 rows · 14 columns');
  await paired
    .getByRole('button', { name: 'Canada Northwind 3 Chinook 8', exact: true })
    .click();
  await expect(inspector).toContainText('30 of 830 orders shipped to Canada');
  // Route exit creates a new board scope; ordinary full load is repeatably canonical.
  await page.goto('/home');
  await page.goto(countryBoardURL);
  await expect(inspector).toContainText('830 rows · 14 columns');
  await expect(inspector).not.toContainText('of 830 orders shipped to Canada');
  expect(await renderedBoard(page)).toEqual(canonical);
  expect(
    readFileSync(
      join(source, 'demo-project-1/boards/showcase/board.json'),
      'utf8',
    ),
  ).toBe(before);
  expect(ledger.downloads).toEqual([]);
  expect(ledger.mutations).toEqual([]);
});

test('tutorial country selection follows the present chart and clears on restart and Show Full', async ({
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
  await page.goto(`${countryBoardURL}?mode=tutorial`);
  const tutorial = page.locator('.tutorial-panel');
  await tutorial.getByRole('button', { name: 'Restart', exact: true }).click();
  const steps = tutorial.getByRole('group', { name: 'Tutorial steps' });
  const next = steps.getByRole('button', { name: 'Next Step', exact: true });
  const paired = page
    .locator('ion-card')
    .filter({ hasText: 'Customer records by shared country' })
    .first();
  const inspector = page
    .locator('ion-card')
    .filter({ hasText: 'Inspect saved query results' })
    .first();
  while (!(await inspector.count())) {
    await expect(next).toBeEnabled();
    await changeStep(tutorial, 'Next Step');
  }
  await ordersPanel(inspector);
  await expect(inspector).toContainText('830 rows · 14 columns');
  const canada = paired.getByRole('button', {
    name: 'Canada Northwind 3 Chinook 8',
    exact: true,
  });
  await expect(canada).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...sessionStorage }),
  );
  const baseline = [...ledger.posts];
  await canada.click();
  await expect(inspector).toContainText('30 of 830 orders shipped to Canada');
  expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).toBe(
    storage,
  );
  expect(ledger.posts).toEqual(baseline);
  // Undo the inspector, then the producing chart; redo recreates an unselected chart.
  await changeStep(tutorial, 'Previous');
  await changeStep(tutorial, 'Previous');
  await expect(paired).toHaveCount(0);
  await changeStep(tutorial, 'Next Step');
  await expect(canada).toHaveAttribute('aria-pressed', 'false');
  await changeStep(tutorial, 'Next Step');
  await expect(inspector).toContainText('830 rows · 14 columns');
  await canada.click();
  await expect(inspector).toContainText('30 of 830 orders shipped to Canada');
  await tutorial
    .getByRole('button', { name: 'Show Full Dashboard', exact: true })
    .click();
  await expect(tutorial).toHaveCount(0);
  await expect(inspector).toContainText('830 rows · 14 columns');
  await expect(inspector).not.toContainText('of 830 orders shipped to Canada');
  await page.goto(`${countryBoardURL}?mode=tutorial`);
  await expect(tutorial).toBeVisible();
  await ordersPanel(inspector);
  await canada.click();
  await expect(inspector).toContainText('30 of 830 orders shipped to Canada');
  await tutorial.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Your empty tutorial canvas' }),
  ).toBeVisible();
  await tutorial
    .getByRole('button', { name: 'Show Full Dashboard', exact: true })
    .click();
  await expect(inspector).toContainText('830 rows · 14 columns');
  await expect(inspector).not.toContainText('of 830 orders shipped to Canada');
  expect(ledger.downloads).toEqual([]);
  expect(ledger.mutations).toEqual([]);
});

test('guided trend, source and race views replay one held result with reduced motion and restore on reload', async ({
  page,
  context,
}, testInfo) => {
  const source = process.env['DATATUG_E2E_GITHUB_FAKE'];
  test.skip(!source, 'paired candidate required');
  if (!source) return;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const ledger = await installCountryComparisonFixture(
    context,
    source,
    testInfo.project.use.baseURL ?? 'http://localhost',
  );
  await page.goto(`${countryBoardURL}?mode=tutorial`);
  const tutorial = page.locator('.tutorial-panel');
  await tutorial.getByRole('button', { name: 'Restart', exact: true }).click();
  await changeStep(tutorial, 'Next Step');
  const race = page
    .locator('ion-card')
    .filter({ hasText: 'Where Northwind orders shipped' })
    .first();
  await expect(race).toContainText('830 source orders');
  await race
    .getByRole('combobox', { name: 'Chart value mode' })
    .selectOption('cumulative');
  await race.getByRole('spinbutton', { name: 'Top', exact: true }).fill('5');
  await race.getByRole('spinbutton', { name: 'Top', exact: true }).press('Tab');
  await race.getByRole('slider', { name: 'Choose month' }).fill('3');
  const baseline = [...ledger.posts];
  expect(baseline).toEqual(['orders']);
  await race.getByRole('button', { name: 'Play chart', exact: true }).click();
  await expect(
    race.getByRole('button', { name: 'Pause chart', exact: true }),
  ).toBeVisible();
  await race.getByRole('button', { name: 'Pause chart', exact: true }).click();
  await expect(tutorial).toContainText('Inspect the monthly trend');
  await changeStep(tutorial, 'Next Step');
  const monthly = race.getByRole('region', { name: 'Monthly orders trend' });
  await expect(monthly).toContainText('830 orders · 23 calendar months');
  expect(ledger.posts).toEqual(baseline);
  await changeStep(tutorial, 'Previous');
  await expect(
    race.getByRole('tab', { name: 'Chart', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(race.getByRole('slider', { name: 'Choose month' })).toHaveValue(
    '3',
  );
  await changeStep(tutorial, 'Next Step');
  await expect(monthly).toBeVisible();
  await changeStep(tutorial, 'Next Step');
  await expect(
    race.getByRole('tab', { name: 'Source rows', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    race.locator('sneat-datatug-held-result-presentation'),
  ).toContainText('830 rows');
  await changeStep(tutorial, 'Next Step');
  await expect(race.getByRole('slider', { name: 'Choose month' })).toHaveValue(
    '3',
  );
  await expect(
    race.getByRole('combobox', { name: 'Chart value mode' }),
  ).toHaveValue('cumulative');
  await expect(
    race.getByRole('spinbutton', { name: 'Top', exact: true }),
  ).toHaveValue('5');
  expect(ledger.posts).toEqual(baseline);
  await page.reload();
  await expect(tutorial).toBeVisible();
  await expect(race).toContainText('830 source orders');
  await expect(
    race.getByRole('tab', { name: 'Chart', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  expect(ledger.posts.filter((query) => query === 'orders')).toHaveLength(2);
  expect(ledger.downloads).toEqual([]);
  expect(ledger.mutations).toEqual([]);
});
