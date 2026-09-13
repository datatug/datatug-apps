import type { ParamMap, Params } from '@angular/router';
import type { IncidentRequestContext, IncidentScope } from './models';

export const incidentAgentQueryParam = 'agent';
export const incidentStoreQueryParam = 'storeId';
export const incidentProjectQueryParam = 'project';
export const incidentEnvironmentQueryParam = 'environment';

/**
 * `datatug serve` exposes checked-out project files through Core's canonical
 * `local` project-store identity. Incident stores have their own independent
 * IDs (often the project ID for the default project-repository route).
 */
export const datatugServeProjectStoreId = 'local';

export interface IncidentAmbientRouteScope {
  readonly agentStoreId?: string;
  readonly project?: {
    readonly ref: {
      readonly storeId: string;
      readonly projectId: string;
    };
  };
  readonly environment?: string;
}

export interface IncidentRouteScope {
  readonly agentStoreId: string;
  readonly storeId: string;
  readonly project: string;
  readonly environment: string;
}

/**
 * Resolves the non-secret incident scope without ever composing a URL-carried
 * field with ambient navigation state. Any explicit scope field makes the URL
 * authoritative and therefore requires the complete four-field scope. With no
 * explicit fields, ambient navigation is accepted only when its store and
 * project agree on the same agent.
 */
export function resolveIncidentRouteScope(
  query: ParamMap,
  ambient: IncidentAmbientRouteScope,
  routeStoreId?: string,
): IncidentRouteScope | undefined {
  const scopeParamNames = [
    incidentAgentQueryParam,
    incidentStoreQueryParam,
    incidentProjectQueryParam,
    incidentEnvironmentQueryParam,
  ];
  const hasExplicitScope =
    routeStoreId !== undefined ||
    scopeParamNames.some((paramName) => query.has(paramName));

  if (hasExplicitScope) {
    const agentStoreId = query.get(incidentAgentQueryParam) || undefined;
    const storeId =
      routeStoreId || query.get(incidentStoreQueryParam) || undefined;
    const project = query.get(incidentProjectQueryParam) || undefined;
    const environment = query.get(incidentEnvironmentQueryParam) || undefined;
    if (!agentStoreId || !storeId || !project || !environment) {
      return undefined;
    }
    return { agentStoreId, storeId, project, environment };
  }

  const agentStoreId = ambient.agentStoreId;
  const projectRef = ambient.project?.ref;
  const environment = ambient.environment;
  if (
    !agentStoreId ||
    !projectRef?.projectId ||
    projectRef.storeId !== agentStoreId ||
    !environment
  ) {
    return undefined;
  }
  return {
    agentStoreId,
    storeId: projectRef.projectId,
    project: projectRef.projectId,
    environment,
  };
}

/** Keeps every non-secret part of a scoped incident request in the URL. */
export function incidentContextQueryParams(
  context: Pick<IncidentRequestContext, 'agentStoreId'> & {
    readonly scope: Pick<IncidentScope, 'storeId' | 'project' | 'environment'>;
  },
): Params {
  return {
    [incidentAgentQueryParam]: context.agentStoreId,
    [incidentStoreQueryParam]: context.scope.storeId,
    [incidentProjectQueryParam]: context.scope.project,
    [incidentEnvironmentQueryParam]: context.scope.environment,
  };
}
