import { Page } from '@playwright/test';
import { expect, test } from './helpers/demodb-guard';

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
  await expect(
    page.getByRole('link', { name: 'Return to DataTug.app' }),
  ).toHaveCount(0);
  await expect(page.getByText('Quick login')).toHaveCount(0);
  await expect(page.getByText('Login with Google')).toBeVisible();
  await expect(page.getByText('Login with Microsoft')).toBeVisible();
  await expect(page.getByText('Login with GitHub')).toBeVisible();
  await expect(page.getByText('Login with Apple')).toHaveCount(0);
  await expect(page.getByText('Login with Facebook')).toHaveCount(0);
  await expect(page.locator('sneat-login-with-telegram')).toHaveCount(0);
  await expect(page.locator('sneat-login')).toBeVisible();
  expect(clientErrors).toEqual([]);
});

for (const [fragment, returnPath] of [
  ['', '/login'],
  ['#/home', '/home'],
  ['#//untrusted.example/reset', '/login'],
] as const) {
  test(`requests a password reset while signed out with return path ${fragment || '(default)'}`, async ({
    page,
  }) => {
    const requests: { email: string; returnUrl: string }[] = [];
    await page.route('**/v0/auth/request-password-reset', async (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers()['authorization']).toBeUndefined();
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      });
    });
    await page.route('**/accounts:sendOobCode*', () => {
      throw new Error(
        'Password resets must use the app-specific backend email sender',
      );
    });

    await page.goto(`/login${fragment}`);
    await page
      .locator('sneat-email-login-form ion-segment-button')
      .filter({ hasText: 'Sign in' })
      .click();
    const emailInput = page.locator(
      'sneat-email-login-form input[type="email"]',
    );
    await emailInput.fill('reset-journey@example.invalid');
    await page.getByRole('button', { name: 'Forgot? Reset!' }).click();

    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual({
      email: 'reset-journey@example.invalid',
      returnUrl: new URL(returnPath, page.url()).href,
    });
    await expect(page.locator('ion-toast')).toBeVisible();
    await expect(emailInput).toBeEnabled();
  });
}

test('keeps login controls inline on an iPhone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/login');

  const tabs = page.locator('sneat-email-login-form ion-segment-button');
  await expect(tabs).toHaveCount(2);
  for (const tab of await tabs.all()) {
    await expect(tab).toBeVisible();
    const icon = await tab.locator('ion-icon').boundingBox();
    const label = await tab.locator('ion-label').boundingBox();
    if (!icon || !label) {
      throw new Error('The login tab icon and label must have visible bounds');
    }
    expect(icon.x + icon.width).toBeLessThan(label.x);
    expect(
      Math.abs(icon.y + icon.height / 2 - label.y - label.height / 2),
    ).toBeLessThan(8);
  }

  await tabs.filter({ hasText: 'Sign in' }).click();
  const actions = page.locator('.email-login-actions ion-button:visible');
  await expect(actions).toHaveCount(3);
  await expect(page.locator('.password-button-suffix')).toHaveCount(1);
  await expect(page.locator('.password-button-suffix')).toBeHidden();
  for (const button of await actions.all()) {
    await expect(button).toBeVisible();
  }
  const boxes = await Promise.all(
    (await actions.all()).map(async (button) => {
      const box = await button.boundingBox();
      if (!box) {
        throw new Error('The login action must have visible bounds');
      }
      return box;
    }),
  );
  expect(boxes).toHaveLength(3);
  const [first, , last] = boxes;
  if (!first || !last) {
    throw new Error('The login actions must contain three buttons');
  }
  expect(
    boxes.every(
      (box) =>
        Math.abs(box.y + box.height / 2 - first.y - first.height / 2) < 4,
    ),
  ).toBe(true);
  expect(last.x + last.width).toBeLessThanOrEqual(375);
});
