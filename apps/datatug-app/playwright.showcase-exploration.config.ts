import { defineConfig, devices } from '@playwright/test';
import { demodbChromiumLaunch, demodbReporter, demodbServerEnv } from './e2e/helpers/demodb-config';

// Captured-read acceptance only. Refuse a live GitHub run instead of querying providers: the demo project comes from
// the GitHub pins (e2e/github-pins.json; CI selects DATATUG_E2E_GITHUB_PINS=demo-independent), which globalSetup checks
// out and points DATATUG_E2E_GITHUB_FAKE at.
if (process.env['GITHUB_E2E_MODE'] === 'live')
  throw new Error(
    'The showcase exploration lane reads the pinned Demo checkout only; unset GITHUB_E2E_MODE.',
  );
const port = process.env['DATATUG_E2E_PORT'] || '44376';

export default defineConfig({
  testDir: './e2e',
  testMatch: [
    'showcase-country-comparison.spec.ts',
    'showcase-independent-sources.spec.ts',
    'showcase-tutorial-acceptance.spec.ts',
    'showcase-inspector-polish.spec.ts',
    'query-grid-enterprise.spec.ts',
  ],
  outputDir: '../../coverage/apps/datatug-showcase-exploration/results',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  globalSetup: './e2e/helpers/demodb-state-setup.ts',
  reporter: [['list'], demodbReporter, ['json', { outputFile: '../../coverage/apps/datatug-showcase-exploration/report.json' }]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // The dependencies (build info, licence stamp, recordsetcompare) are prepared by the nx target's own dependsOn
    // before this bounded run, so the dev server does not prepare them a second time.
    command: `pnpm nx run datatug-app:serve:development --host localhost --port ${port} --excludeTaskDependencies`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    env: demodbServerEnv,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: demodbChromiumLaunch } }],
});
