import {
  DefaultUrlSerializer,
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

  override serialize(tree: UrlTree): string {
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
