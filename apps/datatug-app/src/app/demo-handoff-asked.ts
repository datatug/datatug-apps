import {
  handoffTarget,
  routeSegments,
  startChatSegmentsOf,
} from './demo-handoff-path';

// Whether a hand-off address arrived WITH a question, decided where the route table is read (the eager bundle),
// from what index.html's inline script kept of the query: it takes the query out of the address bar before the
// router ever sees it, so the router cannot ask the URL. This file is small on purpose (no parsing of trust, no
// storage writes, no reporting): demo-handoff-capture.ts, which is a lazy chunk, holds the rest.
//
// What each hand-off address gets (datatug-app-routes.ts), see handoffDecision():
//   - `/demo` (and `/Demo`, …): the holding page, always. There is nothing else at that address.
//   - `…/start-chat`, `…/tree/<ref>[/<dir>…]/-/start-chat` (founder ruling 2026-10-03): the confirmation page,
//     always. It is a page of its own: with a question (kept from the fragment `#msg=…`) or without.
//   - the OLD hand-off address, the project chat (`…/chat`, `…/tree/<ref>/-/chat`): only when it arrived with a
//     question (`msg`, or the old `q`), and then it is MOVED to the start-chat page of the same project. The same
//     address without a question is the project's own chat page, as for every other page of a project opened at
//     its short address; the chat page never reads a question.
// The flag of demo-flag.ts is deliberately NOT read: it is decided independently of the hand-off code (see
// demo-flag.spec.ts), and until the chat can run a question the holding page is the only way not to lose it.

export const DEMO_HANDOFF_KEY = 'datatug.demo.handoff.v1';
export const DEMO_HANDOFF_STASH = '__datatugHandoffSearch';

/**
 * Kept in storage for an address that may not show its question back, in place of the question: the page was
 * shown for a question that was asked, so a reload must show it again (without the question), not the chat.
 */
export const DEMO_HANDOFF_ASKED_PARAM = 'asked';

// Control characters other than tab and line feed have no place in a question that is shown back as text.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
// Two or more blank lines in a row (a line of only spaces and tabs counts as blank): shown as a single blank line.
const BLANK_LINE_RUNS = /(?:[ \t]*\n){3,}/g;

/** A question parameter as a clean text: control characters out, runs of blank lines collapsed, trimmed. */
export function cleanQuestion(value: string | null): string {
  return (value ?? '')
    .replace(CONTROL_CHARACTERS, '')
    .replace(BLANK_LINE_RUNS, '\n\n')
    .trim();
}

/** The question of a query string: `msg`, else `q` (a blank `msg` does not hide a real `q`); '' when none. */
export function questionOfSearch(search: string): string {
  const params = new URLSearchParams(search);
  return cleanQuestion(params.get('msg')) || cleanQuestion(params.get('q'));
}

/** Whether this query string is a question that was asked (or the mark kept in its place for an address that may not echo it). */
export function searchAsksQuestion(search: string): boolean {
  return (
    questionOfSearch(search) !== '' ||
    new URLSearchParams(search).get(DEMO_HANDOFF_ASKED_PARAM) === '1'
  );
}

export interface AskedEnv {
  /** `window`, for the stash written by index.html's inline script. */
  stash: Record<string, unknown>;
  /** Throws when the browser blocks storage. */
  storage: () => Storage;
  /** `PerformanceNavigationTiming.type` of this page load: 'navigate', 'reload', 'back_forward' or undefined. */
  navigationType: () => string | undefined;
}

function navigationType(): string | undefined {
  try {
    const [entry] = performance.getEntriesByType(
      'navigation',
    ) as PerformanceNavigationTiming[];
    return entry?.type;
  } catch {
    return undefined;
  }
}

function defaultEnv(): AskedEnv {
  return {
    stash: window as unknown as Record<string, unknown>,
    storage: () => window.sessionStorage,
    navigationType,
  };
}

/** Removes the copy of the query kept for this tab; blocked storage is not an error. */
function forgetQuestion(env: AskedEnv): void {
  try {
    env.storage().removeItem(DEMO_HANDOFF_KEY);
  } catch {
    // Storage is blocked: nothing was kept.
  }
}

/** What this page load has already been told about an address: it stays the answer for as long as the page lives. */
const settled = new Map<string, boolean>();

const keyOf = (segments: readonly string[]): string =>
  segments.map((s) => s.toLowerCase()).join('/');

