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
/** Assigned legacy metadata can exceed the detail limit; keep read links scoped and usable. */
const admitsTagDetail = (tag: string): boolean =>
  tag.length > 0 && new TextEncoder().encode(tag).length <= 50;

const tagDiscoveryLink = (ref: IProjectRef | undefined, name: string): UrlTree =>
  projectItemLink(ref, 'tag-discovery', { name });

export const projectTagDiscoveryHref = (
  ref: IProjectRef | undefined,
  name: string,
): string => serializer.serialize(tagDiscoveryLink(ref, name));

/** Path-like tag text stays opaque in a query parameter, avoiding browser dot normalization. */
export function projectTagLink(
  ref: IProjectRef | undefined,
  tag: string,
): UrlTree {
  if (!admitsTagDetail(tag)) return tagDiscoveryLink(ref, tag);
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
