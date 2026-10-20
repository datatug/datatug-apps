import { defineConfig, devices } from '@playwright/test';
import { demodbChromiumLaunch, demodbReporter } from './e2e/helpers/demodb-config';

// The AdventureWorks in-browser journey (e2e/demo-sqlite-adventureworks.spec.ts): download through the chunked gzip parts,
// verify, open /demo/sqlite/adventureworks, read, edit, reload, Reset Database. Hermetic: every DemoDB request is answered by
// the guard (e2e/helpers/demodb-guard.ts) from fixtures built from the PROVIDER repository demo-db/adventureworks on GitHub
// (scripts/fetch-demodb-fixtures.mjs, DEMODB_FIXTURE_ADVENTUREWORKS=only: only these 35.4 MB, SHA-256 verified against the
// catalog pin). No request goes to any demodb.dev or openvaultdb.com host.
//
// One browser (Chromium) on purpose: the file is 126.8 MB unpacked and is downloaded twice (open, then Reset, because a
// single-copy dataset has no pristine copy), so this lane is slow and heavy compared with the rest of demo-sqlite. In CI it
// runs only for changes to the demo SQLite code and by hand (see the e2e-demo-sqlite-adventureworks job); the three-browser
// lane (playwright.demo-sqlite.config.ts) keeps the cheap AdventureWorks checks (download prompt, low-storage refusal).
process.env['DEMODB_FIXTURE_ADVENTUREWORKS'] = 'only';

const port = process.env['DATATUG_E2E_SQLITE_PORT'] || '4334';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['demo-sqlite-adventureworks.spec.ts'],
  outputDir: '../../coverage/apps/datatug-app-demo-sqlite-adventureworks-e2e/results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The evidence file of a passing run (adventureworks-evidence.json, printed to the job summary) lives in the test's output folder.
  preserveOutput: 'always',
  globalSetup: './e2e/helpers/demodb-fixtures-setup.ts',
  reporter: [
    ['list'],
    demodbReporter,
    ['html', { outputFolder: '../../coverage/apps/datatug-app-demo-sqlite-adventureworks-e2e/report', open: 'never' }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // The trace of a passing run holds the 35 MB of gzip parts (~47 MB): kept for failures in CI, always on a developer machine.
    trace: process.env['CI'] ? 'retain-on-failure' : 'on',
  },
  webServer: {
    command: `pnpm nx run datatug-app:serve:production --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: demodbChromiumLaunch } }],
});
