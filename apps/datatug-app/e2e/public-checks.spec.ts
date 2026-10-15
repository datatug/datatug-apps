import { expect, test } from '@playwright/test';
import { installFakeGithub } from './helpers/fake-github';
import { activePage } from './journey/helpers/active-page';

const project =
  '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1';
const fake = process.env['DATATUG_E2E_GITHUB_FAKE'];

test.beforeEach(async ({ context }) => {
  if (fake)
    await installFakeGithub(context, [
      { fullName: 'datatug/datatug-demo-project', dir: fake },
    ]);
});

test('unsigned public Checks browse inspect run pass and intentional fail', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(project);
  await page
    .locator('sneat-datatug-project-menu-top ion-item', { hasText: 'Checks' })
    .click();
  let view = activePage(page).locator('sneat-public-demo-checks');
  await expect(view.getByText('Sample Checks · 2')).toBeVisible();
  await view.getByText('Chinook customer coverage', { exact: true }).click();
  view = page.locator('sneat-public-demo-checks').filter({
    has: page.locator('[data-public-check=chinook-customer-coverage]'),
  });
  await expect(
    view.getByRole('heading', {
      name: 'Chinook customer coverage',
      exact: true,
    }),
  ).toBeVisible();
  await expect(view).toHaveCount(1);
  await expect(view).toContainText('expected-customers: row-count 59');
  await view.getByRole('button', { name: 'Run Check', exact: true }).click();
  await expect(view.getByTestId('public-check-result')).toContainText(
    'Browser run result · pass',
    { timeout: 30_000 },
  );
  await view.getByRole('button', { name: 'Show all passing details' }).click();
  await expect(view.getByTestId('public-check-result')).toContainText(
    'Expected 59 rows; observed 59.',
  );
  await page.screenshot({
    path: testInfo.outputPath('public-checks-pass-desktop.png'),
    fullPage: true,
  });
  await view.getByRole('link', { name: 'All Checks', exact: true }).click();
  view = activePage(page)
    .locator('sneat-public-demo-checks')
    .filter({ has: page.getByText('Sample Checks · 2') });
  await view
    .getByText('Chinook customer coverage — intentional failure', {
      exact: true,
    })
    .click();
  view = page.locator('sneat-public-demo-checks').filter({
    has: page.locator('[data-public-check=chinook-customer-coverage-failure]'),
  });
  await expect(view).toHaveCount(1);
  await view.getByRole('button', { name: 'Run Check', exact: true }).click();
  await expect(view.getByTestId('public-check-result')).toContainText(
    'Browser run result · fail',
    { timeout: 30_000 },
  );
  await expect(view.getByTestId('public-check-result')).toContainText(
    'Expected 60 rows; observed 59.',
  );
  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      view.getByRole('button', { name: 'Run Check', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`public-checks-fail-${width}.png`),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
