import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import measurement from './playwright.showcase-measurement.config';
const outputDir = resolve(
  __dirname,
  '../../coverage/apps/datatug-showcase-routing-ab/results',
);
export default defineConfig({
  ...measurement,
  testMatch: 'showcase-routing-ab.spec.ts',
  outputDir,
  reporter: [
    ['list'],
    ['json', { outputFile: resolve(outputDir, '../report.json') }],
  ],
});
