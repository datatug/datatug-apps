import { DefaultUrlSerializer, Params, UrlTree } from '@angular/router';
import { ProjectPage } from '../nav/nav-models';
import { IProjectRef } from '../core/project-context';
import { projectPageHref } from '../nav/project-page-href';
const serializer = new DefaultUrlSerializer();
export function projectItemLink(
  ref: IProjectRef | undefined,
  page: ProjectPage,
  params: Params = {},
): UrlTree {
  const tree = serializer.parse(projectPageHref(ref, page));
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) delete tree.queryParams[key];
    else tree.queryParams[key] = value;
  }
  return tree;
}
/** Path-like tag text stays opaque in a query parameter, avoiding browser dot normalization. */
export function projectTagLink(
  ref: IProjectRef | undefined,
  tag: string,
): UrlTree {
  const pathLike =
    tag.split(/[\\/]/).some((part) => !part || part === '.' || part === '..') ||
    [...tag].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    );
  return pathLike
    ? projectItemLink(ref, 'tag', { tag })
    : projectItemLink(ref, ['tag', tag]);
}
export const projectTagHref = (
  ref: IProjectRef | undefined,
  tag: string,
): string => serializer.serialize(projectTagLink(ref, tag));
