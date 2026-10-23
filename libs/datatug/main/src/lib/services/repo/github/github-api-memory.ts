// What the reader remembers about its `api.github.com` calls between page loads, to spend fewer of them:
//
// 1. The anonymous limit. GitHub allows 60 anonymous API calls an hour per address. Once it has refused one (`403` or
//    `429`), every further anonymous call before the limit resets is refused too, and only delays the page. The time
//    GitHub names (`X-RateLimit-Reset`) is remembered for the browser (`localStorage`: the limit is per address, so
//    it is shared by every tab), and no anonymous call is made before it; the reader answers as GitHub would have.
// 2. Conditional requests. A call made with the signed-in user's token is kept with its `ETag` and asked again with
//    `If-None-Match`: a `304` answer then costs nothing (GitHub docs, "Best practices for using the REST API": a
//    conditional request that returns `304` does not count against the primary rate limit when made with an
//    `Authorization` header). Anonymous calls are NOT made conditional: measured 2026-10-23, an anonymous `304` is
//    counted like a `200` (`X-RateLimit-Used` went up by one per `304`), and the `If-None-Match` header would add a
//    CORS preflight to every call. Kept in `sessionStorage` beside the token itself (same tab, same lifetime) and
//    dropped at sign-out.
//
// Storage that is blocked, full or missing (a private window, a strict browser) means memory for this page only:
// never a failed read.

import { InjectionToken } from '@angular/core';

/** One `api.github.com` answer kept for a conditional request. */
export interface IGithubConditionalEntry {
  readonly etag: string;
  readonly text: string;
  readonly bytes: number;
}

export interface IGithubApiMemory {
  /** Until when (ms since the epoch) GitHub refuses anonymous calls from this browser; `0` when it does not. */
  anonymousLimitedUntil(): number;
  /** GitHub refused an anonymous call: no anonymous call is made before `until`. */
  noteAnonymousLimit(until: number): void;
  /** The answer kept for `key` (`<identity>|<accept>|<url>`), if any. */
  getConditional(key: string): IGithubConditionalEntry | undefined;
  putConditional(key: string, entry: IGithubConditionalEntry): void;
  /** Drops the answers kept for `identity`, or for every signed-in identity when it is not given. */
  dropConditional(identity?: string): void;
}

/** Where the anonymous limit is kept (`localStorage`). */
export const GITHUB_ANON_LIMIT_STORAGE_KEY =
  'datatug:github:anon-limited-until';
/** The prefix of the conditional answers kept (`sessionStorage`). */
export const GITHUB_CONDITIONAL_STORAGE_PREFIX = 'datatug:github:etag:';
/** The most answers kept; the oldest goes first. */
export const MAX_CONDITIONAL_ENTRIES = 16;
/** The largest answer kept, in bytes of text: a listing of a big repository is not worth the tab's storage. */
export const MAX_CONDITIONAL_ENTRY_BYTES = 1024 * 1024;
/** The longest wait trusted from one refusal, whatever GitHub says: the anonymous window is one hour. */
export const MAX_ANON_LIMIT_MS = 60 * 60 * 1000;
/** The wait after a refusal that names no reset time (a secondary limit without `Retry-After`). */
export const DEFAULT_ANON_LIMIT_MS = 60 * 1000;

type StorageGetter = () => Storage | undefined;

const defaultLocal: StorageGetter = () => globalThis.localStorage;
const defaultSession: StorageGetter = () => globalThis.sessionStorage;

function safely<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

/**
 * The memory over `localStorage` (the limit) and `sessionStorage` (the conditional answers), with an in-page copy that
 * still works when either is blocked. `now` is injected so a test controls the clock.
 */
