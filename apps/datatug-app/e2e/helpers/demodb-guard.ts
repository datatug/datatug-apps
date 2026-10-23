import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APIRequestContext, Browser, BrowserContext, expect, Route, test as base, TestInfo } from '@playwright/test';
import { Counter, type HostCounts, type Kind, resolveRequest, type Rules } from './demodb-guard-logic';
import { readBreaker, type Stored } from './demodb-guard-state';
import { fulfillFromCheckouts, GITHUB_HOST, GithubCheckouts, type IFakeGithubRepo } from './fake-github';
import { servingGithubPins } from './github-pins';

/**
 * Keeps the e2e suites off the live DemoDB hosts (demodb.dev and every *.demodb.dev, including ovdb.demodb.dev) and off the
 * public OpenVaultDB API (openvaultdb.com, cloud.openvaultdb.com).
 *
 * Why: on 2026-10-16 about 25,500 CI requests for chinook.demodb.dev/data/chinook.sqlite got the whole demodb.dev
 * Cloudflare zone rate limited (HTTP 429 for every DemoDB site). Every Playwright test opens a fresh browser context,
 * so every test downloaded the file again, in three browsers, plus retries.
 *
 * Layers (the first is this file, the others are the backstop; CI runs all of them):
 *  1. Every browser context of every test gets a route for the DemoDB hosts: the `browser` fixture is wrapped so that
 *     `browser.newContext()` (also the one inside `newPage()` and the built-in `context` fixture) installs it. A
 *     request that still reaches the network is counted as "escaped" and fails the test. Tests of the real-agent lanes use
 *     the guard passively (the `demodbPassive` option, per test): counters and escape detection, no route.
 *  2. Chromium resolves the DemoDB and openvaultdb.com names to nothing (helpers/demodb-config.ts), and CI maps them to
 *     0.0.0.0 in /etc/hosts (.github/actions/block-demodb) for Firefox, WebKit, Node (`request`) and the datatug CLI.
 *  3. The dev server forwards the app's public OVDB calls from Node (tools/public-ovdb-proxy.cjs), which none of the layers
 *     above can see. Lanes that start it set DATATUG_PUBLIC_OVDB_UPSTREAM=refuse (demodbServerEnv): the proxy answers 403 with
 *     x-datatug-ovdb-refused and this guard counts that as an escape. Only a dev server started by the lane gets this: a
 *     server already running (reuseExistingServer outside CI) keeps its own environment, so stop it before a local `nx e2e`.
 *
 * Two modes, picked by DEMODB_E2E_MODE:
 *  - `fixture` (default): every DemoDB request is answered locally: the SQLite files from DEMODB_FIXTURE_DIR (default
 *    <repo>/tmp/demodb-fixtures, filled by scripts/fetch-demodb-fixtures.mjs from the public demo-db GitHub repos,
 *    SHA-256 verified, at most one request per file, none when warm), corpus.json and the dataset pages from the repository
 *    (e2e/fixtures/demodb). Anything else is REFUSED (aborted), notably the OVDB API on ovdb.demodb.dev and the chunked
 *    AdventureWorks manifest and parts (`*.parts.json`, gzip parts) in a run that did not fetch them
 *    (DEMODB_FIXTURE_ADVENTUREWORKS, see playwright.demo-sqlite-adventureworks.config.ts). Live budget: 0.
 *  - `live` (opt-in, the manual "DemoDB live smoke" workflow): requests go to the real hosts, but each URL at most once
 *    per run (later requests are answered from a file memo shared by all workers), at most DEMODB_E2E_MAX_LIVE_REQUESTS
 *    (default 15) live requests per test and DEMODB_E2E_MAX_RUN_LIVE_REQUESTS (default 120) per run. The budgets are
 *    enforced BEFORE a request is sent: once spent, requests are refused. A retry by the app (503 back-off) is a request
 *    like any other and spends budget. No retries by Playwright.
 *
 * In both modes a rate-limit answer from a DemoDB host (HTTP 429, or a Cloudflare block page: see isRateLimited) trips a
 * breaker kept in a file (demodb-guard-state.ts): every worker of the run, including one started after a failure, refuses
 * every further request, and the test fails naming the URL. The live config also sets maxFailures 1 so the run stops.
 *
 * GitHub (api.github.com, raw.githubusercontent.com, cdn.jsdelivr.net) is guarded the same way, picked by GITHUB_E2E_MODE:
 *  - `checkout` (default): every request is answered by helpers/fake-github.ts from the shallow checkouts of the commits in
 *    e2e/github-pins.json (scripts/fetch-github-pins.mjs, run by globalSetup). A repository, branch name or endpoint outside the
 *    pins is answered 404 and FAILS the test, naming the URL; a request that reaches the network is ESCAPED and fails it too. A
 *    spec's own `installFakeGithub` (a scratch repository) answers first. Live budget: 0.
 *  - `live` (the "GitHub live smoke" workflow only): requests go to the real hosts under the same budgets and memo as DemoDB's live
 *    mode, for api.github.com (GITHUB_E2E_MAX_LIVE_REQUESTS per test, default 30; GITHUB_E2E_MAX_RUN_LIVE_REQUESTS per run, default
 *    50, under the anonymous 60 an hour; raw files and the mirror have no quota and go to the network unbudgeted). A 403 with
 *    x-ratelimit-remaining 0 trips the breaker.
 * Passive tests (real-agent lanes) get no GitHub route either: a GitHub request there escapes and fails the test.
 *
 * Every test records its per-host request counts (`demodb-requests` annotation); demodb-request-reporter.ts prints them at
 * the end of the run and writes them to $GITHUB_STEP_SUMMARY.
 */

