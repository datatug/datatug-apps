import { expect, test } from '@playwright/test';
import { installFakeGithub } from './helpers/fake-github';

const DEMO_REPO = process.env['DATATUG_E2E_GITHUB_FAKE'];
const AUTHOR_URL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-invoice-author?id=chinook-invoice-author&editor=text&env=local';
const COUNT_AUTHOR_URL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-customer-invoice-count?id=chinook-customer-invoice-count&editor=text&env=local';

test.skip(
  !DEMO_REPO,
  'set DATATUG_E2E_GITHUB_FAKE to the demo project checkout containing the saved Author query',
);

test.beforeEach(async ({ context }) => {
  if (DEMO_REPO) {
    await installFakeGithub(context, [
      { fullName: 'datatug/datatug-demo-project', dir: DEMO_REPO },
    ]);
  }
});

test('cold saved CustomerId count supports parameterized HAVING thresholds in the worker', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.goto(COUNT_AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  const customerId = author
    .getByTestId('author-customer-id')
    .locator('input');
  await expect(customerId).toBeVisible();
  await author.getByTestId('author-code-tab').click();
  await expect(customerId).toBeVisible();
  const editor = author.getByTestId('query-body-text').locator('textarea');
  await customerId.fill('1');
  await expect(editor).toHaveValue(/count\(\*\) >= 7/u);
  await author.getByTestId('author-preview').click();
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toHaveAttribute('open', '');
  const thresholdSql = await preview.locator('pre').textContent();
  expect(thresholdSql).toContain('GROUP BY "i"."CustomerId"');
  expect(thresholdSql).toContain('HAVING COUNT(*) >= ?');
  expect(thresholdSql).not.toContain('>= 7');
  await author.getByTestId('author-run').click();

  let receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed · 1 rows · Customer ID 1 applied');
  let rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('1');
  await expect(rows.nth(1)).toContainText('7');
  await expect(receipt).toContainText('loaded in');
  await expect(page.getByTestId('result-provenance')).toHaveCount(0);
  await expect(page.getByTestId('query-run-timings')).toHaveCount(0);
  const composeTab = author.getByTestId('author-compose-tab');
  const codeTab = author.getByTestId('author-code-tab');
  await composeTab.click();
  await expect(editor).toHaveCount(0);
  await expect(composeTab).toHaveAttribute('fill', 'solid');
  await expect(codeTab).toHaveAttribute('fill', 'clear');
  await expect(composeTab).toHaveClass(/button-solid/u);
  await expect(codeTab).toHaveClass(/button-clear/u);
  await expect(composeTab).toHaveAttribute('aria-pressed', 'true');
  await expect(codeTab).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({
    path: testInfo.outputPath('query-author-having-success.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await author.getByTestId('author-code-tab').click();
  await expect(editor).toBeVisible();
  await receipt.getByText('Execution details').click();
  await expect(receipt).toContainText('HAVING threshold (literal)');

  const aboveSeven = (await editor.inputValue()).replace('>= 7', '> 7');
  await editor.fill(aboveSeven);
  await expect(receipt).toContainText('Previous run · 1 rows');
  await author.getByTestId('author-preview').click();
  const strictThresholdSql = await preview.locator('pre').textContent();
  expect(strictThresholdSql).toContain('HAVING COUNT(*) > ?');
  expect(strictThresholdSql).not.toContain('> 7');
  await author.getByTestId('author-run').click();

  receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed · 0 rows · Customer ID 1 applied');
  rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(1);
});

test('cold saved Chinook query previews and runs the same bound TugQL plan in the real SQLite worker', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await expect(author.getByTestId('author-compose-tab')).toBeVisible();
  await expect(author.getByTestId('author-code-tab')).toBeVisible();
  await expect(
    author.getByText('Target: Chinook · pinned public SQLite snapshot'),
  ).toBeVisible();
  await expect(author.getByTestId('author-run')).toHaveAttribute('disabled', '');

  await author.getByTestId('author-customer-id').locator('input').fill('1');
  await author.getByTestId('author-preview').click();
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('open', '');
  await expect(preview).toContainText('Compiled SQL');
  await expect(preview).toContainText('does not execute the query');
  const previewSql = await preview.locator('pre').textContent();
  expect(previewSql).toContain('WHERE "i"."CustomerId" = ?');
  expect(previewSql).toContain('LIMIT 100');
  expect(previewSql).not.toContain('= 1');

  await expect(author.getByTestId('author-run')).toBeEnabled();
  await author.getByTestId('author-run').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toBeVisible({ timeout: 20_000 });
  await expect(receipt).toContainText('Executed · 7 rows · Customer ID 1 applied');
  await page.screenshot({
    path: testInfo.outputPath('query-author-browser-success.png'),
    fullPage: true,
  });
  const executionDetails = receipt.getByText('Execution details');
  await executionDetails.click();
  await expect(receipt).toContainText('Worker execution ID');
  await expect(receipt).toContainText('Input origin: manual · client-reported');
  await expect(receipt).toContainText('The executed request matched the preview at Run time');
  await expect(receipt).toContainText('loaded in');
  await expect(page.getByTestId('result-provenance')).toHaveCount(0);
  await expect(page.getByTestId('query-run-timings')).toHaveCount(0);
  const executionId = await receipt.textContent();
  expect(executionId).toMatch(/execution ID [0-9a-f-]{36}/iu);
  const rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(1)).toContainText('98');
  await expect(rows.nth(7)).toContainText('382');
  expect(errors).toEqual([]);
});
