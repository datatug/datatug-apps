import { projectTagHref } from '../tags/tag-navigation';
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
      return projectTagHref(ref, item.name);
    case 'query':
      return withParameters(projectPageHref(ref, ['query', item.id]), {
        id: item.id,
      });
    case 'dashboard':
      page = ['board', id];
      break;
    case 'check':
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

/** Name groups retain cross-kind discovery separately from actual tag detail. */
export function searchNameHref(ref: IProjectRef, name: string): string {
  return withParameters(projectPageHref(ref, ['tag-discovery']), {name});
}
