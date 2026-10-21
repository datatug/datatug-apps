import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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


test('overview query sorting uses persisted creation dates and native Ionic tabs', async ({ page }) => {
  if (!GITHUB_FAKE_DIR) return;
  // Controlled provider fixtures only: historical demo files remain unchanged.
  const fixtures = [
    ['artists/artists_with_albums.sql.json', '2026-10-21T12:00:00Z'],
    ['albums/albums_by_title.sql.json', '2026-10-21T11:00:00Z'],
  ];
  for (const [path, createdAt] of fixtures) {
    const definition = JSON.parse(readFileSync(join(GITHUB_FAKE_DIR, 'demo-project-1/queries', path), 'utf8'));
    await page.route(url => url.hostname === 'raw.githubusercontent.com' && url.pathname.endsWith('/queries/' + path),
      route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ...definition, createdAt }) }));
  }
  await page.goto(PROJECT_URL);
  await page.getByRole('button', { name: 'Queries', exact: true }).click();
  const preview = page.locator('sneat-datatug-project-queries-preview');
  const rows = preview.locator('ion-item[button] h3');
  await expect(rows).not.toHaveCount(0);
  await expect(page.locator('.overview-tabs ion-chip')).toHaveText(String(await rows.count()));
  await expect(preview.locator('ion-card-title')).toHaveCount(0);
  await expect(preview).not.toContainText('Reusable requests');
  await expect(rows.nth(0)).toHaveText('Artists with albums');
  await expect(rows.nth(1)).toHaveText('Albums by title');
  await expect(preview).toContainText('Added Oct 21, 2026');
  await expect(preview.getByRole('button', { name: 'Newest first. Reverse sort order' })).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(5);
  expect(await rows.count()).toBeLessThanOrEqual(100);
  await preview.getByRole('button', { name: 'Newest first. Reverse sort order' }).click();
  await expect(rows.first()).toHaveText('Tracks by title');
  await preview.locator('ion-segment-button[value="alphabetical"]').click();
  await expect(rows.first()).toHaveText('Actor Filmographies');
  await preview.getByRole('button', { name: 'A–Z. Reverse sort order' }).click();
  await expect(rows.first()).toHaveText('Tracks by title');
  await expect(preview.locator('ion-segment-button ion-icon')).toHaveCount(2);
});
