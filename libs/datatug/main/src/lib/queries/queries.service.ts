import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { STORE_ID_GITHUB_COM, STORE_TYPE_GITHUB } from '@sneat/core';
import { IProjectRef } from '../core/project-context';
import { IParameterDef } from '../models/definition/parameter';
import { IRecordsetDef } from '../models/definition/recordset';
import {
  IHttpQueryRequest,
  IQueryDef,
  IQueryFolder,
  IQueryRequest,
  IQueryTarget,
  ITextQueryRequest,
  QueryType,
} from '../models/definition/query-def';
import { ProjectItemService } from '../services/repo/project-item-service';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { QUERY_PROJ_ITEM_SERVICE } from './queries.service.token';

const isGithubStoreId = (storeId: string): boolean =>
  storeId === STORE_ID_GITHUB_COM || storeId === STORE_TYPE_GITHUB;

/**
 * The shape datatug-cli's GET /queries/all_queries and /queries/get_query
 * actually put on the wire — flat, matching datatug-core's own
 * `datatug.QueryDef` JSON tags (`type`, `text`) — NOT `IQueryDef`'s nested
 * `request: {queryType, text}` client-side shape. Verified live against a
 * real agent (both endpoints, project_full's embedded queries too — every
 * server response for a query item is this same flat shape). Distinct from
 * `IQueryDef` deliberately, so a mismatch between what the server sends and
 * what this file adapts it to is a compile error, not a silent runtime
 * `undefined.queryType`.
 */
interface IWireQueryItem {
  id: string;
  title?: string;
  type: string;
  text?: string;
  draft?: boolean;
  parameters?: IParameterDef[];
  dbModel?: string;
  targets?: IQueryTarget[];
  recordsets?: IRecordsetDef[];
}

interface IWireQueryFolder {
  id: string;
  title?: string;
  folders?: IWireQueryFolder[];
  items?: IWireQueryItem[];
}

/**
 * Adapts one flat wire query item into `IQueryDef`'s nested `request` shape
 * — the same translation `query-editor-state-service.ts`'s own
 * `findQueryInProjectFull()` already does for its `project_full` fallback
 * path (this is the same server, the same flat shape, just reached through
 * `all_queries`/`get_query` instead). `text` is absent from `all_queries`'
 * own response (`loadModuleQueries`, datatug-cli, deliberately never reads
 * a query's SQL/DTQL/HTTP body — only `get_query` does, via
 * `store.LoadQuery`), so the folder-list view's inline SQL preview
 * (`queries-tab.component.html`'s `sneat-datatug-sql`) renders empty for a
 * query reached that way; the query PAGE (opened via `get_query`) always
 * has the real text.
 */
function toQueryRequest(type: string, text: string | undefined): IQueryRequest {
  if (type === QueryType.HTTP) {
    const httpRequest: IHttpQueryRequest = {
      queryType: QueryType.HTTP,
      url: text ?? '',
      method: 'GET',
    };
    return httpRequest;
  }
  // SQL and DTQL alike: the list/query-page views only ever branch on
  // `queryType === 'SQL'` for the inline-SQL-preview panel
  // (queries-tab.component.html) — a DTQL query's `text` is its own YAML
  // body, harmlessly unused by that branch.
  return { queryType: type as QueryType, text: text ?? '' } as ITextQueryRequest;
}

function toQueryDef(item: IWireQueryItem): IQueryDef {
  const { type, text, ...rest } = item;
  return { ...rest, request: toQueryRequest(type, text) };
}

function toQueryFolder(folder: IWireQueryFolder): IQueryFolder {
  return {
    id: folder.id,
    title: folder.title,
    folders: folder.folders?.map(toQueryFolder),
    items: folder.items?.map(toQueryDef),
  };
}

@Injectable()
export class QueriesService {
  private readonly projItemService = inject<ProjectItemService<IQueryDef>>(
    QUERY_PROJ_ITEM_SERVICE,
  );
  private readonly githubReader = inject(GithubProjectReaderService);

  /**
   * GitHub-store branch reads `queries/` directly off the repo (no CLI
   * agent — `GithubProjectReaderService.getQueriesFolder()`); `folderPath`
   * is ignored there deliberately, same as `QueriesTabComponent`'s own
   * agent-backed call already effectively gets: the reader always returns
   * the FULL recursive tree in one shot (mirrors datatug-cli's own
   * `all_queries` — see `query_endpoints.go`'s own doc comment: "the
   * response must carry the FULL recursive tree... not just the top level
   * or whatever folder= was requested").
   */
  public getQueriesFolder(
    projRef: IProjectRef,
    folderPath: string,
  ): Observable<IQueryFolder | null | undefined> {
    if (isGithubStoreId(projRef.storeId)) {
      return this.githubReader
        .getQueriesFolder(projRef.projectId)
        .pipe(map((folder) => toQueryFolder(folder as unknown as IWireQueryFolder)));
    }
    return this.projItemService
      .getFolder<IWireQueryFolder>(projRef, folderPath)
      .pipe(map((folder) => (folder ? toQueryFolder(folder) : folder)));
  }

  public getQuery(projRef: IProjectRef, id: string): Observable<IQueryDef> {
    if (isGithubStoreId(projRef.storeId)) {
      return this.githubReader
        .getQuery(projRef.projectId, id)
        .pipe(map((item) => toQueryDef(item as unknown as IWireQueryItem)));
    }
    return this.projItemService
      .getProjItem(projRef, id)
      .pipe(map((item) => toQueryDef(item as unknown as IWireQueryItem)));
  }

  public createQueryFolder(
    projRef: IProjectRef,
    path: string,
    id: string,
  ): Observable<IQueryFolder> {
    return this.projItemService.createProjItem(
      projRef,
      {
        path,
        id,
      } as unknown as IQueryDef,
      'folder',
    ) as unknown as Observable<IQueryFolder>;
  }

  public createQuery(
    projRef: IProjectRef,
    query: IQueryDef,
  ): Observable<IQueryDef> {
    return this.projItemService.createProjItem(projRef, query);
  }

  public updateQuery(
    projRef: IProjectRef,
    query: IQueryDef,
  ): Observable<IQueryDef> {
    return this.projItemService.updateProjItem(projRef, query);
  }

  public deleteQuery(
    projRef: IProjectRef,
    folder: string,
    query: IQueryDef,
  ): Observable<void> {
    return this.projItemService.deleteProjItem(
      projRef,
      folder ? folder + '/' + query.id : query.id,
    );
  }

  public deleteQueryFolder(
    projRef: IProjectRef,
    path: string,
  ): Observable<void> {
    return this.projItemService.deleteProjItem(projRef, path, 'folder');
  }
}
