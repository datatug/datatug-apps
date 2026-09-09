import { Observable, of } from 'rxjs';
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
// Referenced only in the JSDoc `{@link SemanticApiService}` below.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { SemanticApiService } from './semantic-api.service';

export interface MockSemanticApiFixtures {
  readonly columns?: SemanticColumnsResponse;
  readonly related?: SemanticRelatedResponse;
  /** Keyed by `lookupId`. */
  readonly relatedRows?: Readonly<Record<string, SemanticRelatedRowsResponse>>;
  readonly applicable?: ApplicableQueriesResponse;
  readonly runQuery?: RunQueryResponse;
}

export interface RecordedCall {
  readonly method:
    | 'getSemanticColumns'
    | 'getRelated'
    | 'getRelatedRows'
    | 'getApplicableQueries'
    | 'runQuery';
  readonly request: unknown;
}

/**
 * In-memory test double for {@link SemanticApiService} — same method shape, no network
 * (REQ:no-hidden-filters and the J2-J4 tests must stay off the wire per the brief).
 * Returns canned fixtures synchronously via `of(...)` and records every call so tests can
 * assert what the components under test actually requested.
 *
 * Provide it in a TestBed with:
 * ```ts
 * const mock = new MockSemanticApi(fixtures);
 * TestBed.configureTestingModule({
 *   providers: [{ provide: SemanticApiService, useValue: mock as unknown as SemanticApiService }],
 * });
 * ```
 */
export class MockSemanticApi {
  readonly calls: RecordedCall[] = [];

  constructor(private readonly fixtures: MockSemanticApiFixtures = {}) {}

  getSemanticColumns(
    request: SemanticColumnsRequest,
  ): Observable<SemanticColumnsResponse> {
    this.calls.push({ method: 'getSemanticColumns', request });
    return of(this.fixtures.columns ?? []);
  }

  getRelated(
    request: SemanticRelatedRequest,
  ): Observable<SemanticRelatedResponse> {
    this.calls.push({ method: 'getRelated', request });
    return of(this.fixtures.related ?? []);
  }

  getRelatedRows(
    request: SemanticRelatedRowsRequest,
  ): Observable<SemanticRelatedRowsResponse> {
    this.calls.push({ method: 'getRelatedRows', request });
    return of(
      this.fixtures.relatedRows?.[request.lookupId] ?? {
        recordset: { columns: [], rows: [] },
        limitations: [],
      },
    );
  }

  getApplicableQueries(
    request: ApplicableQueriesRequest,
  ): Observable<ApplicableQueriesResponse> {
    this.calls.push({ method: 'getApplicableQueries', request });
    return of(this.fixtures.applicable ?? { applicable: [], notYet: [] });
  }

  runQuery(request: RunQueryRequest): Observable<RunQueryResponse> {
    this.calls.push({ method: 'runQuery', request });
    return of(
      this.fixtures.runQuery ?? {
        recordset: { columns: [], rows: [] },
        limitations: [],
        bindingsApplied: [],
      },
    );
  }
}
