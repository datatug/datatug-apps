import { IProjItemBrief } from './project';
import { IParameterDef } from './parameter';
import { IRecordsetDef } from './recordset';
import { HttpMethod } from './command-definition';
import { IWidgetRef } from './widget';

export enum QueryType {
  HTTP = 'HTTP',
  SQL = 'SQL',
  // DTQL: datatug-cli's own `datatug.QueryType` (query.go) has carried this
  // since before this enum was last touched — demo-project-1's own
  // customer-invoices.query.json is DTQL-typed, and GET
  // /datatug/queries/all_queries (Task 17 item A.1, S121) lists it with
  // that type verbatim. Added here (rather than folding it into SQL) so
  // QueriesTabComponent's type badge/filter show the query's real,
  // server-reported type instead of a lossy substitution.
  DTQL = 'DTQL',
}

export type IQueryItem = IProjItemBrief;

export interface IQueryFolder extends IQueryItem {
  folders?: IQueryFolder[];
  items?: IQueryDef[];
}

export interface IQueryFolderContext extends IQueryFolder {
  // TODO: document what & why
  path: string;
}

// Defines user's query
export interface IQueryDef extends IQueryItem {
  request: IQueryRequest;
  draft?: boolean;
  parameters?: IParameterDef[];
  dbModel?: string;
  targets?: IQueryTarget[];
  recordsets?: IRecordsetDef[];
  widgets?: IWidgetRef[];
}

// Defines request to some data without parameters
// We need it decouple from IQueryDef - why?
export interface IQueryRequest {
  queryType: QueryType; // for example: SQL, HTTP, etc.
}

// A base interface for queries that uses some text based language like SQL, GraphQL, etc.
export interface ITextQueryRequest extends IQueryRequest {
  text: string;
}

export interface ISqlQueryRequest extends ITextQueryRequest {
  queryType: QueryType.SQL;
}

export interface IHttpQueryRequest extends IQueryRequest {
  queryType: QueryType.HTTP;
  url: string;
  method: HttpMethod;
  body?: string;
}

export type QueryItem = IQueryDef | IQueryFolder;

export interface IQueryTarget {
  host?: string;
  port?: number;
  catalog?: string;
  credentials?: ICredentials;
}

export interface ICredentials {
  username: string;
}
