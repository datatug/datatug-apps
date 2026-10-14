import { expect, test } from '@playwright/test';

// Founder request (2026-09-11): "On every page DataTug.app in header should
// lead to main page/screen". The brand title lives in the app shell's side
// menu header (apps/datatug-app/src/app/datatug-app.component.html), which
// is present on every page, so a non-home page (here: /login, which needs no
// running agent) is enough to prove the link works from "somewhere else".
test('brand "DataTug.app" link in the header navigates to the home screen', async ({
  page,
}) => {
  await page.goto('/login');
  await expect(page.getByText('Login @ DataTug.app')).toBeVisible();

  await page.getByRole('link', { name: 'DataTug.app home' }).click();

  // The link points at `/`, which each product profile resolves to its own
  // home inside the app: `/home` under the datatug profile.
  await expect(page).toHaveURL('/home');
  await expect(
    page.getByRole('heading', { name: 'Your data workbench' }),
  ).toBeVisible();
  await expect(page.locator('sneat-datatug-home')).toBeVisible();
});
