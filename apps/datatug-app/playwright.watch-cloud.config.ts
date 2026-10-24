import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
const port = '18848';
export default defineConfig({
  testDir: './e2e',
  testMatch: 'watch-cloud.spec.ts',
  workers: 1,
  retries: 0,
  outputDir: '../../coverage/apps/datatug-watch-cloud/results',
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'off',
    actionTimeout: 5000,
  },
  webServer: [
    {
      cwd: resolve(__dirname, '../..'),
      command:
        'env -u FORCE_COLOR pnpm exec firebase emulators:start --config firebase.watch-cloud.json --only auth,firestore --project demo-local-sneat-app',
      url: 'http://127.0.0.1:18288',
      reuseExistingServer: false,
      timeout: 120000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
    },
    {
      cwd: resolve(__dirname, '../..'),
      command: `DATATUG_WATCH_UI_PORT=${port} node tools/serve-watch-preview.mjs`,
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: false,
      timeout: 15000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
