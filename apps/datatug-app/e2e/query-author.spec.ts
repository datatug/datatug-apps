import { expect, test } from '@playwright/test';
import { installFakeGithub } from './helpers/fake-github';

const DEMO_REPO = process.env['DATATUG_E2E_GITHUB_FAKE'];
const JOIN_DEMO_REPO = process.env['DATATUG_E2E_GITHUB_JOIN'] ?? DEMO_REPO;
const AUTHOR_URL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-invoice-author?id=chinook-invoice-author&editor=text&env=local';
const COUNT_AUTHOR_URL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-customer-invoice-count?id=chinook-customer-invoice-count&editor=text&env=local';
const CTE_AUTHOR_URL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-customer-count-cte?id=chinook-customer-count-cte&editor=text&env=local';

test.skip(
  !DEMO_REPO,
  'set DATATUG_E2E_GITHUB_FAKE to the demo project checkout containing the saved Author query',
);

test.beforeEach(async ({ context }, testInfo) => {
  if (DEMO_REPO) {
    const repository = testInfo.title.includes('Invoice Customer join')
      ? JOIN_DEMO_REPO
      : DEMO_REPO;
    await installFakeGithub(context, [
      {
        fullName: 'datatug/datatug-demo-project',
        dir: repository ?? DEMO_REPO,
      },
    ]);
  }
});

test('Compose HAVING edits replace the shared draft before Preview and worker Run', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(COUNT_AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });

  const threshold = author.getByRole('spinbutton', {
    name: 'HAVING threshold',
  });
  await threshold.fill('8');
  await threshold.press('Tab');
  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('textarea');
  await expect(editor).toHaveValue(/having count\(\*\) >= 8/u);

  await author.getByTestId('author-preview').click();
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  await expect(preview.locator('pre')).toContainText('HAVING COUNT(*) >= ?');
  await expect(preview.locator('pre')).not.toContainText('>= 8');

  await author.getByTestId('author-customer-id').locator('input').fill('1');
  await author.getByTestId('author-run').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('0 rows');
  await expect(page.getByRole('grid').getByRole('row')).toHaveCount(1);

  await author.getByTestId('author-compose-tab').click();
  const thresholdControl = author.getByRole('spinbutton', {
    name: 'HAVING threshold',
  });
  await thresholdControl.fill('8.5');
  await thresholdControl.press('Tab');
  await expect(thresholdControl).toHaveValue('8');
  await expect(author.getByRole('alert')).toContainText(
    'Enter a whole-number HAVING threshold',
  );
  await author.getByTestId('author-code-tab').click();
  await expect(editor).toHaveValue(/having count\(\*\) >= 8\n/u);
});

test('Customer count CTE previews without values and runs against the pinned fixture', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(CTE_AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-preview').click();
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  await expect(preview).toContainText('Required · unset');
  await expect(preview.locator('pre')).toContainText('HAVING COUNT(*) >= ?');
  await expect(preview.locator('pre')).not.toContainText('>= 7');
  await expect(preview.locator('pre')).not.toContainText('= 1');
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  await author.getByTestId('author-customer-id').locator('input').fill('1');
  await author.getByTestId('author-run').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('1 rows');
  const rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(2);
  const resultCells = rows.nth(1).getByRole('gridcell');
  await expect(resultCells.nth(0)).toHaveText('1');
  await expect(resultCells.nth(1)).toHaveText('7');
  await expect(resultCells.nth(2)).toHaveText('Luís');
  await expect(resultCells.nth(3)).toHaveText('Gonçalves');
  await expect(resultCells.nth(4)).toHaveText('luisg@embraer.com.br');
  await expect(receipt).not.toContainText('Worker-verified relationship');
});

