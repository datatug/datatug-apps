import { expect, test } from '@playwright/test';

for (const safeAreaTop of [0, 20]) {
  test(`Home and Login keep the same header height with ${safeAreaTop}px safe area`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/home');
    await page.addStyleTag({
      content: `html { --ion-safe-area-top: ${safeAreaTop}px; }`,
    });
    const homeHeader = page.locator('ion-header.compact-header:visible');
    await expect(homeHeader).toBeVisible();
    const homeBounds = await homeHeader.boundingBox();
    if (!homeBounds) throw new Error('Home header has no bounds');
    const homeContent = page.locator('sneat-datatug-home ion-content');
    await expect
      .poll(async () => (await homeContent.boundingBox())?.y)
      .toBe(homeBounds.height);

    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    const loginHeader = page.locator('sneat-login ion-header:visible');
    await expect.poll(async () => (await loginHeader.boundingBox())?.y).toBe(0);
    const loginBounds = await loginHeader.boundingBox();
    if (!loginBounds) throw new Error('Login header has no bounds');
    expect(loginBounds.height).toBe(homeBounds.height);

    await page.locator('sneat-login ion-back-button').click();
    await expect(page).toHaveURL('/home');
    await expect(page.locator('sneat-login')).toBeHidden();
    await expect
      .poll(async () => (await homeHeader.boundingBox())?.height)
      .toBe(homeBounds.height);
    await expect
      .poll(async () => (await homeContent.boundingBox())?.y)
      .toBe(homeBounds.height);
  });
}

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

test('the login header returns to the preceding app screen', async ({
  page,
}) => {
  await page.goto('/home?from=login-navigation-test');
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.locator('sneat-login ion-header ion-back-button').click();
  await expect(page).toHaveURL('/home?from=login-navigation-test');
  await expect(page.locator('sneat-datatug-home')).toBeVisible();
});
