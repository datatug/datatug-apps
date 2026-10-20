import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DatatugApiService } from '../services/base/datatug-api.service';
import { of, throwError } from 'rxjs';
import {
  DetectiveClientService,
  detectiveErrorMessage,
} from './detective-client.service';
import { datatugApiRealProviders, expectDatatugApiRequest } from '../services/base/datatug-api.test-helpers';


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
        { provide: DatatugApiService, useValue: api },
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

  it.each(['agent', 'cloud'] as const)(
    'normalizes legacy null Detective arrays from %s state',
    (kind) => {
      const legacy = {
        checks: [
          {
            id: 'check-1',
            inputs: null,
            steps: [
              {
                id: 'check-step-1',
                bindings: null,
                validators: [{ id: 'validator-1', bindings: null }],
              },
            ],
          },
          { id: 'empty-check', inputs: null, steps: null },
        ],
        validators: [],
        queryValidators: [],
        cases: [
          {
            id: 'case-legacy',
            context: null,
            incidentRefs: null,
            scenarioRefs: null,
            runRefs: null,
            evidence: null,
            findings: null,
            timeline: null,
            scenarioApplications: [
              {
                snapshot: { inputs: null, steps: null },
                steps: null,
              },
            ],
          },
        ],
        runs: [],
        scenarios: [
          {
            id: 'scenario-1',
            inputs: null,
            steps: [{ id: 'scenario-step-1', bindings: null }],
          },
        ],
      };
      let state: import('./models').DetectiveState | undefined;
      if (kind === 'agent') {
        client.state(context).subscribe((value) => (state = value));
        http
          .expectOne((request) => request.url.endsWith('/detective/state'))
          .flush(legacy);
      } else {
        api.get.mockReturnValueOnce(of(legacy));
        client
          .state({
            kind: 'cloud',
            storage: 'firestore',
            spaceID: 'S1',
            project: 'P1',
          })
          .subscribe((value) => (state = value));
      }
      expect(state?.checks[0]).toMatchObject({
        inputs: [],
        steps: [{ bindings: [], validators: [{ bindings: [] }] }],
      });
      expect(state?.checks[1]).toMatchObject({ inputs: [], steps: [] });
      expect(state?.scenarios[0]).toMatchObject({
        inputs: [],
        steps: [{ bindings: [] }],
      });
      expect(state?.cases[0]).toMatchObject({
        context: {},
        incidentRefs: [],
        scenarioRefs: [],
        runRefs: [],
        evidence: [],
        findings: [],
        timeline: [],
        scenarioApplications: [
          {
            snapshot: { inputs: [], steps: [] },
            steps: [],
          },
        ],
      });
    },
  );

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
      operationId: expect.stringMatching(/^operation-[a-z0-9-]+$/u),
    });
    request.flush({
      queryValidators: { queryId: 'invoices', version: 1, validators: [] },
    });
  });

  it('keeps a slug-safe local action identity across an uncertain retry', () => {
    const random = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue('9abc0000-0000-4000-8000-000000000000');
    const action = {
      type: 'create-case' as const,
      case: {
        id: 'case-1',
        title: 'Case',
        version: 0,
        status: 'active' as const,
        context: {},
        incidentRefs: [],
        scenarioRefs: [],
        runRefs: [],
        evidence: [],
        findings: [],
        timeline: [],
      },
    };
    client.action(context, action).subscribe({ error: vi.fn() });
    const first = http.expectOne(
      (item) => item.url === '//localhost:8989/datatug/detective/action',
    );
    expect(first.request.body.operationId).toBe(
      'operation-9abc0000-0000-4000-8000-000000000000',
    );
    first.flush({}, { status: 0, statusText: 'Network error' });
    client.action(context, action).subscribe();
    const retry = http.expectOne(
      (item) => item.url === '//localhost:8989/datatug/detective/action',
    );
    expect(retry.request.body.operationId).toBe(first.request.body.operationId);
    retry.flush({ case: { id: 'case-1' } });
    random.mockRestore();
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

  it('runs a saved hosted query through the protected endpoint and replays an uncertain request', () => {
    const cloud = {
      kind: 'cloud' as const,
      storage: 'firestore' as const,
      spaceID: 'S1',
      project: 'P1',
    };
    const inputs = { invoice_id: { type: 'integer' as const, value: '7' } };
    api.post
      .mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 0 })),
      )
      .mockReturnValue(
        of({
          result: {
            execution: {
              storeId: 'firestore',
              projectId: 'P1',
              executionId: 'e1',
            },
          },
        }),
      );
    client
      .runHostedQuery(cloud, 'invoice-query', 'demo', inputs)
      .subscribe({ error: () => undefined });
    client.runHostedQuery(cloud, 'invoice-query', 'demo', inputs).subscribe();
    expect(api.post.mock.calls[0][0]).toBe('datatug/queries/run_query');
    expect(api.post.mock.calls[0][1]).toEqual({
      storage: 'firestore',
      spaceID: 'S1',
      project: 'P1',
      queryId: 'invoice-query',
      environment: 'demo',
      inputs,
      operationId: expect.any(String),
    });
    expect(api.post.mock.calls[1][1].operationId).toBe(
      api.post.mock.calls[0][1].operationId,
    );
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('securityContextId');
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('snapshot');
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('record');
  });

  it('keeps a pending hosted validation operation ID until its final receipt', () => {
    const cloud = {
      kind: 'cloud' as const,
      storage: 'firestore' as const,
      spaceID: 'S1',
      project: 'P1',
    };
    const action = {
      type: 'run-query-validators' as const,
      queryId: 'invoices',
      environment: 'demo',
      execution: { storeId: 'firestore', projectId: 'P1', executionId: 'e1' },
    };
    api.post
      .mockReturnValueOnce(of({ run: { executionStatus: 'pending' } }))
      .mockReturnValue(of({ run: { executionStatus: 'completed' } }));
    client.action(cloud, action).subscribe();
    client.action(cloud, action).subscribe();
    expect(api.post.mock.calls[1][1].operationId).toBe(
      api.post.mock.calls[0][1].operationId,
    );
    client.action(cloud, action).subscribe();
    expect(api.post.mock.calls[2][1].operationId).not.toBe(
      api.post.mock.calls[1][1].operationId,
    );
  });

  it('uses authenticated hosted Incident and private knowledge routes without client actor fields', () => {
    const cloud = {
      kind: 'cloud' as const,
      storage: 'firestore' as const,
      spaceID: 'S1',
      project: 'P1',
    };
    api.get.mockReturnValue(of({ caseId: 'case-1', incidents: [] }));
    api.post.mockReturnValue(of({ receipt: 'accepted' }));
    client.linkedIncidents(cloud, 'case-1').subscribe();
    expect(api.get.mock.calls[0][0]).toBe('datatug/detective/incidents');
    expect(api.get.mock.calls[0][1].get('caseId')).toBe('case-1');
    client
      .incidentAction(cloud, {
        type: 'create',
        caseId: 'case-1',
        title: 'Invoice mismatch',
        environment: 'demo',
        ifMatch: 3,
      }, 'operation-reloaded-create')
      .subscribe();
    expect(api.post.mock.calls[0][0]).toBe('datatug/detective/incident_action');
    expect(api.post.mock.calls[0][1]).toEqual({
      storage: 'firestore',
      spaceID: 'S1',
      project: 'P1',
      type: 'create',
      caseId: 'case-1',
      title: 'Invoice mismatch',
      environment: 'demo',
      ifMatch: 3,
      operationId: 'operation-reloaded-create',
    });
    client.knowledgeProposals(cloud).subscribe();
    expect(api.get.mock.calls[1][0]).toBe(
      'datatug/detective/knowledge_proposals',
    );
    client
      .knowledgeAction(cloud, {
        type: 'review',
        proposalId: 'p1',
        reviewNote: 'Verified source receipts',
        ifMatch: 2,
      })
      .subscribe();
    expect(api.post.mock.calls[1][0]).toBe(
      'datatug/detective/knowledge_proposal_action',
    );
    expect(api.post.mock.calls[1][1]).toEqual({
      storage: 'firestore',
      spaceID: 'S1',
      project: 'P1',
      type: 'review',
      proposalId: 'p1',
      reviewNote: 'Verified source receipts',
      ifMatch: 2,
      operationId: expect.any(String),
    });
    expect(api.post.mock.calls[1][1]).not.toHaveProperty('actor');
    expect(api.post.mock.calls[1][1]).not.toHaveProperty('securityContextId');
  });

  it('reads project Incidents and a full server-issued IncidentRef through the authenticated API', () => {
    const cloud = {
      kind: 'cloud' as const,
      storage: 'firestore' as const,
      spaceID: 'personal',
      project: 'demo-project',
    };
    api.get.mockReturnValue(of({ incidents: [] }));
    client.projectIncidents(cloud, 'demo').subscribe();
    expect(api.get.mock.calls[0][0]).toBe('datatug/detective/project_incidents');
    expect(api.get.mock.calls[0][1].toString()).toContain('environment=demo');
    client.projectIncident(cloud, 'demo', 'detective-incidents-9c561d36/INC-1').subscribe();
    expect(api.get.mock.calls[1][0]).toBe('datatug/detective/incident');
    expect(api.get.mock.calls[1][1].get('incidentRef')).toBe('detective-incidents-9c561d36/INC-1');
    expect(api.get.mock.calls[1][1].get('spaceID')).toBe('personal');
  });

  it('uses scoped agent Incident and knowledge routes with typed server mutations', () => {
    client.linkedIncidents(context, 'case-1').subscribe();
    const incidents = http.expectOne(
      (request) =>
        request.url === '//localhost:8989/datatug/detective/incidents',
    );
    expect(incidents.request.params.get('securityContextId')).toBe('session-7');
    expect(incidents.request.params.get('caseId')).toBe('case-1');
    incidents.flush({ caseId: 'case-1', incidents: [] });

    client
      .incidentAction(context, {
        type: 'link',
        caseId: 'case-1',
        incidentRef: 'local/INC-1',
        environment: 'local',
        ifMatch: 2,
      })
      .subscribe();
    const incidentAction = http.expectOne(
      (request) =>
        request.url === '//localhost:8989/datatug/detective/incident-action',
    );
    expect(incidentAction.request.body).toEqual({
      project: 'billing',
      securityContextId: 'session-7',
      operationId: expect.any(String),
      type: 'link',
      caseId: 'case-1',
      incidentRef: 'local/INC-1',
      environment: 'local',
      ifMatch: 2,
    });
    incidentAction.flush({ receipt: 'accepted' });

    client.knowledgeProposals(context, 'cursor-1').subscribe();
    const proposals = http.expectOne(
      (request) =>
        request.url ===
        '//localhost:8989/datatug/detective/knowledge_proposals',
    );
    expect(proposals.request.params.get('project')).toBe('billing');
    expect(proposals.request.params.get('securityContextId')).toBe('session-7');
    expect(proposals.request.params.get('after')).toBe('cursor-1');
    proposals.flush({ proposals: [], hasMore: false });

    client
      .knowledgeAction(context, {
        type: 'review',
        proposalId: 'p1',
        ifMatch: 2,
      })
      .subscribe();
    const knowledgeAction = http.expectOne(
      (request) =>
        request.url ===
        '//localhost:8989/datatug/detective/knowledge_proposal_action',
    );
    expect(knowledgeAction.request.params.get('securityContextId')).toBe(
      'session-7',
    );
    expect(knowledgeAction.request.body).toEqual({
      storage: 'local',
      project: 'billing',
      operationId: expect.any(String),
      type: 'review',
      proposalId: 'p1',
      ifMatch: 2,
    });
    knowledgeAction.flush({ receipt: 'accepted' });
  });

  it('keeps AI generation, reviewed derivative, and confirmation as distinct scoped agent actions', () => {
    client.aiProposals(context).subscribe();
    const list = http.expectOne(
      (request) =>
        request.url === '//localhost:8989/datatug/detective/ai_proposals' &&
        request.method === 'GET',
    );
    expect(list.request.params.get('securityContextId')).toBe('session-7');
    list.flush({ proposals: [], hasMore: false });

    client
      .aiGenerate(context, 'Seven invoice IDs', 'case-1', { invoices: 7 })
      .subscribe();
    const generate = http.expectOne(
      (request) =>
        request.url === '//localhost:8989/datatug/detective/ai_proposals' &&
        request.method === 'POST',
    );
    expect(generate.request.body).toEqual({
      project: 'billing',
      securityContextId: 'session-7',
      operationId: expect.any(String),
      text: 'Seven invoice IDs',
      caseId: 'case-1',
      expectedCounts: { invoices: 7 },
    });
    expect(generate.request.body).not.toHaveProperty('scope');
    expect(generate.request.body).not.toHaveProperty('snapshot');
    generate.flush({ proposals: [], matches: [] });

    client
      .aiReview(context, {
        contextReview: {
          proposalId: 'proposal-1',
          digest: 'digest-1',
          caseId: 'case-1',
          expectedVersion: 3,
          context: {
            invoice_id: {
              type: 'set',
              values: [{ type: 'string', value: 'INV-7' }],
            },
          },
        },
      })
      .subscribe();
    const review = http.expectOne(
      (request) =>
        request.url === '//localhost:8989/datatug/detective/ai_review',
    );
    expect(review.request.body).toEqual({
      project: 'billing',
      securityContextId: 'session-7',
      type: 'context',
      context: {
        proposalId: 'proposal-1',
        digest: 'digest-1',
        caseId: 'case-1',
        expectedVersion: 3,
        context: {
          invoice_id: {
            type: 'set',
            values: [{ type: 'string', value: 'INV-7' }],
          },
        },
      },
    });
    review.flush({ id: 'derivative-1' });

    client
      .aiConfirm(context, { id: 'derivative-1', digest: 'digest-2' })
      .subscribe();
    const confirm = http.expectOne(
      (request) =>
        request.url === '//localhost:8989/datatug/detective/ai_confirm',
    );
    expect(confirm.request.body).toEqual({
      project: 'billing',
      securityContextId: 'session-7',
      proposalId: 'derivative-1',
      digest: 'digest-2',
      operationId: expect.any(String),
    });
    confirm.flush({
      operationId: confirm.request.body.operationId,
      resourceId: 'case-1',
    });
  });

  it('uses authenticated cloud AI review shape without client identity or catalog authority', () => {
    const cloud = {
      kind: 'cloud' as const,
      storage: 'firestore' as const,
      spaceID: 'S1',
      project: 'P1',
    };
    api.post.mockReturnValue(of({ id: 'derived' }));
    client
      .aiReview(cloud, {
        review: {
          proposalId: 'p1',
          digest: 'digest-1',
          draft: { kind: 'draft-query', title: 'Query', sources: [] },
        },
      })
      .subscribe();
    expect(api.post).toHaveBeenCalledWith('datatug/detective/ai_review', {
      storage: 'firestore',
      spaceID: 'S1',
      project: 'P1',
      type: 'draft',
      draft: {
        proposalId: 'p1',
        digest: 'digest-1',
        draft: { kind: 'draft-query', title: 'Query', sources: [] },
      },
    });
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('securityContextId');
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('snapshot');
  });
});

describe('DetectiveClientService DataTug API base URL', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DetectiveClientService, ...datatugApiRealProviders()],
    });
  });

  it('reads the shared Space Detective state from the DataTug API base URL', () => {
    TestBed.inject(DetectiveClientService)
      .state({
        kind: 'cloud' as const,
        storage: 'firestore' as const,
        spaceID: 'S1',
        project: 'P1',
      } as never)
      .subscribe();
    expectDatatugApiRequest('GET', 'datatug/detective/state');
  });
});
