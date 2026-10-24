import { defineConfig, devices } from '@playwright/test';
import {
  demodbChromiumLaunch,
  demodbReporter,
  demodbServerEnv,
} from './e2e/helpers/demodb-config';

// Specs import `test` from ./e2e/helpers/demodb-guard, which serves *.demodb.dev from local fixtures (the app downloads
// chinook.sqlite itself) and fails a test that sends a live request.
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
  // query-grid-enterprise.spec.ts needs an AG Grid Enterprise key, which these
  // lanes do not set (empty in CI): excluded until a keyed opt-in lane runs it
  // (https://github.com/datatug/datatug-apps/issues/410).
  // Deployed-provider checks require their explicit opt-in config, dedicated
  // identity and disabled sensitive artifacts; never discover them here.
  // Hosted Incidents seeds Firebase Auth and Firestore; the checkout lane starts
  // those emulators and serves the SSO E2E app.
  testIgnore: [
    'project-meanings-real.spec.ts',
    'checkout-journey.spec.ts',
    'hosted-incidents.spec.ts',
    // Real Auth/Firestore + paired Backend prerequisites: dedicated e2e-work profile.
    'work.spec.ts',
    'project-ai.spec.ts',
    'checkout-provider.spec.ts',
    'business-project-preview.spec.ts',
    'enterprise-sso.spec.ts',
    'error-dialog.spec.ts',
    'demo-handoff.spec.ts',
    'demo-sqlite*.spec.ts',
    'demo-postgresql*.spec.ts',
    'northwind-logs.spec.ts',
    'hosted-cloud-logs.spec.ts',
    'showcase-live-measurement.spec.ts',
    'showcase-routing-ab.spec.ts',
    'query-grid-enterprise.spec.ts',
    // Needs its paired Demo revision, not the browser catalog pin: CI's
    // e2e-app job runs it through `datatug-app:e2e-showcase-independent`.
    'showcase-independent-sources.spec.ts',
  ],
  outputDir: '../../coverage/apps/datatug-app-e2e/results',
  fullyParallel: true,
  globalSetup: './e2e/helpers/demodb-fixtures-setup.ts',
  reporter: [
    ['list'],
    demodbReporter,
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
    env: demodbServerEnv,
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
        'project-meanings-real.spec.ts',
        'checkout-journey.spec.ts',
        'hosted-incidents.spec.ts',
        // Real Auth/Firestore + paired Backend prerequisites: dedicated e2e-work profile.
        'work.spec.ts',
        'project-ai.spec.ts',
        'checkout-provider.spec.ts',
        'business-project-preview.spec.ts',
        'enterprise-sso.spec.ts',
        'error-dialog.spec.ts',
        'demo-handoff.spec.ts',
        'demo-sqlite*.spec.ts',
        'demo-postgresql*.spec.ts',
        'northwind-logs.spec.ts',
        'hosted-cloud-logs.spec.ts',
        'showcase-live-measurement.spec.ts',
        'showcase-routing-ab.spec.ts',
        'query-grid-enterprise.spec.ts',
        // Runs against its paired Demo revision in its own CI step.
        'showcase-independent-sources.spec.ts',
        'journey/**',
      ],
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: demodbChromiumLaunch,
      },
    },
    {
      // Journey e2e (Phase 1 plan task 3, AC:journey-harness): real
      // `datatug serve` agent, no route interception. See e2e/README.md.
      name: 'journey',
      testDir: './e2e/journey',
      // The session-continuity journey has its own agent fixture (and CLI pin, DATATUG_SESSION_CLI_REF).
      testIgnore: ['session-continuity.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: demodbChromiumLaunch,
        // The journey agent is the release pinned by DATATUG_CLI_REF in ci.yml (v0.113.0). datatug-cli (v0.110.0
        // and later) answers only pages whose Origin is https://datatug.app or the host
        // `datatug.localhost` (any port): `localhost` is refused with 403, and no flag adds an origin
        // (pkg/server/endpoints/validators.go IsSupportedOrigin). Chromium resolves `*.localhost` to the
        // loopback, and the dev server allows this host (`allowedHosts` in project.json).
        baseURL: `http://datatug.localhost:${e2ePort}`,
      },
    },
  ],
});
