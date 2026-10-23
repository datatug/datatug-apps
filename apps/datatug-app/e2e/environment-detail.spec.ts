import { readFileSync } from 'node:fs';
import { expect, test } from './helpers/demodb-guard';
import { installFakeGithub } from './helpers/fake-github';

const demoDir = process.env['DATATUG_E2E_GITHUB_FAKE'];
const base =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-';
test.skip(
  !demoDir,
  'Set DATATUG_E2E_GITHUB_FAKE to a checkout of the demo repository',
);
test.beforeEach(async ({ context }) => {
  if (!demoDir) return;
  await installFakeGithub(context, [
    { fullName: 'datatug/datatug-demo-project', dir: demoDir },
  ]);
});
for (const width of [1440, 900, 390]) {
  test(`environment connections and catalog journey at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${base}/environments`);
    const list = page.locator('sneat-datatug-environments');
    await expect(
      list.locator('[data-testid="environment-list-item"]'),
    ).toHaveCount(5);
    await list
      .locator('[data-testid="environment-list-item"]')
      .filter({ hasText: /LOCAL|local/ })
      .click();
    const detail = page.locator(
      'sneat-datatug-environment:not(.ion-page-hidden)',
    );
    await expect(
      detail.getByText('Data connections', { exact: true }),
    ).toBeVisible();
    await expect(detail.getByText('sqlite3', { exact: true })).toBeVisible();
    // A public project's environment needs no sign-in prompt in its content; the shell header's own Sign in
    // link (one per page, #508) is outside it.
    await expect(
      detail.locator('ion-content').getByText('Sign in', { exact: true }),
    ).toHaveCount(0);
    await expect(list).toBeHidden();
    await page.screenshot({
      path: `/tmp/datatug-environment-local-${width}.png`,
    });
    await detail.getByText('chinook-local', { exact: true }).click();
    await expect(page).toHaveURL(/\/env\/local\/db\/chinook-local$/);
    await expect(
      page.locator('sneat-datatug-env-db').getByText('Album', { exact: true }),
    ).toBeVisible();
    for (const id of ['QA', 'UAT']) {
      await page.goto(`${base}/env/${id}`);
      await expect(
        detail.locator('[data-testid="edition-assignment"]'),
      ).toHaveCount(6);
      await expect(
        detail.getByText('chinook-postgresql', { exact: true }),
      ).toBeVisible();
      await expect(
        detail.getByText(/do not enable browser query execution/),
      ).toBeVisible();
      expect(
        await detail.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: `/tmp/datatug-environment-${id}-${width}.png`,
      });
      await page.reload();
      await expect(
        detail.locator('[data-testid="edition-assignment"]'),
      ).toHaveCount(6);
    }
    await page.goto(`${base}/env/prod`);
    await expect(
      detail.getByText('chinook-prod', { exact: true }),
    ).toBeVisible();
    const production = JSON.parse(
      readFileSync(
        `${demoDir}/demo-project-1/environments/prod/prod.env.json`,
        'utf8',
      ),
    );
    if (production.presentation?.tone === 'danger') {
      await expect(
        detail.getByText('High caution', { exact: true }),
      ).toBeVisible();
      await expect(
        detail.locator('[data-testid="environment-identity"]'),
      ).toHaveAttribute('color', 'danger');
    }
    await page.screenshot({
      path: `/tmp/datatug-environment-prod-${width}.png`,
    });
    await page.goto(`${base}/env/typo`);
    await expect(
      detail.getByText(/Could not load this environment/),
    ).toBeVisible();
    await expect(detail.getByText(/No data connections/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
