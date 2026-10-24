import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import {
  demodbChromiumLaunch,
  demodbReporter,
} from './e2e/helpers/demodb-config';
/** Production Work/Postmortem HTTP handlers; owns only its static app server. */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['postmortem.spec.ts', 'postmortem-origins.spec.ts'],
  workers: 1,
  timeout: 180_000,
  outputDir: '../../coverage/apps/datatug-postmortem/results',
  reporter: [['list'], demodbReporter],
  use: {
    baseURL: 'http://127.0.0.1:4201',
    actionTimeout: 15000,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'DATATUG_WATCH_UI_PORT=4201 node tools/serve-watch-preview.mjs',
    cwd: resolve(__dirname, '../..'),
    url: 'http://127.0.0.1:4201',
    reuseExistingServer: false,
    timeout: 15000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: demodbChromiumLaunch,
      },
    },
  ],
});
