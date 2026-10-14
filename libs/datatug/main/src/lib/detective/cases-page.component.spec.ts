import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { SneatApiService } from '@sneat/api';
import {
  AgentContextService,
  InvestigationContextService,
} from '@sneat/datatug-semantic';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { CasesPageComponent } from './cases-page.component';
import { DetectiveClientService } from './detective-client.service';
import { DetectiveCase, DetectiveState } from './models';

const savedCase: DetectiveCase = {
  id: 'case-1',
  title: 'Invoice investigation',
  status: 'active',
  version: 1,
  context: {},
  incidentRefs: [],
  scenarioRefs: [],
  runRefs: [],
  evidence: [{ id: 'evidence-1', kind: 'external', ref: 'ticket-1' }],
  findings: [],
  timeline: [],
};
const state: DetectiveState = {
  checks: [],
  validators: [],
  queryValidators: [],
  cases: [savedCase],
  runs: [],
  scenarios: [],
  runsHasMore: false,
  capabilities: {
    localOnly: false,
    canRead: true,
    canWrite: true,
    canRun: true,
    maxRows: 500,
    maxFanout: 100,
  },
};

describe('CasesPageComponent knowledge draft retry', () => {
  const client = {
    state: vi.fn(),
    linkedIncidents: vi.fn(),
    knowledgeProposals: vi.fn(),
    knowledgeAction: vi.fn(),
    incidentAction: vi.fn(),
  };
  beforeEach(async () => {
    vi.clearAllMocks();
    client.state.mockReturnValue(of(state));
    client.linkedIncidents.mockReturnValue(
      of({ caseId: 'case-1', incidents: [] }),
    );
    client.knowledgeProposals.mockReturnValue(
      of({ proposals: [], hasMore: false }),
    );
    await TestBed.configureTestingModule({
      imports: [CasesPageComponent],
      providers: [
        { provide: DetectiveClientService, useValue: client },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: new BehaviorSubject({
              ref: {
                storeId: 'firestore',
                spaceID: 'space-1',
                projectId: 'project-1',
              },
            }),
            currentEnv: of(undefined),
          },
        },
        { provide: AgentContextService, useValue: {} },
        {
          provide: SneatAuthStateService,
          useValue: { authState: of({ user: { uid: 'actor-1' } }) },
        },
        {
          provide: InvestigationContextService,
          useValue: { scope: signal(undefined), items: signal([]) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ caseId: 'case-1' }),
              queryParamMap: convertToParamMap({}),
            },
            paramMap: of(convertToParamMap({ caseId: 'case-1' })),
            queryParamMap: of(convertToParamMap({})),
          },
        },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
      ],
    })
      .overrideComponent(CasesPageComponent, { set: { template: '' } })
      .compileComponents();
  });

  it('reuses the real proposal identity when Case version advances after a lost acknowledgment', async () => {
    const fixture = TestBed.createComponent(CasesPageComponent);
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as {
      state: { set(value: DetectiveState): void };
      knowledgeTitle: { set(value: string): void };
      knowledgeStatement: { set(value: string): void };
      knowledgeEvidence: { set(value: string[]): void };
      saveKnowledgeDraft(): Promise<void>;
    };
    page.knowledgeTitle.set('Invoice meaning');
    page.knowledgeStatement.set(
      'These invoices belong to the same order cohort.',
    );
    page.knowledgeEvidence.set(['evidence-1']);
    client.knowledgeAction.mockReturnValueOnce(
      throwError(() => new Error('acknowledgment lost')),
    );
    await page.saveKnowledgeDraft();
    const first = client.knowledgeAction.mock.calls[0][1];
    expect(first.proposal.id).toMatch(/^proposal-/u);
    page.state.set({ ...state, cases: [{ ...savedCase, version: 2 }] });
    const proposal = {
      ...first.proposal,
      version: 1,
      status: 'draft',
      createdAt: '2026-10-13T12:00:00Z',
      createdBy: 'actor-1',
    };
    client.knowledgeAction.mockReturnValueOnce(
      of({ proposal, receipt: 'receipt-1' }),
    );
    await page.saveKnowledgeDraft();
    const retry = client.knowledgeAction.mock.calls[1][1];
    expect(retry).toEqual(first);
    expect(retry.proposal.id).toBe(first.proposal.id);
  });

  it('keeps a created Incident identity and repairs only its link with the latest Case version', async () => {
    const fixture = TestBed.createComponent(CasesPageComponent);
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as {
      state: { set(value: DetectiveState): void };
      hostedEnvironment: { set(value: string): void };
      incidentTitle: { set(value: string): void };
      incidentRef: () => string;
      pendingIncident: () => { ref: string; reason?: string } | undefined;
      createIncident(): Promise<void>;
      retryPendingIncidentLink(): Promise<boolean>;
      caseRuns(): unknown[];
      unlinkedRuns(): unknown[];
    };
    page.state.set({ ...state, environments: ['demo'] });
    page.hostedEnvironment.set('demo');
    page.incidentTitle.set('Invoice mismatch');
    const incident = {
      ref: { storeId: 'detective-incidents', incidentId: 'INC-1' },
      uid: 'INC-1',
      title: 'Invoice mismatch',
      status: 'open',
      canonicalContext: {},
      lastSeq: 1,
    };
    client.incidentAction.mockReturnValueOnce(
      of({
        incident,
        receipt: 'create-receipt',
        caseLinkStatus: 'link-pending',
        linkPendingReason: 'case-changed',
      }),
    );
    client.state.mockReturnValueOnce(
      of({
        ...state,
        environments: ['demo'],
        cases: [{ ...savedCase, version: 2 }],
      }),
    );
    await page.createIncident();
    expect(page.pendingIncident()).toEqual({
      ref: 'detective-incidents/INC-1',
      reason: 'case-changed',
    });
    expect(page.incidentRef()).toBe('detective-incidents/INC-1');
    expect(client.incidentAction).toHaveBeenCalledTimes(1);
    client.incidentAction.mockReturnValueOnce(
      of({
        incident,
        case: {
          ...savedCase,
          version: 3,
          incidentRefs: ['detective-incidents/INC-1'],
        },
        receipt: 'link-receipt',
        caseLinkStatus: 'linked',
      }),
    );
    client.state.mockReturnValueOnce(
      of({
        ...state,
        environments: ['demo'],
        cases: [
          {
            ...savedCase,
            version: 3,
            incidentRefs: ['detective-incidents/INC-1'],
          },
        ],
      }),
    );
    expect(await page.retryPendingIncidentLink()).toBe(true);
    expect(client.incidentAction.mock.calls[1][1]).toEqual({
      type: 'link',
      caseId: 'case-1',
      incidentRef: 'detective-incidents/INC-1',
      environment: 'demo',
      ifMatch: 2,
    });
    expect(page.pendingIncident()).toBeUndefined();
    expect(client.incidentAction).toHaveBeenCalledTimes(2);
  });

  it('offers only Checks that declare the full confirmed Case cohort and range', () => {
    const fixture = TestBed.createComponent(CasesPageComponent);
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as {
      state: { set(value: DetectiveState): void };
      relevantChecks(): { id: string }[];
    };
    const context = {
      order_id: {
        type: 'set' as const,
        values: ['101', '102', '103', '104', '105'].map((value) => ({
          type: 'string' as const,
          value,
        })),
      },
      invoice_id: {
        type: 'set' as const,
        values: ['10', '11', '12', '13', '7', '8', '9'].map((value) => ({
          type: 'string' as const,
          value,
        })),
      },
      invoice_date: {
        type: 'range' as const,
        start: { type: 'date' as const, value: '2026-10-01' },
        end: { type: 'date' as const, value: '2026-10-12' },
      },
    };
    const inputs = [
      {
        name: 'order_id',
        type: 'string' as const,
        cardinality: 'set' as const,
      },
      {
        name: 'invoice_id',
        type: 'string' as const,
        cardinality: 'set' as const,
      },
      {
        name: 'invoice_date',
        type: 'date' as const,
        cardinality: 'range' as const,
      },
    ];
    const checks = [
      {
        id: 'all-invoices',
        title: 'All invoices',
        version: 1,
        inputs: [],
        steps: [],
      },
      {
        id: 'invoice-only',
        title: 'Invoice only',
        version: 1,
        inputs: inputs.slice(1, 2),
        steps: [],
      },
      {
        id: 'case-cohort',
        title: 'Case cohort',
        version: 1,
        inputs,
        steps: [],
      },
    ];
    page.state.set({ ...state, cases: [{ ...savedCase, context }], checks });
    expect(page.relevantChecks().map((check) => check.id)).toEqual([
      'case-cohort',
    ]);
  });
});

