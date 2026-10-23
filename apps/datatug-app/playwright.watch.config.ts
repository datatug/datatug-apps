import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
const port = process.env.DATATUG_WATCH_UI_PORT || '18843';
export default defineConfig({
  testDir: './e2e',
  testMatch: ['watch.spec.ts', 'watch-real.spec.ts'],
  workers: 1,
  retries: 0,
  outputDir: process.env.DATATUG_WATCH_REAL_TOKEN
    ? '../../coverage/apps/datatug-watch/real-results'
    : '../../coverage/apps/datatug-watch/results',
  reporter: [['list']],
  use: {
    baseURL: `http://datatug.localhost:${port}`,
    trace: process.env.DATATUG_WATCH_REAL_TOKEN ? 'off' : 'retain-on-failure',
  },
  webServer: {
    command: 'node tools/serve-watch-preview.mjs',
    cwd: resolve(__dirname, '../..'),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 15000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
