import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// Deliberately scoped mobile WebKit regression lane. This uses real SQLite
// workers and the maintained demo fixtures, and does not claim physical iOS QA.
export default defineConfig({
  ...base,
  fullyParallel: false,
  workers: 1,
  outputDir: '../../coverage/apps/datatug-query-mobile/results',
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: '../../coverage/apps/datatug-query-mobile/report',
        open: 'never',
      },
    ],
  ],
  projects: [
    {
      name: 'query-mobile-webkit',
      testMatch: ['query-author.spec.ts', 'query-compare.spec.ts'],
      grep: /TugQL and SQL coloring|TugQL suggestions are explicit|cold saved Chinook query|compares the maintained Chinook invoice query/u,
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
    },
  ],
});
