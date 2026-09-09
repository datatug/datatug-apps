import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ApplicableQueriesResponse,
  Fact,
  RunQueryResponse,
  SemanticColumnsResponse,
  SemanticRelatedResponse,
  SemanticRelatedRowsResponse,
} from '../../contract/types';
import { DATATUG_AGENT_BASE_URL } from '../tokens/datatug-agent-base-url.token';
import { SemanticApiService } from './semantic-api.service';

const BASE_URL = 'http://localhost:8989/datatug';

const SCOPE = {
  project: 'demo-project-1',
  environment: 'production',
  securityContextId: 'sctx-1',
};

const CUSTOMER_ID_FACT: Fact = {
  id: 'Customer.ID=5',
  entity: 'Customer',
  field: 'ID',
  value: { type: 'integer', value: '5' },
  origin: 'selection',
  enabled: true,
};

describe('SemanticApiService', () => {
  let service: SemanticApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SemanticApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('defaults the base URL to http://localhost:8989/datatug', () => {
    expect(TestBed.inject(DATATUG_AGENT_BASE_URL)).toBe(BASE_URL);
  });

  it('GET /datatug/semantic/columns sends Scope + source/collection as query params', () => {
    const fixture: SemanticColumnsResponse = {
      columns: [
        { column: 'CustomerId', entity: 'Customer', field: 'ID', provenance: 'declared' },
        { column: 'Email', entity: 'Customer', field: 'Email', provenance: 'declared' },
      ],
    };
    let result: SemanticColumnsResponse | undefined;
    service
      .getSemanticColumns({ ...SCOPE, source: 'chinook', collection: 'Customer' })
      .subscribe((r) => (result = r));

    const req = httpMock.expectOne(
      (r) => r.url === `${BASE_URL}/semantic/columns`,
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('project')).toBe('demo-project-1');
    expect(req.request.params.get('environment')).toBe('production');
    expect(req.request.params.get('securityContextId')).toBe('sctx-1');
    expect(req.request.params.get('source')).toBe('chinook');
    expect(req.request.params.get('collection')).toBe('Customer');
    req.flush(fixture);

    expect(result).toEqual(fixture);
  });

  it('POST /datatug/semantic/related sends Scope + fact + limit as a JSON body, never in the URL', () => {
    const fixture: SemanticRelatedResponse = {
      related: [
        { lookupId: 'invoices', label: 'Invoices', source: 'chinook', collection: 'Invoice', count: 7 },
        { lookupId: 'support-notes', label: 'Support notes', source: 'support-notes', collection: 'notes', count: 2 },
      ],
      truncated: false,
    };
    let result: SemanticRelatedResponse | undefined;
    service
      .getRelated({ ...SCOPE, fact: CUSTOMER_ID_FACT, limit: 10 })
      .subscribe((r) => (result = r));

    const req = httpMock.expectOne(`${BASE_URL}/semantic/related`);
    expect(req.request.method).toBe('POST');
    expect(req.request.url).not.toContain('5'); // the value never leaks into the URL
    expect(req.request.body).toEqual({ ...SCOPE, fact: CUSTOMER_ID_FACT, limit: 10 });
    req.flush(fixture);

    expect(result).toEqual(fixture);
  });

  it('POST /datatug/semantic/related/rows sends Scope + lookupId + typed value', () => {
    const fixture: SemanticRelatedRowsResponse = {
      recordset: { columns: [{ name: 'InvoiceId', type: 'integer' }], rows: [[{ type: 'integer', value: '1' }]] },
      limitations: [],
      bindingsApplied: [],
      provenance: {
        source: 'chinook',
        mode: 'live',
        observedAt: '2026-09-09T12:00:00Z',
        executionProfile: 'protected',
      },
      truncated: false,
    };
    let result: SemanticRelatedRowsResponse | undefined;
    service
      .getRelatedRows({
        ...SCOPE,
        lookupId: 'invoices',
        value: { type: 'integer', value: '5' },
      })
      .subscribe((r) => (result = r));

    const req = httpMock.expectOne(`${BASE_URL}/semantic/related/rows`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      ...SCOPE,
      lookupId: 'invoices',
      value: { type: 'integer', value: '5' },
    });
    req.flush(fixture);

    expect(result).toEqual(fixture);
  });

  it('POST /datatug/queries/applicable sends Scope + Fact[] values', () => {
    const fixture: ApplicableQueriesResponse = {
      applicable: [
        {
          queryId: 'customer-invoices',
          targets: [{ source: 'chinook', label: 'Chinook (SQLite)' }],
          selectedSource: 'chinook',
          bindings: [
            {
              parameterId: 'CustomerId',
              value: { type: 'integer', value: '5' },
              origin: 'selection',
              originEvidence: 'client-reported',
            },
          ],
          chain: [
            { parameterId: 'CustomerId', explanation: 'maps to Customer.ID (declared)' },
          ],
          missing: [],
          ambiguous: [],
          state: 'runnable',
        },
      ],
      notYet: [
        {
          queryId: 'invoice-lines',
          targets: [],
          bindings: [],
          chain: [],
          missing: ['InvoiceId'],
          ambiguous: [],
          state: 'needs-input',
        },
      ],
    };
    let result: ApplicableQueriesResponse | undefined;
    service
      .getApplicableQueries({ ...SCOPE, values: [CUSTOMER_ID_FACT] })
      .subscribe((r) => (result = r));

    const req = httpMock.expectOne(`${BASE_URL}/queries/applicable`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ ...SCOPE, values: [CUSTOMER_ID_FACT] });
    req.flush(fixture);

    expect(result).toEqual(fixture);
  });

  it('POST /datatug/exec/run_query sends the full ExecutionRequest as-is', () => {
    const fixture: RunQueryResponse = {
      recordset: { columns: [], rows: [] },
      limitations: [{ policy: 'customers-support', rowsFiltered: true, hiddenColumns: [] }],
      bindingsApplied: [
        {
          parameterId: 'CustomerId',
          value: { type: 'integer', value: '5' },
          origin: 'selection',
          originEvidence: 'client-reported',
        },
      ],
      provenance: {
        source: 'chinook',
        mode: 'live',
        observedAt: '2026-09-09T12:00:00Z',
        executionProfile: 'protected',
      },
      truncated: false,
    };
    let result: RunQueryResponse | undefined;
    const request = {
      ...SCOPE,
      queryId: 'customer-invoices',
      parameters: { CustomerId: { type: 'integer' as const, value: '5' } },
      bindingOrigins: [{ parameterId: 'CustomerId', origin: 'selection' as const }],
      mode: 'live' as const,
    };
    service.runQuery(request).subscribe((r) => (result = r));

    const req = httpMock.expectOne(`${BASE_URL}/exec/run_query`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    req.flush(fixture);

    expect(result).toEqual(fixture);
  });
});
