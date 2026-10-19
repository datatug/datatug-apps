import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const outputDir = resolve(
  __dirname,
  '../../coverage/apps/datatug-showcase-measurement/results',
);

// Explicit production read acceptance. No server, auth state, retries or fixture substitution.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'showcase-live-measurement.spec.ts',
  outputDir,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  repeatEach: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  // Keep inline finally-attachments on failure; list alone cannot persist their bodies.
  // PLAYWRIGHT_JSON_OUTPUT_FILE may redirect this report to a retained receipt path.
  reporter: [
    ['list'],
    ['json', { outputFile: resolve(outputDir, '../report.json') }],
  ],
  use: {
    baseURL: 'https://datatug.app',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    storageState: { cookies: [], origins: [] },
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
