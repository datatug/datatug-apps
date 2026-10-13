import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  DetectiveClientService,
  detectiveErrorMessage,
} from './detective-client.service';

const context = {
  agentStoreId: 'localhost:8989',
  project: 'billing',
  securityContextId: 'session-7',
};

describe('DetectiveClientService', () => {
  let client: DetectiveClientService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    client = TestBed.inject(DetectiveClientService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('reads state from the scoped agent without a browser persistence fallback', () => {
    client.state(context).subscribe();
    const request = http.expectOne(
      (item) => item.url === '//localhost:8989/datatug/detective/state',
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('project')).toBe('billing');
    expect(request.request.params.get('securityContextId')).toBe('session-7');
    request.flush({
      checks: [],
      cases: [],
      runs: [],
      validators: [],
      queryValidators: [],
      scenarios: [],
    });
  });

  it('sends a versioned query-local Validator action to the same project agent', () => {
    client
      .action(context, {
        type: 'save-query-validators',
        queryValidators: { queryId: 'invoices', version: 0, validators: [] },
      })
      .subscribe();
    const request = http.expectOne(
      (item) => item.url === '//localhost:8989/datatug/detective/action',
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.params.get('project')).toBe('billing');
    expect(request.request.body).toEqual({
      type: 'save-query-validators',
      queryValidators: { queryId: 'invoices', version: 0, validators: [] },
      project: 'billing',
      securityContextId: 'session-7',
    });
    request.flush({
      queryValidators: { queryId: 'invoices', version: 1, validators: [] },
    });
  });

  it('distinguishes missing agent support and edit conflicts', () => {
    expect(
      detectiveErrorMessage(new HttpErrorResponse({ status: 404 })),
    ).toContain('does not provide Detective');
    expect(
      detectiveErrorMessage(new HttpErrorResponse({ status: 409 })),
    ).toContain('changed since it was opened');
  });
});