test('Code formats TugQL reversibly before explicit Preview and worker Run', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('textarea');
  const original = await editor.inputValue();
  const mixed = original
    .replace(/^(\s*)from\b/imu, '$1FrOm')
    .replace(/^(\s*)where\b/imu, '$1WhErE')
    .replace(/^(\s*)limit\b/imu, '$1LiMiT')
    .replace(/^(\s*)select\b/imu, '$1sElEcT')
    .replace(/^( {2,})/gmu, '\t');
  expect(mixed).not.toBe(original);
  await editor.fill(mixed);

  await author.getByTestId('author-format-tugql').click();
  await expect(editor).not.toHaveValue(mixed);
  const formatted = await editor.inputValue();
  expect(formatted).not.toBe(mixed);
  await expect(author.getByTestId('author-format-status')).toHaveText(
    'TugQL formatted.',
  );
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await expect(page.getByTestId('author-execution-receipt')).toHaveCount(0);

  await author.getByTestId('author-undo-format').click();
  await expect(editor).toHaveValue(mixed);
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);

  const malformed = mixed.replace(
    /^(\s*)where\b.*$/imu,
    "$1WHERE i.Name = 'Mixed\nCase'",
  );
  expect(malformed).not.toBe(mixed);
  await editor.fill(malformed);
  await author.getByTestId('author-format-tugql').click();
  await expect(editor).toHaveValue(malformed);
  const formatStatus = author.getByTestId('author-format-status');
  await expect(formatStatus).toContainText(
    'TugQL was not changed: quoted value cannot continue across lines',
  );
  expect(
    (await formatStatus.innerText()).match(
      /quoted value cannot continue across lines/gu,
    ),
  ).toHaveLength(1);
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await expect(page.getByTestId('author-execution-receipt')).toHaveCount(0);
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  await editor.fill(mixed);
  await expect(editor).toHaveValue(mixed);

  await author.getByTestId('author-format-tugql').click();
  await expect(editor).not.toHaveValue(mixed);
  await author.getByTestId('author-preview').click();
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  await expect(preview).toContainText('Required · unset');
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  await author.getByTestId('author-customer-id').locator('input').fill('1');
  await author.getByTestId('author-run').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('7 rows');
  const rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(8);
  for (const [index, invoiceId] of [
    '98',
    '121',
    '143',
    '195',
    '316',
    '327',
    '382',
  ].entries()) {
    await expect(
      rows.nth(index + 1).getByRole('gridcell').first(),
    ).toHaveText(invoiceId);
  }
  await expect(author.getByTestId('author-format-status')).toHaveText(
    'TugQL formatted.',
  );
});

