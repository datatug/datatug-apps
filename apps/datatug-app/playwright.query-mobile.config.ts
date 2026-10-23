import { defineConfig, devices } from '@playwright/test';
import { demodbReporter } from './e2e/helpers/demodb-config';
import base from './playwright.config';

// Deliberately scoped mobile WebKit regression lane. This uses real SQLite
// workers and the maintained demo fixtures, and does not claim physical iOS QA.
export default defineConfig({
  ...base,
  // The same specs run fully parallel in the Chromium lane: each test owns its context and seeded state.
  fullyParallel: true,
  outputDir: '../../coverage/apps/datatug-query-mobile/results',
  reporter: [
    ['list'],
    demodbReporter,
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
      grep: /query workspace clarity|query context counts stay inline|related count arriving later|query workspace six polish|expanding source metadata grows|Run validates a missing Customer ID|TugQL and SQL coloring|native SQL editor highlights|native SQL keeps one reachable workspace row|legacy TugQL YAML opens|TugQL suggestions are explicit|mobile editor actions format, undo, and open completion without executing|Format diagnostics navigate the unchanged draft|Preview syntax errors navigate to the exact unchanged draft without running it|cold saved Chinook query|compares the maintained Chinook invoice query/u,
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
    },
  ],
});
