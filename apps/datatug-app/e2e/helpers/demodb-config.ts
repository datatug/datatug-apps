/**
 * Shared Playwright config pieces for the DemoDB request rules (see demodb-guard.ts). Import from the playwright.*.config.ts files.
 */

// One run id for every process of a run (the runner sets it first; workers inherit it), so the guard's breaker, memo and
// live counter files (demodb-guard-state.ts) are shared by all workers of this run and by nothing else.
process.env['DEMODB_RUN_ID'] ??= String(process.pid);

export const DEMODB_LIVE_MODE = process.env['DEMODB_E2E_MODE'] === 'live';

/**
 * Chromium launch args: in the default (fixture) mode every demodb.dev and openvaultdb.com name, whatever the sub-domain, resolves to nothing,
 * and in GitHub checkout mode so do the three GitHub hosts.
 * Fixtures are answered by the guard's route before any name lookup, so this is a wildcard backstop for contexts and
 * requests the route cannot see. (The CI hosts block, .github/actions/block-demodb, does the same for Firefox, WebKit,
 * Node and the datatug CLI.) Never in live mode.
 */
export const GITHUB_LIVE_MODE = process.env['GITHUB_E2E_MODE'] === 'live';
const blockedNames = [
  ...(DEMODB_LIVE_MODE ? [] : ['demodb.dev', '*.demodb.dev', 'openvaultdb.com', '*.openvaultdb.com']),
  // GitHub checkout mode (default): the guard answers the GitHub hosts from the pinned checkouts (fake-github.ts); a request
  // its route cannot see fails to resolve here and counts as escaped.
  ...(GITHUB_LIVE_MODE ? [] : ['api.github.com', 'raw.githubusercontent.com', 'cdn.jsdelivr.net']),
];
export const demodbChromiumLaunch = blockedNames.length
  ? { args: [`--host-resolver-rules=${blockedNames.map((name) => `MAP ${name} ~NOTFOUND`).join(', ')}`] }
  : {};

/**
 * Environment for the dev server a lane starts (webServer.env). The dev server forwards the app's public OVDB calls
 * (https://ovdb.demodb.dev, https://cloud.openvaultdb.com, rewritten to /__datatug_public_ovdb/*) from NODE, where neither
 * the guard's route nor the Chromium resolver rule can see them (tools/public-ovdb-proxy.cjs). In fixture mode the proxy
 * REFUSES them (403 + x-datatug-ovdb-refused) and the guard counts every refusal as an escape. A dev server that was
 * already running (reuseExistingServer, outside CI) keeps its own environment: stop it to get this protection locally.
 */
export const demodbServerEnv: Record<string, string> = DEMODB_LIVE_MODE ? {} : { DATATUG_PUBLIC_OVDB_UPSTREAM: 'refuse' };

/** The reporter that prints and records the per-host request report. */
export const demodbReporter: [string] = ['./e2e/helpers/demodb-request-reporter.ts'];