test('Invoice Customer join makes missing ON reviewable and opens an explicit typed lookup', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(
    '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-customer-invoice-join?id=chinook-customer-invoice-join&editor=text&env=local',
  );
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await expect(author.getByRole('button', { name: 'Code', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const editor = author.getByTestId('query-body-text').locator('textarea');
  const original = await editor.inputValue();
  const missingOn = original.replace(
    /join Customer as c\r?\n\s*on i\.CustomerId = c\.CustomerId\r?\n/u,
    'join Customer as c -- preserve this relationship note\n',
  );
  expect(missingOn).not.toBe(original);
  await editor.fill(missingOn);
  await author.getByTestId('author-preview').click();

  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toContainText('Preview · Not executed');
  await expect(editor).toHaveValue(/on i\.CustomerId = c\.CustomerId/u);
  await expect(editor).toHaveValue(/-- preserve this relationship note/u);
  const sourceInspector = preview.getByTestId('author-source-inspector');
  await expect(sourceInspector.locator(':scope > summary')).toHaveText(
    'Sources and relationships',
  );
  await expect(sourceInspector).not.toHaveAttribute('open', '');
  await sourceInspector.locator(':scope > summary').click();
  const preparedMetadata = preview.getByTestId('author-source-metadata');
  await expect(preparedMetadata).toContainText('chinook-sqlite');
  await expect(preparedMetadata).toContainText(
    'FK_Invoice_Customer_CustomerId',
  );
  const declaredRelationship = preparedMetadata.locator(
    '[aria-label="Prepared relationship"]',
  );
  const relationshipPairs = declaredRelationship.locator('li');
  await expect(relationshipPairs).toHaveCount(1);
  await expect(relationshipPairs.first()).toHaveText(
    'i.CustomerId → c.CustomerId',
  );
  await expect(
    declaredRelationship.getByText('Relationship definition fingerprint'),
  ).toBeVisible();
  await expect(
    declaredRelationship.locator('.author-source-fingerprint'),
  ).not.toHaveAttribute('open', '');
  await expect(preparedMetadata).toContainText(
    'Prepared metadata · not worker-verified or executed.',
  );
  await expect(preview.locator('pre')).toContainText(
    'INNER JOIN "Customer" AS "c" ON "i"."CustomerId" = "c"."CustomerId"',
  );
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  await author.getByTestId('author-customer-id').locator('input').fill('1');
  await author.getByTestId('author-run').click();
  const joinReceipt = page.getByTestId('author-execution-receipt');
  await expect(joinReceipt).toContainText('Executed');
  await expect(joinReceipt).toContainText('7 rows');
  await expect(joinReceipt).toContainText('Worker-verified relationship');
  let rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(1)).toContainText('98');
  await expect(rows.nth(7)).toContainText('382');

  const firstRunAction = await page
    .getByRole('button', { name: 'Look up invoices for Customer ID 1' })
    .first()
    .elementHandle();
  expect(firstRunAction).not.toBeNull();
  await author.getByTestId('author-customer-id').locator('input').fill('2');
  await expect(
    page.getByRole('button', { name: 'Look up invoices for Customer ID 1' }),
  ).toHaveCount(0);
  await expect(author.getByTestId('author-binding-origin')).toContainText(
    'manual · client-reported',
  );
  await author.getByTestId('author-run').click();
  await expect(joinReceipt).toContainText('Customer ID 2');
  await expect(
    rows
      .nth(1)
      .getByRole('button', { name: 'Look up invoices for Customer ID 2' }),
  ).toBeVisible();
  await firstRunAction?.evaluate((button) => button.click());
  await expect(page).toHaveURL(/id=chinook-customer-invoice-join/u);
  await author.getByTestId('author-customer-id').locator('input').fill('1');
  await joinReceipt.getByText('Execution details', { exact: true }).click();
  const executionId = joinReceipt.getByText(/^Worker execution ID /u);
  const previousExecutionId = await executionId.textContent();
  await author.getByTestId('author-run').click();
  // The previous CustomerId=2 run has the same row count, so waiting only for
  // “7 rows” can race the refreshed grid and start keyboard navigation against
  // the old receipt. Bind the keyboard journey to the new worker execution.
  await expect(executionId).not.toHaveText(previousExecutionId ?? '');
  await expect(joinReceipt).toContainText('Customer ID 1');
  await expect(joinReceipt).toContainText('7 rows');
  await expect(rows.nth(1)).toContainText('98');
  await expect(
    rows
      .nth(1)
      .getByRole('button', { name: 'Look up invoices for Customer ID 1' }),
  ).toBeVisible();

  const lookupActions = page.getByRole('button', {
    name: 'Look up invoices for Customer ID 1',
  });
  const firstLookupAction = lookupActions.nth(0);
  const firstResultRow = rows.nth(1);
  const invoiceIdCell = firstResultRow.getByRole('gridcell').nth(0);
  const customerIdCell = firstResultRow.getByRole('gridcell').nth(1);
  const firstNameCell = firstResultRow.getByRole('gridcell').nth(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#workspace-results-tab').click();
  await expect(page.locator('#workspace-results-pane')).toBeVisible();
  await expect(firstLookupAction).toBeVisible();
  await invoiceIdCell.click();
  await page.keyboard.press('Tab');
  await expect(customerIdCell).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(firstLookupAction).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(firstNameCell).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(customerIdCell).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(invoiceIdCell).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(customerIdCell).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(firstLookupAction).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/id=chinook-invoice-author/u);
  const lookupAuthor = page.getByTestId('tugql-author');
  await expect(lookupAuthor).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Editor', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#workspace-editor-pane')).toBeVisible();
  await expect(lookupAuthor.locator('ion-card-title')).toBeFocused();
  await expect(
    lookupAuthor.getByTestId('author-customer-id').locator('input'),
  ).toHaveValue('1');
  await expect(page.getByTestId('author-results-empty')).toHaveCount(1);
  await expect(lookupAuthor.getByTestId('author-binding-origin')).toContainText(
    'selection · client-reported',
  );
  await expect(lookupAuthor.getByTestId('author-binding-origin')).toContainText(
    'chinook-customer-invoice-join.CustomerId',
  );
  await expect(lookupAuthor.getByTestId('author-binding-origin')).toContainText(
    'Chinook Invoice Author',
  );
  await expect(lookupAuthor.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );
  await expect(page.getByTestId('author-execution-receipt')).toHaveCount(0);

  await lookupAuthor.getByTestId('author-preview').click();
  await expect(lookupAuthor.getByTestId('author-run')).toBeEnabled();
  await expect(page.getByTestId('author-execution-receipt')).toHaveCount(0);
  await lookupAuthor.getByTestId('author-run').click();
  await page.locator('#workspace-results-tab').click();
  await expect(page.locator('#workspace-results-pane')).toBeVisible();
  const lookupReceipt = page.getByTestId('author-execution-receipt');
  await expect(lookupReceipt).toContainText('Executed');
  await expect(lookupReceipt).toContainText('7 rows');
  await lookupReceipt.getByText('Execution details').click();
  await expect(lookupReceipt).toContainText(
    'Input origin: selection · client-reported',
  );
  await expect(lookupReceipt).toContainText(
    'chinook-customer-invoice-join.CustomerId',
  );
  rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(1)).toContainText('98');
});

