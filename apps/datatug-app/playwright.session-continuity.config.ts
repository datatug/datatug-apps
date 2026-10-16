import { defineConfig, devices } from '@playwright/test';

const origin = process.env['DATATUG_SESSION_CONTINUITY_APP_ORIGIN'] || 'http://datatug.localhost:4275';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['journey/session-continuity.spec.ts'],
  outputDir: '../../coverage/apps/datatug-session-continuity-e2e/results',
  reporter: 'list',
  workers: 1,
  retries: 0,
  fullyParallel: false,
  webServer: {
    command: 'pnpm nx run datatug-app:serve:development --host datatug.localhost --port 4275',
    url: origin,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: origin,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
});