/** Every host the guard watches: the DemoDB zone and the public OpenVaultDB API. */
export const DEMODB_HOST = /(^|\.)(demodb\.dev|openvaultdb\.com)$/;
export const DEMODB_LIVE = process.env['DEMODB_E2E_MODE'] === 'live';
const MAX_LIVE_PER_TEST = Number(process.env['DEMODB_E2E_MAX_LIVE_REQUESTS'] || 15);
const MAX_LIVE_PER_RUN = Number(process.env['DEMODB_E2E_MAX_RUN_LIVE_REQUESTS'] || 120);
const MEMO_LIMIT_BYTES = 16 * 1024 * 1024;
export const GITHUB_LIVE = process.env['GITHUB_E2E_MODE'] === 'live';
const GITHUB_MAX_LIVE_PER_TEST = Number(process.env['GITHUB_E2E_MAX_LIVE_REQUESTS'] || 30);
const GITHUB_MAX_LIVE_PER_RUN = Number(process.env['GITHUB_E2E_MAX_RUN_LIVE_REQUESTS'] || 50);
/** Every host the guard watches. */
const WATCHED = (host: string): boolean => DEMODB_HOST.test(host) || GITHUB_HOST.test(host);

let pinned: GithubCheckouts | undefined;
/**
 * The pinned checkouts, loaded once per worker. DATATUG_E2E_GITHUB_FAKE set by hand to a checkout that is not a pin (local
 * work on the demo project) serves that checkout's HEAD as the demo project's HEAD/main instead of the pinned one.
 */
function pinnedCheckouts(): GithubCheckouts {
  if (pinned) return pinned;
  const pins = servingGithubPins();
  const custom = process.env['DATATUG_E2E_GITHUB_FAKE'];
  const customDemo = custom && !pins.some((pin) => resolve(pin.dir) === resolve(custom)) ? resolve(custom) : undefined;
  const repos: IFakeGithubRepo[] = pins.map((pin) => {
    if (!existsSync(join(pin.dir, '.datatug-pin-complete'))) {
      throw new Error(`GitHub pin ${pin.id} (${pin.repo}@${pin.sha}) is not checked out at ${pin.dir}: run \`node scripts/fetch-github-pins.mjs\` (the lane's globalSetup does).`);
    }
    return { fullName: pin.repo, dir: pin.dir, sha: pin.sha, refs: customDemo && pin.repo === 'datatug/datatug-demo-project' ? [] : pin.refs };
  });
  if (customDemo) repos.push({ fullName: 'datatug/datatug-demo-project', dir: customDemo, refs: ['HEAD', 'main'] });
  pinned = new GithubCheckouts(repos);
  return pinned;
}

/** Committed fixtures (corpus.json, dataset pages) built from demo-db/websites; see fixtures/demodb/provenance.json. */
const committedDir = (): string => join(__dirname, '../fixtures/demodb');

