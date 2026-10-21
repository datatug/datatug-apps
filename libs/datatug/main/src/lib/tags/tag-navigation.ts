import { DefaultUrlSerializer, Params, UrlTree } from '@angular/router';
import { ProjectPage } from '../nav/nav-models';
import { IProjectRef } from '../core/project-context';
import { projectPageHref } from '../nav/project-page-href';
/** Route builders encode each tag as one case-sensitive path segment. */
export const projectTagHref = (
  ref: IProjectRef | undefined,
  tag: string,
): string => projectPageHref(ref, ['tag', tag]);

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
export const projectTagLink = (
  ref: IProjectRef | undefined,
  tag: string,
): UrlTree => projectItemLink(ref, ['tag', tag]);
