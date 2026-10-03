import { IProjectRef } from '../core/project-context';
import { ProjectPage, tryProjectUrl } from './nav-models';

/**
 * The address of a project's page for a link a template or a back button holds (`defaultHref`, `routerLink`): the one
 * address `projectUrl()` writes (design `demo-as-github-project.md` 3.4: the short form for a GitHub project,
 * `/store/<storeId>/project/<projectId>` for every other store). Where there is no project yet, or the project has no
 * exact address, there is nothing to link to and the root is returned, which is what a back button falls back to.
 */
export function projectPageHref(
  ref: IProjectRef | undefined,
  page?: ProjectPage,
): string {
  if (!ref) {
    return '/';
  }
  const url = tryProjectUrl(ref, page);
  return typeof url === 'string' ? url : '/';
}
