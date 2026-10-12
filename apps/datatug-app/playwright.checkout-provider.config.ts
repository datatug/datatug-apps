import { defineConfig, devices } from '@playwright/test';

// Deliberate opt-in: never let the hermetic CI suite reach a deployed payment
// service. This is the local origin already allowed by the fixed TEST host.
if (process.env.DATATUG_CHECKOUT_PROVIDER_TEST !== '1')
  throw new Error(
    'Set DATATUG_CHECKOUT_PROVIDER_TEST=1 for the isolated TEST smoke suite.',
  );

export default defineConfig({
  testDir: './e2e',
  testMatch: 'checkout-provider.spec.ts',
  workers: 1,
  retries: 0,
  outputDir: '../../coverage/apps/datatug-checkout-provider/results',
  reporter: 'list',
  use: {
    baseURL: 'http://datatug.localhost:4328',
    storageState: process.env.DATATUG_CHECKOUT_TEST_STORAGE_STATE,
    // Auth state and provider secrets must not enter traces or videos.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
