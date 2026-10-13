import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SneatApiService } from '@sneat/api';
import { of, throwError } from 'rxjs';
import {
  DetectiveClientService,
  detectiveErrorMessage,
} from './detective-client.service';

const context = {
  kind: 'agent' as const,
  agentStoreId: 'localhost:8989',
  project: 'billing',
  securityContextId: 'session-7',
};

describe('DetectiveClientService', () => {
  let client: DetectiveClientService;
  let http: HttpTestingController;
  const api = { get: vi.fn(), post: vi.fn() };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SneatApiService, useValue: api },
      ],
    });
    vi.clearAllMocks();
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

  it('uses authenticated cloud API and server identity for a shared Space project', () => {
    const cloud = {
      kind: 'cloud' as const,
      storage: 'firestore' as const,
      spaceID: 'S1',
      project: 'P1',
    };
    api.get.mockReturnValue(of({ checks: [] }));
    api.post.mockReturnValue(of({ check: { id: 'c1' } }));
    client.state(cloud).subscribe();
    expect(api.get).toHaveBeenCalledWith(
      'datatug/detective/state',
      expect.objectContaining({}),
    );
    const params = api.get.mock.calls[0][1];
    expect(params.get('storage')).toBe('firestore');
    expect(params.get('spaceID')).toBe('S1');
    expect(params.get('project')).toBe('P1');
    client
      .action(cloud, {
        type: 'save-check',
        check: { id: 'c1', title: 'C1', version: 2, inputs: [], steps: [] },
      })
      .subscribe();
    expect(api.post).toHaveBeenCalledWith(
      'datatug/detective/action',
      expect.objectContaining({
        storage: 'firestore',
        spaceID: 'S1',
        project: 'P1',
        type: 'save-check',
        ifMatch: 2,
        operationId: expect.any(String),
      }),
    );
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('securityContextId');
    http.expectNone(() => true);
  });

  it('replays an uncertain cloud mutation with its original operation ID', () => {
    const cloud = {
      kind: 'cloud' as const,
      storage: 'firestore' as const,
      spaceID: 'S1',
      project: 'P1',
    };
    const action = {
      type: 'append-event' as const,
      caseId: 'case-1',
      event: { id: 'note-1', type: 'note', message: 'Check invoice 7' },
    };
    api.post
      .mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 0 })),
      )
      .mockReturnValue(of({ case: { id: 'case-1' } }));
    client.action(cloud, action, 3).subscribe({ error: () => undefined });
    client.action(cloud, action, 3).subscribe();
    expect(api.post.mock.calls[0][1].operationId).toBe(
      api.post.mock.calls[1][1].operationId,
    );
    expect(api.post.mock.calls[1][1].ifMatch).toBe(3);
    client.action(cloud, action, 3).subscribe();
    expect(api.post.mock.calls[2][1].operationId).not.toBe(
      api.post.mock.calls[1][1].operationId,
    );
  });

  it('uses distinct cloud case-events and demo-project contracts', () => {
    const cloud = {
      kind: 'cloud' as const,
      storage: 'firestore' as const,
      spaceID: 'S1',
      project: 'P1',
    };
    api.get.mockReturnValue(
      of({ caseId: 'case-1', events: [], hasMore: false }),
    );
    api.post.mockReturnValue(
      of({ storeId: 'firestore', spaceID: 'S1', projectId: 'P1' }),
    );
    client.caseEvents(cloud, 'case-1', 40).subscribe();
    const params = api.get.mock.calls[0][1];
    expect(api.get.mock.calls[0][0]).toBe('datatug/detective/case_events');
    expect(params.get('before')).toBe('40');
    expect(params.get('caseId')).toBe('case-1');
    client.demoProject(undefined, 'operation-1').subscribe();
    expect(api.post).toHaveBeenCalledWith('datatug/detective/demo_project', {
      operationId: 'operation-1',
    });
  });
});
