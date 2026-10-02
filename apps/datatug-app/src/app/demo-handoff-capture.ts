// The hand-off from datatug.io / datatug.ai is `datatug.app/demo?scenario=<id>&q=<text>&lang=<en|ru>`; the
// project chat will receive `/project/github.com/<owner>/<repo>/chat?msg=<text>&lang=<en|ru>`. The visitor's
// question must never be reported as part of a page URL, so it is taken out of the address bar before
// analytics and Sentry start, kept in memory, and shown back by the holding page.
//
// Two steps, split by weight and by timing:
//   1. index.html: a tiny inline script, first in <head> (before the Google Analytics snippet, which reads the
//      URL when gtag.js has loaded, possibly before any bundle runs), strips the query from the address bar and
//      keeps it twice: in `window.__datatugHandoffSearch` and, so that a reload before the app has started
//      does not lose the question either, in sessionStorage under DEMO_HANDOFF_KEY (the path and the raw query
//      string, so that it is only ever applied to the same path). Its path test is the same expression as
//      HANDOFF_PATH below; demo-handoff-capture.spec.ts runs the real script to prove it.
//   2. `captureDemoHandoff()`, called by the holding page (demo-holding-page.component.ts, a lazy chunk, so none
//      of this code is in the initial bundle): parses the stash (or, after a reload, what sessionStorage
//      kept) and holds the result in module memory. Should the stash be missing on a first visit, it parses and
//      strips the live query string itself. Blocked storage never leaves the question in the URL; it only means
//      that a reload shows the no-question copy.
//
// Only the path shapes below are touched; every other URL is left exactly as it is.
//
// Which hand-offs are shown back. `/demo` and the project chat of the demo project itself
// (`datatug/chinook-demo`, default branch) show the visitor's question. The project chat of any other repository
// does not: a message chosen by whoever made the link must not be displayed inside datatug.app's pages under
// someone else's repository address. For those the query is still taken out of the address bar and kept out of
// every report; only the language is kept, for the neutral page. See isEchoTrusted().
export const DEMO_HANDOFF_KEY = 'datatug.demo.handoff.v1';
export const DEMO_HANDOFF_STASH = '__datatugHandoffSearch';
export const DEMO_QUESTION_MAX_BYTES = 1000;

/**
 * `/demo`, or the chat of a GitHub project (`…/chat`, or `…/tree/<ref>/-/chat` at the repository root): the places
 * a hand-off lands.
 */
export const HANDOFF_PATH =
  /^\/(?:demo|project\/github\.com\/[^/]+\/[^/]+(?:\/tree\/[^/]+\/-)?\/chat)\/?$/;

const PROJECT_CHAT_PATH =
  /^\/project\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)\/-)?\/chat\/?$/;

/** The demo project: the only repository whose chat address may show a message that came in a link. */
const TRUSTED_OWNER = 'datatug';
const TRUSTED_REPO = 'chinook-demo';

export type DemoLang = 'en' | 'ru';

export interface DemoHandoff {
  /** The question as plain text (never HTML), at most DEMO_QUESTION_MAX_BYTES UTF-8 bytes; '' when none was asked. */
  readonly question: string;
  readonly lang: DemoLang;
  /** True when the question was longer than the bound and has been cut. */
  readonly truncated: boolean;
}

let current: DemoHandoff | undefined;

export function isHandoffPath(pathname: string): boolean {
  return HANDOFF_PATH.test(pathname);
}

function decoded(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment).toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Whether the hand-off at this path may be shown back to the visitor: `/demo`, or the chat of
 * `datatug/chinook-demo` (owner and repository decoded, lower-cased, each compared for exact equality) on its
 * default branch, that is with no `tree/<ref>` or with `tree/HEAD`. Anything else, however similar
 * (`chinook-demo-evil`, `tree/<sha>`), is not.
 */
export function isEchoTrusted(pathname: string): boolean {
  if (/^\/demo\/?$/.test(pathname)) return true;
  const match = PROJECT_CHAT_PATH.exec(pathname);
  if (!match) return false;
  const [, owner, repo, ref] = match;
  return (
    decoded(owner) === TRUSTED_OWNER &&
    decoded(repo) === TRUSTED_REPO &&
    (ref === undefined || ref === 'HEAD')
  );
}

/** What is kept for a reload: the path and the raw query string, so it is only applied to the same path. */
function storedFor(pathname: string, search: string): string {
  return pathname.replace(/\/$/, '') + search;
}

function utf8Length(codePoint: number): number {
  return codePoint < 0x80
    ? 1
    : codePoint < 0x800
      ? 2
      : codePoint < 0x10000
        ? 3
        : 4;
}

/** Cuts `text` to at most `maxBytes` UTF-8 bytes, only ever between two characters (never inside a surrogate pair). */
export function truncateToBytes(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    bytes += utf8Length(char.codePointAt(0) ?? 0);
    if (bytes > maxBytes) return { text: text.slice(0, end), truncated: true };
    end += char.length;
  }
  return { text, truncated: false };
}

