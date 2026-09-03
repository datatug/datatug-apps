import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.sso.config';

const existingServers = Array.isArray(baseConfig.webServer)
  ? baseConfig.webServer
  : baseConfig.webServer
    ? [baseConfig.webServer]
    : [];

export default defineConfig({
  ...baseConfig,
  webServer: [
    {
      command: 'sh apps/datatug-app/e2e/keycloak/run.sh',
      cwd: existingServers[0]?.cwd,
      url: 'http://127.0.0.1:8088/realms/acme',
      reuseExistingServer: false,
      timeout: 180_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 20_000 },
    },
    // The real-provider profile must own the complete test stack. Reusing a
    // stale emulator or dev server can leave the browser connected to a
    // process that Playwright did not start or supervise.
    ...existingServers.map((server) => ({
      ...server,
      reuseExistingServer: false,
    })),
  ],
});
