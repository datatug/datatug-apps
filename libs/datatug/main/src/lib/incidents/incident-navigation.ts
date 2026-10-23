import { convertToParamMap, type Params } from '@angular/router';
import {
  resolveIncidentRouteScope,
  incidentAgentQueryParam,
  incidentStoreQueryParam,
  incidentProjectQueryParam,
  incidentEnvironmentQueryParam,
  type IncidentRouteScope,
} from './incident-route-context';
import type { IProjectRef } from '../core/project-context';
import {
  projectApiQuery,
  readProjectApiQuery,
} from '../nav/project-api-routing';
import {
  projectPageHref,
  projectRouterCommands,
  type ProjectRouterCommand,
} from '../nav/project-page-href';
import { parseProjectUrl } from '../nav/nav-models';

const INCIDENT_PATH = /^\/incidents(?:\/|$)/;

/** Complete Incident authority belonging to the project addressed by this URL. */
export function incidentProjectRouteScope(
  currentUrl: string,
): IncidentRouteScope | undefined {
  const project = incidentProjectRefFromUrl(currentUrl);
  if (!project) return undefined;
  const url = new URL(currentUrl, 'https://datatug.app');
  // Angular request ParamMaps read the first repeated value; collapsing URL
  // entries reads the last. Ambiguous scope must never select sidebar state.
  if (
    [
      incidentAgentQueryParam,
      incidentStoreQueryParam,
      incidentProjectQueryParam,
      incidentEnvironmentQueryParam,
    ].some((key) => url.searchParams.getAll(key).length > 1)
  )
    return undefined;
  // With its query: a GitHub project's `?ref=` is part of its address.
  const parsed = parseProjectUrl(url.pathname + url.search);
  if (!parsed.ok) return undefined;
  const segments = parsed.rest.split('/');
  const incidentStoreId = segments[3]
    ? decodeURIComponent(segments[2])
    : undefined;
  const scope = resolveIncidentRouteScope(
    convertToParamMap(Object.fromEntries(url.searchParams)),
    {},
    incidentStoreId,
  );
  return scope &&
    scope.agentStoreId === project.storeId &&
    scope.project === project.projectId &&
    (!incidentStoreId ||
      !url.searchParams.has('storeId') ||
      url.searchParams.get('storeId') === incidentStoreId)
    ? scope
    : undefined;
}

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
  // With its query: a GitHub project's `?ref=` is part of which project the address names.
  const parsed = parseProjectUrl(withoutFragment);
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
): readonly ProjectRouterCommand[] {
  const project = incidentProjectRefFromUrl(currentUrl);
  if (!project) {
    return ['/incidents', ...tail];
  }
  return projectRouterCommands(projectPageHref(project, ['incidents', ...tail]));
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
