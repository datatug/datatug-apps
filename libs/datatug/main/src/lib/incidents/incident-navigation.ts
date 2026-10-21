import type { Params } from '@angular/router';
import type { IProjectRef } from '../core/project-context';
import {
  projectApiQuery,
  readProjectApiQuery,
} from '../nav/project-api-routing';
import { projectPageHref } from '../nav/project-page-href';
import { parseProjectUrl } from '../nav/nav-models';

const INCIDENT_PATH = /^\/incidents(?:\/|$)/;

/**
 * Reads a project only from the current Incident URL. Ambient navigation state
 * is deliberately excluded so a global Incident page cannot inherit a stale
 * project from a previously open workspace.
 */
export function incidentProjectRefFromUrl(
  currentUrl: string,
): IProjectRef | undefined {
  const hashIndex = currentUrl.indexOf('#');
  const withoutFragment =
    hashIndex < 0 ? currentUrl : currentUrl.slice(0, hashIndex);
  const queryIndex = withoutFragment.indexOf('?');
  const path =
    queryIndex < 0 ? withoutFragment : withoutFragment.slice(0, queryIndex);
  const parsed = parseProjectUrl(path);
  if (!parsed.ok || !INCIDENT_PATH.test(parsed.rest)) {
    return undefined;
  }

  const query =
    queryIndex < 0
      ? new URLSearchParams()
      : new URLSearchParams(withoutFragment.slice(queryIndex + 1));
  return {
    storeId: parsed.storeId,
    projectId: parsed.projectId,
    ...(parsed.spaceID ? { spaceID: parsed.spaceID } : {}),
    ...readProjectApiQuery(query),
  };
}

/** Commands for one Incident page, project-qualified only from an actual project URL. */
export function incidentPageCommands(
  currentUrl: string,
  tail: readonly string[] = [],
): readonly string[] {
  const project = incidentProjectRefFromUrl(currentUrl);
  if (!project) {
    return ['/incidents', ...tail];
  }
  const href = projectPageHref(project, ['incidents', ...tail]);
  return [href.split('?')[0]];
}

/**
 * Keeps explicit project transport qualifiers beside the existing complete
 * Incident scope. A missing scope stays missing; this never selects an
 * environment or composes partial authority.
 */
export function incidentPageQueryParams(
  currentUrl: string,
  scope: Params | undefined,
): Params | undefined {
  const project = incidentProjectRefFromUrl(currentUrl);
  if (!project?.projectApi) {
    return scope;
  }
  const projectParams = Object.fromEntries(
    new URLSearchParams(projectApiQuery(project)),
  );
  return { ...projectParams, ...scope };
}
