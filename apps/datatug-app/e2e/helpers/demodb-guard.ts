import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APIRequestContext, Browser, BrowserContext, expect, Route, test as base, TestInfo } from '@playwright/test';
import {
  bumpLiveRun,
  isRateLimited,
  liveRunCount,
  memoGet,
  memoSet,
  rateLimitMessage,
  readBreaker,
  Stored,
  tripBreaker,
} from './demodb-guard-state';

/**
 * Keeps the e2e suites off the live DemoDB hosts (demodb.dev and every *.demodb.dev, including ovdb.demodb.dev).
 *
 * Why: on 2026-10-16 about 25,500 CI requests for chinook.demodb.dev/data/chinook.sqlite got the whole demodb.dev
 * Cloudflare zone rate limited (HTTP 429 for every DemoDB site). Every Playwright test opens a fresh browser context,
 * so every test downloaded the file again, in three browsers, plus retries.
 *
 * Layers (the first is this file, the others are the backstop; CI runs all of them):
 *  1. Every browser context of every test gets a route for the DemoDB hosts: the `browser` fixture is wrapped so that
 *     `browser.newContext()` (also the one inside `newPage()` and the built-in `context` fixture) installs it. A
 *     request that still reaches the network is counted as "escaped" and fails the test. (Real-agent lanes use the guard
 *     passively: counters and escape detection, no route; see useDemodbGuardPassively.)
 *  2. Chromium resolves *.demodb.dev to nothing (helpers/demodb-config.ts), and CI maps the DemoDB names to 0.0.0.0 in
 *     /etc/hosts (.github/actions/block-demodb) for Firefox, WebKit, Node (`request`) and the datatug CLI.
 *
 * Two modes, picked by DEMODB_E2E_MODE:
 *  - `fixture` (default): every DemoDB request is answered locally: the SQLite files from DEMODB_FIXTURE_DIR (default
 *    <repo>/tmp/demodb-fixtures, filled by scripts/fetch-demodb-fixtures.mjs from the public demo-db GitHub repos,
 *    SHA-256 verified, at most one request per file, none when warm), corpus.json and the dataset pages from the repository
 *    (e2e/fixtures/demodb). Anything else is REFUSED (aborted), notably the OVDB API on ovdb.demodb.dev and the chunked
 *    AdventureWorks manifest and parts (`*.parts.json`, gzip parts): they have no fixtures. Live budget: 0.
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
 * Every test records its per-host request counts (`demodb-requests` annotation); demodb-request-reporter.ts prints them at
 * the end of the run and writes them to $GITHUB_STEP_SUMMARY.
 */

export const DEMODB_HOST = /(^|\.)demodb\.dev$/;
export const DEMODB_LIVE = process.env['DEMODB_E2E_MODE'] === 'live';
const MAX_LIVE_PER_TEST = Number(process.env['DEMODB_E2E_MAX_LIVE_REQUESTS'] || 15);
const MAX_LIVE_PER_RUN = Number(process.env['DEMODB_E2E_MAX_RUN_LIVE_REQUESTS'] || 120);
const MEMO_LIMIT_BYTES = 16 * 1024 * 1024;

/** Committed fixtures (corpus.json, dataset pages) built from demo-db/websites; see fixtures/demodb/provenance.json. */
const committedDir = (): string => join(__dirname, '../fixtures/demodb');

export const fixtureDir = (): string =>
  resolve(process.env['DEMODB_FIXTURE_DIR'] || join(__dirname, '../../../../tmp/demodb-fixtures'));

