import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AiProposal } from './detective-ai.models';
import { DetectiveAiPanelComponent } from './detective-ai-panel.component';
import { DetectiveClientService } from './detective-client.service';
import { DetectiveState } from './models';

const extracted: AiProposal = {
  id: 'proposal-1',
  scope: { key: 'local/billing', project: 'billing', actor: 'agent-user' },
  basis: { catalogRevision: 'rev-1', environments: ['local'] },
  draft: {
    kind: 'extract-context',
    title: 'Invoice identifiers',
    context: {
      invoice_id: {
        value: { type: 'set', values: [{ type: 'string', value: 'INV-7' }] },
        provenance: [
          {
            sourceId: 'paste',
            start: 0,
            end: 5,
            quote: 'INV-7',
            confidence: 0.8,
          },
        ],
      },
    },
    sources: [
      { sourceId: 'paste', start: 0, end: 5, quote: 'INV-7', confidence: 0.8 },
    ],
  },
  sources: [
    {
      id: 'paste',
      kind: 'text',
      revision: '1',
      digest: 'source-digest',
      length: 5,
    },
  ],
  createdAt: '2026-10-13T12:00:00Z',
  expiresAt: '2026-10-14T12:00:00Z',
  digest: 'digest-1',
};
const derived: AiProposal = {
  ...extracted,
  id: 'proposal-2',
  parentProposalId: 'proposal-1',
  digest: 'digest-2',
  draft: {
    kind: 'edit-case',
    title: 'Apply invoice identifiers',
    sources: extracted.draft.sources,
    case: {
      caseId: 'case-1',
      expectedVersion: 3,
      context: {
        invoice_id: {
          type: 'set',
          values: [{ type: 'string', value: 'INV-7' }],
        },
      },
    },
  },
};
const state: DetectiveState = {
  checks: [],
  validators: [],
  queryValidators: [],
  runs: [],
  runsHasMore: false,
  scenarios: [],
  cases: [
    {
      id: 'case-1',
      title: 'Investigation',
      status: 'active',
      version: 3,
      context: {},
      incidentRefs: [],
      scenarioRefs: [],
      runRefs: [],
      evidence: [],
      findings: [],
      timeline: [],
    },
  ],
  capabilities: {
    localOnly: true,
    canRead: true,
    canWrite: true,
    canRun: true,
    maxRows: 500,
    maxFanout: 100,
  },
};

describe('DetectiveAiPanelComponent', () => {
  const client = {
    aiProposals: vi.fn(),
    aiGenerate: vi.fn(),
    aiReview: vi.fn(),
    aiConfirm: vi.fn(),
  };
  beforeEach(async () => {
    vi.clearAllMocks();
    client.aiProposals.mockReturnValue(of({ proposals: [], hasMore: false }));
    await TestBed.configureTestingModule({
      imports: [DetectiveAiPanelComponent],
      providers: [{ provide: DetectiveClientService, useValue: client }],
    }).compileComponents();
  });

  it('requires generation, human context review, and a separate confirmation', async () => {
    const fixture = TestBed.createComponent(DetectiveAiPanelComponent);
    fixture.componentRef.setInput('context', {
      kind: 'agent',
      agentStoreId: 'localhost:8989',
      project: 'billing',
      securityContextId: 'session-7',
    });
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('caseId', 'case-1');
    fixture.detectChanges();
    expect(client.aiProposals).not.toHaveBeenCalled();
    const panel = fixture.componentInstance as unknown as {
      toggleOpen(): void;
      text: { set(value: string): void };
      generate(): Promise<void>;
      review(): Promise<void>;
      confirm(): Promise<void>;
      confirmable(): boolean;
      draft(): import('./detective-ai.models').AiDraft | undefined;
    };
    panel.toggleOpen();
    fixture.detectChanges();
    expect(client.aiProposals).toHaveBeenCalledTimes(1);
    panel.text.set('INV-7');
    client.aiGenerate.mockReturnValue(
      of({ proposals: [extracted], matches: [] }),
    );
    await panel.generate();
    fixture.detectChanges();
    expect(client.aiGenerate).toHaveBeenCalledWith(
      expect.any(Object),
      'INV-7',
      'case-1',
      {},
    );
    expect(client.aiConfirm).not.toHaveBeenCalled();
    expect(panel.confirmable()).toBe(false);
    expect(panel.draft()?.context?.['invoice_id'].provenance[0].quote).toBe(
      'INV-7',
    );

    client.aiReview.mockReturnValue(of(derived));
    await panel.review();
    expect(client.aiReview).toHaveBeenCalledWith(expect.any(Object), {
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
    });
    expect(panel.confirmable()).toBe(true);
    expect(client.aiConfirm).not.toHaveBeenCalled();

    client.aiConfirm.mockReturnValue(
      of({ operationId: 'op-1', resourceId: 'case-1' }),
    );
    await panel.confirm();
    expect(client.aiConfirm).toHaveBeenCalledWith(expect.any(Object), {
      id: 'proposal-2',
      digest: 'digest-2',
    });
  });

  it('keeps an edited Check inert until the server returns a reviewed derivative', async () => {
    const fixture = TestBed.createComponent(DetectiveAiPanelComponent);
    fixture.componentRef.setInput('context', {
      kind: 'cloud',
      storage: 'firestore',
      spaceID: 'S1',
      project: 'P1',
    });
    fixture.componentRef.setInput('state', state);
    fixture.detectChanges();
    const proposal: AiProposal = {
      ...extracted,
      id: 'check-1',
      digest: 'check-digest',
      draft: {
        kind: 'draft-check',
        title: 'Check invoices',
        sources: extracted.draft.sources,
        check: {
          id: 'invoice-check',
          title: 'Check invoices',
          version: 0,
          inputs: [],
          steps: [{ id: 'invoices', kind: 'query', queryId: 'invoice-list' }],
        },
      },
    };
    const panel = fixture.componentInstance as unknown as {
      selectProposal(item: AiProposal): void;
      updateCheck(patch: { title: string }): void;
      review(): Promise<void>;
      confirmable(): boolean;
    };
    panel.selectProposal(proposal);
    panel.updateCheck({ title: 'Reviewed invoice check' });
    expect(panel.confirmable()).toBe(false);
    client.aiReview.mockReturnValue(
      of({ ...proposal, id: 'check-2', parentProposalId: 'check-1' }),
    );
    await panel.review();
    expect(client.aiReview).toHaveBeenCalledWith(expect.any(Object), {
      review: {
        proposalId: 'check-1',
        digest: 'check-digest',
        draft: expect.objectContaining({
          check: expect.objectContaining({ title: 'Reviewed invoice check' }),
          sources: extracted.draft.sources,
        }),
      },
    });
    expect(client.aiConfirm).not.toHaveBeenCalled();
    expect(panel.confirmable()).toBe(true);
  });
});
