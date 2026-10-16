import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['context-bag-provider.spec.ts'],
  outputDir: '../../coverage/apps/datatug-context-bag-provider/results',
  reporter: 'list',
  workers: 1,
  retries: 0,
  fullyParallel: false,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://datatug.localhost:8181',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
});
