import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const port = process.env['DATATUG_LOGS_E2E_PORT'] ?? '4342';
const origin = `http://127.0.0.1:${port}`;
const demoProject = process.env['DATATUG_DEMO_PROJECT_DIR'];

if (!demoProject) {
  throw new Error(
    'Set DATATUG_DEMO_PROJECT_DIR to the local datatug-demo-project checkout.',
  );
}

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * Focused real-source E2E. First run the build guide's two stamp targets and
 * `nx build datatug-app --configuration=development
 * --excludeTaskDependencies --skip-nx-cache`. Then run:
 * `DATATUG_DEMO_PROJECT_DIR=... DALGO2LOGS_REPO=... pnpm nx run datatug-app:e2e
 * -- --config=apps/datatug-app/playwright.logs.config.ts --forbid-only`.
 * The documented static helper avoids the unrelated RecordsetCompare dev
 * server asset preparation. Port 4342 and its temporary CORS origin are
 * test-only; the documented demo origin remains port 4200.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'northwind-logs.spec.ts',
  outputDir: '../../coverage/apps/datatug-app-e2e/northwind-logs-results',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: origin,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `python3 ${quote(resolve(demoProject, 'scripts/serve-built-datatug.py'))} ${quote('dist/apps/datatug-app/browser')} --port ${port}`,
    url: origin,
    cwd: process.cwd(),
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
