import {
  bumpLiveRun,
  isRateLimited,
  liveRunCount,
  memoGet,
  memoSet,
  rateLimitMessage,
  readBreaker,
  type Stored,
  tripBreaker,
} from './demodb-guard-state';

/**
 * The decision logic of the DemoDB guard, free of Playwright so it can be unit tested (demodb-guard-logic.unit.ts).
 * `resolveRequest` answers one request to a DemoDB / OpenVaultDB host under the rules in demodb-guard.ts.
 */

export type Kind = 'total' | 'handled' | 'fixture' | 'memo' | 'live' | 'refused' | 'escaped';

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
   * Requests that reached the NETWORK instead of being answered locally: a response from a real server address, a failed name
   * lookup / connection, or a refusal by the dev server's public OVDB proxy. A request that another route (a spec's own
   * `context.route`) fulfilled never counts: it did not leave the machine.
   */
  escaped: number;
}

export class Counter {
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

export interface Rules {
  /** DEMODB_E2E_MODE=live */
  readonly live: boolean;
  readonly maxLivePerTest: number;
  readonly maxLivePerRun: number;
  readonly memoLimitBytes: number;
  /** The local answer for a URL (fixture mode), or undefined. */
  fixture(url: URL, method: string): Stored | undefined;
  /** Why a fixture-mode request without a fixture is refused. */
  refusal(url: URL): string;
}

export async function resolveRequest(
  rules: Rules,
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
  if (!rules.live) {
    const hit = rules.fixture(url, method);
    if (hit) {
      counter.bump(url.hostname, 'fixture');
      return hit;
    }
    return refuse(rules.refusal(url));
  }
  const key = `${method} ${url.href}`;
  const cached = hasRange ? undefined : memoGet(key);
  if (cached) {
    counter.bump(url.hostname, 'memo');
    return cached;
  }
  // Budgets are enforced BEFORE a request is sent. Every live request spends budget, a retry by the app included.
  if (counter.sum('live') >= rules.maxLivePerTest) {
    return refuse(`Refused ${url.href}: this test has spent its live budget of ${rules.maxLivePerTest} requests to the DemoDB hosts (DEMODB_E2E_MAX_LIVE_REQUESTS).`);
  }
  if (liveRunCount() >= rules.maxLivePerRun) {
    return refuse(`Refused ${url.href}: the run has spent its live budget of ${rules.maxLivePerRun} requests to the DemoDB hosts (DEMODB_E2E_MAX_RUN_LIVE_REQUESTS).`);
  }
  // Counted before sending, so a request that throws or hangs still spends budget.
  bumpLiveRun();
  counter.bump(url.hostname, 'live');
  const response = await live();
  const blocked = isRateLimited(response.status, response.headers, response.status === 200 ? '' : response.body.subarray(0, 4096).toString('utf8'));
  if (blocked) return { abort: tripBreaker(rateLimitMessage(url.href, response.status, response.headers['retry-after'])) };
  if (response.status === 200 && !hasRange && response.body.length <= rules.memoLimitBytes) memoSet(key, response);
  return response;
}
