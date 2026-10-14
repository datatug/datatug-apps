import { defineConfig, devices } from '@playwright/test';
const port = process.env.DATATUG_E2E_PORT || '18786';
export default defineConfig({
  testDir: './e2e',
  testMatch: 'checkout-journey.spec.ts',
  workers: 1,
  outputDir: '../../coverage/apps/datatug-checkout/results',
  reporter: 'list',
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
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
    },
  ],
});
