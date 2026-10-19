import { expect, test } from '@playwright/test';

test('the cold login header returns to the home screen', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Login @ DataTug.app')).toBeVisible();
  await expect(page.locator('.auth-brand')).toHaveCount(0);
  const back = page.locator('sneat-login ion-header ion-back-button');
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL('/home');
  await expect(page.locator('sneat-datatug-home')).toBeVisible();
});

test('the login header returns to the preceding app screen', async ({ page }) => {
  await page.goto('/home?from=login-navigation-test');
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.locator('sneat-login ion-header ion-back-button').click();
  await expect(page).toHaveURL('/home?from=login-navigation-test');
  await expect(page.locator('sneat-datatug-home')).toBeVisible();
});
