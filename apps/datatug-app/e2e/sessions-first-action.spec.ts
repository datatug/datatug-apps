import { expect, test } from '@playwright/test';
import { installFakeGithub } from './helpers/fake-github';

const project =
  '/project/github.com/datatug/datatug-demo-project/tree/main/demo-project-1';
const fake = process.env['DATATUG_E2E_GITHUB_FAKE'];

test.beforeEach(async ({ context }) => {
  if (fake)
    await installFakeGithub(context, [
      { fullName: 'datatug/datatug-demo-project', dir: fake },
    ]);
});

test('signed-out Sessions explains the next action at wide and narrow widths', async ({ page }) => {
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${project}/-/sessions`);

    const start = page.locator('.session-start');
    await expect(start.getByRole('heading', { name: 'Sessions' })).toBeVisible();
    await expect(start).toContainText('Sign in to open or create sessions for this project.');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.locator('.session-primary-actions').getByRole('button', { name: 'New session' })).toBeDisabled();
  }
});
