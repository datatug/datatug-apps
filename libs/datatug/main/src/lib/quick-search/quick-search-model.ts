import { isPublicChecksProject } from '../detective/public-checks-project';
import { IProjectRef } from '../core/project-context';
import { projectPageHref } from '../nav/project-page-href';

export const searchKinds = [
  'tag',
  'table',
  'column',
  'view',
  'query',
  'dashboard',
  'check',
  'entity',
  'server',
  'environment',
] as const;
export type SearchKind = (typeof searchKinds)[number];
export interface SearchReference {
  environmentId?: string;
  sourceId?: string;
  dbModelId?: string;
  schema?: string;
  table?: string;
  column?: string;
  folder?: string;
  objectId?: string;
}
export interface SearchDocument {
  kind: SearchKind;
  id: string;
  name: string;
  qualifiedName?: string;
  sourceName?: string;
  parentId?: string;
  parentName?: string;
  tags: readonly string[];
  reference: SearchReference;
}
export interface SourceCoverage {
  kind: SearchKind;
  status: 'complete' | 'unavailable';
  count: number;
  error?: string;
}
export interface SearchSnapshot {
  documents: SearchDocument[];
  sourceCoverage: SourceCoverage[];
}
export interface SearchStatus {
  state: 'disabled' | 'indexing' | 'ready' | 'deleting' | 'error';
  supportsMetadataPreview?: boolean;
  canManage: boolean;
  eligible: boolean;
  audience: string;
  provider: string;
  consentVersion?: string;
  lastIndexedAt?: string;
  documentCount: number;
  revision?: number;
  error?: string;
  sourceCoverage?: SourceCoverage[];
  /** Index schema version; absent for indexes written before versioning. */
  schemaVersion?: number;
  /** Why counts cannot be shown (e.g. `not_eligible`); counts are then unavailable, never 0. */
  countsUnavailable?: string;
}
/** A typed Quick Search failure the page renders as an explicit state. */
export type SearchProblem =
  | 'consent'
  | 'reindex'
  | 'unsupported'
  | 'premium'
  | 'denied'
  | 'conflict'
  | 'rateLimited'
  | 'unavailable'
  | 'failed';
/**
 * Classifies a failed Quick Search call by the API's JSON error code
 * (`{error:{code}}` or the legacy `{error:'code'}`), falling back to the HTTP status.
 */
export function classifySearchError(error: unknown): SearchProblem {
  const failure = error as
    | { status?: number; error?: { error?: unknown; code?: unknown } }
    | undefined;
  const inner = failure?.error?.error ?? failure?.error?.code;
  const code =
    typeof inner === 'string'
      ? inner
      : (inner as { code?: unknown } | undefined)?.code;
  switch (code) {
    case 'consent_required':
      return 'consent';
    case 'quick_search_reindex_required':
      return 'reindex';
    case 'quick_search_unsupported_storage':
      return 'unsupported';
    case 'quick_search_premium_required':
      return 'premium';
    case 'project_denied':
      return 'denied';
    case 'operation_in_progress':
      return 'conflict';
    case 'quick_search_rate_limited':
      return 'rateLimited';
    case 'search_unavailable':
    case 'provider_unavailable':
      return 'unavailable';
  }
  if (failure?.status === 403) return 'denied';
  if (failure?.status === 429) return 'rateLimited';
  if (failure?.status === 503) return 'unavailable';
  return 'failed';
}
export interface SearchResponse {
  items: SearchDocument[];
  itemCount: number;
  tags: string[];
}
export const kindIcons: Record<SearchKind, string> = {
  tag: 'pricetag-outline',
  table: 'grid-outline',
  column: 'list-outline',
  view: 'eye-outline',
  query: 'code-slash-outline',
  dashboard: 'bar-chart-outline',
  check: 'checkmark-circle-outline',
  entity: 'cube-outline',
  server: 'server-outline',
  environment: 'layers-outline',
};
export const kindNames: Record<SearchKind, string> = {
  tag: 'Tag',
  table: 'Table',
  column: 'Column',
  view: 'View',
  query: 'Query',
  dashboard: 'Dashboard',
  check: 'Check',
  entity: 'Entity',
  server: 'Server',
  environment: 'Environment',
};
export const normalizedName = (name: string) =>
  name.trim().normalize('NFKC').toLocaleLowerCase('en-US');
