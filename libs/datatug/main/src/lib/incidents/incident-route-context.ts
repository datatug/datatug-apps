import type { Params } from '@angular/router';
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
