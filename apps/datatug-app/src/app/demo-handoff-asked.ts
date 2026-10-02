import { handoffTarget, routeSegments } from './demo-handoff-path';

// Whether a hand-off address arrived WITH a question, decided where the route table is read (the eager bundle),
// from what index.html's inline script kept of the query: it takes the query out of the address bar before the
// router ever sees it, so the router cannot ask the URL. This file is small on purpose (no parsing of trust, no
// storage writes, no reporting): demo-handoff-capture.ts, which is a lazy chunk, holds the rest.
//
// Which addresses show the holding page (datatug-app-routes.ts):
//   - `/demo` (and `/Demo`, …): always. There is nothing else at that address.
//   - the project chat address of a GitHub project (`…/chat`, `…/tree/<ref>/-/chat`): only when it arrived with a
//     question (`msg`, or the old `q`). The same address without one is the project's own chat page, as for every
//     other page of a project opened at its short address.
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
 */
export function handoffAsked(
  segments: readonly string[],
  env: AskedEnv = defaultEnv(),
): boolean {
  const key = keyOf(segments);
  const stashed = env.stash[DEMO_HANDOFF_STASH];
  if (typeof stashed === 'string') {
    const asked = searchAsksQuestion(stashed);
    settled.set(key, asked);
    return asked;
  }
  const known = settled.get(key);
  if (known !== undefined) return known;
  if (env.navigationType() === 'navigate') return false;
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

/**
 * Whether the holding page is the page of this hand-off address. `/demo` always; a project chat address only when
 * it arrived with a question. Not a hand-off address: no.
 */
export function showsHoldingPage(
  segments: readonly string[],
  env?: AskedEnv,
): boolean {
  const target = handoffTarget(segments);
  if (!target) return false;
  return target.kind === 'demo' || handoffAsked(segments, env);
}

/** For tests: forgets what this page load settled. */
export function resetHandoffAskedForTests(): void {
  settled.clear();
}
