import type { UrlMatcher, UrlSegment, UrlSegmentGroup } from '@angular/router';
import {
  hasOutletGroup,
  pathHasOutletGroup,
  ROOT_GROUP,
} from '@datatug/project-address';

// The one definition, in TypeScript, of which address is a hand-off address. The route table (the matcher
// below), the capture of the visitor's question (demo-handoff-capture.ts) and the trust check all use it. The
// inline script in index.html cannot import anything and repeats the same rules in plain ES5; its spec runs that
// script against this function so the two cannot drift apart.
//
// The rules are the router's own: matrix parameters (`/demo;x=1`) and a trailing slash do not change which route
// matches, and the segments are matched after percent-decoding. The literal segments (`demo`, `project`,
// `github.com`, `chat`, `tree`, `-`) match in any letter case; `/Demo` is the same page as `/demo`. So do the other
// spellings that the router's parser reads as the same path: `//demo` and `///demo`, and a path written as one
// group at the root, `/(demo)` (review r2: an address the script read differently from the router left the question
// in the address bar).
//
// An address with an auxiliary-outlet group (`/demo(menu:x)`, any `(` in the path but a root group) is NOT a hand-off address, for
// the script, the TypeScript and the matcher alike: the router cannot show this page for it (the outlet group
// matches nothing and the navigation fails, as on main), so nothing may claim to handle it. Its query is left
// alone, exactly as for any other address that is not a hand-off.

/**
 * What a hand-off address points at. `owner`, `repo`, `ref` and `dir` are the decoded segments, in their original
 * case.
 * - `demo`: `/demo`, the address datatug.io's Ask button still links to.
 * - `start-chat`: the confirmation page, `…/start-chat` or `…/tree/<ref>[/<dir>…]/-/start-chat`. Its question
 *   travels after `#` (founder ruling 2026-10-03; design demo-as-github-project.md, 3.1).
 * - `chat`: the OLD hand-off address `…/chat?msg=…`, which is an ordinary project page unless it arrived with a
 *   question, in which case it is moved to the `start-chat` page of the same project.
 */
export type HandoffTarget =
  | { readonly kind: 'demo' }
  | {
      readonly kind: 'chat';
      readonly owner: string;
      readonly repo: string;
      /** The `tree/<ref>` segment of `…/tree/<ref>/-/chat`; undefined for `…/chat`. */
      readonly ref?: string;
      /** The folder segments of a nested project. */
      readonly dir: readonly string[];
    }
  | {
      readonly kind: 'start-chat';
      readonly owner: string;
      readonly repo: string;
      /** The `tree/<ref>` segment; undefined for the short form. */
      readonly ref?: string;
      /** The folder segments between the ref and `/-/`; empty for the repository root. */
      readonly dir: readonly string[];
    };

/** The last segment of the page the old hand-off address moves to, and of every address of the confirmation page. */
export const START_CHAT_PAGE = 'start-chat';

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The path segments of an address as the router reads them: one trailing slash dropped (the router's Location does
 * that before the parser sees the address), a root group read as its content (`/(demo)` is `/demo`), leading
 * slashes collapsed (`//demo` is `/demo`), the path cut at an empty segment inside it (`/a//b` is `/a`: the parser
 * stops there), matrix parameters dropped, and each segment percent-decoded (raw when it does not decode).
 */
export function routeSegments(pathname: string): string[] {
  const group = ROOT_GROUP.exec(pathname);
  const path = (group ? group[1] : pathname.replace(/\/$/, '')).replace(
    /^\/+/,
    '',
  );
  if (path === '') return [];
  const parts = path.split('/');
  const empty = parts.indexOf('');
  if (empty >= 0 && empty < parts.length - 1) parts.length = empty;
  return parts.map((part) => decoded(part.split(';')[0]));
}

/** The hand-off the (already split) path segments point at, or undefined when they are not a hand-off address. */
export function handoffTarget(
  segments: readonly string[],
): HandoffTarget | undefined {
  // The site's short folder/start-chat link predates the canonical tree/HEAD
  // spelling. Recognize only this first-party alias so its fragment is captured
  // before analytics, then the route redirects to the explicit folder project.
  if (segments.length === 6 && segments.every((part) => /^[\x20-\x7e]+$/.test(part)) &&
      segments.map((part) => part.toLowerCase()).join('/') ===
        'project/github.com/datatug/datatug-demo-project/demo-project-1/start-chat') {
    return {
      kind: 'start-chat', owner: 'datatug', repo: 'datatug-demo-project',
      ref: 'HEAD', dir: ['demo-project-1'],
    };
  }
  const [first, host, owner, repo, ...rest] = segments.map((s) =>
    s.toLowerCase(),
  );
  if (first === 'demo')
    return segments.length === 1 ? { kind: 'demo' } : undefined;
  if (first !== 'project' || host !== 'github.com' || !owner || !repo)
    return undefined;
  const chat = (ref?: string, dir: string[] = []): HandoffTarget => ({
    kind: 'chat',
    owner: segments[2],
    repo: segments[3],
    ref,
    dir,
  });
  if (rest.length === 1 && rest[0] === 'chat') return chat();
  if (
    rest.length >= 4 &&
    rest[0] === 'tree' &&
    rest[1] &&
    rest[rest.length - 2] === '-' &&
    rest[rest.length - 1] === 'chat' &&
    !rest.slice(2, -2).includes('-')
  )
    return chat(segments[5], segments.slice(6, -2));
  const startChat = (ref?: string, dir: string[] = []): HandoffTarget => ({
    kind: 'start-chat',
    owner: segments[2],
    repo: segments[3],
    ref,
    dir,
  });
  if (rest.length === 1 && rest[0] === START_CHAT_PAGE) return startChat();
  // `tree/<ref>[/<dir>…]/-/start-chat`: the first `-` ends the project locator, so no folder segment is one.
  if (
    rest.length >= 4 &&
    rest[0] === 'tree' &&
    rest[1] &&
    rest[rest.length - 2] === '-' &&
    rest[rest.length - 1] === START_CHAT_PAGE &&
    !rest.slice(2, -2).includes('-')
  )
    return startChat(segments[5], segments.slice(6, -2));
  return undefined;
}

/**
 * The segments of the `start-chat` page of the same project, for an old hand-off address (`…/chat`,
 * `…/tree/<ref>/-/chat`): its last segment is replaced. Matrix parameters, a trailing slash and any group at the
 * root are not carried over; the result is the one spelling of the address.
 */
export function startChatSegmentsOf(segments: readonly string[]): string[] {
  return [...segments.slice(0, -1), START_CHAT_PAGE];
}

/** What a URL path (`location.pathname`) points at, or undefined when it is not a hand-off address. */
export function handoffTargetOfPath(
  pathname: string,
): HandoffTarget | undefined {
  if (pathHasOutletGroup(pathname)) return undefined;
  return handoffTarget(routeSegments(pathname));
}

/** Whether this URL path is a hand-off address. */
export function isHandoffPath(pathname: string): boolean {
  return handoffTargetOfPath(pathname) !== undefined;
}

/**
 * The route matcher for every hand-off address: the whole path or nothing (a matcher is not `pathMatch: 'full'`),
 * and nothing when the URL carries an auxiliary-outlet group.
 */
export const handoffUrlMatcher: UrlMatcher = (
  segments: UrlSegment[],
  group: UrlSegmentGroup,
) =>
  !hasOutletGroup(group) &&
  handoffTarget(segments.map((segment) => segment.path))
    ? { consumed: segments }
    : null;