export const fixtureDir = (): string =>
  resolve(process.env['DEMODB_FIXTURE_DIR'] || join(__dirname, '../../../../tmp/demodb-fixtures'));

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' };

function fixtureFile(url: URL): { path: string; contentType: string } | undefined {
  const dir = fixtureDir();
  const committed = committedDir();
  if (!/(^|\.)demodb\.dev$/.test(url.hostname)) return undefined;
  const sub = url.hostname.replace(/\.?demodb\.dev$/, '');
  if (url.hostname === 'demodb.dev' && url.pathname === '/corpus.json') {
    return { path: join(committed, 'corpus.json'), contentType: 'application/json' };
  }
  const data = /^\/data\/([a-z0-9-]+)\.sqlite$/.exec(url.pathname);
  if (sub && data && data[1] === sub) {
    return { path: join(dir, 'data', `${sub}.sqlite`), contentType: 'application/vnd.sqlite3' };
  }
  // The chunked AdventureWorks download (scripts/fetch-demodb-fixtures.mjs with DEMODB_FIXTURE_ADVENTUREWORKS): manifest + gzip parts.
  if (sub === 'adventureworks' && url.pathname === '/data/adventureworks.sqlite.parts.json') {
    return { path: join(dir, 'data', 'adventureworks.sqlite.parts.json'), contentType: 'application/json' };
  }
  const part = /^\/data\/(adventureworks\.sqlite\.gz\.[0-9a-f]{16}\.part-[0-9]+)$/.exec(url.pathname);
  if (sub === 'adventureworks' && part) {
    return { path: join(dir, 'data', part[1]), contentType: 'application/octet-stream' };
  }
  const compare = /^\/data\/compare\/([0-9a-f]{64})\.sqlite$/.exec(url.pathname);
  if (sub === 'chinook' && compare) {
    return { path: join(dir, 'data', 'compare', `${compare[1]}.sqlite`), contentType: 'application/vnd.sqlite3' };
  }
  if (sub && (url.pathname === '/' || url.pathname === '/index.html')) {
    return { path: join(committed, 'pages', `${sub}.html`), contentType: 'text/html; charset=utf-8' };
  }
  return undefined;
}

function fromFixture(url: URL, method: string): Stored | undefined {
  const file = fixtureFile(url);
  if (!file || !existsSync(file.path)) return undefined;
  const body = readFileSync(file.path);
  return {
    status: 200,
    headers: { ...CORS, 'content-type': file.contentType, 'content-length': String(body.length) },
    body: method === 'HEAD' ? Buffer.alloc(0) : body,
  };
}

/** Why a fixture-mode request for a URL without a fixture is refused. */
function refusalFor(url: URL): string {
  if (url.hostname === 'ovdb.demodb.dev' || /(^|\.)openvaultdb\.com$/.test(url.hostname)) {
    return `Refused ${url.href}: the OVDB API (${url.hostname}) has no fixtures and is never reached from CI. Use DEMODB_E2E_MODE=live for the manual smoke.`;
  }
  if (/\.parts\.json$|\.part[0-9]*\.gz$|\.gz$|\.gz\.[0-9a-f]{16}\.part-[0-9]+$/.test(url.pathname)) {
    return `Refused ${url.href}: the chunked AdventureWorks download (manifest and gzip parts) has no fixture on disk. Run \`DEMODB_FIXTURE_ADVENTUREWORKS=1 node scripts/fetch-demodb-fixtures.mjs\` (its lane, playwright.demo-sqlite-adventureworks.config.ts, does), or use live mode.`;
  }
  return (
    `No local fixture for ${url.href}. Run \`node scripts/fetch-demodb-fixtures.mjs\`, ` +
    'or set DEMODB_E2E_MODE=live for the opt-in live smoke.'
  );
}

export interface DemodbGuard {
  /** Per-host counts for the current test. */
  readonly counts: ReadonlyMap<string, HostCounts>;
  /** GET a demodb URL for a test that talks to the host directly (the `request` fixture), under the same rules. */
  get(request: APIRequestContext, url: string): Promise<{ status: number; headers: Record<string, string>; body: Buffer }>;
  /** HEAD a demodb URL, under the same rules. */
  head(request: APIRequestContext, url: string): Promise<{ status: number; headers: Record<string, string> }>;
}