/**
 * Whether the hand-off address with these (decoded) segments arrived with a question, in this order:
 * 1. the query index.html took out of the address bar for this page load (not yet picked up by the holding page);
 * 2. what this page load already settled for the same address;
 * 3. a fresh visit (the document was loaded by navigating, not reloaded) with no query: no, whatever an earlier
 *    visit in this tab left in storage;
 * 4. a reload or back/forward: the copy of the query kept in storage for this very address.
 * Blocked storage means no for 3 and 4: the question lives only in the page.
 *
 * `routerSearch` is the query the router has for this navigation (review r2, B1). Normally empty: the script took
 * the query out before the router started. A question in it, with no stash, is "asked" (and goes into the stash).
 *
 * An answer of "no" that comes from 1 or 3 also forgets the question kept for this tab (the copy in storage, and
 * the stash, which only the holding page reads), as `captureDemoHandoff` did on main for a bare visit: otherwise a
 * reload would bring the holding page back, with a question the visitor did not ask this time.
 */
export function handoffAsked(
  segments: readonly string[],
  env: AskedEnv = defaultEnv(),
  routerSearch = '',
): boolean {
  const key = keyOf(segments);
  const stashed = env.stash[DEMO_HANDOFF_STASH];
  if (typeof stashed === 'string') {
    const asked = searchAsksQuestion(stashed);
    settled.set(key, asked);
    if (!asked) {
      delete env.stash[DEMO_HANDOFF_STASH];
      forgetQuestion(env);
    }
    return asked;
  }
  if (searchAsksQuestion(routerSearch)) {
    // The router matched this address with a question in its query that the script did not take out (it reads
    // the path its own way, and an address can be spelled in ways it does not): asked. Stashed, so that the
    // holding page captures it and takes it out of the address as it does for every other hand-off.
    env.stash[DEMO_HANDOFF_STASH] = routerSearch;
    settled.set(key, true);
    return true;
  }
  const known = settled.get(key);
  if (known !== undefined) return known;
  if (env.navigationType() === 'navigate') {
    settled.set(key, false);
    forgetQuestion(env);
    return false;
  }
  try {
    const raw = env.storage().getItem(DEMO_HANDOFF_KEY) ?? '';
    const at = raw.indexOf('?');
    if (at < 0) return false;
    const stored = raw.slice(0, at);
    return (
      stored.startsWith('/') &&
      keyOf(routeSegments(stored)) === key &&
      searchAsksQuestion(raw.slice(at))
    );
  } catch {
    return false;
  }
}

/** What the route table does with a hand-off address. */
export type HandoffDecision =
  /** Not a hand-off address, or the old chat address without a question: the route does not match. */
  | { readonly kind: 'none' }
  /** The confirmation / holding page is the page of this very address. */
  | { readonly kind: 'page' }
  /** The old chat address arrived with a question: go (replacing it) to start-chat of the same project. */
  | {
      readonly kind: 'move-to-start-chat';
      /** The segments of the new address, owner, repo and ref in their original case. */
      readonly segments: readonly string[];
    };

/**
 * What the route table does with this address (see the header). The question itself is never in the address by
 * now: for `/demo` and the old chat address it is in the stash (the page captures it from there), for start-chat
 * the page reads and strips its own address (demo-handoff-capture.ts).
 */
export function handoffDecision(
  segments: readonly string[],
  env: AskedEnv = defaultEnv(),
  routerSearch = '',
): HandoffDecision {
  const target = handoffTarget(segments);
  if (!target) return { kind: 'none' };
  if (target.kind === 'start-chat') return { kind: 'page' };
  if (target.kind === 'demo') {
    if (routerSearch && typeof env.stash[DEMO_HANDOFF_STASH] !== 'string') {
      env.stash[DEMO_HANDOFF_STASH] = routerSearch;
    }
    return { kind: 'page' };
  }
  return handoffAsked(segments, env, routerSearch)
    ? { kind: 'move-to-start-chat', segments: startChatSegmentsOf(segments) }
    : { kind: 'none' };
}

/** The query of a navigation as a query string (`?a=1&b=2`; '' when it has none), as the capture parses it. */
export function searchOfQueryParams(
  queryParams: Record<string, string | string[] | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(queryParams)) {
    for (const each of Array.isArray(value) ? value : [value]) {
      if (each !== undefined) search.append(name, each);
    }
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

/** For tests: forgets what this page load settled. */
export function resetHandoffAskedForTests(): void {
  settled.clear();
}