export interface HostCounts {
  /** Requests the page/worker/test asked for (request events of every guarded context). */
  total: number;
  /** Requests that entered the guard's route handler (`total - handled`: answered by another route of the spec, or none). */
  handled: number;
  /** Of those, answered from the fixture directory. */
  fixture: number;
  /** Of those, answered from the live memo (a URL already fetched live in this run). */
  memo: number;
  /** Of those, sent to the real host. */
  live: number;
  /** Of those, refused (no fixture, budget spent, breaker tripped, OVDB API). */
  refused: number;
  /**
   * Requests that reached the NETWORK instead of being answered locally: a response from a real server address, or a
   * failed name lookup / connection (what the hosts block and the Chromium resolver rule turn them into). A request that
   * another route (a spec's own `context.route`) fulfilled never counts: it did not leave the machine.
   */
  escaped: number;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' };

function fixtureFile(url: URL): { path: string; contentType: string } | undefined {
  const dir = fixtureDir();
  const committed = committedDir();
  const sub = url.hostname.replace(/\.?demodb\.dev$/, '');
  if (url.hostname === 'demodb.dev' && url.pathname === '/corpus.json') {
    return { path: join(committed, 'corpus.json'), contentType: 'application/json' };
  }
  const data = /^\/data\/([a-z0-9-]+)\.sqlite$/.exec(url.pathname);
  if (sub && data && data[1] === sub) {
    return { path: join(dir, 'data', `${sub}.sqlite`), contentType: 'application/vnd.sqlite3' };
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
  if (url.hostname === 'ovdb.demodb.dev') {
    return `Refused ${url.href}: the OVDB API on ovdb.demodb.dev has no fixtures and is never reached from CI. Use DEMODB_E2E_MODE=live for the manual smoke.`;
  }
  if (/\.parts\.json$|\.part[0-9]*\.gz$|\.gz$/.test(url.pathname)) {
    return `Refused ${url.href}: the chunked AdventureWorks download (manifest and gzip parts) has no fixtures. Its opt-in tests run only in live mode.`;
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

type Kind = keyof HostCounts;

class Counter {
  readonly counts = new Map<string, HostCounts>();
  bump(host: string, kind: Kind): void {
    const entry = this.counts.get(host) ?? { total: 0, handled: 0, fixture: 0, memo: 0, live: 0, refused: 0, escaped: 0 };
    entry[kind] += 1;
    this.counts.set(host, entry);
  }
  sum(kind: Kind): number {
    let n = 0;
    for (const entry of this.counts.values()) n += entry[kind];
    return n;
  }
}

/** The counter of the running test; requests of a context created outside a test land in `orphan`. */
const orphan = new Counter();
let current: Counter = orphan;

/** Answers one DemoDB request under the mode's rules. `live` is how to reach the real host (called only within budget). */
async function resolveRequest(
  url: URL,
  method: string,
  hasRange: boolean,
  counter: Counter,
  live: () => Promise<Stored>,
): Promise<Stored | { abort: string }> {
  const refuse = (message: string): { abort: string } => {
    counter.bump(url.hostname, 'refused');
    return { abort: message };
  };
  const tripped = readBreaker();
  if (tripped) return refuse(tripped);
  if (!DEMODB_LIVE) {
    const hit = fromFixture(url, method);
    if (hit) {
      counter.bump(url.hostname, 'fixture');
      return hit;
    }
    return refuse(refusalFor(url));
  }
  const key = `${method} ${url.href}`;
  const cached = hasRange ? undefined : memoGet(key);
  if (cached) {
    counter.bump(url.hostname, 'memo');
    return cached;
  }
  // Budgets are enforced BEFORE the request is sent. Every live request spends budget, a retry by the app included.
  if (counter.sum('live') >= MAX_LIVE_PER_TEST) {
    return refuse(`Refused ${url.href}: this test has spent its live budget of ${MAX_LIVE_PER_TEST} requests to the DemoDB hosts (DEMODB_E2E_MAX_LIVE_REQUESTS).`);
  }
  if (liveRunCount() >= MAX_LIVE_PER_RUN) {
    return refuse(`Refused ${url.href}: the run has spent its live budget of ${MAX_LIVE_PER_RUN} requests to the DemoDB hosts (DEMODB_E2E_MAX_RUN_LIVE_REQUESTS).`);
  }
  bumpLiveRun();
  counter.bump(url.hostname, 'live');
  const response = await live();
  const blocked = isRateLimited(response.status, response.headers, response.status === 200 ? '' : response.body.subarray(0, 4096).toString('utf8'));
  if (blocked) return { abort: tripBreaker(rateLimitMessage(url.href, response.status, response.headers['retry-after'])) };
  if (response.status === 200 && !hasRange && response.body.length <= MEMO_LIMIT_BYTES) memoSet(key, response);
  return response;
}

const dropEncoding = (headers: Record<string, string>): Record<string, string> => {
  const copy = { ...headers };
  // The body is already decoded when it is read back, so the encoding and length headers would be wrong.
  delete copy['content-encoding'];
  delete copy['content-length'];
  delete copy['transfer-encoding'];
  return copy;
};

const installed = new WeakSet<BrowserContext>();

/**
 * Passive mode: count requests and detect escapes on every context, but install NO route. For lanes that talk only to a
 * local agent and have no reason to ask DemoDB for anything (journey, session-continuity, agent-links): a route makes
 * Chromium intercept every request, which slows those long flows enough to hit their test timeouts on a CI runner. The
 * hosts block and the Chromium resolver rule stop a DemoDB request there; the listeners turn it into a failed test.
 * Call at import time from the fixture module of such a lane.
 */
let passive = false;
export function useDemodbGuardPassively(): void {
  passive = true;
}

/** Puts the DemoDB route and the request counters on a context. Idempotent. */
async function installOnContext(context: BrowserContext): Promise<void> {
  if (installed.has(context)) return;
  installed.add(context);
  context.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (DEMODB_HOST.test(host)) current.bump(host, 'total');
  });
  // Escapes: only what actually left the machine counts (see HostCounts.escaped).
  context.on('response', async (response) => {
    const host = new URL(response.url()).hostname;
    if (!DEMODB_HOST.test(host)) return;
    try {
      if (await response.serverAddr()) current.bump(host, 'escaped');
    } catch {
      // the page closed before the address could be read
    }
  });
  context.on('requestfailed', (request) => {
    const host = new URL(request.url()).hostname;
    if (DEMODB_HOST.test(host) && /NAME_NOT_RESOLVED|CONNECTION_|TIMED_OUT|UNKNOWN_HOST|could not connect|cannot find/i.test(request.failure()?.errorText ?? '')) {
      current.bump(host, 'escaped');
    }
  });
  if (passive) return;
  await context.route(
    (url) => DEMODB_HOST.test(url.hostname),
    async (route: Route) => {
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
      const result = await resolveRequest(url, request.method(), 'range' in request.headers(), counter, async () => {
        const response = await route.fetch();
        return { status: response.status(), headers: dropEncoding(response.headers()), body: await response.body() };
      });
      if ('abort' in result) {
        console.error(`[demodb-guard] ${result.abort}`);
        return route.abort();
      }
      if (process.env['DEMODB_GUARD_DEBUG']) console.error(`[demodb-guard] ${request.method()} ${url.href} -> ${result.status} (${result.body.length} bytes)`);
      return route.fulfill({ status: result.status, headers: result.headers, body: result.body });
    },
  );
}

function summarise(counter: Counter): Record<string, HostCounts> {
  return Object.fromEntries([...counter.counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export const test = base.extend<{ demodbGuard: DemodbGuard }, { browser: Browser }>({
  // Worker-scoped: every context created from this browser (newContext, newPage, the `context` fixture, contexts a spec or a
  // fixture creates by hand) gets the guard, so no test can open a context that skips it.
  browser: [
    async ({ browser }, use) => {
      const original = browser.newContext.bind(browser);
      browser.newContext = (async (...args: Parameters<Browser['newContext']>) => {
        const context = await original(...args);
        await installOnContext(context);
        return context;
      }) as Browser['newContext'];
      await use(browser);
      browser.newContext = original;
    },
    { scope: 'worker' },
  ],
  demodbGuard: [
    async ({ context }, use, testInfo: TestInfo) => {
      const counter = new Counter();
      current = counter;
      await installOnContext(context);
      const guard: DemodbGuard = {
        counts: counter.counts,
        async get(request, href) {
          const url = new URL(href);
          counter.bump(url.hostname, 'total');
          counter.bump(url.hostname, 'handled');
          const result = await resolveRequest(url, 'GET', false, counter, async () => {
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
          const result = await resolveRequest(url, 'HEAD', false, counter, async () => {
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
      testInfo.annotations.push({ type: 'demodb-requests', description: JSON.stringify({ mode: DEMODB_LIVE ? 'live' : 'fixture', hosts: summary }) });
      const tripped = readBreaker();
      if (tripped) throw new Error(tripped);
      const sum = (kind: Kind): number => Object.values(summary).reduce((n, host) => n + host[kind], 0);
      const budget = DEMODB_LIVE ? MAX_LIVE_PER_TEST : 0;
      expect(sum('escaped'), `DemoDB requests that reached the network (the guard's route did not answer them): ${JSON.stringify(summary)}`).toBe(0);
      // Fixture mode refuses what has no fixture (page assets, the OVDB API) and the test goes on; they show in the report.
      // In live mode a refusal means a budget or the breaker stopped a request the test needed: that is a failure.
      if (DEMODB_LIVE) expect(sum('refused'), `DemoDB requests refused by the guard (budget spent): ${JSON.stringify(summary)}`).toBe(0);
      expect(
        sum('live'),
        `live DemoDB requests in this test (budget ${budget}; ${DEMODB_LIVE ? 'live mode' : 'fixture mode must make none'}): ${JSON.stringify(summary)}`,
      ).toBeLessThanOrEqual(budget);
    },
    { auto: true },
  ],
});

export { expect };