/** The counter of the running test; requests of a context created outside a test land in `orphan` (guarded, reported and checked when the worker ends). */
const orphan = new Counter();
let current: Counter = orphan;
/** Whether the running test is passive (no route, counters and escape detection only); see `demodbPassive`. False outside a test. */
let currentPassive = false;
/** GitHub reads of the running test that no pin answers (checkout mode); each one fails the test. */
let currentUnpinned: string[] = [];

const rules: Rules = {
  live: DEMODB_LIVE,
  maxLivePerTest: MAX_LIVE_PER_TEST,
  maxLivePerRun: MAX_LIVE_PER_RUN,
  memoLimitBytes: MEMO_LIMIT_BYTES,
  fixture: fromFixture,
  refusal: refusalFor,
};
const resolve_ = (url: URL, method: string, hasRange: boolean, counter: Counter, live: () => Promise<Stored>) =>
  resolveRequest(rules, url, method, hasRange, counter, live);
const githubLiveRules: Rules = {
  live: true,
  maxLivePerTest: GITHUB_MAX_LIVE_PER_TEST,
  maxLivePerRun: GITHUB_MAX_LIVE_PER_RUN,
  memoLimitBytes: MEMO_LIMIT_BYTES,
  fixture: () => undefined,
  refusal: (url) => `Refused ${url.href}`,
};

const dropEncoding = (headers: Record<string, string>): Record<string, string> => {
  const copy = { ...headers };
  // The body is already decoded when it is read back, so the encoding and length headers would be wrong.
  delete copy['content-encoding'];
  delete copy['content-length'];
  delete copy['transfer-encoding'];
  return copy;
};

const observed = new WeakSet<BrowserContext>();
const routed = new WeakSet<BrowserContext>();
interface Installed {
  matcher: (url: URL) => boolean;
  handler: (route: Route) => Promise<void>;
  githubMatcher: (url: URL) => boolean;
  githubHandler: (route: Route) => Promise<void>;
}
const routes = new WeakMap<BrowserContext, Installed>();

/** Test hook: whether the guard's route is installed on a context (see demodb-guard-selftest.spec.ts). */
export const hasGuardRoute = (context: BrowserContext): boolean => routed.has(context);

/** Counters and escape detection on a context. Idempotent. Needs no route. */
function observe(context: BrowserContext): void {
  if (observed.has(context)) return;
  observed.add(context);
  context.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (WATCHED(host)) current.bump(host, 'total');
  });
  // Escapes: only what actually left the machine counts (see HostCounts.escaped).
  context.on('response', async (response) => {
    const url = new URL(response.url());
    // The dev server's public OVDB proxy refused to forward this request: the app tried to reach a public OVDB host.
    const refusedUpstream = response.headers()['x-datatug-ovdb-refused'];
    if (refusedUpstream) {
      current.bump(new URL(refusedUpstream).hostname, 'escaped');
      return;
    }
    if (!WATCHED(url.hostname)) return;
    try {
      if (await response.serverAddr()) current.bump(url.hostname, 'escaped');
    } catch {
      // the page closed before the address could be read
    }
  });
  context.on('requestfailed', (request) => {
    const host = new URL(request.url()).hostname;
    if (WATCHED(host) && /NAME_NOT_RESOLVED|CONNECTION_|TIMED_OUT|UNKNOWN_HOST|could not connect|cannot find/i.test(request.failure()?.errorText ?? '')) {
      current.bump(host, 'escaped');
    }
  });
}

