// Whether the router sees an auxiliary-outlet group in a URL. Pure, and written against the shape of the router's
// `UrlSegmentGroup` rather than its type, so that this library keeps its "no Angular" promise.
//
// A path such as `/project/github.com/o/r/tree/HEAD/a(b)/-/queries` (a folder called `a(b)`, as pasted from GitHub)
// is not an address of folder `a(b)` for the router: its parser reads `(b)` as a group of the segment `a`, and drops
// what follows. The hand-off route (the app) and the short project route (datatug-main) both refuse such an address,
// so that neither opens another project silently. A named group (`chat(menu:x)`) is in the router's URL tree, and
// `hasOutletGroup` finds it there. An unnamed one (`a(b)`) is not: the parser keeps nothing of it, so only the path
// as typed shows it, and `pathHasOutletGroup` reads that.

/** The part of the router's `UrlSegmentGroup` that is read here. */
export interface SegmentGroupLike {
  readonly segments: readonly unknown[];
  readonly children: { readonly [outlet: string]: SegmentGroupLike };
  readonly parent?: SegmentGroupLike | null;
  hasChildren(): boolean;
}

const carriesPath = (group: SegmentGroupLike): boolean =>
  group.segments.length > 0 || group.hasChildren();

/**
 * Whether the router sees an auxiliary-outlet group in this URL: a group below this one, or beside it, that
 * carries a path. The empty group the router itself adds for a named outlet whose route has an empty path (the
 * app's side menu, `outlet: 'menu'`) is not one. A group at the root that holds the whole path
 * (`/(project/github.com/o/r)`) is the primary group written out, not an outlet group.
 */
export function hasOutletGroup(
  group: SegmentGroupLike | null | undefined,
): boolean {
  if (!group) return false;
  const below = Object.values(group.children);
  const beside = group.parent
    ? Object.values(group.parent.children).filter((other) => other !== group)
    : [];
  return [...below, ...beside].some(carriesPath);
}

/** A path written as one group at the root, `/(project/github.com/o/r/chat)`: the parser reads it as its content. */
export const ROOT_GROUP = /^\/\(([^()]*)\)/;

/**
 * Whether a path as typed (`location.pathname`) has a group that the router would read as an outlet group, or drop:
 * any `(`, except a path written as one group at the root (the primary group written out), which holds the whole path
 * unless it also holds another outlet's path (`/(demo//menu:x)`).
 */
export function pathHasOutletGroup(pathname: string): boolean {
  const group = ROOT_GROUP.exec(pathname);
  return group ? group[1].includes('//') : pathname.includes('(');
}
