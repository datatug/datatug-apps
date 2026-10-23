import { defineConfig, devices } from '@playwright/test';
import { demodbChromiumLaunch, demodbReporter } from './e2e/helpers/demodb-config';
const port = process.env.DATATUG_E2E_PORT || '18786';
export default defineConfig({
  testDir: './e2e',
  testMatch: ['checkout-journey.spec.ts', 'hosted-incidents.spec.ts'],
  // Each test signs up its own random emulator user and fakes payment per page, so tests run in parallel.
  fullyParallel: true,
  outputDir: '../../coverage/apps/datatug-checkout/results',
  globalSetup: './e2e/helpers/demodb-state-setup.ts',
  reporter: [['list'], demodbReporter],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  webServer: [
    {
      command:
        'pnpm exec firebase emulators:start --only auth,firestore --project demo-local-sneat-app',
      url: 'http://127.0.0.1:8180',
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
    {
      command: `pnpm nx run datatug-app:serve:sso-e2e --host 127.0.0.1 --port ${port}`,
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: demodbChromiumLaunch } },
    {
      name: 'mobile-webkit',
      testMatch: 'checkout-journey.spec.ts',
      // Chromium runs the whole matrix. The account situations and the error and recovery flows are app and server
      // logic, the same in every browser; mobile WebKit keeps what renders or is entered differently on an iPhone:
      // sign-up and the auth panel with its layout check for both plans, the business destination picker, and the
      // payment form.
      grep: /(pro|business): new unsigned user$|business: project and business space$|pro: payment form failure/u,
      // The test budget includes first-page initialization, which can take
      // over 15 seconds on CI before the multi-navigation journey begins.
      timeout: 60_000,
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
    },
  ],
});
