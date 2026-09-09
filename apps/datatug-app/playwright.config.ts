import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Enterprise SSO owns Firebase, Firestore, an SSO backend, and an OIDC IdP;
  // run it through playwright.sso.config.ts or the Keycloak profile instead.
  testIgnore: 'enterprise-sso.spec.ts',
  outputDir: '../../coverage/apps/datatug-app-e2e/results',
  fullyParallel: true,
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: '../../coverage/apps/datatug-app-e2e/report',
        open: 'never',
      },
    ],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4200',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'pnpm nx run datatug-app:serve:development --host 127.0.0.1 --port 4200',
    url: 'http://127.0.0.1:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
