import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ApplicableQueriesResponse,
  RunQueryResponse,
  SemanticColumnsResponse,
  SemanticRelatedResponse,
  SemanticRelatedRowsResponse,
} from '../models/models';
import { DATATUG_AGENT_BASE_URL } from '../tokens/datatug-agent-base-url.token';
import { SemanticApiService } from './semantic-api.service';

const BASE_URL = 'http://localhost:8989/datatug';

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

  it('GET /datatug/semantic/columns sends project/source/collection as query params', () => {
    const fixture: SemanticColumnsResponse = [
      { column: 'CustomerId', entity: 'Customer', field: 'ID', provenance: 'declared' },
      { column: 'Email', entity: 'Customer', field: 'Email', provenance: 'declared' },
    ];
    let result: SemanticColumnsResponse | undefined;
    service
      .getSemanticColumns({
        project: 'demo-project-1',
        source: 'chinook',
        collection: 'Customer',
      })
      .subscribe((r) => (result = r));

    const req = httpMock.expectOne(
      (r) => r.url === `${BASE_URL}/semantic/columns`,
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('project')).toBe('demo-project-1');
    expect(req.request.params.get('source')).toBe('chinook');
    expect(req.request.params.get('collection')).toBe('Customer');
    req.flush(fixture);

    expect(result).toEqual(fixture);
  });

  it('GET /datatug/semantic/related sends entity/field/value and omits limit when not given', () => {
    const fixture: SemanticRelatedResponse = [
      { lookupId: 'invoices', label: 'Invoices', source: 'chinook', collection: 'Invoice', count: 7 },
      { lookupId: 'support-notes', label: 'Support notes', source: 'support-notes', collection: 'notes', count: 2 },
    ];
    let result: SemanticRelatedResponse | undefined;
    service
      .getRelated({ project: 'demo-project-1', entity: 'Customer', field: 'ID', value: 5 })
      .subscribe((r) => (result = r));

    const req = httpMock.expectOne(
      (r) => r.url === `${BASE_URL}/semantic/related`,
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('value')).toBe('5');
    expect(req.request.params.has('limit')).toBe(false);
    req.flush(fixture);

    expect(result).toEqual(fixture);
  });

  it('GET /datatug/semantic/related includes limit when given', () => {
    service
      .getRelated({ project: 'demo-project-1', entity: 'Customer', field: 'ID', value: 5, limit: 10 })
      .subscribe();

    const req = httpMock.expectOne(
      (r) => r.url === `${BASE_URL}/semantic/related`,
    );
    expect(req.request.params.get('limit')).toBe('10');
    req.flush([]);
  });

  it('GET /datatug/semantic/related/rows sends lookupId/value', () => {
    const fixture: SemanticRelatedRowsResponse = {
      recordset: { columns: [{ name: 'InvoiceId' }], rows: [[1], [2]] },
      limitations: [],
    };
    let result: SemanticRelatedRowsResponse | undefined;
    service
      .getRelatedRows({ project: 'demo-project-1', lookupId: 'invoices', value: 5 })
      .subscribe((r) => (result = r));

    const req = httpMock.expectOne(
      (r) => r.url === `${BASE_URL}/semantic/related/rows`,
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('lookupId')).toBe('invoices');
    expect(req.request.params.get('value')).toBe('5');
    req.flush(fixture);

    expect(result).toEqual(fixture);
  });

  it('POST /datatug/queries/applicable sends the request body as-is', () => {
    const fixture: ApplicableQueriesResponse = {
      applicable: [
        {
          queryId: 'customer-invoices',
          bindings: [{ parameterId: 'customerId', entity: 'Customer', field: 'ID', value: 5 }],
          chain: ['CustomerId', 'maps to Customer.ID (declared)', 'requires Customer.ID'],
        },
      ],
      notYet: [{ queryId: 'invoice-lines', missing: ['Invoice.ID'] }],
    };
    let result: ApplicableQueriesResponse | undefined;
    service
      .getApplicableQueries({
        project: 'demo-project-1',
        values: [{ entity: 'Customer', field: 'ID', value: 5, origin: 'selection' }],
      })
      .subscribe((r) => (result = r));

    const req = httpMock.expectOne(`${BASE_URL}/queries/applicable`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      project: 'demo-project-1',
      values: [{ entity: 'Customer', field: 'ID', value: 5, origin: 'selection' }],
    });
    req.flush(fixture);

    expect(result).toEqual(fixture);
  });

  it('POST /datatug/exec/run_query sends the request body as-is', () => {
    const fixture: RunQueryResponse = {
      recordset: { columns: [], rows: [] },
      limitations: [{ policy: 'customers-support', rowsFiltered: true }],
      bindingsApplied: [
        { parameterId: 'customerId', entity: 'Customer', field: 'ID', value: 5, origin: 'selection' },
      ],
    };
    let result: RunQueryResponse | undefined;
    service
      .runQuery({ project: 'demo-project-1', queryId: 'customer-invoices', parameters: { customerId: 5 } })
      .subscribe((r) => (result = r));

    const req = httpMock.expectOne(`${BASE_URL}/exec/run_query`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      project: 'demo-project-1',
      queryId: 'customer-invoices',
      parameters: { customerId: 5 },
    });
    req.flush(fixture);

    expect(result).toEqual(fixture);
  });
});
