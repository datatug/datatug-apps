/**
 * Shared Playwright config pieces for the DemoDB request rules (see demodb-guard.ts). Import from the playwright.*.config.ts files.
 */

// One run id for every process of a run (the runner sets it first; workers inherit it), so the guard's breaker, memo and
// live counter files (demodb-guard-state.ts) are shared by all workers of this run and by nothing else.
process.env['DEMODB_RUN_ID'] ??= String(process.pid);

export const DEMODB_LIVE_MODE = process.env['DEMODB_E2E_MODE'] === 'live';

/**
 * Chromium launch args: in the default (fixture) mode every demodb.dev name, whatever the sub-domain, resolves to nothing.
 * Fixtures are answered by the guard's route before any name lookup, so this is a wildcard backstop for contexts and
 * requests the route cannot see. (The CI hosts block, .github/actions/block-demodb, does the same for Firefox, WebKit,
 * Node and the datatug CLI.) Never in live mode.
 */
export const demodbChromiumLaunch = DEMODB_LIVE_MODE
  ? {}
  : { args: ['--host-resolver-rules=MAP demodb.dev ~NOTFOUND, MAP *.demodb.dev ~NOTFOUND'] };

/** The reporter that prints and records the per-host request report. */
export const demodbReporter: [string] = ['./e2e/helpers/demodb-request-reporter.ts'];
