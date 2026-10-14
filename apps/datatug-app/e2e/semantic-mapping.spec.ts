import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { installFakeGithub } from './helpers/fake-github';
import { activePage } from './journey/helpers/active-page';
const queryURL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/query/chinook-invoice-author?id=chinook-invoice-author&editor=text&env=local';
test('column meaning saves a complete personal copy, stays visible and survives cold reload', async ({
  context,
  page,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  await installFakeGithub(context, [
    {
      fullName: 'datatug/datatug-demo-project',
      dir:
        process.env['DATATUG_E2E_GITHUB_FAKE'] ||
        '/Users/alex/projects/datatug/datatug-demo-project',
    },
  ]);
  await page.goto(queryURL);
  const author = activePage(page);
  await author.getByTestId('author-customer-id').locator('input').fill('1');
  await author.getByTestId('author-preview-tab').click();
  await author.getByTestId('author-preview').click();
  await author.getByTestId('author-run').click();
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 30000 });
  const map = page.getByRole('button', {
    name: 'Map meaning of InvoiceId',
    exact: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await map.focus();
  await map.press('Enter');
  const modal = page.locator('ion-modal').filter({ visible: true });
  await modal
    .getByLabel('Property name', { exact: true })
    .fill('Invoice number');
  await modal.getByLabel('Entity name', { exact: true }).fill('Invoice');
  await modal
    .locator('summary')
    .filter({ hasText: 'Context role (optional)' })
    .click();
  await modal
    .getByLabel('Context role (optional)', { exact: true })
    .fill('Billing');
  await modal
    .locator('summary')
    .filter({ hasText: 'Context role (optional)' })
    .click();
  expect(
    await modal
      .getByRole('button', { name: 'Save personal copy', exact: true })
      .evaluate(
        (element) =>
          element.getBoundingClientRect().bottom <= window.innerHeight,
      ),
  ).toBe(true);
  expect(
    await modal.evaluate(
      (element) => element.getBoundingClientRect().width <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'coverage/apps/datatug-app-e2e/semantic-mapping-modal.png',
    fullPage: true,
    animations: 'disabled',
  });
  await modal
    .getByRole('button', { name: 'Save personal copy', exact: true })
    .click();
  await expect(page).toHaveURL(/device-personal-/);
  await expect(page.getByRole('link', { name: 'Edit query Validators' })).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(
    page.getByRole('button', {
      name: 'Edit meaning of InvoiceId',
      exact: true,
    }),
  ).toContainText('Invoice · Invoice number');
  await expect(page.getByTestId('query-save-state')).toContainText(
    'Saved on this device',
  );
  await expect(
    page.getByRole('button', {
      name: 'Edit meaning of InvoiceId',
      exact: true,
    }),
  ).not.toContainText('Needs review');
  await expect(
    activePage(page).getByTestId('author-customer-id').locator('input'),
  ).toHaveValue('1');
  await page
    .getByRole('columnheader')
    .filter({
      has: page.getByRole('button', {
        name: 'Edit meaning of InvoiceId',
        exact: true,
      }),
    })
    .click({ button: 'right' });
  await page
    .locator('ion-modal')
    .filter({ visible: true })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(page.locator('ion-modal').filter({ visible: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: 'coverage/apps/datatug-app-e2e/semantic-mapping-confirmed.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.reload();
  await expect(page.getByTestId('query-save-state')).toContainText(
    'Saved on this device',
  );
  await expect(page.getByRole('link', { name: 'Edit query Validators' })).toHaveCount(0);
  const reopened = activePage(page);
  await reopened.getByTestId('author-customer-id').locator('input').fill('1');
  await reopened.getByTestId('author-preview-tab').click();
  await reopened.getByTestId('author-preview').click();
  await reopened.getByTestId('author-run').click();
  const badge = page.getByRole('button', {
    name: 'Edit meaning of InvoiceId',
    exact: true,
  });
  await expect(badge).toContainText('Invoice · Invoice number');
  await expect(badge).not.toContainText('Needs review');
  await expect(badge).not.toContainText('Checking meaning');
  await badge.click();
  await page
    .locator('ion-modal')
    .filter({ visible: true })
    .getByLabel('Property name', { exact: true })
    .fill('Invoice reference');
  await page
    .locator('ion-modal')
    .filter({ visible: true })
    .getByRole('button', { name: 'Save meaning', exact: true })
    .click();
  await expect(badge).toContainText('Invoice · Invoice reference');
  await expect(page.locator('ion-modal').filter({ visible: true })).toHaveCount(
    0,
  );
  await page
    .getByRole('button', { name: 'Map meaning of InvoiceDate', exact: true })
    .click();
  let editor = page.locator('ion-modal').filter({ visible: true });
  await editor.locator('ion-select').first().click();
  await page
    .getByRole('radio', { name: 'Invoice · Invoice reference', exact: true })
    .click();
  await editor
    .getByRole('button', { name: 'Save meaning', exact: true })
    .click();
  const second = page.getByRole('button', {
    name: 'Edit meaning of InvoiceDate',
    exact: true,
  });
  await expect(second).toContainText('Invoice · Invoice reference');
  await badge.click();
  editor = page.locator('ion-modal').filter({ visible: true });
  await editor
    .getByLabel('Property name', { exact: true })
    .fill('Shared reference');
  await editor
    .getByRole('button', { name: 'Save meaning', exact: true })
    .click();
  await expect(badge).toContainText('Invoice · Shared reference');
  await expect(second).toContainText('Invoice · Shared reference');
  await badge.click();
  editor = page.locator('ion-modal').filter({ visible: true });
  await editor.getByText('Reuse and export meanings', { exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await editor
    .getByRole('button', { name: 'Export MeaningGraph', exact: true })
    .click();
  const download = await downloadPromise;
  await download.saveAs('coverage/apps/datatug-app-e2e/query.meaning.json');
  const modelDownloadPromise = page.waitForEvent('download');
  await editor
    .getByRole('button', { name: 'Export ModelSpec', exact: true })
    .click();
  await (
    await modelDownloadPromise
  ).saveAs('coverage/apps/datatug-app-e2e/query.modelspec.json');
  const exported = JSON.parse(await readFile('coverage/apps/datatug-app-e2e/query.meaning.json', 'utf8'));
  expect(exported.format).toBe('meaning/draft-2');
  expect(
    exported.concepts.find(
      (concept: { id: string }) => concept.id === 'invoice-number',
    ).bindings,
  ).toHaveLength(2);
  await editor.locator('input[type=file]').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        ...exported,
        concepts: [{ ...exported.concepts[0], labels: { en: 42 } }],
      }),
    ),
  });
  await expect(editor.getByRole('alert')).toContainText('invalid');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await reopened.getByTestId('author-compose-tab').click();
  await reopened
    .getByRole('spinbutton', { name: 'Row limit', exact: true })
    .fill('50');
  await expect(badge).toContainText('Needs review');
  await reopened.getByTestId('author-preview-tab').click();
  await reopened.getByTestId('author-preview').click();
  await reopened.getByTestId('author-run').click();
  await expect(
    reopened.getByTestId('author-execution-receipt'),
  ).not.toContainText('Previous run');
  await expect(reopened.getByTestId('author-execution-receipt')).toContainText(
    'Executed',
  );
  await expect(badge).toContainText('Needs review');
  await second.click();
  editor = page.locator('ion-modal').filter({ visible: true });
  await expect(
    editor.getByRole('button', { name: 'Remove mapping', exact: true }),
  ).toBeDisabled();
  const review = editor.getByRole('checkbox', {
    name: 'I reviewed every mapping below for the current query and columns.',
    exact: true,
  });
  await review.focus();
  await review.press('Space');
  await expect(review).toHaveAttribute('aria-checked', 'true');
  await editor
    .getByRole('button', { name: 'Remove mapping', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Map meaning of InvoiceDate',
      exact: true,
    }),
  ).toBeVisible();
  await expect(badge).not.toContainText('Needs review');
  await badge.click();
  editor = page.locator('ion-modal').filter({ visible: true });
  await editor
    .getByLabel('Property name', { exact: true })
    .fill('Unsaved conflict draft');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('datatug-personal-queries', 1);
      open.onsuccess = () => {
        const db = open.result,
          tx = db.transaction('queries', 'readwrite'),
          store = tx.objectStore('queries'),
          all = store.getAll();
        all.onsuccess = () => {
          const query = all.result[0];
          query.revision += 1;
          store.put(query);
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  await editor
    .getByRole('button', { name: 'Save meaning', exact: true })
    .click();
  await expect(editor.getByRole('alert')).toContainText('another tab');
  await expect(editor.getByLabel('Property name', { exact: true })).toHaveValue(
    'Unsaved conflict draft',
  );
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(badge).toContainText('Invoice · Shared reference');
  const firstPersonalURL = page.url();
  await page.goto(queryURL);
  const independent = activePage(page);
  await independent
    .getByTestId('author-customer-id')
    .locator('input')
    .fill('1');
  await independent.getByTestId('author-preview-tab').click();
  await independent.getByTestId('author-preview').click();
  await independent.getByTestId('author-run').click();
  await page
    .getByRole('button', { name: 'Map meaning of InvoiceId', exact: true })
    .click();
  editor = page.locator('ion-modal').filter({ visible: true });
  await editor.getByText('Reuse and export meanings', { exact: true }).click();
  await editor.locator('input[type=file]').setInputFiles({
    name: 'query.meaning.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await editor.locator('ion-select').first().click();
  await page
    .getByRole('radio', { name: 'Invoice · Shared reference', exact: true })
    .click();
  await editor
    .getByRole('button', { name: 'Save personal copy', exact: true })
    .click();
  await expect(page).toHaveURL(/device-personal-/);
  expect(page.url()).not.toBe(firstPersonalURL);
  await expect(
    page.getByRole('button', {
      name: 'Edit meaning of InvoiceId',
      exact: true,
    }),
  ).toContainText('Invoice · Shared reference');
  // Direct reuse from a saved query requires no files and remains independent.
  const importedPersonalURL = page.url();
  await page.goto(queryURL);
  const direct = activePage(page);
  await direct.getByTestId('author-customer-id').locator('input').fill('1');
  await direct.getByTestId('author-preview-tab').click();
  await direct.getByTestId('author-preview').click();
  await direct.getByTestId('author-run').click();
  await page
    .getByRole('button', { name: 'Map meaning of InvoiceId', exact: true })
    .click();
  editor = page.locator('ion-modal').filter({ visible: true });
  await expect(
    editor.getByText(
      'Loading saved meanings… You can still create a property.',
      { exact: true },
    ),
  ).toHaveCount(0);
  await editor.locator('ion-select').first().click();
  const savedOption = page
    .getByRole('radio', {
      name: /Invoice · Shared reference — .*Personal \(on this device\)/,
    })
    .first();
  await savedOption.click();
  await expect(
    editor.getByText(/Copied from .* Edits here affect only this query\./),
  ).toBeVisible();
  await editor
    .getByLabel('Property name', { exact: true })
    .fill('Independent reference');
  await editor
    .getByRole('button', { name: 'Save personal copy', exact: true })
    .click();
  await expect(page).toHaveURL(/device-personal-/);
  expect(page.url()).not.toBe(firstPersonalURL);
  expect(page.url()).not.toBe(importedPersonalURL);
  await expect(
    page.getByRole('button', {
      name: 'Edit meaning of InvoiceId',
      exact: true,
    }),
  ).toContainText('Invoice · Independent reference');
  for (const sourceURL of [firstPersonalURL, importedPersonalURL]) {
    await page.goto(sourceURL);
    const unchangedSource = activePage(page);
    await unchangedSource
      .getByTestId('author-customer-id')
      .locator('input')
      .fill('1');
    await unchangedSource.getByTestId('author-preview-tab').click();
    await unchangedSource.getByTestId('author-preview').click();
    await unchangedSource.getByTestId('author-run').click();
    await expect(
      page.getByRole('button', {
        name: 'Edit meaning of InvoiceId',
        exact: true,
      }),
    ).toContainText('Invoice · Shared reference');
  }
});