/** Installs the DemoDB route on a context. Idempotent. */
async function installRoute(context: BrowserContext): Promise<void> {
  if (routed.has(context)) return;
  routed.add(context);
  const matcher = (url: URL): boolean => DEMODB_HOST.test(url.hostname);
  const handler = async (route: Route): Promise<void> => {
    const request = route.request();
    const url = new URL(request.url());
    const counter = current;
    counter.bump(url.hostname, 'handled');
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS' },
      });
    }
    const result = await resolve_(url, request.method(), 'range' in request.headers(), counter, async () => {
      const response = await route.fetch();
      return { status: response.status(), headers: dropEncoding(response.headers()), body: await response.body() };
    });
    if ('abort' in result) {
      console.error(`[demodb-guard] ${result.abort}`);
      return route.abort();
    }
    if (process.env['DEMODB_GUARD_DEBUG']) console.error(`[demodb-guard] ${request.method()} ${url.href} -> ${result.status} (${result.body.length} bytes)`);
    return route.fulfill({ status: result.status, headers: result.headers, body: result.body });
  };
  const githubMatcher = (url: URL): boolean => GITHUB_HOST.test(url.hostname);
  const githubHandler = async (route: Route): Promise<void> => {
    const request = route.request();
    const url = new URL(request.url());
    const counter = current;
    counter.bump(url.hostname, 'handled');
    if (!GITHUB_LIVE) {
      const answer = await fulfillFromCheckouts(route, pinnedCheckouts());
      if (!answer) return;
      if (answer.unpinned) {
        counter.bump(url.hostname, 'refused');
        currentUnpinned.push(answer.unpinned);
        console.error(`[github-guard] ${answer.unpinned}`);
      } else counter.bump(url.hostname, 'fixture');
      return;
    }
    if (request.method() === 'OPTIONS') return route.continue();
    // Only the API has a quota (60 an hour per address, anonymous): raw files and the mirror go to the network unbudgeted.
    if (url.hostname !== 'api.github.com') {
      counter.bump(url.hostname, 'live');
      return route.continue();
    }
    const apiOnly = { bump: (host: string, kind: Kind) => counter.bump(host, kind), sum: (kind: Kind) => counter.counts.get('api.github.com')?.[kind] ?? 0 } as Counter;
    const result = await resolveRequest(githubLiveRules, url, request.method(), 'range' in request.headers(), apiOnly, async () => {
      const response = await route.fetch();
      return { status: response.status(), headers: dropEncoding(response.headers()), body: await response.body() };
    });
    if ('abort' in result) {
      console.error(`[github-guard] ${result.abort}`);
      return route.abort();
    }
    return route.fulfill({ status: result.status, headers: result.headers, body: result.body });
  };
  routes.set(context, { matcher, handler, githubMatcher, githubHandler });
  await context.route(matcher, handler);
  await context.route(githubMatcher, githubHandler);
}

/** Removes the route again (a passive test's own context is created before the test's option is known). */
async function removeRoute(context: BrowserContext): Promise<void> {
  const installed = routes.get(context);
  if (!installed) return;
  routes.delete(context);
  routed.delete(context);
  await context.unroute(installed.matcher, installed.handler);
  await context.unroute(installed.githubMatcher, installed.githubHandler);
}

