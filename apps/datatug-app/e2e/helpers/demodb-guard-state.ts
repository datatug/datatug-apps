import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * State of the DemoDB guard that must outlive one Playwright worker process: Playwright starts a fresh worker after a
 * failed test, and a fresh worker must not forget that the host answered 429, which URLs were already fetched live,
 * or how many live requests the run has spent. Plain files in a per-run directory (DEMODB_GUARD_STATE_DIR, or
 * <tmp>/demodb-guard-<DEMODB_RUN_ID or the runner's pid>); no Playwright imports, unit tested in demodb-guard-state.test.ts.
 */

export interface Stored {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export function stateDir(): string {
  const dir = process.env['DEMODB_GUARD_STATE_DIR'] || join(tmpdir(), `demodb-guard-${process.env['DEMODB_RUN_ID'] || process.ppid}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Forgets everything (the start of a run). */
export function resetState(): void {
  rmSync(stateDir(), { recursive: true, force: true });
}

const breakerFile = (): string => join(stateDir(), 'breaker.txt');

/** The rate-limit message, once any process of this run has seen the host rate limit us. */
export function readBreaker(): string | undefined {
  return existsSync(breakerFile()) ? readFileSync(breakerFile(), 'utf8') : undefined;
}

/** Trips the breaker for the whole run. The first message wins. */
export function tripBreaker(message: string): string {
  try {
    writeFileSync(breakerFile(), message, { flag: 'wx' });
  } catch {
    // another process tripped it first
  }
  return readBreaker() ?? message;
}

/** The message for a rate-limit response from `url`. */
export function rateLimitMessage(url: string, status: number, retryAfter?: string): string {
  return (
    `HTTP ${status} from ${url}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}: the host is rate limiting or blocking this client. ` +
    'All further requests to the DemoDB hosts are refused in every worker of this run, nothing is retried. Wait for the limit to clear.'
  );
}

/**
 * Whether a response means "the zone is rate limiting / blocking us": HTTP 429, or a Cloudflare block (403/503/52x with
 * a cf-mitigated header, or a Cloudflare error page for 1015/1020/1027 or a rate-limit text).
 */
export function isRateLimited(status: number, headers: Record<string, string>, bodyText = ''): boolean {
  if (status === 429) return true;
  if (![403, 503, 520, 521, 522, 523, 524, 525, 526, 527, 530].includes(status)) return false;
  if (headers['cf-mitigated']) return true;
  const cloudflare = /cloudflare/i.test(headers['server'] ?? '') || /cloudflare/i.test(bodyText);
  return cloudflare && /error\s*(1015|1020|1027|1006|1007|1008)|rate.?limit|banned|blocked/i.test(bodyText);
}

const memoFile = (key: string): string => join(stateDir(), `memo-${createHash('sha1').update(key).digest('hex')}.json`);

export function memoGet(key: string): Stored | undefined {
  const file = memoFile(key);
  if (!existsSync(file)) return undefined;
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { status: number; headers: Record<string, string>; body: string };
  return { status: parsed.status, headers: parsed.headers, body: Buffer.from(parsed.body, 'base64') };
}

export function memoSet(key: string, stored: Stored): void {
  writeFileSync(memoFile(key), JSON.stringify({ status: stored.status, headers: stored.headers, body: stored.body.toString('base64') }));
}

const liveFile = (): string => join(stateDir(), 'live.count');

/** Live requests the whole run (all workers) has sent so far. */
export function liveRunCount(): number {
  return existsSync(liveFile()) ? statSync(liveFile()).size : 0;
}

export function bumpLiveRun(): void {
  appendFileSync(liveFile(), '.');
}
