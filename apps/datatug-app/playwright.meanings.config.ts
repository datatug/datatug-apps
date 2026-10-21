import { defineConfig, devices } from '@playwright/test';
import {
  demodbChromiumLaunch,
  demodbServerEnv,
} from './e2e/helpers/demodb-config';

const port = process.env['DATATUG_E2E_PORT'] || '14321';
export default defineConfig({
  testDir: './e2e',
  testMatch: 'project-meanings-real.spec.ts',
  workers: 1,
  fullyParallel: false,
  outputDir: '../../coverage/apps/datatug-app-meanings-e2e',
  reporter: 'list',
  timeout: 90_000,
  use: {
    baseURL: `http://datatug.localhost:${port}`,
    ...devices['Desktop Chrome'],
    launchOptions: demodbChromiumLaunch,
    trace: 'off',
    actionTimeout: 10000,
  },
  webServer: {
    command: `pnpm nx run datatug-app:serve:development --host 127.0.0.1 --port ${port} --allowed-hosts datatug.localhost`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    env: demodbServerEnv,
    timeout: 180_000,
  },
});
