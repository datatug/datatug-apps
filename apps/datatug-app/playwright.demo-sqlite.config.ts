import { defineConfig, devices } from '@playwright/test';

// /demo/sqlite/<dataset>: a DemoDB SQLite file opened as an editable copy in the browser (OPFS, a dataset
// worker, Web Locks leader election). The suite runs the real BUILT app (`serve:production`, so the worker and
// sqlite3.wasm are the bundled ones) in Chromium, Firefox and WebKit, against the real demodb.dev files.
// Nothing here replaces the OVDB server, the worker or the database. WebKit's default Playwright context has
// no OPFS, so there the suite asserts the in-memory behaviour instead (see demo-sqlite.spec.ts).
const port = process.env['DATATUG_E2E_SQLITE_PORT'] || '4333';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'demo-sqlite.spec.ts',
  outputDir: '../../coverage/apps/datatug-app-demo-sqlite-e2e/results',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: [
    ['list'],
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
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
