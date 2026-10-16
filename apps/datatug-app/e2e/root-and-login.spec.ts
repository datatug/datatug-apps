import { expect, Page, test } from '@playwright/test';

const clientErrorPatterns = [
  /NG\d{4}/,
  /NullInjectorError/,
  /No provider for/,
  /Could not load icon/,
  /Failed to construct 'URL': Invalid base URL/,
];

async function installClientErrorChecks(page: Page): Promise<string[]> {
  const clientErrors: string[] = [];

  await page.route(/https?:\/\/localhost:8989\/.*/, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { version: 'e2e', uptimeMinutes: 0 },
    });
  });

  page.on('console', (message) => {
    const text = message.text();
    if (
      (message.type() === 'error' || message.type() === 'warning') &&
      clientErrorPatterns.some((pattern) => pattern.test(text))
    ) {
      clientErrors.push(text);
    }
  });

  page.on('pageerror', (error) => {
    const text = error.message;
    if (clientErrorPatterns.some((pattern) => pattern.test(text))) {
      clientErrors.push(text);
    }
  });

  return clientErrors;
}

test('renders the root page', async ({ page }) => {
  const clientErrors = await installClientErrorChecks(page);

  await page.goto('/');

  // The first 'DataTug.app' text node is the hidden menu's brand link
  // (display:none panel while signed out on home) — assert the visible
  // header brand instead.
  await expect(page.locator('.home-header-brand')).toBeVisible();
  await expect(
    page.getByTestId('home-hero').getByRole('heading', { level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('My projects')).toBeVisible();
  await expect(page.locator('sneat-datatug-home')).toBeVisible();
  // Signed out on the start page the side panel is hidden entirely (founder
  // 2026-10-14: "We do not need empty side panel on homepage") — the menu
  // stays in the DOM but collapsed, and the content header carries the brand.
  await expect(page.locator('ion-menu')).toBeHidden();
  await expect(
    page.locator('ion-app > ion-split-pane').locator('ion-menu'),
  ).toBeHidden();
  await expect(page.locator('.home-header-brand')).toBeVisible();
  expect(clientErrors).toEqual([]);
});

test('renders the login page', async ({ page }) => {
  const clientErrors = await installClientErrorChecks(page);

  await page.goto('/login');

  await expect(page.getByText('Login @ DataTug.app')).toBeVisible();
  await expect(page.getByText('Quick login')).toBeVisible();
  await expect(page.getByText('Login with Google')).toBeVisible();
  await expect(page.locator('sneat-login')).toBeVisible();
  expect(clientErrors).toEqual([]);
});
