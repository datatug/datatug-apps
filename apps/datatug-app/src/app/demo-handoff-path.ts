import type { UrlMatcher, UrlSegment } from '@angular/router';

// The one definition, in TypeScript, of which address is a hand-off address. The route table (the matcher
// below), the capture of the visitor's question (demo-handoff-capture.ts) and the trust check all use it. The
// inline script in index.html cannot import anything and repeats the same rules in plain ES5; its spec runs that
// script against this function so the two cannot drift apart.
//
// The rules are the router's own: matrix parameters (`/demo;x=1`) and a trailing slash do not change which route
// matches, and the segments are matched after percent-decoding. The literal segments (`demo`, `project`,
// `github.com`, `chat`, `tree`, `-`) match in any letter case; `/Demo` is the same page as `/demo`.

/** What a hand-off address points at. `owner`, `repo` and `ref` are the decoded segments, in their original case. */
export type HandoffTarget =
  | { readonly kind: 'demo' }
  | {
      readonly kind: 'chat';
      readonly owner: string;
      readonly repo: string;
      /** The `tree/<ref>` segment of `…/tree/<ref>/-/chat`; undefined for `…/chat`. */
      readonly ref?: string;
    };

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The path segments of an address as the router reads them: nothing after an auxiliary outlet's `(`, one
 * trailing slash ignored, matrix parameters dropped, each segment percent-decoded (raw when it does not decode).
 */
export function routeSegments(pathname: string): string[] {
  const parts = pathname.split('(')[0].split('/').slice(1);
  if (parts[parts.length - 1] === '') parts.pop();
  return parts.map((part) => decoded(part.split(';')[0]));
}

/** The hand-off the (already split) path segments point at, or undefined when they are not a hand-off address. */
export function handoffTarget(
  segments: readonly string[],
): HandoffTarget | undefined {
  const [first, host, owner, repo, ...rest] = segments.map((s) =>
    s.toLowerCase(),
  );
  if (first === 'demo')
    return segments.length === 1 ? { kind: 'demo' } : undefined;
  if (first !== 'project' || host !== 'github.com' || !owner || !repo)
    return undefined;
  const chat = (ref?: string): HandoffTarget => ({
    kind: 'chat',
    owner: segments[2],
    repo: segments[3],
    ref,
  });
  if (rest.length === 1 && rest[0] === 'chat') return chat();
  if (
    rest.length === 4 &&
    rest[0] === 'tree' &&
    rest[1] &&
    rest[2] === '-' &&
    rest[3] === 'chat'
  )
    return chat(segments[5]);
  return undefined;
}

/** Whether this URL path is a hand-off address. */
export function isHandoffPath(pathname: string): boolean {
  return handoffTarget(routeSegments(pathname)) !== undefined;
}

/** The route matcher for every hand-off address: the whole path or nothing (a matcher is not `pathMatch: 'full'`). */
export const handoffUrlMatcher: UrlMatcher = (segments: UrlSegment[]) =>
  handoffTarget(segments.map((segment) => segment.path))
    ? { consumed: segments }
    : null;
