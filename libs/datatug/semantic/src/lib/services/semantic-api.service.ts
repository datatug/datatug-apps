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
} from '../models/models';

/**
 * Typed client for the semantic-resolution and execution endpoints described in the hub
 * Feature's "API contracts" table (datatug/datatug:
 * spec/features/core-investigation-loop/README.md). The browser MUST use only this
 * client to resolve meaning, related records and applicable queries — it MUST NOT
 * evaluate name patterns or build queries itself (REQ:semantic-resolution-endpoint,
 * REQ:related-lookup-execution).
 *
 * The base URL comes from {@link DATATUG_AGENT_BASE_URL} so the agent-URL builder
 * landing on `fix/phase0-web-agent-contract` (stream S2) can provide it later without
 * this service importing anything from that stream.
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
      .set('source', request.source)
      .set('collection', request.collection);
    return this.http.get<SemanticColumnsResponse>(
      `${this.baseUrl}/semantic/columns`,
      { params },
    );
  }

  /** `GET /datatug/semantic/related` */
  getRelated(
    request: SemanticRelatedRequest,
  ): Observable<SemanticRelatedResponse> {
    const params = this.withOptionalLimit(
      new HttpParams()
        .set('project', request.project)
        .set('entity', request.entity)
        .set('field', request.field)
        .set('value', String(request.value)),
      request.limit,
    );
    return this.http.get<SemanticRelatedResponse>(
      `${this.baseUrl}/semantic/related`,
      { params },
    );
  }

  /** `GET /datatug/semantic/related/rows` */
  getRelatedRows(
    request: SemanticRelatedRowsRequest,
  ): Observable<SemanticRelatedRowsResponse> {
    const params = this.withOptionalLimit(
      new HttpParams()
        .set('project', request.project)
        .set('lookupId', request.lookupId)
        .set('value', String(request.value)),
      request.limit,
    );
    return this.http.get<SemanticRelatedRowsResponse>(
      `${this.baseUrl}/semantic/related/rows`,
      { params },
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

  private withOptionalLimit(
    params: HttpParams,
    limit: number | undefined,
  ): HttpParams {
    return limit === undefined ? params : params.set('limit', String(limit));
  }
}
