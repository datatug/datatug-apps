import { expect, test } from './helpers/demodb-guard';
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
  const environmentControls = page.locator('sneat-datatug-menu-env-selector');
  const choices = environmentControls.getByRole('group', { name: 'Choose an environment' });
  await expect(choices.getByRole('button')).toHaveCount(5);
  await expect(selector).toHaveCount(0);
  await expect(page.locator('sneat-datatug-project-menu-top').getByRole('link', { name: 'Environments', exact: true })).toHaveCount(0);
  await environmentControls.getByRole('link', { name: 'Environments', exact: true }).click();
  await expect(page).toHaveURL(/\/environments$/);

  await choices.getByRole('button', { name: 'prod', exact: true }).click();
  await expect(page).toHaveURL(/\/env\/prod$/);
  await expect(selector).toBeVisible();
  await expect(selector.locator('ion-select-option')).toHaveCount(5);
  await expect(selector).toHaveJSProperty('value', 'prod');
  await expect(choices).toHaveCount(0);
  const iconEndGap = await selector.locator('.select-icon').evaluate((icon) => {
    const root = icon.getRootNode() as ShadowRoot;
    return root.host.getBoundingClientRect().right - icon.getBoundingClientRect().right;
  });
  expect(iconEndGap).toBeLessThanOrEqual(12);

  await selector.click();
  await page.getByRole('radio', { name: 'local', exact: true }).click();
  await expect(page).toHaveURL(/\/env\/local$/);
  await expect(selector).toHaveJSProperty('value', 'local');

  await page.reload();
  const reloadedSelector = page.locator(
    'sneat-datatug-menu-env-selector ion-select',
  );
  await expect(reloadedSelector).toHaveJSProperty('value', 'local');

  await page
    .locator('sneat-datatug-menu-env-selector ion-button[color="medium"]')
    .click();
  await expect(page).toHaveURL(/\/demo-project-1\/?$/);
  await expect(
    page.locator('sneat-datatug-menu-env-selector ion-select'),
  ).toHaveCount(0);
  await expect(choices.getByRole('button')).toHaveCount(5);
  await page.reload();
  await expect(page).toHaveURL(/\/demo-project-1\/?$/);
  await expect(
    page.locator('sneat-datatug-menu-env-selector ion-button[color="medium"]'),
  ).toHaveCount(0);
});
