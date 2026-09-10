import { expect, Page, test } from '@playwright/test';

// The debug page throws inside an Angular event handler, so the error is caught
// by Angular's ErrorHandler and surfaced via console.error rather than as an
// uncaught pageerror. Capture both to be robust.
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  return errors;
}

test('debug page throws an error with the message from the textbox', async ({
  page,
}) => {
  const errors = collectErrors(page);

  await page.goto('/debug');

  await expect(page.locator('sneat-datatug-debug')).toBeVisible();
  await expect(page.getByText('Debug')).toBeVisible();

  // Scoped to sneat-datatug-debug: a bare 'ion-input input' now also
  // matches the side menu's build-info panel (feat/build-info-menu,
  // libs/datatug/main/src/lib/menu/build-info/), which renders an
  // ion-input on every page.
  await page
    .locator('sneat-datatug-debug ion-input input')
    .fill('Boom from e2e');
  await page.getByRole('button', { name: 'Throw error' }).click();

  await expect
    .poll(() => errors.some((message) => message.includes('Boom from e2e')))
    .toBe(true);
});
