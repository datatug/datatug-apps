import {
  projectQueryMetadataForSave,
  type ProjectQueryMetadataWire,
} from './project-query-metadata';
import { validateQueryComparison } from './query-comparison';
import {
  type IQueryDef,
  type ITextQueryRequest,
  type IHttpQueryRequest,
  QueryType,
} from '../models/definition/query-def';
import { savableHttpHeaders } from './http-credential-headers';
import { httpMethodAllowsBody } from './http-request-rules';

/** The supported Core query envelope. Richer browser plans must refuse a lossy save. */
export interface ProjectQueryWire extends ProjectQueryMetadataWire {
  readonly comparison?: IQueryDef['comparison'];
  readonly semanticModel?: IQueryDef['semanticModel'];
  readonly folderPath: string;
  readonly id: string;
  readonly title?: string;
  readonly purpose?: string;
  readonly type: QueryType.SQL | QueryType.TugQL | QueryType.DTQL | QueryType.HTTP;
  /** The query text; for an HTTP query, its URL. */
  readonly text: string;
  /** The saved request of an HTTP query beyond its URL; never holds credentials. */
  readonly http?: ProjectQueryHttpWire;
  readonly draft?: boolean;
  readonly connectionId?: string;
  readonly federation?: IQueryDef['federation'];
  /** Declared parameters of an HTTP query (http-query-parameters). */
  readonly parameters?: IQueryDef['parameters'];
}

export interface ProjectQueryHttpWire {
  readonly method?: string;
  readonly headers?: readonly { readonly name: string; readonly value: string }[];
  readonly body?: string;
}

export type ProjectQueryReadWire = Omit<
  ProjectQueryWire,
  'type' | 'comparison' | 'parameters' | 'recordsets'
> & {
  readonly type: QueryType;
  readonly [key: string]: unknown;
};

export interface ProjectQueryRevision {
  readonly query: ProjectQueryReadWire;
  readonly revision: string;
  readonly branchHead?: string;
  readonly saveSupported?: boolean;
  readonly unsupportedSaveReason?: string;
}

export interface ProjectQueryCapabilities {
  readonly queryRead: boolean;
  readonly semanticModel?: boolean;
  readonly querySave: boolean;
  readonly branches: boolean;
  readonly branchMerge: boolean;
  readonly reviewedCommit: boolean;
  readonly pullCurrent: boolean;
  readonly pushCurrent: boolean;
  /** Server-verified Business usage scope for this exact registered GitHub project. */
  readonly activityScope?: GitHubProjectActivityScope;
}

/** A selector returned by authenticated capabilities, never an authorization grant. */
export interface GitHubProjectActivityScope {
  readonly spaceID: string;
  readonly projectID: string;
}

export class UnsupportedQueryContractError extends Error {
  constructor() {
    super(
      'This query contains fields the current save API cannot preserve. Keep the draft and use a compatible API before saving.',
    );
  }
}

function assertFields(value: object, allowed: readonly string[]): void {
  if (
    Object.entries(value).some(
      ([key, entry]) => entry !== undefined && !allowed.includes(key),
    )
  )
    throw new UnsupportedQueryContractError();
}

