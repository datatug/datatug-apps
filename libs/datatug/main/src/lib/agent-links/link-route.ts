import { ActivatedRouteSnapshot } from '@angular/router';
import {
  routingParamDbCatalogId,
  routingParamEnvironmentId,
  routingParamProjectId,
  routingParamStoreId,
  routingParamTableType,
} from '../core/datatug-routing-params';
import { tryProjectUrl } from '@datatug/project-address';
import { projectPageHref } from '../nav/project-page-href';
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

/** The `limit` query parameter of a records page. */
export const LIMIT_QUERY_PARAM = 'limit';
/** The `daemon url` bounds of `limit` (REQ:ui-routes): default 50, at most 1000. */
export const DEFAULT_RECORDS_LIMIT = 50;
export const MAX_RECORDS_LIMIT = 1000;

/** How many rows a records page reads: the `limit` query parameter when it is a whole number from 1, at most
 * {@link MAX_RECORDS_LIMIT}; {@link DEFAULT_RECORDS_LIMIT} for anything else. */
export function recordsLimit(param: string | null | undefined): number {
  if (!param || !/^\d+$/.test(param)) return DEFAULT_RECORDS_LIMIT;
  const n = Number(param);
  if (n < 1) return DEFAULT_RECORDS_LIMIT;
  return Math.min(n, MAX_RECORDS_LIMIT);
}

/**
 * Where the back button of an agent-link page goes when the page has no history (the link was opened in a fresh tab):
 * the home of the project the page is for, else the store's own page (its projects). Always an address of this app.
 */
export function linkBackHref(
  storeId: string,
  projectId: string | undefined,
): string {
  if (projectId && storeId) {
    const href = projectPageHref({ storeId, projectId });
    if (href !== '/') return href;
  }
  return storeId
    ? `/store/${encodeURIComponent(storeId).replace(/%3A/gi, ':')}`
    : '/';
}

/**
 * The router commands of a page of a project's database (`env/<env>/db/<source>/table/<name>[/records|/record]`),
 * written by the one builder of project addresses and split into the segments the router takes (each decoded: the
 * router encodes them again). Undefined when the project has no exact address.
 */
export function projectPageCommands(
  project: { readonly storeId: string; readonly projectId: string },
  page: readonly string[],
): string[] | undefined {
  const path = tryProjectUrl(project, [...page]);
  if (typeof path !== 'string') return undefined;
  const [first, ...rest] = path.slice(1).split('/').map(decodeURIComponent);
  return [`/${first}`, ...rest];
}
