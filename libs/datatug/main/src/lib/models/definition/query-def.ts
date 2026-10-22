import { IProjItemBrief } from './project';
import { IParameterDef } from './parameter';
import { IRecordsetDef } from './recordset';
import { HttpMethod } from './command-definition';
import { IWidgetRef } from './widget';
import type { BoundedFederation } from '../../queries/public-data/bounded-federation';
import type { PublicDataScenario } from '../../queries/public-data/public-data-scenario';

export enum QueryType {
  HTTP = 'HTTP',
  SQL = 'SQL',
  TugQL = 'TugQL',
  // DTQL: retained as backwards-compatible alias for TugQL.
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
  readonly comparison?: import('../../queries/query-comparison').QueryComparison;
  /** Store-assigned creation instant (RFC3339); drafts omit it until first save. */
  readonly createdAt?: string;
  semanticModel?: import("../../queries/semantic-mapping").SemanticModel;
  request: IQueryRequest;
  /** Reviewed schema relationship pins retained by Git-backed query files. */
  relationshipBindings?: readonly IQueryRelationshipBinding[];
  /** Project connection declaration ID; never a URL or credential. */
  connectionId?: string;
  draft?: boolean;
  parameters?: IParameterDef[];
  dbModel?: string;
  targets?: IQueryTarget[];
  recordsets?: IRecordsetDef[];
  federation?: {
    readonly ovdbBaseUrl: string;
    /** One admitted origin/identity pair; not independent source eligibility. */
    readonly expectedServerIdentity?: {
      readonly baseUrl: string;
      readonly serverId: string;
    };
    /** Required captured evidence for structured sources; metadata is never admission authority. */
    readonly expectedSourceRights?: readonly import('@sneat/datatug-semantic').SourceRight[];
    readonly bounds?: BoundedFederation;
    /** Finite saved graph inputs; never execution authority. */
    readonly nativeGraph?: import('../../queries/public-data/native-graph-executor').NativeGraphPlan;
    /** Descriptive historical pages/pins; reopening never executes them. */
    readonly readReceipt?: import('../../queries/public-data/immutable-federation').RuntimeReadReport;
    readonly tables: readonly {
      readonly name: string;
      readonly database?: string;
      readonly schema?: string;
      readonly fields: readonly string[];
    }[];
    readonly lookups?: readonly {
      readonly database: string;
      readonly collection: string;
      readonly fromColumn: string;
      readonly fields: readonly {
        readonly source: string;
        readonly target: string;
      }[];
      readonly concurrency?: number;
    }[];
  };
  publicData?: PublicDataScenario;
  widgets?: IWidgetRef[];
}

export interface IQueryRelationshipBinding {
  readonly id: string;
  readonly version: string;
  readonly from: { readonly schema: string; readonly table: string };
  readonly to: { readonly schema: string; readonly table: string };
  readonly pairs: readonly {
    readonly fromField: string;
    readonly toField: string;
  }[];
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

/** Persisted query records always include store-assigned creation metadata. */
export interface ISavedQueryDef extends IQueryDef { readonly createdAt: string; }