export function toProjectQueryWire(
  query: IQueryDef,
  location = query.id,
): ProjectQueryWire {
  validateQueryComparison(query);
  let metadata: ProjectQueryMetadataWire;
  try {
    metadata = projectQueryMetadataForSave(query);
  } catch {
    throw new UnsupportedQueryContractError();
  }
  assertFields(query, [
    'id',
    'title',
    'purpose',
    // Server-managed metadata may round-trip through the editor but is never sent on save.
    'createdAt',
    'request',
    'draft',
    'connectionId',
    'federation',
    'semanticModel',
    'comparison',
    'parameters',
    'recordsets',
  ]);
  // Core owns credential screening and the bounded whole-query save admission.
  if (query.purpose !== undefined && typeof query.purpose !== 'string')
    throw new UnsupportedQueryContractError();
  const isHttp = query['request'].queryType === QueryType.HTTP;
  for (const p of (isHttp ? query.parameters : undefined) ?? [])
    assertFields(p, ['id', 'type', 'title', 'defaultValue', 'isRequired', 'isCredential', 'meta']);
  assertFields(
    query['request'],
    isHttp
      ? ['queryType', 'url', 'method', 'headers', 'body']
      : ['queryType', 'text'],
  );
  if (
    ![QueryType.SQL, QueryType.TugQL, QueryType.DTQL, QueryType.HTTP].includes(
      query['request'].queryType,
    )
  )
    throw new UnsupportedQueryContractError();
  const httpRequest = isHttp ? (query['request'] as IHttpQueryRequest) : undefined;
  const text = httpRequest
    ? httpRequest.url
    : (query['request'] as ITextQueryRequest).text;
  if (typeof text !== 'string') throw new UnsupportedQueryContractError();
  if (query.federation) {
    assertFields(query.federation, ['ovdbBaseUrl', 'tables', 'lookups']);
    for (const table of query.federation.tables)
      assertFields(table, ['name', 'database', 'schema', 'fields']);
    for (const lookup of query.federation.lookups ?? []) {
      assertFields(lookup, [
        'database',
        'collection',
        'fromColumn',
        'fields',
        'concurrency',
      ]);
      for (const field of lookup.fields)
        assertFields(field, ['source', 'target']);
    }
  }
  const slash = location.lastIndexOf('/');
  const folderPath = slash < 0 ? '~' : location.slice(0, slash);
  const id = slash < 0 ? location : location.slice(slash + 1);
  if (
    !id ||
    id !== query.id ||
    !folderPath ||
    location.startsWith('/') ||
    location.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new UnsupportedQueryContractError();
  return structuredClone({
    ...metadata,
    ...(query.comparison ? { comparison: query.comparison } : {}),
    ...(query.semanticModel ? { semanticModel: query.semanticModel } : {}),
    folderPath,
    id,
    ...(query.title !== undefined ? { title: query.title } : {}),
    ...(query.purpose !== undefined ? { purpose: query.purpose } : {}),
    type: query['request'].queryType as ProjectQueryWire['type'],
    text,
    ...(httpRequest ? { http: httpWire(httpRequest) } : {}),
    ...(httpRequest && query.parameters?.length
      ? { parameters: query.parameters }
      : {}),
    ...(query.draft !== undefined ? { draft: query.draft } : {}),
    ...(query.connectionId !== undefined
      ? { connectionId: query.connectionId }
      : {}),
    ...(query.federation ? { federation: query.federation } : {}),
  });
}

/** The saved part of an HTTP request: credential headers are stripped, never persisted. */
function httpWire(request: IHttpQueryRequest): ProjectQueryHttpWire {
  const headers = savableHttpHeaders(request.headers).map(
    ({ name, value }) => ({ name, value }),
  );
  return {
    method: request.method ?? 'GET',
    ...(headers.length ? { headers } : {}),
    ...(request.body && httpMethodAllowsBody(request.method)
      ? { body: request.body }
      : {}),
  };
}

export function fromProjectQueryWire(query: ProjectQueryReadWire): IQueryDef {
  // Reads preserve legacy/richer metadata; save validates the entire definition separately.
  const metadata = { ...query };
  for (const key of ['folderPath', 'id', 'title', 'type', 'text', 'http'])
    delete metadata[key];
  const request =
    query['request'] && typeof query['request'] === 'object'
      ? (query['request'] as Partial<ITextQueryRequest & IHttpQueryRequest>)
      : {};
  const mapped: IQueryDef = {
    ...metadata,
    id: query.id,
    ...(query.title !== undefined ? { title: query.title } : {}),
    request:
      query.type === QueryType.HTTP
        ? ({
            ...request,
            queryType: QueryType.HTTP,
            url: query.text ?? request.url ?? '',
            method: (query.http?.method || request.method || 'GET') as IHttpQueryRequest['method'],
            ...(query.http?.headers?.length
              ? { headers: query.http.headers }
              : {}),
            ...(query.http?.body ? { body: query.http.body } : {}),
          } as IHttpQueryRequest)
        : ({
            ...request,
            queryType: query.type,
            text: query.text ?? request.text ?? '',
          } as ITextQueryRequest),
    ...(query.draft !== undefined ? { draft: query.draft } : {}),
    ...(query.federation ? { federation: query.federation } : {}),
  };
  validateQueryComparison(mapped);
  return structuredClone(mapped);
}
