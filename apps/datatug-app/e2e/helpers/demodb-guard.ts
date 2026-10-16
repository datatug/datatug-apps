import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APIRequestContext, BrowserContext, expect, Route, test as base, TestInfo } from '@playwright/test';

/**
 * Keeps the e2e suites off the live DemoDB hosts (demodb.dev and *.demodb.dev).
 *
 * Why: on 2026-10-16 about 25,500 CI requests for chinook.demodb.dev/data/chinook.sqlite got the whole demodb.dev
 * Cloudflare zone rate limited (HTTP 429 for every DemoDB site). Every Playwright test opens a fresh browser context,
 * so every test downloaded the file again, in three browsers, plus retries.
 *
 * Two modes, picked by DEMODB_E2E_MODE:
 *
 *  - `fixture` (default): every demodb.dev request is answered from DEMODB_FIXTURE_DIR (default <repo>/tmp/demodb-fixtures,
 *    filled by scripts/fetch-demodb-fixtures.mjs: SHA-256 verified, at most one request per file, none when warm).
 *    Nothing reaches the network; a demodb.dev URL without a fixture is aborted. Live requests budget: 0.
 *  - `live` (opt-in, the manual "DemoDB live smoke" workflow): requests go to the real hosts, but each URL at most once
 *    per run (later requests are answered from memory), at most DEMODB_E2E_MAX_LIVE_REQUESTS (default 15) live
 *    requests per test and DEMODB_E2E_MAX_RUN_LIVE_REQUESTS (default 120) per run. No retries.
 *
 * In both modes HTTP 429 from a demodb host trips a breaker: every later demodb request in the process is refused and
 * the test fails with a message naming the URL. The config also sets maxFailures 1 so the run stops.
 *
 * Every test records its per-host request counts (`demodb-requests` annotation); demodb-request-reporter.ts prints
 * them at the end of the run.
 */

export const DEMODB_HOST = /(^|\.)demodb\.dev$/;
export const DEMODB_LIVE = process.env['DEMODB_E2E_MODE'] === 'live';
const MAX_LIVE_PER_TEST = Number(process.env['DEMODB_E2E_MAX_LIVE_REQUESTS'] || 15);
const MEMO_LIMIT_BYTES = 16 * 1024 * 1024;

export const fixtureDir = (): string =>
  resolve(process.env['DEMODB_FIXTURE_DIR'] || join(__dirname, '../../../../tmp/demodb-fixtures'));

export interface HostCounts {
  /** Requests the page/worker/test asked for. */
  total: number;
  /** Of those, answered from the fixture directory. */
  fixture: number;
  /** Of those, answered from memory (a URL already fetched live in this run). */
  memo: number;
  /** Of those, sent to the real host. */
  live: number;
}

