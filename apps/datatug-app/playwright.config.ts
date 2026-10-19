import { defineConfig, devices } from '@playwright/test';

const e2ePort = process.env.DATATUG_E2E_PORT || '4200';

export default defineConfig({
  testDir: './e2e',
  // Enterprise SSO owns Firebase, Firestore, an SSO backend, and an OIDC IdP;
  // run it through playwright.sso.config.ts or the Keycloak profile instead.
  // error-dialog.spec.ts (S167) needs the PRODUCTION build configuration
  // (real Sentry DSN, non-"localhost" hostname) to mean anything — this
  // config's webServer always serves `serve:development` on "localhost",
  // where Sentry capture is unconditionally skipped
  // (`ErrorLoggerService.logError()`), so running it here would pass
  // vacuously rather than proving anything. Run it through
  // playwright.error-dialog.config.ts instead. demo-handoff.spec.ts (G-0) is
  // the same: it asserts what the PRODUCTION build reports to Sentry and
  // analytics, so it has its own config (playwright.demo-handoff.config.ts).
  // business-project-preview.spec.ts is a live journey against the deployed
  // datatug-cloud-preview: playwright.business-preview.config.ts only.
  // Deployed-provider checks require their explicit opt-in config, dedicated
  // identity and disabled sensitive artifacts; never discover them here.
  testIgnore: [
    'checkout-journey.spec.ts',
    'checkout-provider.spec.ts',
    'business-project-preview.spec.ts',
    'enterprise-sso.spec.ts',
    'error-dialog.spec.ts',
    'demo-handoff.spec.ts',
    'demo-sqlite*.spec.ts',
    'demo-postgresql*.spec.ts',
    'northwind-logs.spec.ts',
    'showcase-live-measurement.spec.ts',
  ],
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
    baseURL: `http://localhost:${e2ePort}`,
    trace: 'retain-on-failure',
  },
  // Shared by every project below, including "journey": the app resolves
  // which agent to talk to at runtime from the `:storeId` URL segment (see
  // e2e/README.md), so the journey project needs no dev-server instance or
  // env var of its own — it reuses this one and navigates to a URL that
  // names its own agent's host:port.
  webServer: {
    command: `pnpm nx run datatug-app:serve:development --host localhost --port ${e2ePort}`,
    url: `http://localhost:${e2ePort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      // Project-level testIgnore replaces (does not merge with) the
      // top-level one above, so it re-states 'enterprise-sso.spec.ts' and
      // 'error-dialog.spec.ts' and adds 'journey/**' — journey/ has its own
      // project below (real agent, no interception) and must not also run
      // under this default project.
      testIgnore: [
        'checkout-journey.spec.ts',
        'checkout-provider.spec.ts',
        'business-project-preview.spec.ts',
        'enterprise-sso.spec.ts',
        'error-dialog.spec.ts',
        'demo-handoff.spec.ts',
        'demo-sqlite*.spec.ts',
        'demo-postgresql*.spec.ts',
        'northwind-logs.spec.ts',
        'showcase-live-measurement.spec.ts',
        'journey/**',
      ],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Journey e2e (Phase 1 plan task 3, AC:journey-harness): real
      // `datatug serve` agent, no route interception. See e2e/README.md.
      name: 'journey',
      testDir: './e2e/journey',
      // Session context was added after the pinned v0.78.0 CLI used by J1-J4.
      // It has a separate config and runs against the modern CLI in the same CI job.
      testIgnore: ['session-continuity.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