// Control characters other than tab and line feed have no place in a question that is shown back as text.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/**
 * Parses a hand-off query string.
 * - the question is `msg`, else `q` (a blank `msg` does not hide a real `q`), trimmed, cut at 1000 bytes;
 * - `lang` is `en` or `ru`, anything else is `en`;
 * - `scenario` and every other parameter are ignored.
 */
export function parseHandoffSearch(search: string): DemoHandoff {
  const params = new URLSearchParams(search);
  const clean = (value: string | null): string =>
    (value ?? '').replace(CONTROL_CHARACTERS, '').trim();
  const raw = clean(params.get('msg')) || clean(params.get('q'));
  const { text, truncated } = truncateToBytes(raw, DEMO_QUESTION_MAX_BYTES);
  const lang: DemoLang =
    (params.get('lang') ?? '').trim().toLowerCase() === 'ru' ? 'ru' : 'en';
  return { question: text.trimEnd(), lang, truncated };
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

export interface CaptureEnv {
  location: Location;
  history: History;
  /** Throws when the browser blocks storage. */
  storage: () => Storage;
  /** `window`, for the stash written by index.html's inline script. */
  stash: Record<string, unknown>;
  /** `PerformanceNavigationTiming.type` of this page load: 'navigate', 'reload', 'back_forward' or undefined. */
  navigationType: () => string | undefined;
}

function defaultEnv(): CaptureEnv {
  return {
    location: window.location,
    history: window.history,
    storage: () => window.sessionStorage,
    stash: window as unknown as Record<string, unknown>,
    navigationType,
  };
}

/**
 * Parses the stashed hand-off (or, without a stash, the live query string, which it also strips) and holds it.
 * Every failure mode (blocked storage, no query, a reload) still ends with the query string out of the URL.
 */
export function captureDemoHandoff(env: CaptureEnv = defaultEnv()): void {
  const { location: loc, history, stash } = env;
  const stashed = stash[DEMO_HANDOFF_STASH];
  delete stash[DEMO_HANDOFF_STASH];
  const onHandoffPath = isHandoffPath(loc.pathname);
  if (!onHandoffPath && typeof stashed !== 'string') return;

  // Read the live query string before stripping it: after replaceState `location.search` is empty.
  const search = typeof stashed === 'string' ? stashed : loc.search;
  if (loc.search) {
    // Strip first and unconditionally: nothing below may leave the question in the URL.
    history.replaceState(history.state, '', loc.pathname + loc.hash);
  }
  if (search) {
    const parsed = parseHandoffSearch(search);
    const trusted = isEchoTrusted(loc.pathname);
    // Not trusted: only the language survives, for the neutral page. The question is dropped here, not hidden later.
    current = trusted
      ? parsed
      : { question: '', lang: parsed.lang, truncated: false };
    // index.html has stored the original already; this covers a page served without that script, and removes
    // the question of an untrusted address from storage.
    store(
      env,
      storedFor(loc.pathname, trusted ? search : '?lang=' + parsed.lang),
    );
  } else if (env.navigationType() === 'navigate') {
    // A fresh visit to the bare path must not show a question left in this tab by an earlier visit. (A reload
    // or back/forward keeps it: demoHandoff() reads it back from sessionStorage.)
    store(env, undefined);
  }
}

function store(env: CaptureEnv, search: string | undefined): void {
  try {
    if (search === undefined) env.storage().removeItem(DEMO_HANDOFF_KEY);
    else env.storage().setItem(DEMO_HANDOFF_KEY, search);
  } catch {
    // Storage is blocked: the question lives in memory for this page load only.
  }
}

/**
 * The hand-off for the holding page: the one captured in this page load, else the one kept for a reload, else
 * `undefined` (a bare visit, or storage is blocked after a reload: the page then shows its no-question copy in
 * English). A hand-off with only a language has an empty `question`. What storage holds is parsed like any
 * query string, so the bound and the clean-up apply to it too.
 */
export function demoHandoff(
  storage: () => Storage = () => window.sessionStorage,
  pathname: string = window.location.pathname,
): DemoHandoff | undefined {
  // Whatever was captured, the question is only ever returned for an address that may show it.
  const forPath = (handoff: DemoHandoff): DemoHandoff =>
    isEchoTrusted(pathname)
      ? handoff
      : { question: '', lang: handoff.lang, truncated: false };
  if (current) return forPath(current);
  try {
    const raw = storage().getItem(DEMO_HANDOFF_KEY) ?? '';
    const at = raw.indexOf('?');
    if (at < 0 || raw.slice(0, at) !== pathname.replace(/\/$/, ''))
      return undefined;
    return forPath(parseHandoffSearch(raw.slice(at)));
  } catch {
    return undefined;
  }
}

/** For tests: forgets the in-memory hand-off. */
export function resetDemoHandoffForTests(): void {
  current = undefined;
}
