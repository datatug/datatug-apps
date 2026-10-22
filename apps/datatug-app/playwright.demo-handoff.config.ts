import { defineConfig, devices } from '@playwright/test';
import { demodbChromiumLaunch, demodbReporter } from './e2e/helpers/demodb-config';

// G-0: the hand-off from the sites (`/demo?…`, `/project/github.com/<owner>/<repo>/start-chat#msg=…`, and the old
// `…/chat?msg=…`) must show the holding page and keep the visitor's question out of every analytics and error report. That only means
// something against the PRODUCTION build: it carries the real Sentry DSN and the real analytics, and a
// non-"localhost" host makes the app report errors (see playwright.error-dialog.config.ts for the same
// reasoning). This config serves the `production` build configuration on 127.0.0.1, like that one.
const port = process.env['DATATUG_E2E_DEMO_PORT'] || '4332';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'demo-handoff.spec.ts',
  outputDir: '../../coverage/apps/datatug-app-demo-handoff-e2e/results',
  // Every test opens its own browser context against one static production build and shares no state with
  // another, so they run in parallel (Playwright's default: half the CPU cores in CI). On one worker the
  // 116 tests took 9 minutes.
  fullyParallel: true,
  globalSetup: './e2e/helpers/demodb-state-setup.ts',
  reporter: [
    ['list'],
    demodbReporter,
    [
      'html',
      {
        outputFolder: '../../coverage/apps/datatug-app-demo-handoff-e2e/report',
        open: 'never',
      },
    ],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm nx run datatug-app:serve:production --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: demodbChromiumLaunch },
    },
  ],
});