interface Stored {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** Process-wide (one Playwright worker): the live memo and the 429 breaker. */
const memo = new Map<string, Stored>();
let rateLimited: string | undefined;

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' };

function fixtureFile(url: URL): { path: string; contentType: string } | undefined {
  const dir = fixtureDir();
  const sub = url.hostname.replace(/\.?demodb\.dev$/, '');
  if (url.hostname === 'demodb.dev' && url.pathname === '/corpus.json') {
    return { path: join(dir, 'corpus.json'), contentType: 'application/json' };
  }
  const data = /^\/data\/([a-z0-9-]+)\.sqlite$/.exec(url.pathname);
  if (sub && data && data[1] === sub) {
    return { path: join(dir, 'data', `${sub}.sqlite`), contentType: 'application/vnd.sqlite3' };
  }
  if (sub && (url.pathname === '/' || url.pathname === '/index.html')) {
    return { path: join(dir, 'pages', `${sub}.html`), contentType: 'text/html; charset=utf-8' };
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

const unfixtured = (url: string): string =>
  `No local fixture for ${url}. Run \`node scripts/fetch-demodb-fixtures.mjs\` (add --include-large for AdventureWorks), ` +
  'or set DEMODB_E2E_MODE=live for the opt-in live smoke.';

function tripBreaker(url: string, retryAfter?: string): string {
  rateLimited ??=
    `HTTP 429 from ${url}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}: the demodb.dev zone is rate limiting this ` +
    'client. All further demodb.dev requests are refused and the run should stop. Do not retry; wait for the limit to clear.';
  return rateLimited;
}

export interface DemodbGuard {
  /** Per-host counts for the current test. */
  readonly counts: ReadonlyMap<string, HostCounts>;
  /** GET a demodb URL for a test that talks to the host directly (the `request` fixture), under the same rules. */
  get(request: APIRequestContext, url: string): Promise<{ status: number; headers: Record<string, string>; body: Buffer }>;
  /** HEAD a demodb URL, under the same rules. */
  head(request: APIRequestContext, url: string): Promise<{ status: number; headers: Record<string, string> }>;
}

function counter(): { counts: Map<string, HostCounts>; bump: (host: string, kind: keyof HostCounts) => void } {
  const counts = new Map<string, HostCounts>();
  return {
    counts,
    bump(host, kind) {
      const entry = counts.get(host) ?? { total: 0, fixture: 0, memo: 0, live: 0 };
      entry[kind] += 1;
      counts.set(host, entry);
    },
  };
}

/** Answers one demodb request under the mode's rules. `live` is how to reach the real host. */
async function resolveRequest(
  url: URL,
  method: string,
  hasRange: boolean,
  bump: (host: string, kind: keyof HostCounts) => void,
  live: () => Promise<Stored>,
): Promise<Stored | { abort: string }> {
  if (rateLimited) return { abort: rateLimited };
  if (!DEMODB_LIVE) {
    const hit = fromFixture(url, method);
    if (hit) {
      bump(url.hostname, 'fixture');
      return hit;
    }
    return { abort: unfixtured(url.href) };
  }
  const key = `${method} ${url.href}`;
  const cached = memo.get(key);
  if (cached && !hasRange) {
    bump(url.hostname, 'memo');
    return cached;
  }
  bump(url.hostname, 'live');
  const response = await live();
  if (response.status === 429) return { abort: tripBreaker(url.href, response.headers['retry-after']) };
  if (response.status === 200 && !hasRange && response.body.length <= MEMO_LIMIT_BYTES) memo.set(key, response);
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

async function installRoute(
  context: BrowserContext,
  bump: (host: string, kind: keyof HostCounts) => void,
): Promise<void> {
  context.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (DEMODB_HOST.test(host)) bump(host, 'total');
  });
  await context.route(
    (url) => DEMODB_HOST.test(url.hostname),
    async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS' },
        });
      }
      const result = await resolveRequest(
        url,
        request.method(),
        'range' in request.headers(),
        bump,
        async () => {
          const response = await route.fetch();
          return {
            status: response.status(),
            headers: dropEncoding(response.headers()),
            body: await response.body(),
          };
        },
      );
      if ('abort' in result) {
        console.error(`[demodb-guard] ${result.abort}`);
        return route.abort();
      }
      return route.fulfill({ status: result.status, headers: result.headers, body: result.body });
    },
  );
}

function summarise(counts: ReadonlyMap<string, HostCounts>): Record<string, HostCounts> {
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export const test = base.extend<{ demodbGuard: DemodbGuard }>({
  demodbGuard: [
    async ({ context }, use, testInfo: TestInfo) => {
      const { counts, bump } = counter();
      await installRoute(context, bump);
      const guard: DemodbGuard = {
        counts,
        async get(request, href) {
          const url = new URL(href);
          bump(url.hostname, 'total');
          const result = await resolveRequest(url, 'GET', false, bump, async () => {
            const response = await request.get(href, { maxRedirects: 0, failOnStatusCode: false });
            return { status: response.status(), headers: response.headers(), body: await response.body() };
          });
          if ('abort' in result) throw new Error(result.abort);
          return result;
        },
        async head(request, href) {
          const url = new URL(href);
          bump(url.hostname, 'total');
          const result = await resolveRequest(url, 'HEAD', false, bump, async () => {
            const response = await request.head(href, { maxRedirects: 0, failOnStatusCode: false });
            return { status: response.status(), headers: response.headers(), body: Buffer.alloc(0) };
          });
          if ('abort' in result) throw new Error(result.abort);
          return result;
        },
      };
      await use(guard);

      const summary = summarise(counts);
      testInfo.annotations.push({ type: 'demodb-requests', description: JSON.stringify({ mode: DEMODB_LIVE ? 'live' : 'fixture', hosts: summary }) });
      if (rateLimited) throw new Error(rateLimited);
      const live = Object.values(summary).reduce((sum, host) => sum + host.live, 0);
      const budget = DEMODB_LIVE ? MAX_LIVE_PER_TEST : 0;
      expect(
        live,
        `live demodb.dev requests in this test (budget ${budget}; ${DEMODB_LIVE ? 'live mode' : 'fixture mode must make none'}): ${JSON.stringify(summary)}`,
      ).toBeLessThanOrEqual(budget);
    },
    { auto: true },
  ],
});

export { expect };
