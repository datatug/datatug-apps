import { expect, test, type Locator } from '@playwright/test';
import { installCountryComparisonFixture } from './helpers/country-comparison-fixture';

/** Wait for actual canvas stability, so ongoing initial animation cannot satisfy the filter assertion. */
async function stableCanvas(canvas: Locator): Promise<Buffer> {
  let previous: Buffer | undefined,
    stable = 0;
  await expect
    .poll(async () => {
      const next = await canvas.screenshot();
      stable = previous?.equals(next) ? stable + 1 : 0;
      previous = next;
      return stable;
    })
    .toBeGreaterThanOrEqual(2);
  if (!previous) throw new Error('Stable canvas required');
  return previous;
}

// Licensed, captured-read regression: real native grid/group/chart controls, no public provider requests.
const queryURL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/demodb%2Fcustomer-country-comparison-server?id=demodb%2Fcustomer-country-comparison-server&env=dev&editor=text';

test('licensed Query Editor groups, aggregates and charts the selected held range without executing another query', async ({
  page,
  context,
}, testInfo) => {
  const source = process.env['DATATUG_E2E_GITHUB_FAKE'];
  test.skip(!source, 'Pinned Demo checkout required');
  if (!source) return;
  const { posts, mutations, downloads } = await installCountryComparisonFixture(
    context,
    source,
    testInfo.project.use.baseURL ?? 'http://localhost',
  );
  await page.goto(queryURL);
  await page.getByTestId('workspace-run').click();
  const grid = page
    .locator('sneat-datatug-results-grid')
    .filter({ visible: true })
    .first();
  await expect(grid.getByTestId('results-grid-count')).toContainText('17 rows');
  await expect(grid.getByTestId('results-grid-export-excel')).toBeVisible();
  await expect
    .poll(
      async () =>
        (await grid.locator('.ag-grid-viewport').boundingBox())?.height ?? 0,
    )
    .toBeGreaterThanOrEqual(240);
  await expect(grid.locator('.ag-column-drop-horizontal')).toBeVisible();
  await expect(grid.getByTestId('results-grid-analytics-scope')).toContainText(
    '17 loaded rows on page 1',
  );
  await expect(grid.getByTestId('results-grid-chart')).toBeDisabled();
  expect(posts).toEqual(['comparison']);

  await grid
    .getByRole('button', { name: 'Column menu of country', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Group by country', exact: true })
    .click();
  await expect(grid.locator('.ag-row-group').first()).toBeVisible();
  await expect(grid.getByTestId('results-grid-count')).toContainText('17 rows');
  await grid
    .getByRole('button', {
      name: 'Column menu of northwindCustomers',
      exact: true,
    })
    .click();
  const aggregation = page.getByRole('menuitem', {
    name: 'Value Aggregation',
    exact: true,
  });
  await aggregation.hover();
  await page.getByRole('menuitemradio', { name: 'Sum', exact: true }).click();
  const canadaGroup = grid
    .locator('.ag-row-group')
    .filter({ hasText: 'Canada' });
  await expect(canadaGroup.locator('[col-id="result_1"]')).toHaveText('3');
  await grid.locator('.ag-grid-viewport').evaluate((el) => {
    el.scrollLeft = 0;
  });
  const first = grid
    .locator('.ag-row-group')
    .first()
    .locator('.ag-cell')
    .filter({ hasText: 'Argentina' })
    .first();
  const end = grid
    .locator('.ag-row-group')
    .nth(2)
    .locator('[col-id="result_1"]');
  const startBox = await first.boundingBox(),
    endBox = await end.boundingBox();
  expect(startBox).toBeTruthy();
  expect(endBox).toBeTruthy();
  if (!startBox || !endBox) throw new Error('Visible range cells required');
  await page.mouse.move(
    startBox.x + startBox.width / 2,
    startBox.y + startBox.height / 2,
  );
  await page.mouse.down();
  try {
    await page.mouse.move(
      endBox.x + endBox.width / 2,
      endBox.y + endBox.height / 2,
      { steps: 12 },
    );
  } finally {
    await page.mouse.up();
  }
  await expect(grid.getByTestId('results-grid-chart')).toBeEnabled();
  await grid.getByTestId('results-grid-chart').focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('.ag-chart').filter({ visible: true }).first();
  await expect(dialog.locator('canvas').first()).toBeVisible();
  const before = await stableCanvas(
    dialog.locator('.ag-charts-canvas-container').first(),
  );
  // The linked vendor chart follows filtering of held rows; it remains the same dialog.
  await grid
    .getByRole('searchbox', { name: 'Filter rows', exact: true })
    .fill('Austria');
  await expect(grid.getByTestId('results-grid-count')).toContainText(
    '1 of 17 rows',
  );
  await expect(dialog.locator('canvas').first()).toBeVisible();
  // A specific public tooltip proves the linked chart's filtered category/value, beyond pixel differences.
  await dialog.locator('.ag-charts-series-area').first().hover();
  const tooltip = page.locator('.ag-charts-tooltip').filter({ visible: true });
  await expect(tooltip).toContainText('Austria');
  await expect(tooltip.locator('.ag-charts-tooltip-value')).toHaveText('2');
  const after = await stableCanvas(
    dialog.locator('.ag-charts-canvas-container').first(),
  );
  expect(before.equals(after)).toBe(false);
  await grid
    .getByRole('searchbox', { name: 'Filter rows', exact: true })
    .fill('');
  await expect(grid.getByTestId('results-grid-count')).toContainText('17 rows');
  expect(posts).toEqual(['comparison']);
  expect(mutations).toEqual([]);
  expect(downloads).toEqual([]);
  await testInfo.attach('enterprise-grid-boundary', {
    contentType: 'application/json',
    body: JSON.stringify({
      expected:
        'Native group and Sum, explicit range chart, linked filter repaint, leaf counts and one query',
      observed: 'All assertions passed',
      provider:
        'captured-read fixtures; not live provider or vendor license validation',
      posts,
      mutations,
      downloads,
    }),
  });
});
