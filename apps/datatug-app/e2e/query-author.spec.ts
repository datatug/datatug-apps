import { expect, test } from '@playwright/test';
import { installFakeGithub } from './helpers/fake-github';

const DEMO_REPO = process.env['DATATUG_E2E_GITHUB_FAKE'];
const JOIN_DEMO_REPO = process.env['DATATUG_E2E_GITHUB_JOIN'] ?? DEMO_REPO;
const AUTHOR_URL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-invoice-author?id=chinook-invoice-author&editor=text&env=local';
const COUNT_AUTHOR_URL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-customer-invoice-count?id=chinook-customer-invoice-count&editor=text&env=local';

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
  await expect(sourceInspector.locator('summary')).toHaveText(
    'Sources and relationships',
  );
  await expect(sourceInspector).not.toHaveAttribute('open', '');
  await sourceInspector.locator('summary').click();
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
  await expect(joinReceipt).toContainText('Executed');
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
  await expect(joinReceipt).toContainText('7 rows');

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
  await sourceInspector.locator('summary').click();
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
