import { IProjectRef, isSharedProjectRef } from '../core/project-context';
import { ProjectPage, tryProjectUrl, parseProjectUrl } from './nav-models';

/** Preserve a session only where that project's session routes admit the destination. */
export function projectPageInCurrentSession(
  ref: IProjectRef,
  page: ProjectPage | undefined,
  currentUrl?: string,
): ProjectPage | undefined {
  const current = currentUrl
    ? parseProjectUrl(currentUrl.split('?')[0])
    : undefined;
  if (
    !current?.ok ||
    current.storeId !== ref.storeId ||
    current.projectId !== ref.projectId ||
    current.spaceID !== ref.spaceID
  )
    return page;
  const session = /^\/sessions\/([A-Za-z0-9_-]{1,128})(?:\/|$)/.exec(
    current.rest,
  )?.[1];
  const parts = Array.isArray(page)
    ? page
    : typeof page === 'string'
      ? page.split('/')
      : [];
  const supported = isSharedProjectRef(ref)
    ? [
        'overview',
        'queries',
        'query',
        'invoice-overview',
        'invoice-explorer',
        'composer',
      ]
    : [
        'chat',
        'overview',
        'board',
        'boards',
        'entities',
        'entity',
        'env',
        'query',
        'queries',
        'servers',
        'variables',
        'invoice-overview',
        'invoice-explorer',
        'composer',
      ];
  return session && (!parts.length || supported.includes(parts[0]))
    ? ['sessions', session, ...parts]
    : page;
}

/**
 * The address of a project's page for a link a template or a back button holds (`defaultHref`, `routerLink`): the one
 * address `projectUrl()` writes (design `demo-as-github-project.md` 3.4: the short form for a GitHub project,
 * `/store/<storeId>/project/<projectId>` for every other store). Where there is no project yet, or the project has no
 * exact address, there is nothing to link to and the root is returned, which is what a back button falls back to.
 */
export function projectPageHref(
  ref: IProjectRef | undefined,
  page?: ProjectPage,
  currentUrl?: string,
): string {
  if (!ref) {
    return '/';
  }
  const url = tryProjectUrl(
    ref,
    projectPageInCurrentSession(ref, page, currentUrl),
  );
  return typeof url === 'string' ? url : '/';
}
