import { defineConfig, devices } from '@playwright/test';

// S167: the Sentry "Submit Crash Report" dialog for a handled, logged HTTP
// error (e.g. a 404 while resolving a bad GitHub project id) only reproduces
// against the PRODUCTION build — `ErrorLoggerService.logError()`
// (`@sneat/logging`) skips Sentry `captureException`/`showReportDialog`
// entirely whenever `window.location.hostname === 'localhost'`, and the
// Sentry DSN itself only exists in `environments/environment.prod.ts`
// (`fileReplacements` on the `production` build configuration). The default
// `playwright.config.ts` serves `datatug-app:serve:development` on
// "localhost:4200" for unrelated reasons (an agent-origin allowlist quirk —
// see the comment there), which would make this suite's own assertion (the
// dialog never opens) vacuously true for the wrong reason. This dedicated
// config, mirroring `playwright.sso.config.ts`'s pattern for another
// specialized suite, serves the real `production` build configuration on
// "127.0.0.1" (any non-"localhost" hostname works — "127.0.0.1" also
// matches how the bug was originally reproduced) so `error-dialog.spec.ts`
// actually exercises the Sentry capture path it's guarding.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'error-dialog.spec.ts',
  outputDir: '../../coverage/apps/datatug-app-error-dialog-e2e/results',
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: '../../coverage/apps/datatug-app-error-dialog-e2e/report',
        open: 'never',
      },
    ],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4331',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'pnpm nx run datatug-app:serve:production --host 127.0.0.1 --port 4331',
    url: 'http://127.0.0.1:4331',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
