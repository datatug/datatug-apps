// Browser cache for files read straight from GitHub, following standard HTTP
// Cache-Control (RFC 9111) semantics as evaluated by `http-cache-semantics`.
//
// The policy for a data file combines inGitDB's `cache_control`, the OVDB
// descriptor's `cacheControl` and the origin's header (raw.githubusercontent.com
// sends `max-age=300`); see gitFilePolicy for the precedence. A read pinned to
// a commit SHA may keep data for the declared lifetime, e.g.
// `public, max-age=31536000, immutable`.
// A fresh entry is used with no request. Past its lifetime (or under
// `no-cache`), the file is fetched again with `cache: 'no-cache'`, so the
// browser revalidates with GitHub's ETag (If-None-Match) itself; JavaScript
// cannot send If-None-Match because GitHub refuses the CORS preflight.
// Unknown directives are ignored. The cache is a convenience, never a
// dependency: when storage is missing, blocked or full, files are fetched as if
// there were no cache.
import CachePolicy from 'http-cache-semantics';

export interface CachedGitFile {
  readonly text: string;
  /** Epoch milliseconds when the file was stored. */
  readonly storedAt: number;
  /** How long the entry is fresh, in milliseconds. */
  readonly ttlMs: number;
}

export interface GitFileCache {
  get(url: string): Promise<CachedGitFile | undefined>;
  put(url: string, text: string, ttlMs: number): Promise<void>;
}

export interface GitFilePolicy {
  readonly storable: boolean;
  readonly ttlMs: number;
}

/**
 * One year: what `immutable` without `max-age` gives a pinned read (inGitDB
 * cache-control spec). http-cache-semantics 4.2.0 compares this option with
 * seconds in maxAge(), despite documenting milliseconds, so it is given in seconds.
 */
const IMMUTABLE_TTL_SECONDS = 31536000;

function evaluate(url: string, cacheControl: string | null | undefined, immutableSeconds = 0): GitFilePolicy {
  const policy = new CachePolicy(
    { url, method: 'GET', headers: {} },
    { status: 200, headers: cacheControl ? { 'cache-control': cacheControl } : {} },
    // A private browser cache with no heuristic lifetime; `immutable` counts only where the caller allows it.
    { shared: false, cacheHeuristic: 0, immutableMinTimeToLive: immutableSeconds },
  );
  return { storable: policy.storable(), ttlMs: Math.max(0, policy.timeToLive()) };
}

/** The Cache-Control values that apply to one file, besides the origin's response header. */
export interface CacheControlLayers {
  /** inGitDB `cache_control`: the collection's value, else the database's (`.ingitdb/settings.yaml`). */
  readonly ingitdb?: string;
  /** The OVDB descriptor's `storage.github.cacheControl`. */
  readonly descriptor?: string;
}

function tighten(a: GitFilePolicy, b: GitFilePolicy): GitFilePolicy {
  return { storable: a.storable && b.storable, ttlMs: Math.min(a.ttlMs, b.ttlMs) };
}

/** True when the value carries `no-cache` (http-cache-semantics then reports no lifetime). */
function hasNoCache(url: string, cacheControl: string | null | undefined): boolean {
  if (!cacheControl) return false;
  const probe = evaluate(url, `${cacheControl}, max-age=1`);
  return probe.storable && probe.ttlMs === 0;
}

/**
 * The effective policy for one fetched file, matching inGitDB's `cache_control`
 * rules (ingitdb-go spec `cache-control`):
 * - the declared value is inGitDB's (the collection's, which replaces the
 *   database's whole), else the OVDB descriptor's; with both, the descriptor
 *   can only tighten. Directives are never merged across levels;
 * - it applies to data files only; metadata files follow the origin;
 * - unpinned: it may only tighten the origin (max-age capped, `immutable` ignored);
 * - pinned to a full commit SHA: its max-age and `immutable` may relax the origin
 *   (`immutable` without `max-age` gives one year);
 * - `no-store` and `no-cache` from any applicable layer always win;
 * - unknown or malformed directives are ignored.
 */
export function gitFilePolicy(url: string, originCacheControl: string | null | undefined,
  layers: CacheControlLayers, pinned: boolean, dataFile = true): GitFilePolicy {
  const origin = evaluate(url, originCacheControl);
  const declaredValue = layers.ingitdb ?? layers.descriptor;
  if (!dataFile || !declaredValue) return origin;
  const immutableSeconds = pinned ? IMMUTABLE_TTL_SECONDS : 0;
  let declared = evaluate(url, declaredValue, immutableSeconds);
  if (layers.ingitdb && layers.descriptor) declared = tighten(declared, evaluate(url, layers.descriptor, immutableSeconds));
  if (!pinned) return tighten(origin, declared);
  return {
    storable: declared.storable && origin.storable,
    ttlMs: hasNoCache(url, originCacheControl) ? 0 : declared.ttlMs,
  };
}

const CACHE_NAME = 'datatug-ingitdb-github-v1';
const STORED_AT = 'x-datatug-stored-at';
const TTL = 'x-datatug-ttl-ms';

/** The Cache API store, keyed by the exact file URL (repository, revision and path). */
export function browserGitFileCache(now: () => number = Date.now): GitFileCache {
  const open = async (): Promise<Cache | undefined> => {
    try {
      return typeof caches === 'undefined' ? undefined : await caches.open(CACHE_NAME);
    } catch {
      return undefined;
    }
  };
  return {
    async get(url) {
      try {
        const response = await (await open())?.match(url);
        if (!response) return undefined;
        const storedAt = Number(response.headers.get(STORED_AT));
        const ttlMs = Number(response.headers.get(TTL));
        if (!Number.isFinite(storedAt) || !Number.isFinite(ttlMs)) return undefined;
        return { text: await response.text(), storedAt, ttlMs };
      } catch {
        return undefined;
      }
    },
    async put(url, text, ttlMs) {
      try {
        await (await open())?.put(url, new Response(text, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', [STORED_AT]: String(now()), [TTL]: String(ttlMs) },
        }));
      } catch {
        /* Quota exceeded or storage blocked: the next run fetches again. */
      }
    },
  };
}