describe('CasesPageComponent Case creation HTTP payload', () => {
  it('submits confirmed five-order, seven-invoice and date-range context in Core set order', async () => {
    const route = {
      snapshot: {
        paramMap: convertToParamMap({}),
        queryParamMap: convertToParamMap({}),
      },
      paramMap: of(convertToParamMap({})),
      queryParamMap: of(convertToParamMap({})),
    };
    await TestBed.configureTestingModule({
      imports: [CasesPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SneatApiService, useValue: { get: vi.fn(), post: vi.fn() } },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of({
              ref: { storeId: 'localhost:18980', projectId: 'detective-demo' },
            }),
            currentEnv: of(undefined),
          },
        },
        {
          provide: AgentContextService,
          useValue: {
            contextFor: () => ({ securityContextId: signal('session-7') }),
          },
        },
        {
          provide: SneatAuthStateService,
          useValue: { authState: of({ user: { uid: 'actor-1' } }) },
        },
        {
          provide: InvestigationContextService,
          useValue: { scope: signal(undefined), items: signal([]) },
        },
        { provide: ActivatedRoute, useValue: route },
        {
          provide: Router,
          useValue: { navigateByUrl: vi.fn().mockResolvedValue(true) },
        },
      ],
    })
      .overrideComponent(CasesPageComponent, { set: { template: '' } })
      .compileComponents();
    const fixture = TestBed.createComponent(CasesPageComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne((request) => request.url.endsWith('/datatug/detective/state'))
      .flush(state);
    const page = fixture.componentInstance as unknown as {
      startNew(): void;
      updateDraft(patch: Partial<DetectiveCase>): void;
      pastedText: { set(value: string): void };
      proposeFromPaste(): void;
      confirmProposal(index: number): void;
      contextName: { set(value: string): void };
      contextType: { set(value: 'date'): void };
      contextCardinality: { set(value: 'range'): void };
      contextText: { set(value: string): void };
      contextEnd: { set(value: string): void };
      addContext(): void;
      save(): Promise<void>;
    };
    page.startNew();
    page.updateDraft({
      id: 'invoice-investigation',
      title: 'Five orders and seven invoices',
    });
    page.pastedText.set(
      'Order IDs 101,102,103,104,105. Invoice IDs 7,8,9,10,11,12,13,7.',
    );
    page.proposeFromPaste();
    page.confirmProposal(0);
    page.confirmProposal(0);
    page.contextName.set('invoice_dates');
    page.contextType.set('date');
    page.contextCardinality.set('range');
    page.contextText.set('2026-10-01');
    page.contextEnd.set('2026-10-12');
    page.addContext();
    const saving = page.save();
    const request = http.expectOne((item) =>
      item.url.endsWith('/datatug/detective/action'),
    );
    expect(request.request.body.type).toBe('create-case');
    expect(request.request.body.case.context).toEqual({
      order_id: {
        type: 'set',
        values: ['101', '102', '103', '104', '105'].map((value) => ({
          type: 'string',
          value,
        })),
      },
      invoice_id: {
        type: 'set',
        values: ['10', '11', '12', '13', '7', '8', '9'].map((value) => ({
          type: 'string',
          value,
        })),
      },
      invoice_dates: {
        type: 'range',
        start: { type: 'date', value: '2026-10-01' },
        end: { type: 'date', value: '2026-10-12' },
      },
    });
    request.flush({ case: { ...savedCase, id: 'invoice-investigation' } });
    await Promise.resolve();
    http
      .expectOne((item) => item.url.endsWith('/datatug/detective/state'))
      .flush(state);
    await saving;
    http.verify();
  });
});
