import { defineConfig, devices } from '@playwright/test';
import {
  demodbChromiumLaunch,
  demodbReporter,
} from './e2e/helpers/demodb-config';

/** Real HTTP backend + Auth/Firestore emulator profile; no Work interception. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'work.spec.ts',
  workers: 1,
  timeout: 120_000,
  outputDir: '../../coverage/apps/datatug-work/results',
  reporter: [['list'], demodbReporter],
  use: { baseURL: 'http://127.0.0.1:4201', trace: 'retain-on-failure' },
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
