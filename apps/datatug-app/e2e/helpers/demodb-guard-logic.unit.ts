import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { Counter, resolveRequest, type Rules } from './demodb-guard-logic.ts';
import { bumpLiveRun, liveRunCount, readBreaker, resetState, type Stored, tripBreaker } from './demodb-guard-state.ts';

process.env['DEMODB_GUARD_STATE_DIR'] = mkdtempSync(join(tmpdir(), 'demodb-guard-logic-'));

const ok = (body = 'x'): Stored => ({ status: 200, headers: {}, body: Buffer.from(body) });
const url = new URL('https://chinook.demodb.dev/data/chinook.sqlite');

const liveRules = (over: Partial<Rules> = {}): Rules => ({
  live: true,
  maxLivePerTest: 2,
  maxLivePerRun: 4,
  memoLimitBytes: 1024,
  fixture: () => undefined,
  refusal: (u) => `no fixture for ${u.href}`,
  ...over,
});
const fixtureRules = (hit?: Stored): Rules => liveRules({ live: false, fixture: () => hit });

beforeEach(() => resetState());

/** A live function that records how often it is called. */
function spy(answer: () => Promise<Stored>) {
  const state = { calls: 0 };
  return { state, live: async () => { state.calls += 1; return answer(); } };
}

test('fixture mode: a fixture answers, anything else is refused, and nothing is ever sent', async () => {
  const counter = new Counter();
  const s = spy(async () => ok());
  assert.deepEqual(await resolveRequest(fixtureRules(ok('f')), url, 'GET', false, counter, s.live), ok('f'));
  const refused = await resolveRequest(fixtureRules(undefined), url, 'GET', false, counter, s.live);
  assert.match((refused as { abort: string }).abort, /no fixture/);
  assert.equal(s.state.calls, 0);
  assert.equal(counter.sum('fixture'), 1);
  assert.equal(counter.sum('refused'), 1);
  assert.equal(counter.sum('live'), 0);
});

test('a tripped breaker refuses everything first, even a request a fixture or a live call could answer', async () => {
  tripBreaker('HTTP 429 from somewhere');
  for (const rules of [fixtureRules(ok('f')), liveRules()]) {
    const counter = new Counter();
    const s = spy(async () => ok());
    const result = await resolveRequest(rules, url, 'GET', false, counter, s.live);
    assert.deepEqual(result, { abort: 'HTTP 429 from somewhere' });
    assert.equal(s.state.calls, 0, 'nothing is sent while the breaker is tripped');
    assert.equal(counter.sum('refused'), 1);
  }
});

test('live mode: the per-test budget refuses BEFORE sending', async () => {
  const counter = new Counter();
  const s = spy(async () => ok());
  await resolveRequest(liveRules(), new URL('https://demodb.dev/a'), 'GET', false, counter, s.live);
  await resolveRequest(liveRules(), new URL('https://demodb.dev/b'), 'GET', false, counter, s.live);
  assert.equal(s.state.calls, 2);
  const third = await resolveRequest(liveRules(), new URL('https://demodb.dev/c'), 'GET', false, counter, s.live);
  assert.match((third as { abort: string }).abort, /this test has spent its live budget of 2/);
  assert.equal(s.state.calls, 2, 'the third request was never sent');
});

test('live mode: the run budget (shared by all tests and workers) refuses BEFORE sending, and only once it is spent', async () => {
  const s = spy(async () => ok());
  // Three live requests already sent by other tests/workers: one left.
  bumpLiveRun(); bumpLiveRun(); bumpLiveRun();
  const first = await resolveRequest(liveRules({ maxLivePerTest: 99 }), new URL('https://demodb.dev/a'), 'GET', false, new Counter(), s.live);
  assert.ok(!('abort' in first), 'one request of budget is left, so it is sent');
  assert.equal(liveRunCount(), 4);
  const second = await resolveRequest(liveRules({ maxLivePerTest: 99 }), new URL('https://demodb.dev/b'), 'GET', false, new Counter(), s.live);
  assert.match((second as { abort: string }).abort, /the run has spent its live budget of 4/);
  assert.equal(s.state.calls, 1);
});

test('live mode: a request is counted before it is sent, so one that throws still spends budget', async () => {
  const counter = new Counter();
  const failing = spy(async () => { throw new Error('socket hang up'); });
  await assert.rejects(resolveRequest(liveRules(), url, 'GET', false, counter, failing.live), /socket hang up/);
  assert.equal(counter.sum('live'), 1);
  assert.equal(liveRunCount(), 1);
});

test('live mode: a repeated URL is answered from the memo, not sent again', async () => {
  const counter = new Counter();
  const s = spy(async () => ok('body'));
  await resolveRequest(liveRules(), url, 'GET', false, counter, s.live);
  const again = await resolveRequest(liveRules(), url, 'GET', false, counter, s.live);
  assert.equal((again as Stored).body.toString(), 'body');
  assert.equal(s.state.calls, 1);
  assert.equal(counter.sum('memo'), 1);
});

test('live mode: HTTP 429 trips the breaker for the whole run and the answer is not forwarded', async () => {
  const counter = new Counter();
  const s = spy(async () => ({ status: 429, headers: { 'retry-after': '60' }, body: Buffer.from('slow down') }));
  const result = await resolveRequest(liveRules(), url, 'GET', false, counter, s.live);
  assert.match((result as { abort: string }).abort, /HTTP 429 from https:\/\/chinook\.demodb\.dev/);
  assert.match(readBreaker() ?? '', /HTTP 429/);
});

test('live mode: Cloudflare 52x block pages trip the breaker too', async () => {
  for (const status of [520, 522, 525, 530]) {
    resetState();
    const s = spy(async () => ({ status, headers: { server: 'cloudflare', 'cf-mitigated': 'block' }, body: Buffer.from('<h1>Error 1020</h1> Access denied') }));
    const result = await resolveRequest(liveRules(), url, 'GET', false, new Counter(), s.live);
    assert.ok('abort' in result, `HTTP ${status} must not be treated as an ordinary answer`);
    assert.ok(readBreaker(), `HTTP ${status} must trip the breaker`);
  }
});

test('live mode: an ordinary 503 (a database mounting) does not trip the breaker', async () => {
  const s = spy(async () => ({ status: 503, headers: {}, body: Buffer.from('{"error":"database_unavailable"}') }));
  const result = await resolveRequest(liveRules(), url, 'GET', false, new Counter(), s.live);
  assert.ok(!('abort' in result));
  assert.equal(readBreaker(), undefined);
});