export interface SearchGroup {
  name: string;
  key: string;
  items: SearchDocument[];
}
export function groupSearchItems(
  items: readonly SearchDocument[],
): SearchGroup[] {
  const groups = new Map<string, SearchGroup>();
  for (const item of items) {
    const key = normalizedName(item.name);
    let group = groups.get(key);
    if (!group) {
      group = { name: item.name.trim(), key, items: [] };
      groups.set(key, group);
    }
    const identity = JSON.stringify([item.kind, item.id, item.reference]);
    if (
      !group.items.some(
        (existing) =>
          JSON.stringify([existing.kind, existing.id, existing.reference]) ===
          identity,
      )
    )
      group.items.push(item);
  }
  return [...groups.values()];
}
export function searchChipLabel(
  item: SearchDocument,
  group: SearchGroup,
): string {
  const base =
    kindNames[item.kind] + (item.sourceName ? '@' + item.sourceName : '');
  const duplicate =
    group.items.filter(
      (other) =>
        other.kind === item.kind && other.sourceName === item.sourceName,
    ).length > 1;
  if (!duplicate) return base;
  const context = [
    item.reference.environmentId,
    item.reference.sourceId,
    item.reference.schema,
    item.parentName,
  ]
    .filter(Boolean)
    .join('/');
  return (
    base +
    ' · ' +
    (item.qualifiedName || context || item.id) +
    (context && item.qualifiedName ? ' · ' + context : '')
  );
}
function withParameters(href: string, values: Record<string, string>): string {
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(values)) params.set(key, value);
  return path + '?' + params.toString();
}
/** Closed typed routes only. Provider documents never supply a URL. */
export function searchItemHref(
  ref: IProjectRef,
  item: SearchDocument,
): string | undefined {
  const r = item.reference;
  const id = r.objectId || item.id;
  let page: string[];
  switch (item.kind) {
    case 'tag':
      return withParameters(projectPageHref(ref, ['tags']), {
        name: item.name,
      });
    case 'query':
      return withParameters(projectPageHref(ref, ['query', item.id]), {
        id: item.id,
      });
    case 'dashboard':
      page = ['board', id];
      break;
    case 'check':
      if (
        ['github', 'github.com'].includes(ref.storeId) &&
        !isPublicChecksProject(ref)
      )
        return withParameters(projectPageHref(ref, ['quick-search']), {
          detailKind: 'check',
          objectId: id,
        });
      page = ['checks', id];
      break;
    case 'entity':
      page = ['entity', id];
      break;
    case 'environment':
      page = ['env', r.environmentId || id];
      break;
    case 'table':
    case 'column':
    case 'view':
      if (!r.dbModelId || !r.table) return undefined;
      return withParameters(
        projectPageHref(ref, ['search-schema', r.dbModelId]),
        {
          schema: r.schema || '',
          table: r.table,
          ...(r.column ? { column: r.column } : {}),
        },
      );
    default:
      return undefined;
  }
  return projectPageHref(ref, page);
}

export type CheckMetadataTarget =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'check'; objectId: string };
/** Query metadata mode is closed: duplicate, unknown and incomplete selectors fail visibly. */
export function checkMetadataTarget(params: {
  has(name: string): boolean;
  getAll(name: string): string[];
}): CheckMetadataTarget {
  if (!params.has('detailKind') && !params.has('objectId'))
    return { kind: 'none' };
  const kinds = params.getAll('detailKind'),
    ids = params.getAll('objectId');
  return kinds.length === 1 &&
    kinds[0] === 'check' &&
    ids.length === 1 &&
    /^[A-Za-z0-9_-]{1,128}$/.test(ids[0])
    ? { kind: 'check', objectId: ids[0] }
    : { kind: 'invalid' };
}
