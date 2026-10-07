import {
  type IQueryDef,
  type ITextQueryRequest,
  type IHttpQueryRequest,
  QueryType,
} from '../models/definition/query-def';

/** The supported Core v0.44.0 query envelope. Richer browser plans must refuse a lossy save. */
export interface ProjectQueryWire {
  readonly folderPath: string;
  readonly id: string;
  readonly title?: string;
  readonly type: QueryType.SQL | QueryType.DTQL;
  readonly text: string;
  readonly draft?: boolean;
  readonly federation?: IQueryDef['federation'];
}

export type ProjectQueryReadWire = Omit<ProjectQueryWire, 'type'> & {
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
  readonly querySave: boolean;
  readonly branches: boolean;
  readonly branchMerge: boolean;
  readonly reviewedCommit: boolean;
  readonly pullCurrent: boolean;
  readonly pushCurrent: boolean;
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
  assertFields(query, ['id', 'title', 'request', 'draft', 'federation']);
  assertFields(query.request, ['queryType', 'text']);
  if (![QueryType.SQL, QueryType.DTQL].includes(query.request.queryType))
    throw new UnsupportedQueryContractError();
  const text = (query.request as ITextQueryRequest).text;
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
    folderPath,
    id,
    ...(query.title !== undefined ? { title: query.title } : {}),
    type: query.request.queryType as ProjectQueryWire['type'],
    text,
    ...(query.draft !== undefined ? { draft: query.draft } : {}),
    ...(query.federation ? { federation: query.federation } : {}),
  });
}

export function fromProjectQueryWire(query: ProjectQueryReadWire): IQueryDef {
  // Reads preserve legacy/richer metadata; save validates the entire definition separately.
  const metadata = { ...query };
  for (const key of ['folderPath', 'id', 'title', 'type', 'text'])
    delete metadata[key];
  const mapped: IQueryDef = {
    ...metadata,
    id: query.id,
    ...(query.title !== undefined ? { title: query.title } : {}),
    request:
      query.type === QueryType.HTTP
        ? ({
            queryType: QueryType.HTTP,
            url: query.text ?? '',
            method: 'GET',
          } as IHttpQueryRequest)
        : ({
            queryType: query.type,
            text: query.text ?? '',
          } as ITextQueryRequest),
    ...(query.draft !== undefined ? { draft: query.draft } : {}),
    ...(query.federation ? { federation: query.federation } : {}),
  };
  return structuredClone(mapped);
}
