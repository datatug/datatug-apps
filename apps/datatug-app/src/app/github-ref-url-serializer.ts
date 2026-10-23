import {
  DefaultUrlSerializer,
  UrlHandlingStrategy,
  UrlSegment,
  UrlSegmentGroup,
  UrlTree,
} from '@angular/router';
import { asciiLowerCase, githubRefQuery } from '@datatug/project-address';

// The ref of a GitHub project address is the query parameter `ref` (founder 2026-10-23):
//   /project/github.com/<owner>/<repo>[/<folder…>][/-/<page…>]?ref=<branch, tag or commit>
// The router's route matchers see path segments only, never the query, and the project route must supply the
// project id WITH its ref. So inside the router the ref is a matrix parameter of the repository segment
// (`…/<repo>;ref=<ref>/…`): `parse` moves a single `ref` query parameter there, and `serialize` moves it back to the
// query, written as `githubRefQuery` writes it (`?ref=feature/x`). A relative in-app navigation keeps the
// repository segment, and with it the ref, so every page of the same project carries it forward.
// Only an address under `/project/github.com/<owner>/<repo>` is touched; every other URL is the default serializer's.

const REF = 'ref';

/** The repository segment's group, when the tree's primary path is a GitHub project address. */
function githubProjectGroup(tree: UrlTree): UrlSegmentGroup | undefined {
  const primary = tree.root.children['primary'];
  const segments = primary?.segments;
  return segments &&
    segments.length >= 4 &&
    asciiLowerCase(segments[0].path) === 'project' &&
    asciiLowerCase(segments[1].path) === 'github.com'
    ? primary
    : undefined;
}

/**
 * A `[routerLink]` given a project page's href as ONE string command (`…/-/environments?ref=feature/x`, as
 * `projectPageHref` writes it) keeps its query inside the path (`environments?ref=feature` and `x`), where no route
 * matches it. For a GitHub project address whose path holds `?…ref=…`, that query is lifted out: `ref` to the repository segment's
 * matrix parameter, every other parameter to the query. Applied to a link's `href` (`serialize`) and to every
 * navigation (`GithubRefUrlHandlingStrategy.extract`), so such a link keeps the project's ref.
 */
export function liftProjectQuery(tree: UrlTree): UrlTree {
  const group = githubProjectGroup(tree);
  if (!group) {
    return tree;
  }
  // RouterLink splits a string command at every `/`, the query's too (`?ref=feature/x`): the query starts in the first
  // segment after the repository's name that holds a `?`, and runs to the end of the path.
  const at = group.segments.findIndex((segment, i) => i >= 3 && segment.path.includes('?'));
  if (at < 0) {
    return tree;
  }
  const holder = group.segments[at];
  const queryAt = holder.path.indexOf('?');
  const params = new URLSearchParams(
    [holder.path.slice(queryAt + 1), ...group.segments.slice(at + 1).map((s) => s.path)].join('/'),
  );
  const refs = params.getAll(REF);
  if (refs.length !== 1) {
    // No ref in it (a page segment that holds a `?`, such as a query id): not a lifted href.
    return tree;
  }
  const segments = group.segments.slice(0, at + 1);
  segments[at] = new UrlSegment(holder.path.slice(0, queryAt), holder.parameters);
  segments[3] = new UrlSegment(segments[3].path, {
    ...segments[3].parameters,
    [REF]: refs[0],
  });
  params.delete(REF);
  const queryParams: Record<string, string | string[]> = { ...tree.queryParams };
  for (const name of new Set(params.keys())) {
    const values = params.getAll(name);
    queryParams[name] = values.length === 1 ? values[0] : values;
  }
  const primary = new UrlSegmentGroup(segments, group.children);
  const root = new UrlSegmentGroup(tree.root.segments, {
    ...tree.root.children,
    primary,
  });
  primary.parent = root;
  return new UrlTree(root, queryParams, tree.fragment);
}

/** Every navigation's URL goes through {@link liftProjectQuery}; nothing else differs from the default strategy. */
export class GithubRefUrlHandlingStrategy implements UrlHandlingStrategy {
  shouldProcessUrl(): boolean {
    return true;
  }
  extract(url: UrlTree): UrlTree {
    return liftProjectQuery(url);
  }
  merge(newUrlPart: UrlTree): UrlTree {
    return newUrlPart;
  }
}

export class GithubRefUrlSerializer extends DefaultUrlSerializer {
  override parse(url: string): UrlTree {
    const tree = super.parse(url);
    const group = githubProjectGroup(tree);
    const ref = tree.queryParams[REF];
    if (
      !group ||
      typeof ref !== 'string' ||
      Object.prototype.hasOwnProperty.call(group.segments[3].parameters, REF)
    ) {
      // Not a project address, no ref, two refs (left in the query, where the address check refuses them).
      return tree;
    }
    const repo = group.segments[3];
    group.segments[3] = new UrlSegment(repo.path, {
      ...repo.parameters,
      [REF]: ref,
    });
    const queryParams = { ...tree.queryParams };
    delete queryParams[REF];
    tree.queryParams = queryParams;
    return tree;
  }

  override serialize(given: UrlTree): string {
    const tree = liftProjectQuery(given);
    const group = githubProjectGroup(tree);
    const ref = group?.segments[3].parameters[REF];
    if (!group || ref === undefined) {
      return super.serialize(tree);
    }
    const parameters = { ...group.segments[3].parameters };
    delete parameters[REF];
    const segments = [...group.segments];
    segments[3] = new UrlSegment(group.segments[3].path, parameters);
    const primary = new UrlSegmentGroup(segments, group.children);
    const root = new UrlSegmentGroup(tree.root.segments, {
      ...tree.root.children,
      primary,
    });
    const queryParams = { ...tree.queryParams };
    delete queryParams[REF];
    const written = super.serialize(new UrlTree(root, queryParams, null));
    const query = githubRefQuery(ref).slice(1);
    const fragment =
      tree.fragment !== null ? '#' + encodeURI(tree.fragment) : '';
    return (
      written + (written.includes('?') ? '&' : '?') + query + fragment
    );
  }
}
