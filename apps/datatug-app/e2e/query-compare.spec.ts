import { expect, test } from './helpers/demodb-guard';
import { installFakeGithub } from './helpers/fake-github';
import { installPinnedChinookComparison, installPinnedChinookSqlite } from './helpers/pinned-chinook-sqlite';

const DEMO_REPO = process.env['DATATUG_E2E_GITHUB_FAKE'];
const QUERY_URL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-invoice-compare?id=chinook-invoice-compare&editor=text&env=local';

test.skip(
  !DEMO_REPO,
  'set DATATUG_E2E_GITHUB_FAKE to the demo project checkout containing the saved Invoice-Customer relationship',
);

test.beforeEach(async ({ context }) => {
  if (DEMO_REPO) {
    await installPinnedChinookSqlite(context, DEMO_REPO);
    await installPinnedChinookComparison(context);
    await installFakeGithub(context, [
      { fullName: 'datatug/datatug-demo-project', dir: DEMO_REPO },
    ]);
  }
});

test('compares the maintained Chinook invoice query against two public fixtures with the released Core bridge', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.addInitScript(() => {
    const original = window.Worker;
    let starts = 0;
    Object.defineProperty(window, '__compareWorkerStarts', { get: () => starts });
    window.Worker = new Proxy(original, {
      construct(target, args) {
        starts++;
        return Reflect.construct(target, args);
      },
    });
  });

  await page.goto(QUERY_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('.cm-content');
  await expect(editor).toContainText(/i\.InvoiceId as InvoiceId/u);
  await expect(editor).toContainText(/i\.InvoiceDate as InvoiceDate/u);
  await author.getByTestId('workspace-parameters-tab').click();
  const customerId = author.getByTestId('author-customer-id').locator('input');
  await expect(customerId).toHaveValue('');
  await author.getByTestId('author-preview-tab').click();
  await author.getByTestId('author-preview').click();
  await expect(author.getByTestId('author-sql-preview')).toContainText('LIMIT 100');
  await expect(author.getByTestId('author-sql-preview')).toContainText('?1');
  await expect(author.getByTestId('author-sql-preview')).toContainText('Required · unset');
  expect(await page.evaluate(() => (window as unknown as { __compareWorkerStarts: number }).__compareWorkerStarts)).toBe(0);

  await author.getByTestId('workspace-parameters-tab').click();
  await customerId.fill('1');
  await author.getByTestId('author-preview-tab').click();
  await author.getByTestId('author-preview').click();
  await expect(author.getByTestId('author-sql-preview')).toContainText('LIMIT 100');
  expect(await page.evaluate(() => (window as unknown as { __compareWorkerStarts: number }).__compareWorkerStarts)).toBe(0);

  const compareToggle = page.getByTestId('query-view-compare');
  const compareNativeButton = compareToggle.locator('button');
  await compareNativeButton.focus();
  await compareNativeButton.press('Space');
  await expect(compareNativeButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tablist', { name: 'Query workspace view' })).toHaveCount(0);
  await expect(page.getByTestId('author-results-empty')).toHaveCount(0);
  await expect(page.getByText('Not executed', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('comparison-target-baseline')).toContainText('Pinned upstream baseline');
  await expect(page.getByTestId('comparison-target-candidate')).toContainText('Synthetic comparison fixture (not production data)');
  expect(await page.evaluate(() => (window as unknown as { __compareWorkerStarts: number }).__compareWorkerStarts)).toBe(0);
  await expect(
    page.getByTestId('comparison-panel').getByRole('status'),
  ).toContainText('Ready');

  await page.getByTestId('comparison-run-both').click();
  const baseline = page.getByTestId('comparison-side-baseline');
  const candidate = page.getByTestId('comparison-side-candidate');
  await expect(baseline).toContainText('7 complete rows observed', { timeout: 60_000 });
  await expect(candidate).toContainText('7 complete rows observed', { timeout: 60_000 });
  const sideWidths = await Promise.all([baseline, candidate].map(async (side) =>
    (await side.boundingBox())?.width ?? 0,
  ));
  console.info(`[comparison-layout] viewport=1280px baseline=${sideWidths[0]}px candidate=${sideWidths[1]}px`);
  expect(sideWidths.every((width) => width >= 300)).toBe(true);
  await expect(page.getByTestId('comparison-panel')).toContainText(
    'Both fixture queries completed with complete bounded results.',
  );
  await expect(page.getByTestId('comparison-panel')).not.toContainText('still running');
  expect(await page.evaluate(() => (window as unknown as { __compareWorkerStarts: number }).__compareWorkerStarts)).toBe(2);
  await baseline.getByText('Observed rows, execution ID, schema and provenance').click();
  await candidate.getByText('Observed rows, execution ID, schema and provenance').click();
  await expect(baseline).toContainText('execution ID');
  await expect(candidate).toContainText('execution ID');
  for (const side of [baseline, candidate]) {
    await expect(side).toContainText('Observed');
    await expect(side).toContainText('demo-db/chinook@95d14a11256f8db512d5ecd7ea5be56e01d51781');
    await expect(side).toContainText('aa80280419d5e0e8bd99ae97574b5d91cbf4df6e560e536f8699f42ec175c887');
    await expect(side).toContainText('44d9f354ed5b7bf8aaf496dfde15e81d4307730c');
  }
  await expect(baseline).toContainText('7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15');
  await expect(candidate).toContainText('3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f');

  const compareResults = page.getByTestId('comparison-compare');
  await expect(compareResults).toBeEnabled({ timeout: 60_000 });
  await compareResults.click();
  const result = page.getByTestId('comparison-result');
  await expect(result).toContainText('1 changed', { timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { __compareWorkerStarts: number }).__compareWorkerStarts)).toBe(3);
  await expect(result).toContainText('1 baseline-only');
  await expect(result).toContainText('1 candidate-only');
  await expect(result).toContainText('5 unchanged');
  await expect(result).toContainText('InvoiceDate: 2022-03-11 00:00:00 → 2022-03-12 00:00:00');
  await expect(result).toContainText('Baseline-only · InvoiceId 121');
  await expect(result).toContainText('Candidate-only · InvoiceId 97');
  await expect(result).toContainText('Raw text comparison · no date/time normalization');
  await expect(result).toContainText('not durable or citable evidence');

  await page.getByTestId('query-view-author').locator('button').click();
  await expect(page.getByTestId('tugql-author')).toBeVisible();
  await author.getByTestId('author-code-tab').click();
  await expect(page.getByTestId('query-body-text').locator('.cm-content')).toContainText(/i\.InvoiceDate as InvoiceDate/u);
  await author.getByTestId('workspace-parameters-tab').click();
  await expect(page.getByTestId('author-customer-id').locator('input')).toHaveValue('1');
  await page.getByTestId('query-view-compare').locator('button').click();
  await expect(page.getByTestId('comparison-result')).toBeVisible();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByTestId('comparison-side-baseline')).toBeVisible();
    await expect(page.getByTestId('comparison-side-candidate')).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  }

  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator('sneat-datatug-project-menu-top ion-item', { hasText: 'Queries' }).click();
  await expect(page).toHaveURL(/\/-\/queries/u);
  const demoFolder = page.locator('sneat-datatug-queries-tab ion-item', { hasText: 'demodb' });
  await expect(demoFolder).toBeVisible();
  await demoFolder.click();
  const savedCompareQuery = page.locator('sneat-datatug-queries-tab ion-item', {
    hasText: 'Chinook Invoice Comparison',
  });
  await expect(savedCompareQuery).toBeVisible();
  await savedCompareQuery.click();
  await expect(page).toHaveURL(/\/query\/demodb%2Fchinook-invoice-compare/u);
  await expect(page.getByTestId('tugql-author')).toBeVisible();
  await page.getByTestId('tugql-author').getByTestId('workspace-parameters-tab').click();
  await expect(page.getByTestId('author-customer-id').locator('input')).toHaveValue('');
  await expect(page.getByTestId('comparison-result')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __compareWorkerStarts: number }).__compareWorkerStarts)).toBe(3);
});
