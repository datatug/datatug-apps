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
    // "localhost", not "127.0.0.1": the web app's own *page origin* becomes
    // the `Origin` header on every request a real agent sees (journey
    // project below), and sneat-go-core's security.VerifyOrigin
    // (github.com/sneat-co/sneat-go-core/security, vendored into
    // datatug-cli's apicore.Execute request pipeline) allow-lists the
    // literal hostname "localhost" but NOT "127.0.0.1" — a real GET from an
    // "http://127.0.0.1:4200" page origin gets a hard 403 "Unsupported
    // origin" from the agent (found running the journey suite against a
    // datatug-cli main build: `curl -H "Origin: http://127.0.0.1:4200"
    // .../project_summary` reproduces it directly; "http://localhost:4200"
    // does not). Vite's dev-server itself also refuses any request whose
    // Host header doesn't match what it was told to bind to (ERR_EMPTY_RESPONSE,
    // no HTTP response at all) — see the matching --host below — so this and
    // the dev-server's own bind address must agree, which is why this isn't
    // scoped to just the "journey" project.
    baseURL: 'http://localhost:4200',
    trace: 'retain-on-failure',
  },
  // Shared by every project below, including "journey": the app resolves
  // which agent to talk to at runtime from the `:storeId` URL segment (see
  // e2e/README.md), so the journey project needs no dev-server instance or
  // env var of its own — it reuses this one and navigates to a URL that
  // names its own agent's host:port.
  webServer: {
    command:
      'pnpm nx run datatug-app:serve:development --host localhost --port 4200',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      // Project-level testIgnore replaces (does not merge with) the
      // top-level one above, so it re-states 'enterprise-sso.spec.ts' and
      // adds 'journey/**' — journey/ has its own project below (real agent,
      // no interception) and must not also run under this default project.
      testIgnore: ['enterprise-sso.spec.ts', 'journey/**'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Journey e2e (Phase 1 plan task 3, AC:journey-harness): real
      // `datatug serve` agent, no route interception. See e2e/README.md.
      name: 'journey',
      testDir: './e2e/journey',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