test('cold saved CustomerId count supports parameterized HAVING thresholds in the worker', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.goto(COUNT_AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  const customerId = author.getByTestId('author-customer-id').locator('input');
  await expect(customerId).toBeVisible();
  await customerId.fill('');
  await author.getByTestId('author-preview').click();
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Preview · Not executed');
  await expect(preview).toContainText('?1');
  await expect(preview).toContainText('@CustomerId · integer');
  await expect(preview).toContainText('Required · unset');
  await expect(preview).toContainText('HAVING threshold · integer literal');
  await expect(preview).toContainText('?2');
  await expect(preview).toContainText('7');
  const sourceInspector = preview.getByTestId('author-source-inspector');
  await sourceInspector.locator(':scope > summary').click();
  const preparedMetadata = preview.getByTestId('author-source-metadata');
  await expect(preparedMetadata).toContainText('chinook-sqlite');
  await expect(preparedMetadata).toContainText(
    'Column lineage is unavailable for this preview.',
  );
  await expect(preparedMetadata).not.toContainText('Declared relationship');
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );
  await author.getByTestId('author-code-tab').click();
  await expect(customerId).toBeVisible();
  const editor = author.getByTestId('query-body-text').locator('textarea');
  await expect(editor).toHaveValue(/count\(\*\) >= 7/u);
  const thresholdSql = await preview.locator('pre').textContent();
  expect(thresholdSql).toContain('GROUP BY "i"."CustomerId"');
  expect(thresholdSql).toContain('HAVING COUNT(*) >= ?');
  expect(thresholdSql).not.toContain('>= 7');
  await customerId.fill('1');
  await expect(preview.locator('pre')).toHaveText(thresholdSql ?? '');
  await expect(author.getByTestId('author-run')).toBeEnabled();
  await author.getByTestId('author-run').click();

  let receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('1 row');
  await expect(receipt).toContainText('Customer ID 1');
  let rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('1');
  await expect(rows.nth(1)).toContainText('7');
  await expect(receipt).toContainText('Loaded in');
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
  await expect(receipt).toContainText('Previous run');
  await expect(receipt).toContainText('1 row');
  await author.getByTestId('author-preview').click();
  const strictThresholdSql = await preview.locator('pre').textContent();
  expect(strictThresholdSql).toContain('HAVING COUNT(*) > ?');
  expect(strictThresholdSql).not.toContain('> 7');
  await author.getByTestId('author-run').click();

  receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('0 rows');
  await expect(receipt).toContainText('Customer ID 1');
  await expect(receipt).toContainText('Loaded in');
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
  await expect(page.getByTestId('author-results-empty')).toBeVisible();
  await expect(page.locator('#workspace-editor-pane')).toBeVisible();
  await expect(page.locator('#workspace-results-pane')).toBeVisible();
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  const invoiceDate = author.getByLabel('InvoiceDate', { exact: true });
  await expect(invoiceDate).toBeChecked();
  await invoiceDate.uncheck();
  await author.getByTestId('author-code-tab').click();
  const editor = author.getByTestId('query-body-text').locator('textarea');
  await expect(editor).toHaveValue(/select i\.InvoiceId\s*$/u);
  await expect(editor).not.toHaveValue(/InvoiceDate/u);
  await author.getByTestId('author-compose-tab').click();
  await expect(invoiceDate).not.toBeChecked();

  const customerId = author.getByTestId('author-customer-id').locator('input');
  await customerId.fill('');
  await author.getByTestId('author-preview').click();
  const preview = author.getByTestId('author-sql-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('SQL preview');
  await expect(preview).toContainText('Preview · Not executed');
  await expect(preview).toContainText('Preview never executes the query');
  await expect(preview).toContainText('Required · unset');
  const previewSql = await preview.locator('pre').textContent();
  expect(previewSql).toContain('WHERE "i"."CustomerId" = ?');
  expect(previewSql).toContain('LIMIT 100');
  expect(previewSql).not.toContain('= 1');
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  await customerId.fill('1.5');
  await expect(preview).toContainText('Invalid · enter a whole number');
  await expect(
    author.getByText('Enter a whole-number Customer ID'),
  ).toBeVisible();
  await expect(customerId).toHaveAttribute('aria-invalid', 'true');
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  await customerId.fill('1');
  await expect(preview.locator('pre')).toHaveText(previewSql ?? '');
  await expect(author.getByTestId('author-run')).toBeEnabled();
  await author.getByTestId('author-run').click();
  const receipt = page.getByTestId('author-execution-receipt');
  await expect(receipt).toBeVisible({ timeout: 20_000 });
  await expect(receipt).toContainText('Executed');
  await expect(receipt).toContainText('7 rows');
  await expect(receipt).toContainText('Customer ID 1');
  await expect(receipt).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('query-author-browser-success.png'),
    fullPage: true,
  });
  const executionDetails = receipt.getByText('Execution details');
  await executionDetails.click();
  await expect(receipt).toContainText('Worker execution ID');
  await expect(receipt).toContainText('Input origin: manual · client-reported');
  await expect(receipt).toContainText(
    'The executed request matched the preview at Run time',
  );
  await expect(receipt).toContainText('Loaded in');
  await expect(page.getByTestId('result-provenance')).toHaveCount(0);
  await expect(page.getByTestId('query-run-timings')).toHaveCount(0);
  const executionId = await receipt.textContent();
  expect(executionId).toMatch(/execution ID [0-9a-f-]{36}/iu);
  const rows = page.getByRole('grid').getByRole('row');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(1)).toContainText('98');
  await expect(rows.nth(7)).toContainText('382');
  expect(errors).toEqual([]);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const resultsView = page.locator('#workspace-results-tab');
    await resultsView.click();
    await expect(resultsView).toHaveAttribute('aria-pressed', 'true');
    await expect(receipt).toBeVisible();
    const editorView = page.locator('#workspace-editor-tab');
    await editorView.click();
    await expect(editorView).toHaveAttribute('aria-pressed', 'true');
    await expect(author).toBeVisible();
    const header = await page.evaluate(() => {
      const bounds = (selector: string): DOMRect | undefined =>
        document.querySelector(selector)?.getBoundingClientRect();
      const start = bounds('ion-toolbar ion-buttons[slot="start"]');
      const title = bounds('.query-page-title');
      const end = bounds('ion-toolbar ion-buttons[slot="end"]');
      return {
        startRight: start?.right,
        titleLeft: title?.left,
        titleRight: title?.right,
        endLeft: end?.left,
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    expect(header.startRight).toBeLessThanOrEqual(header.titleLeft ?? -1);
    expect(header.titleRight).toBeLessThanOrEqual(header.endLeft ?? -1);
    expect(header.documentWidth).toBeLessThanOrEqual(header.viewportWidth);
  }

  // Ionic chooses its mode during the first page bootstrap, so use a fresh
  // navigation to exercise the iOS header layout explicitly.
  await page.goto(`${AUTHOR_URL}&ionic:mode=ios`);
  const queryToolbar = page.locator('ion-toolbar.toolbar-label');
  await expect(queryToolbar).toHaveClass(/\bios\b/u);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const header = await page.evaluate(() => {
      const bounds = (selector: string): DOMRect | undefined =>
        document.querySelector(selector)?.getBoundingClientRect();
      const start = bounds('ion-toolbar ion-buttons[slot="start"]');
      const title = bounds('.query-page-title');
      const end = bounds('ion-toolbar ion-buttons[slot="end"]');
      return {
        startRight: start?.right,
        titleLeft: title?.left,
        titleRight: title?.right,
        endLeft: end?.left,
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    expect(header.startRight).toBeLessThanOrEqual(header.titleLeft ?? -1);
    expect(header.titleRight).toBeLessThanOrEqual(header.endLeft ?? -1);
    expect(header.documentWidth).toBeLessThanOrEqual(header.viewportWidth);
  }
});

test('multiline SELECT requires a block while compact and canonical queries preview identically', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(AUTHOR_URL);
  const author = page.getByTestId('tugql-author');
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.getByTestId('author-code-tab').click();

  const editor = author.getByTestId('query-body-text').locator('textarea');
  const customerId = author.getByTestId('author-customer-id').locator('input');
  await customerId.fill('');
  const compactSource = await editor.inputValue();
  expect(compactSource).toMatch(/select i\.InvoiceId, i\.InvoiceDate\s*$/u);

  const bareMultilineSource = compactSource.replace(
    /select i\.InvoiceId, i\.InvoiceDate\s*$/u,
    'select\n  i.InvoiceId\n  i.InvoiceDate',
  );
  expect(bareMultilineSource).not.toBe(compactSource);
  await editor.fill(bareMultilineSource);
  await author.getByTestId('author-preview').click();

  await expect(author.getByTestId('author-error')).toContainText(
    "multiline SELECT requires '(' on the SELECT header line",
  );
  await expect(editor).toHaveValue(bareMultilineSource);
  await expect(author.getByTestId('author-sql-preview')).toHaveCount(0);
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  const blockSource = compactSource.replace(
    /select i\.InvoiceId, i\.InvoiceDate\s*$/u,
    'select (\n  i.InvoiceId\n  i.InvoiceDate\n)',
  );
  await editor.fill(blockSource);
  await author.getByTestId('author-preview').click();

  const blockPreview = author.getByTestId('author-sql-preview');
  await expect(blockPreview).toBeVisible();
  await expect(blockPreview).toContainText('Required · unset');
  await expect(author.getByTestId('author-error')).toHaveCount(0);
  const blockSql = await blockPreview.locator('pre').textContent();
  expect(blockSql).toContain('"i"."InvoiceId"');
  expect(blockSql).toContain('"i"."InvoiceDate"');
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );

  await editor.fill(compactSource);
  await author.getByTestId('author-preview').click();
  const compactPreview = author.getByTestId('author-sql-preview');
  await expect(compactPreview).toBeVisible();
  await expect(compactPreview).toContainText('Required · unset');
  await expect(compactPreview.locator('pre')).toHaveText(blockSql ?? '');
  await expect(author.getByTestId('author-error')).toHaveCount(0);
  await expect(author.getByTestId('author-run')).toHaveAttribute(
    'disabled',
    '',
  );
});
