import { expect, test } from '@playwright/test';
import { installFakeGithub } from './helpers/fake-github';

const project =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1';
const fake = process.env['DATATUG_E2E_GITHUB_FAKE'];

test.beforeEach(async ({ context }) => {
  if (fake)
    await installFakeGithub(context, [
      { fullName: 'datatug/datatug-demo-project', dir: fake },
    ]);
});

test('project sidebar offers active queries and a working saved-query path at wide and narrow widths', async ({
  page,
}) => {
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(project);
    const menu = page.locator('sneat-datatug-project-menu');
    if (width < 992) {
      await page.locator('ion-menu-button.app-level-menu-button').click();
    }
    await expect(menu).toBeVisible();
    await expect(
      menu.locator('ion-segment-button[value="boards"]'),
    ).toHaveCount(0);
    await menu.locator('ion-segment-button[value="queries"]').click();
    await expect(menu.getByText('Active queries')).toBeVisible();
    await expect(
      menu.getByText('No queries open in this session'),
    ).toBeVisible();
    await expect(menu.getByText('Not implemented yet')).toHaveCount(0);
    await expect(menu.getByText('Bookmarked')).toHaveCount(0);
    await expect(menu.getByText('New query')).toBeVisible();
    await menu.getByText('Browse saved queries').click();
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe(`${project}/-/queries`);
  }
});
