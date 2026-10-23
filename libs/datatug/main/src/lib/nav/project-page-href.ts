import { IProjectRef, isSharedProjectRef } from '../core/project-context';
import { ProjectPage, tryProjectUrl, parseProjectUrl } from './nav-models';

/** Preserve a session only where that project's session routes admit the destination. */
export function projectPageInCurrentSession(
  ref: IProjectRef,
  page: ProjectPage | undefined,
  currentUrl?: string,
): ProjectPage | undefined {
  // The whole URL, query included: a GitHub project's `?ref=` is part of which project it is.
  const current = currentUrl ? parseProjectUrl(currentUrl) : undefined;
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

/**
 * `href` with `query` (`name=value&…`, no `?`) added to its query: a project address may already have one
 * (a GitHub project's `?ref=`, the project API's `?projectApi=…&branch=…`), so never append a second `?`.
 */
export function withQuery(href: string, query: string): string {
  if (!query) return href;
  const hash = href.indexOf('#');
  const base = hash < 0 ? href : href.slice(0, hash);
  const fragment = hash < 0 ? '' : href.slice(hash);
  return base + (base.includes('?') ? '&' : '?') + query + fragment;
}

/** A router command: a path, or the matrix parameters of the segment before it. */
export type ProjectRouterCommand = string | { readonly ref: string };

/**
 * The router commands (`[routerLink]`, `router.navigate`) of a project page's `href`, its query left to the caller's
 * `queryParams` but for a GitHub project's `ref`, which inside the router is the matrix parameter of the repository
 * segment (apps/datatug-app/src/app/github-ref-url-serializer.ts): `['/project/github.com/o/r', {ref}, 'd/-/queries']`.
 * So a link keeps the project's ref, as every link within the project must.
 */
export function projectRouterCommands(href: string): ProjectRouterCommand[] {
  const bare = href.split('#')[0];
  const queryAt = bare.indexOf('?');
  const path = queryAt < 0 ? bare : bare.slice(0, queryAt);
  const ref =
    queryAt < 0 ? null : new URLSearchParams(bare.slice(queryAt + 1)).get('ref');
  const parts = path.split('/');
  if (ref === null || parts[1] !== 'project' || parts[2] !== 'github.com' || parts.length < 5) {
    return [path];
  }
  const head = parts.slice(0, 5).join('/');
  const tail = parts.slice(5).join('/');
  return tail ? [head, { ref }, tail] : [head, { ref }];
}
