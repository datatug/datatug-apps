import { expect, test } from '@playwright/test';

/**
 * S167: reproduces, then guards against, the Sentry "Submit Crash Report"
 * dialog (`.sentry-error-embed`, Sentry Angular's `showReportDialog()`)
 * opening for a HANDLED, LOGGED error — as opposed to a genuinely uncaught
 * exception, which is the only case the dialog is meant for.
 *
 * Root cause (see `apps/datatug-app/src/main.ts`'s comment on the trailing
 * `...provideErrorLoggerWithoutReportDialog()` entry, and
 * `apps/datatug-app/src/main-providers-error-logger-order.spec.ts`): that
 * wrapper (PR #128) forces `feedback: false` on every `logError()` call, but
 * `provideSneatAuthenticatedProviders()` (`@sneat/app-auth`) internally
 * re-registers a plain, undecorated `ErrorLogger` too. When that provider was
 * listed AFTER the wrapper in `main.ts`'s `providers` array, Angular's
 * injector kept only that later, plain registration — silently undoing the
 * wrapper for every logged error in the app, including
 * `DatatugNavContextService.setCurrentProject()`'s 404 handler for a
 * nonexistent GitHub project id (`{ show: false }`, no `feedback` — so the
 * raw `ErrorLoggerService` default of `feedback: true` won and opened the
 * dialog). MUST run against the PRODUCTION build (see
 * `playwright.error-dialog.config.ts`'s own comment for why) — this is NOT
 * exercised by `playwright.config.ts`'s default dev-server run.
 *
 * `test.skip`'s DATATUG_E2E_OFFLINE guard mirrors `github-store.spec.ts`:
 * both cases here hit the real `raw.githubusercontent.com`, not a stub.
 */
test.skip(
  process.env['DATATUG_E2E_OFFLINE'] === '1',
  'requires network access to raw.githubusercontent.com — set DATATUG_E2E_OFFLINE=1 to skip',
);

const BAD_PROJECT_URL =
  '/store/github.com/project/datatug-demo-projects@datatug@no-such-project-xyz';
const GOOD_PROJECT_URL =
  '/store/github.com/project/datatug-demo-projects@datatug@demo-project-1';

const SENTRY_DIALOG_SELECTOR = '.sentry-error-embed';

test.describe('Sentry report dialog — handled errors never trigger it', () => {
  test('a 404 for a nonexistent GitHub project id may toast, but never opens the Sentry dialog', async ({
    page,
  }) => {
    await page.goto(BAD_PROJECT_URL);

    // The error toast (`ErrorLoggerService.showError()`, `ion-toast`) is a
    // best-effort signal, not this test's point — it can already have faded
    // (its own default 7s duration races this navigation+fetch) by the time
    // this assertion runs, and that's fine: the toast is not what's under
    // test. Give it a chance to show up without failing the test if it
    // doesn't.
    await page
      .locator('ion-toast')
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .catch(() => {
        // Toast may have already come and gone, or never rendered in time —
        // not a failure for this test.
      });

    // The actual regression guard: the Sentry report dialog must never
    // appear for this handled, logged 404, within a generous window that
    // covers the async fetch to raw.githubusercontent.com plus both
    // `logError()` calls this navigation triggers (nav-context service +
    // project-page component).
    await expect(page.locator(SENTRY_DIALOG_SELECTOR)).toHaveCount(0, {
      timeout: 5_000,
    });
    // Re-check after a further beat — `showReportDialog()` injects an
    // iframe/script asynchronously, so a single immediate count(0) could
    // pass just because the injection hadn't landed yet.
    await page.waitForTimeout(2_000);
    await expect(page.locator(SENTRY_DIALOG_SELECTOR)).toHaveCount(0);
  });

  test('control: the real demo project shows neither a toast nor the Sentry dialog', async ({
    page,
  }) => {
    await page.goto(GOOD_PROJECT_URL);

    await expect(
      page.locator('sneat-datatug-project-menu-top'),
    ).toBeVisible({ timeout: 20_000 });

    await expect(page.locator(SENTRY_DIALOG_SELECTOR)).toHaveCount(0);
    await expect(page.locator('ion-toast')).toHaveCount(0);
  });
});
