import { defineConfig, devices } from '@playwright/test';

/**
 * Card links (Feature claude-mod-web-links): the pages a DataTug Claude Code mod card links to, opened against a
 * REAL `datatug daemon start` in an isolated HOME, with links minted by `datatug daemon url` (see
 * e2e/agent-links/fixtures/daemon.ts). The agent admits only https://datatug.app and the development host
 * datatug.localhost, so the app is served on datatug.localhost (Chromium resolves every *.localhost name to the
 * loopback address); a page on http://localhost would be refused, which is why this is not part of the default
 * e2e config. Skipped, not failed, when no datatug binary is given (DATATUG_BIN or DATATUG_CLI_DIR).
 */
const port = process.env['DATATUG_LINKS_E2E_PORT'] || '4312';
const origin = `http://datatug.localhost:${port}`;

export default defineConfig({
  testDir: './e2e/agent-links',
  outputDir: '../../coverage/apps/datatug-app-agent-links-e2e/results',
  // One daemon per run: the daemon picks the first free port from 8989.
  workers: 1,
  fullyParallel: false,
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: '../../coverage/apps/datatug-app-agent-links-e2e/report',
        open: 'never',
      },
    ],
  ],
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `pnpm nx run datatug-app:serve:development --host 127.0.0.1 --port ${port} --allowed-hosts datatug.localhost`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
