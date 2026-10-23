// Browser cache for files read straight from GitHub, following standard HTTP
// Cache-Control (RFC 9111) directives with the inGitDB `cache_control` reader
// rules (ingitdb-go spec `cache-control`; shared vectors in
// ingitdb/ingitdb `conformance/cache-control/vectors.yaml`).
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

/** The Cache-Control values that apply to one file, besides the origin's response header. */
export interface CacheControlLayers {
  /** inGitDB `cache_control`: the collection's, else the database's (`.ingitdb/settings.yaml`). */
  readonly ingitdb?: string;
  /** The OVDB descriptor's `storage.github.cacheControl`. */
  readonly descriptor?: string;
}

export interface ParsedCacheControl {
  readonly maxAgeSeconds?: number;
  readonly noStore: boolean;
  readonly noCache: boolean;
  readonly immutable: boolean;
}

const DELTA_SECONDS = new Set(['max-age', 's-maxage', 'stale-while-revalidate', 'stale-if-error']);
/** RFC 9111 section 1.2.2: anything larger is treated as 2^31. */
const MAX_DELTA_SECONDS = 2 ** 31;
/** What `immutable` without `max-age` gives a pinned read: one year. */
const IMMUTABLE_TTL_SECONDS = 31_536_000;
/** Freshness assumed when the origin sends no max-age (GitHub's raw CDN uses 300). */
export const DEFAULT_GIT_FILE_TTL_MS = 300_000;
const TOKEN = /^[a-z0-9!#$%&'*+.^_`|~-]+$/;

/** Splits on commas outside quoted strings. */
function splitDirectives(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let escaped = false;
  for (const ch of value) {
    if (escaped) escaped = false;
    else if (inQuote && ch === '\\') escaped = true;
    else if (ch === '"') inQuote = !inQuote;
    else if (ch === ',' && !inQuote) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * A reader's lenient parse, as the inGitDB `cache_control` spec and its shared
 * conformance vectors require: names are case-insensitive, a malformed directive
 * is dropped, the first of a repeated directive wins, a flag given an argument
 * still counts, quoted `max-age="60"` is accepted, delta-seconds above 2^31 are
 * clamped, unknown directives are ignored. Never throws.
 */
export function parseCacheControl(value: string | null | undefined): ParsedCacheControl | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const directives = new Map<string, string>();
  for (const part of splitDirectives(value)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const name = (eq === -1 ? trimmed : trimmed.slice(0, eq)).trim().toLowerCase();
    let arg = eq === -1 ? '' : trimmed.slice(eq + 1).trim();
    if (arg.startsWith('"')) {
      if (arg.length < 2 || !arg.endsWith('"')) continue;
      arg = arg.slice(1, -1).replace(/\\(.)/g, '$1');
    }
    if (!TOKEN.test(name) || directives.has(name)) continue;
    if (DELTA_SECONDS.has(name)) {
      if (!/^\d+$/.test(arg)) continue;
      arg = String(Math.min(Number(arg), MAX_DELTA_SECONDS));
    }
    directives.set(name, arg);
  }
  if (!directives.size) return undefined;
  const maxAge = directives.get('max-age');
  return {
    ...(maxAge === undefined ? {} : { maxAgeSeconds: Number(maxAge) }),
    noStore: directives.has('no-store'),
    noCache: directives.has('no-cache'),
    immutable: directives.has('immutable'),
  };
}

/**
 * Reuse time in milliseconds (0: do not store or reuse), the inGitDB freshness
 * rule: unpinned, the declared value may only tighten the origin's; pinned, its
 * max-age (or `immutable` alone: one year) may relax it; `no-store` and
 * `no-cache` on either side win; an origin without max-age counts as `defaultMs`.
 */
export function freshnessTtlMs(declared: string | undefined, pinned: boolean,
  origin: string | null | undefined, defaultMs = DEFAULT_GIT_FILE_TTL_MS): number {
  const d = parseCacheControl(declared);
  const o = parseCacheControl(origin);
  if (d?.noStore || d?.noCache || o?.noStore || o?.noCache) return 0;
  const originMs = o?.maxAgeSeconds === undefined ? defaultMs : o.maxAgeSeconds * 1000;
  const declaredMs = d?.maxAgeSeconds === undefined ? undefined : d.maxAgeSeconds * 1000;
  if (pinned && declaredMs !== undefined) return declaredMs;
  if (pinned && d?.immutable) return IMMUTABLE_TTL_SECONDS * 1000;
  return declaredMs !== undefined && declaredMs < originMs ? declaredMs : originMs;
}

/**
 * The effective policy for one fetched file. The declared value is inGitDB's
 * (the collection's, which replaces the database's whole), else the OVDB
 * descriptor's; with both, the descriptor can only tighten. It applies to data
 * files only; metadata files follow the origin.
 */
export function gitFilePolicy(originCacheControl: string | null | undefined,
  layers: CacheControlLayers, pinned: boolean, dataFile = true): GitFilePolicy {
  const declared = dataFile ? layers.ingitdb ?? layers.descriptor : undefined;
  let ttlMs = freshnessTtlMs(declared, pinned, originCacheControl);
  const noStore = (value?: string | null) => !!parseCacheControl(value)?.noStore;
  let storable = !noStore(originCacheControl) && !(dataFile && (noStore(layers.ingitdb) || noStore(layers.descriptor)));
  if (dataFile && layers.ingitdb && layers.descriptor) {
    // The descriptor only tightens an inGitDB value: evaluated as unpinned against it.
    ttlMs = Math.min(ttlMs, freshnessTtlMs(layers.descriptor, false, `max-age=${Math.floor(ttlMs / 1000)}`));
  }
  if (ttlMs <= 0) storable = false;
  return { storable, ttlMs };
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
