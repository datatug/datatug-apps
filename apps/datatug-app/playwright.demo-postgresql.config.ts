import { defineConfig, devices } from '@playwright/test';

// /demo/ovdb/<dataset>-postgresql: a hosted, read-only PostgreSQL DemoDB edition opened through the public OpenVaultDB
// server (https://cloud.openvaultdb.com), never Neon directly. The suite runs the real BUILT app (`serve:production`)
// in Chromium and Firefox and calls the REAL live API: nothing here replaces the OVDB server or the database, so
// the suite needs the network and is tolerant to what the live server does (a cold start takes up to ~6 s, and a mount
// that is still pending answers 503 database_unavailable for a moment): long waits, the app's own retry back-off, and
// two CI retries. The app is served as https://datatug.app (see demo-postgresql.spec.ts), so the server's real CORS
// allow-list is exercised too. WebKit is left out: it adds no PostgreSQL-specific behaviour (no OPFS, workers or
// WASM are involved), and the /demo/sqlite suite already covers the app shell there.
const port = process.env['DATATUG_E2E_POSTGRESQL_PORT'] || '4334';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['demo-postgresql.spec.ts'],
  outputDir: '../../coverage/apps/datatug-app-demo-postgresql-e2e/results',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 2 : 0,
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder:
          '../../coverage/apps/datatug-app-demo-postgresql-e2e/report',
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
  ],
});
