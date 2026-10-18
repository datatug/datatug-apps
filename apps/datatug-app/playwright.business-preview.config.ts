import { defineConfig, devices } from '@playwright/test';

// Live, opt-in journey against the deployed datatug-cloud-preview (Stripe TEST
// keys only). It serves the `business-preview` build on http://localhost:18782,
// the one origin the preview admits (`localhost`, never 127.0.0.1).
//
// The TEST buyer comes only from the environment. Without it the spec skips
// itself, so no dev server is started either: a skipped run costs nothing.
const hasBuyer =
  !!process.env['DATATUG_BUSINESS_PREVIEW_BUYER_EMAIL'] &&
  !!process.env['DATATUG_BUSINESS_PREVIEW_BUYER_PASSWORD'];

export default defineConfig({
  testDir: './e2e',
  testMatch: 'business-project-preview.spec.ts',
  workers: 1,
  retries: 0,
  outputDir: '../../coverage/apps/datatug-business-preview/results',
  reporter: 'list',
  webServer: hasBuyer
    ? {
        command:
          'pnpm nx run datatug-app:serve:business-preview --host localhost',
        url: 'http://localhost:18782',
        // Never adopt whatever already listens on 18782: it could be a build
        // that talks to production. An occupied port is an error.
        reuseExistingServer: false,
        timeout: 240_000,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      }
    : undefined,
  use: {
    baseURL: 'http://localhost:18782',
    // Credentials must not enter traces, videos or screenshots.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
