import { defineConfig, devices } from '@playwright/test';
import { demodbChromiumLaunch, demodbReporter } from './e2e/helpers/demodb-config';

// /demo/sqlite/<dataset>: a DemoDB SQLite file opened as an editable copy in the browser (OPFS, a dataset
// worker, Web Locks leader election). The suite runs the real BUILT app (`serve:production`, so the worker and
// sqlite3.wasm are the bundled ones) in Chromium, Firefox and WebKit, against the pinned demodb.dev files served
// from LOCAL fixtures (scripts/fetch-demodb-fixtures.mjs, SHA-256 verified, at most one download per file and none on a
// warm cache; see e2e/helpers/demodb-guard.ts). DEMODB_E2E_MODE=live (the manual "DemoDB live smoke" workflow only)
// goes to the real hosts instead: each URL at most once, no Playwright retries, and the run stops on the first failure
// (HTTP 429 above all: a rate limit must never be retried).
// Nothing here replaces the OVDB server, the worker or the database. WebKit's default Playwright context has
// no OPFS, so there the suite asserts the in-memory behaviour instead (see demo-sqlite.spec.ts).
const LIVE = process.env['DEMODB_E2E_MODE'] === 'live';
const port = process.env['DATATUG_E2E_SQLITE_PORT'] || '4333';

export default defineConfig({
  testDir: './e2e',
  testMatch: [
    'demo-sqlite.spec.ts',
    'demo-sqlite-datasets.spec.ts',
    'demo-sqlite-journey.spec.ts',
  ],
  outputDir: '../../coverage/apps/datatug-app-demo-sqlite-e2e/results',
  fullyParallel: false,
  workers: 1,
  retries: LIVE ? 0 : process.env['CI'] ? 1 : 0,
  maxFailures: LIVE ? 1 : 0,
  globalSetup: './e2e/helpers/demodb-fixtures-setup.ts',
  reporter: [
    ['list'],
    demodbReporter,
    [
      'html',
      {
        outputFolder: '../../coverage/apps/datatug-app-demo-sqlite-e2e/report',
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
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: demodbChromiumLaunch } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