function summarise(counter: Counter): Record<string, HostCounts> {
  return Object.fromEntries([...counter.counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export const test = base.extend<{ demodbGuard: DemodbGuard; demodbPassive: boolean }, { browser: Browser }>({
  /**
   * Passive mode, per test (set it in a fixture module with `demodbPassive: [true, { option: true }]`, or in a project's
   * `use`): count requests and detect escapes on every context, but install NO route. For lanes that talk only to a local
   * agent and have no reason to ask DemoDB for anything (journey, session-continuity, agent-links): a route makes Chromium
   * intercept every request, which slows those long flows enough to hit their test timeouts on a CI runner. The hosts block
   * and the Chromium resolver rule stop a DemoDB request there; the listeners turn it into a failed test. It applies to the
   * tests that use this option only, never to other specs that happen to run in the same worker.
   */
  demodbPassive: [false, { option: true }],
  // Worker-scoped: every context created from this browser (newContext, newPage, contexts a spec or a fixture creates by
  // hand during a test) gets the guard. The built-in `context` fixture is created before the test's own fixture below runs, so
  // that one is routed by `demodbGuard`.
  browser: [
    async ({ browser }, use) => {
      const original = browser.newContext.bind(browser);
      browser.newContext = (async (...args: Parameters<Browser['newContext']>) => {
        const context = await original(...args);
        observe(context);
        if (!currentPassive) await installRoute(context);
        return context;
      }) as Browser['newContext'];
      await use(browser);
      browser.newContext = original;
      // Contexts created outside a test (beforeAll, worker fixtures) are guarded like any other and counted here; whatever
      // they sent must not have escaped or gone live in fixture mode.
      const outside = summarise(orphan);
      const outsideSum = (kind: Kind): number => Object.values(outside).reduce((n, host) => n + host[kind], 0);
      if (Object.keys(outside).length) console.error(`[demodb-guard] requests from contexts created outside a test: ${JSON.stringify(outside)}`);
      if (outsideSum('escaped') > 0 || (!DEMODB_LIVE && outsideSum('live') > 0)) {
        throw new Error(`DemoDB requests from contexts created outside a test escaped the guard or went live: ${JSON.stringify(outside)}`);
      }
    },
    { scope: 'worker' },
  ],
  demodbGuard: [
    async ({ context, demodbPassive }, use, testInfo: TestInfo) => {
      const counter = new Counter();
      current = counter;
      currentPassive = demodbPassive;
      const unpinned: string[] = [];
      currentUnpinned = unpinned;
      observe(context);
      if (demodbPassive) await removeRoute(context);
      else await installRoute(context);
      const guard: DemodbGuard = {
        counts: counter.counts,
        async get(request, href) {
          const url = new URL(href);
          counter.bump(url.hostname, 'total');
          counter.bump(url.hostname, 'handled');
          const result = await resolve_(url, 'GET', false, counter, async () => {
            const response = await request.get(href, { maxRedirects: 0, failOnStatusCode: false });
            return { status: response.status(), headers: response.headers(), body: await response.body() };
          });
          if ('abort' in result) throw new Error(result.abort);
          return result;
        },
        async head(request, href) {
          const url = new URL(href);
          counter.bump(url.hostname, 'total');
          counter.bump(url.hostname, 'handled');
          const result = await resolve_(url, 'HEAD', false, counter, async () => {
            const response = await request.head(href, { maxRedirects: 0, failOnStatusCode: false });
            return { status: response.status(), headers: response.headers(), body: Buffer.alloc(0) };
          });
          if ('abort' in result) throw new Error(result.abort);
          return result;
        },
      };
      await use(guard);

      const summary = summarise(counter);
      current = orphan;
      currentPassive = false;
      currentUnpinned = [];
      testInfo.annotations.push({
        type: 'demodb-requests',
        description: JSON.stringify({ mode: DEMODB_LIVE ? 'live' : 'fixture', github: GITHUB_LIVE ? 'live' : 'checkout', hosts: summary }),
      });
      const tripped = readBreaker();
      if (tripped) throw new Error(tripped);
      const sum = (kind: Kind): number => Object.values(summary).reduce((n, host) => n + host[kind], 0);
      const budget = DEMODB_LIVE ? MAX_LIVE_PER_TEST : 0;
      const demodbLive = Object.entries(summary).filter(([host]) => DEMODB_HOST.test(host)).reduce((n, [, host]) => n + host.live, 0);
      expect(sum('escaped'), `DemoDB / OpenVaultDB / GitHub requests that reached the network (the guard did not answer them): ${JSON.stringify(summary)}`).toBe(0);
      expect(unpinned, 'GitHub reads outside e2e/github-pins.json (pin the repository/commit, or serve a scratch repository with installFakeGithub)').toEqual([]);
      const githubLive = summary['api.github.com']?.live ?? 0;
      expect(githubLive, `live api.github.com requests in this test (budget ${GITHUB_LIVE ? GITHUB_MAX_LIVE_PER_TEST : 0})`).toBeLessThanOrEqual(GITHUB_LIVE ? GITHUB_MAX_LIVE_PER_TEST : 0);
      // Fixture mode refuses what has no fixture (page assets, the OVDB API) and the test goes on; they show in the report.
      // In live mode a refusal means a budget or the breaker stopped a request the test needed: that is a failure.
      if (DEMODB_LIVE) expect(Object.entries(summary).filter(([host]) => DEMODB_HOST.test(host)).reduce((n, [, host]) => n + host.refused, 0), `DemoDB requests refused by the guard (budget spent): ${JSON.stringify(summary)}`).toBe(0);
      if (GITHUB_LIVE) {
        const githubRefused = Object.entries(summary).filter(([host]) => GITHUB_HOST.test(host)).reduce((n, [, host]) => n + host.refused, 0);
        expect(githubRefused, `GitHub requests refused by the guard (budget spent or rate limited): ${JSON.stringify(summary)}`).toBe(0);
      }
      expect(
        demodbLive,
        `live DemoDB requests in this test (budget ${budget}; ${DEMODB_LIVE ? 'live mode' : 'fixture mode must make none'}): ${JSON.stringify(summary)}`,
      ).toBeLessThanOrEqual(budget);
    },
    { auto: true },
  ],
});

export { expect };
