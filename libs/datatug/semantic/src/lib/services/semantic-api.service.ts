import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DATATUG_AGENT_BASE_URL } from '../tokens/datatug-agent-base-url.token';
import {
  ApplicableQueriesRequest,
  ApplicableQueriesResponse,
  RunQueryRequest,
  RunQueryResponse,
  SemanticColumnsRequest,
  SemanticColumnsResponse,
  SemanticRelatedRequest,
  SemanticRelatedResponse,
  SemanticRelatedRowsRequest,
  SemanticRelatedRowsResponse,
} from '../../contract/types';

/**
 * Typed client for the semantic-resolution and execution endpoints described in the hub
 * Feature's normative transport appendix (datatug/datatug:
 * spec/features/core-investigation-loop/api-contract.md — see ../../contract/types.ts for
 * the exact shapes). The browser MUST use only this client to resolve meaning, related
 * records and applicable queries — it MUST NOT evaluate name patterns or build queries
 * itself (REQ:semantic-resolution-endpoint, REQ:related-lookup-execution).
 *
 * Every request carries the caller's full {@link import('../../contract/types').Scope}
 * (`project`, `environment`, `securityContextId`) — this service does not inject
 * `AgentContextService` itself, so a caller obtains `securityContextId` from it and
 * reacts to a `STALE_CONTEXT` (409) response by calling `AgentContextService.refresh()`
 * and retrying (plan Task 12 item 3; full reactive isolation is Task 15).
 *
 * `related`/`related/rows`/`applicable`/`run_query` are POST so semantic values (facts,
 * typed parameter values) are never copied into a URL, browser history or access log —
 * only `semantic/columns` (identifiers only) stays GET, per the appendix's endpoint table.
 *
 * The base URL comes from {@link DATATUG_AGENT_BASE_URL}.
 */
@Injectable({ providedIn: 'root' })
export class SemanticApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(DATATUG_AGENT_BASE_URL);

  /** `GET /datatug/semantic/columns` */
  getSemanticColumns(
    request: SemanticColumnsRequest,
  ): Observable<SemanticColumnsResponse> {
    const params = new HttpParams()
      .set('project', request.project)
      .set('environment', request.environment)
      .set('securityContextId', request.securityContextId)
      .set('source', request.source)
      .set('collection', request.collection);
    return this.http.get<SemanticColumnsResponse>(
      `${this.baseUrl}/semantic/columns`,
      { params },
    );
  }

  /** `POST /datatug/semantic/related` */
  getRelated(
    request: SemanticRelatedRequest,
  ): Observable<SemanticRelatedResponse> {
    return this.http.post<SemanticRelatedResponse>(
      `${this.baseUrl}/semantic/related`,
      request,
    );
  }

  /** `POST /datatug/semantic/related/rows` */
  getRelatedRows(
    request: SemanticRelatedRowsRequest,
  ): Observable<SemanticRelatedRowsResponse> {
    return this.http.post<SemanticRelatedRowsResponse>(
      `${this.baseUrl}/semantic/related/rows`,
      request,
    );
  }

  /** `POST /datatug/queries/applicable` */
  getApplicableQueries(
    request: ApplicableQueriesRequest,
  ): Observable<ApplicableQueriesResponse> {
    return this.http.post<ApplicableQueriesResponse>(
      `${this.baseUrl}/queries/applicable`,
      request,
    );
  }

  /** `POST /datatug/exec/run_query` */
  runQuery(request: RunQueryRequest): Observable<RunQueryResponse> {
    return this.http.post<RunQueryResponse>(
      `${this.baseUrl}/exec/run_query`,
      request,
    );
  }
}
