import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const workspaceRoot = path.resolve(__dirname, '../..');
const canonicalWorkspaceRoot = path.dirname(
  execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: workspaceRoot, encoding: 'utf8' },
  ).trim(),
);
const coreModulesCandidates = [
  process.env.SNEAT_CORE_MODULES_DIR,
  path.resolve(workspaceRoot, '../../sneat-co/sneat-core-modules'),
  path.resolve(canonicalWorkspaceRoot, '../../sneat-co/sneat-core-modules'),
].filter((candidate): candidate is string => !!candidate);
const coreModulesRoot = coreModulesCandidates.find((candidate) =>
  existsSync(path.join(candidate, 'auth/sso/cmd/sso-e2e-server')),
);
const authUiSetup = process.env.SNEAT_AUTH_UI_DIST_DIR
  ? "node tools/local-auth-ui-link.mjs link && trap 'node tools/local-auth-ui-link.mjs restore' EXIT INT TERM; "
  : '';

if (!coreModulesRoot) {
  throw new Error(
    `Unable to locate sneat-core-modules; checked ${coreModulesCandidates.join(', ')}. Set SNEAT_CORE_MODULES_DIR to override.`,
  );
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'enterprise-sso.spec.ts',
  outputDir: '../../coverage/apps/datatug-app-sso-e2e/results',
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: '../../coverage/apps/datatug-app-sso-e2e/report',
        open: 'never',
      },
    ],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4200',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command:
        'pnpm exec firebase emulators:start --only auth,firestore --project demo-local-sneat-app',
      cwd: workspaceRoot,
      url: 'http://127.0.0.1:9099',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
    {
      command: 'go run ./auth/sso/cmd/sso-e2e-server',
      cwd: coreModulesRoot,
      url: 'http://127.0.0.1:8090/healthz',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
    {
      command: `${authUiSetup}NG_BUILD_CACHE=0 NX_SKIP_NX_CACHE=true pnpm nx run datatug-app:serve:sso-e2e --host 127.0.0.1 --port 4200 --prebundle=false --skip-nx-cache`,
      cwd: workspaceRoot,
      url: 'http://127.0.0.1:4200/sso',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