export function createGithubApiMemory(
  local: StorageGetter = defaultLocal,
  session: StorageGetter = defaultSession,
  now: () => number = () => Date.now(),
): IGithubApiMemory {
  let limitedUntil = 0;
  const entries = new Map<string, IGithubConditionalEntry>();

  const storedKeys = (): string[] =>
    safely(() => {
      const store = session();
      if (!store) return [];
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key?.startsWith(GITHUB_CONDITIONAL_STORAGE_PREFIX)) keys.push(key);
      }
      return keys;
    }, []);

  return {
    anonymousLimitedUntil(): number {
      const stored = safely(
        () => Number(local()?.getItem(GITHUB_ANON_LIMIT_STORAGE_KEY) ?? 0),
        0,
      );
      const until = Math.max(
        limitedUntil,
        Number.isFinite(stored) ? stored : 0,
      );
      // Never trusted further ahead than one window: a clock moved back, or a bad value, does not lock reads out.
      return until > now() && until <= now() + MAX_ANON_LIMIT_MS ? until : 0;
    },
    noteAnonymousLimit(until: number): void {
      limitedUntil = Math.min(until, now() + MAX_ANON_LIMIT_MS);
      safely(
        () =>
          local()?.setItem(GITHUB_ANON_LIMIT_STORAGE_KEY, String(limitedUntil)),
        undefined,
      );
    },
    getConditional(key: string): IGithubConditionalEntry | undefined {
      const kept = entries.get(key);
      if (kept) return kept;
      const stored = safely(
        () =>
          session()?.getItem(GITHUB_CONDITIONAL_STORAGE_PREFIX + key) ??
          undefined,
        undefined,
      );
      if (!stored) return undefined;
      const entry = safely(
        () => JSON.parse(stored) as Partial<IGithubConditionalEntry>,
        undefined,
      );
      if (
        typeof entry?.etag !== 'string' ||
        typeof entry.text !== 'string' ||
        typeof entry.bytes !== 'number'
      ) {
        return undefined;
      }
      const valid = { etag: entry.etag, text: entry.text, bytes: entry.bytes };
      entries.set(key, valid);
      return valid;
    },
    putConditional(key: string, entry: IGithubConditionalEntry): void {
      if (!entry.etag || entry.text.length > MAX_CONDITIONAL_ENTRY_BYTES)
        return;
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > MAX_CONDITIONAL_ENTRIES) {
        const oldest = entries.keys().next().value as string;
        entries.delete(oldest);
        safely(
          () =>
            session()?.removeItem(GITHUB_CONDITIONAL_STORAGE_PREFIX + oldest),
          undefined,
        );
      }
      const stored = storedKeys();
      if (stored.length >= MAX_CONDITIONAL_ENTRIES) {
        // Another page of this tab kept answers too: start again rather than track their age.
        for (const k of stored)
          safely(() => session()?.removeItem(k), undefined);
      }
      // Full storage keeps the answer for this page only.
      safely(
        () =>
          session()?.setItem(
            GITHUB_CONDITIONAL_STORAGE_PREFIX + key,
            JSON.stringify(entry),
          ),
        undefined,
      );
    },
    dropConditional(identity?: string): void {
      const drops = (key: string) =>
        identity
          ? key.startsWith(`${identity}|`)
          : !key.startsWith('anonymous|');
      for (const key of [...entries.keys()])
        if (drops(key)) entries.delete(key);
      for (const stored of storedKeys()) {
        if (drops(stored.slice(GITHUB_CONDITIONAL_STORAGE_PREFIX.length))) {
          safely(() => session()?.removeItem(stored), undefined);
        }
      }
    },
  };
}

/** Remembers nothing beyond this page: for a test, or a caller that wants every call made. */
export function createInPageGithubApiMemory(
  now?: () => number,
): IGithubApiMemory {
  return createGithubApiMemory(
    () => undefined,
    () => undefined,
    now,
  );
}

/** The reader's memory. Injected so a test starts from nothing. */
export const GITHUB_API_MEMORY = new InjectionToken<IGithubApiMemory>(
  'GITHUB_API_MEMORY',
  {
    providedIn: 'root',
    factory: () => createGithubApiMemory(),
  },
);

/** Removes what the memory keeps in the browser's storage. For tests, between cases. */
export function clearStoredGithubApiMemory(): void {
  safely(
    () => globalThis.localStorage?.removeItem(GITHUB_ANON_LIMIT_STORAGE_KEY),
    undefined,
  );
  safely(() => {
    const store = globalThis.sessionStorage;
    if (!store) return;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(GITHUB_CONDITIONAL_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  }, undefined);
}
