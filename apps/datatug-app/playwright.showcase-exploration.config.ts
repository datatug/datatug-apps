import { defineConfig, devices } from '@playwright/test';

// Captured-read acceptance only. Refuse an unconfigured run instead of querying providers.
if (!process.env['DATATUG_E2E_GITHUB_FAKE'])
  throw new Error(
    'Set DATATUG_E2E_GITHUB_FAKE to the pinned Demo checkout for showcase fixtures.',
  );
const port = process.env['DATATUG_E2E_PORT'] || '44376';

export default defineConfig({
  testDir: './e2e',
  testMatch: [
    'showcase-country-comparison.spec.ts',
    'showcase-tutorial-acceptance.spec.ts',
    'showcase-inspector-polish.spec.ts',
  ],
  outputDir: '../../coverage/apps/datatug-showcase-exploration/results',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // Dependencies are prepared/verified explicitly before this bounded run.
    command: `pnpm nx run datatug-app:serve:development --host localhost --port ${port} --excludeTaskDependencies`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
