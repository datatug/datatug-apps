import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { bumpLiveRun, isRateLimited, liveRunCount, memoGet, memoSet, rateLimitMessage, readBreaker, resetState, tripBreaker } from './demodb-guard-state.ts';

const dir = mkdtempSync(join(tmpdir(), 'demodb-guard-test-'));
process.env['DEMODB_GUARD_STATE_DIR'] = dir;

/** Runs a snippet in a NEW node process (a restarted Playwright worker) against the same state directory. */
const inFreshProcess = (code: string): string =>
  execFileSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--input-type=module', '-e', code], {
    env: { ...process.env, DEMODB_GUARD_STATE_DIR: dir },
    cwd: import.meta.dirname,
  }).toString();

test('the 429 breaker survives a worker restart', () => {
  resetState();
  assert.equal(readBreaker(), undefined);
  tripBreaker(rateLimitMessage('https://chinook.demodb.dev/data/chinook.sqlite', 429, '60'));
  assert.match(inFreshProcess("import {readBreaker} from './demodb-guard-state.ts'; console.log(readBreaker())"), /HTTP 429 from https:\/\/chinook\.demodb\.dev/);
  // the first message wins
  tripBreaker('second');
  assert.match(readBreaker() ?? '', /^HTTP 429/);
});

test('the live memo and the run-wide live counter survive a worker restart', () => {
  resetState();
  memoSet('GET https://demodb.dev/corpus.json', { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"a":1}') });
  bumpLiveRun();
  bumpLiveRun();
  const out = inFreshProcess(
    "import {memoGet, liveRunCount} from './demodb-guard-state.ts'; console.log(memoGet('GET https://demodb.dev/corpus.json').body.toString(), liveRunCount())",
  );
  assert.equal(out.trim(), '{"a":1} 2');
  assert.equal(liveRunCount(), 2);
  assert.equal(memoGet('GET https://nope'), undefined);
});

test('rate limits are recognised: 429, and Cloudflare block pages on 403/503', () => {
  assert.equal(isRateLimited(429, {}), true);
  assert.equal(isRateLimited(200, {}), false);
  assert.equal(isRateLimited(404, {}), false);
  assert.equal(isRateLimited(403, { 'cf-mitigated': 'challenge' }), true);
  assert.equal(isRateLimited(403, { server: 'cloudflare' }, '<title>Error 1027</title> You are being rate limited'), true);
  assert.equal(isRateLimited(503, { server: 'cloudflare' }, '<h1>Error 1015</h1> rate limited'), true);
  for (const status of [520, 522, 525, 530]) assert.equal(isRateLimited(status, { 'cf-mitigated': 'block' }), true, `HTTP ${status}`);
  assert.equal(isRateLimited(522, { server: 'cloudflare' }, 'Error 1015 You are being rate limited'), true);
  assert.equal(isRateLimited(503, {}, 'database_unavailable'), false);
  assert.equal(isRateLimited(403, { server: 'nginx' }, 'forbidden'), false);
});
