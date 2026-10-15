import { ActivatedRouteSnapshot } from '@angular/router';
import {
  routingParamDbCatalogId,
  routingParamEnvironmentId,
  routingParamProjectId,
  routingParamStoreId,
  routingParamTableType,
} from '../core/datatug-routing-params';
import { AgentTableRef } from './agent-link-api.service';
import { SCHEMA_QUERY_PARAM, tableIdentity } from './table-identity';

/**
 * The table a table, view, records or record page is for, read from the whole route (the store, project,
 * environment and database are parameters of ancestor routes) and the `schema` query parameter. Undefined when a
 * part is missing.
 */
export function linkTableRef(
  route: ActivatedRouteSnapshot,
): AgentTableRef | undefined {
  const params: Record<string, string> = {};
  for (const r of route.pathFromRoot ?? [route]) {
    for (const key of r.paramMap?.keys ?? []) {
      params[key] = r.paramMap.get(key) ?? '';
    }
  }
  const storeId = params[routingParamStoreId];
  const project = params[routingParamProjectId];
  const env = params[routingParamEnvironmentId];
  const source = params[routingParamDbCatalogId];
  const tableSegment = params[routingParamTableType];
  if (!storeId || !project || !env || !source || !tableSegment) {
    return undefined;
  }
  return {
    storeId,
    project,
    env,
    source,
    table: tableIdentity(
      tableSegment,
      route.queryParamMap?.get(SCHEMA_QUERY_PARAM),
    ),
  };
}
