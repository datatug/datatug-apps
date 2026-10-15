import { expect, test } from '@playwright/test';
import { installFakeGithub } from './helpers/fake-github';

const GITHUB_FAKE_DIR = process.env['DATATUG_E2E_GITHUB_FAKE'];
const PROJECT_URL =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1';

test.skip(
  !GITHUB_FAKE_DIR,
  'set DATATUG_E2E_GITHUB_FAKE to the demo project checkout',
);

test.beforeEach(async ({ context }) => {
  if (GITHUB_FAKE_DIR) {
    await installFakeGithub(context, [
      { fullName: 'datatug/datatug-demo-project', dir: GITHUB_FAKE_DIR },
    ]);
  }
});

test('environment selector follows project data, URL, reload, and Clear', async ({
  page,
}) => {
  await page.goto(PROJECT_URL);
  const selector = page.locator('sneat-datatug-menu-env-selector ion-select');
  await expect(selector).toBeVisible({ timeout: 20_000 });
  await expect(selector.locator('ion-select-option')).toHaveCount(5);

  await selector.click();
  await page.getByRole('radio', { name: 'prod' }).click();
  await expect(page).toHaveURL(/\/env\/prod$/);
  await expect(selector).toHaveJSProperty('value', 'prod');

  await page.reload();
  const reloadedSelector = page.locator(
    'sneat-datatug-menu-env-selector ion-select',
  );
  await expect(reloadedSelector).toHaveJSProperty('value', 'prod');

  await page
    .locator('sneat-datatug-menu-env-selector ion-button[color="medium"]')
    .click();
  await expect(page).toHaveURL(/\/demo-project-1\/?$/);
  await expect(
    page.locator('sneat-datatug-menu-env-selector ion-select'),
  ).toHaveJSProperty('value', undefined);
  await page.reload();
  await expect(page).toHaveURL(/\/demo-project-1\/?$/);
  await expect(
    page.locator('sneat-datatug-menu-env-selector ion-button[color="medium"]'),
  ).toHaveCount(0);
});
