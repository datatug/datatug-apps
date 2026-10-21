import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
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

  it('keeps the native disclosure button state, controls, and focus synchronized without requesting proposals', async () => {
    const fixture = TestBed.createComponent(DetectiveAiPanelComponent);
    fixture.detectChanges();
    const header = fixture.nativeElement.querySelector(
      'ion-item.detective-ai-card-header',
    );
    expect(header?.getAttribute('color')).toBe('light');
    expect(header?.querySelector('h2')?.textContent).toContain(
      'AI investigation proposals',
    );
    expect(header?.querySelector('ion-icon')?.getAttribute('name')).toBe(
      'sparkles-outline',
    );
    const action = header?.querySelector('ion-button') as HTMLElement | null;
    await fixture.whenStable();
    const nativeButton = document.createElement('button');
    nativeButton.setAttribute('part', 'native');
    nativeButton.setAttribute('aria-expanded', 'false');
    Object.defineProperty(nativeButton, 'ariaControlsElements', {
      value: null,
      writable: true,
    });
    (
      action?.shadowRoot ?? action?.attachShadow({ mode: 'open' })
    )?.replaceChildren(nativeButton);
    expect(action?.getAttribute('aria-expanded')).toBe('false');
    expect(nativeButton.getAttribute('aria-expanded')).toBe('false');
    expect(action?.getAttribute('aria-label')).toBe(
      'Open AI investigation proposals',
    );
    const content = fixture.nativeElement.querySelector(
      'ion-card-content.detective-ai-proposals-content',
    );
    expect(action?.getAttribute('aria-controls')).toBe(content?.id);
    expect(nativeButton.getAttribute('aria-controls')).toBeNull();
    const contentId = content?.id;
    nativeButton.focus();
    expect(action?.shadowRoot?.activeElement).toBe(nativeButton);
    const panel = fixture.componentInstance as unknown as {
      toggleOpen(): void;
    };
    panel.toggleOpen();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(action?.getAttribute('aria-expanded')).toBe('true');
    expect(nativeButton.getAttribute('aria-expanded')).toBe('true');
    expect(action?.shadowRoot?.querySelector('button[part~="native"]')).toBe(
      nativeButton,
    );
    expect(action?.shadowRoot?.activeElement).toBe(nativeButton);
    expect(nativeButton.getAttribute('aria-controls')).toBe(contentId);
    expect(nativeButton.ariaControlsElements).toEqual([content]);
    expect(content?.id).toBe(contentId);
    panel.toggleOpen();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(action?.getAttribute('aria-expanded')).toBe('false');
    expect(nativeButton.getAttribute('aria-expanded')).toBe('false');
    expect(nativeButton.getAttribute('aria-controls')).toBe(contentId);
    expect(nativeButton.ariaControlsElements).toEqual([content]);
    expect(action?.shadowRoot?.querySelector('button[part~="native"]')).toBe(
      nativeButton,
    );
    expect(nativeButton.tabIndex).toBe(0);
    expect(content?.id).toBe(contentId);
    expect(fixture.nativeElement.textContent).toContain(
      'Review every suggestion before applying it.',
    );
    expect(client.aiProposals).not.toHaveBeenCalled();
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

  it('invalidates confirmation when a reviewed derivative is edited', () => {
    const fixture = TestBed.createComponent(DetectiveAiPanelComponent);
    fixture.componentRef.setInput('context', {
      kind: 'cloud',
      storage: 'firestore',
      spaceID: 'S1',
      project: 'P1',
    });
    fixture.componentRef.setInput('identity', 'S1/P1/actor-a');
    fixture.detectChanges();
    const panel = fixture.componentInstance as unknown as {
      selectProposal(item: AiProposal): void;
      updateCase(patch: { title: string }): void;
      confirmable(): boolean;
      confirm(): Promise<void>;
    };
    panel.selectProposal(derived);
    expect(panel.confirmable()).toBe(true);
    panel.updateCase({ title: 'A different Case title' });
    expect(panel.confirmable()).toBe(false);
    void panel.confirm();
    expect(client.aiConfirm).not.toHaveBeenCalled();
  });

  it.each(['published', 'step'] as const)(
    'keeps a raw invalid %s expected edit visible and prevents review or confirmation',
    async (location) => {
      const fixture = TestBed.createComponent(DetectiveAiPanelComponent);
      fixture.componentRef.setInput('context', {
        kind: 'cloud',
        storage: 'firestore',
        spaceID: 'S1',
        project: 'P1',
      });
      fixture.componentRef.setInput('identity', 'S1/P1/actor-a');
      fixture.detectChanges();
      const validator = {
        id: 'count',
        kind: 'row-count' as const,
        scope: 'set' as const,
        severity: 'error' as const,
        expected: { type: 'integer' as const, value: '7' },
      };
      const proposal: AiProposal = {
        ...derived,
        id: `derived-${location}`,
        draft:
          location === 'published'
            ? {
                kind: 'draft-validator',
                title: 'Count',
                sources: [],
                validator: {
                  id: 'published',
                  title: 'Count',
                  version: 0,
                  validator,
                },
              }
            : {
                kind: 'draft-check',
                title: 'Count',
                sources: [],
                check: {
                  id: 'count-check',
                  title: 'Count',
                  version: 0,
                  inputs: [],
                  steps: [
                    {
                      id: 'query',
                      kind: 'query',
                      queryId: 'invoice-list',
                      validators: [validator],
                    },
                  ],
                },
              },
      };
      const panel = fixture.componentInstance as unknown as {
        selectProposal(item: AiProposal): void;
        setPublishedExpected(raw: string, type: 'integer'): void;
        setStepExpected(
          step: number,
          index: number,
          raw: string,
          type: 'integer',
        ): void;
        expectedValueEdits(): Record<string, string>;
        reviewable(): boolean;
        confirmable(): boolean;
        review(): Promise<void>;
        confirm(): Promise<void>;
      };
      panel.selectProposal(proposal);
      expect(panel.confirmable()).toBe(true);
      if (location === 'published')
        panel.setPublishedExpected('not-an-integer', 'integer');
      else panel.setStepExpected(0, 0, 'not-an-integer', 'integer');
      expect(
        panel.expectedValueEdits()[
          location === 'published' ? 'published' : 'step-0-0'
        ],
      ).toBe('not-an-integer');
      expect(panel.reviewable()).toBe(false);
      expect(panel.confirmable()).toBe(false);
      await panel.review();
      await panel.confirm();
      expect(client.aiReview).not.toHaveBeenCalled();
      expect(client.aiConfirm).not.toHaveBeenCalled();
      if (location === 'published') panel.setPublishedExpected('8', 'integer');
      else panel.setStepExpected(0, 0, '8', 'integer');
      expect(panel.reviewable()).toBe(true);
      expect(panel.confirmable()).toBe(false);
    },
  );

  it('reviews a Case draft using a Core-valid PascalCase hyphenated context name', async () => {
    const fixture = TestBed.createComponent(DetectiveAiPanelComponent);
    fixture.componentRef.setInput('context', {
      kind: 'cloud',
      storage: 'firestore',
      spaceID: 'S1',
      project: 'P1',
    });
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('caseId', 'case-1');
    fixture.detectChanges();
    const proposal: AiProposal = {
      ...extracted,
      id: 'case-name',
      draft: {
        kind: 'edit-case',
        title: 'Invoice Case',
        sources: [],
        case: {
          caseId: 'case-1',
          expectedVersion: 3,
          context: { 'Invoice-ID': { type: 'integer', value: '7' } },
        },
      },
    };
    const panel = fixture.componentInstance as unknown as {
      selectProposal(item: AiProposal): void;
      review(): Promise<void>;
    };
    panel.selectProposal(proposal);
    client.aiReview.mockReturnValue(
      of({
        ...proposal,
        id: 'case-name-reviewed',
        parentProposalId: proposal.id,
      }),
    );
    await panel.review();
    expect(client.aiReview).toHaveBeenCalledWith(expect.any(Object), {
      review: expect.objectContaining({
        draft: expect.objectContaining({
          case: expect.objectContaining({
            context: { 'Invoice-ID': { type: 'integer', value: '7' } },
          }),
        }),
      }),
    });
  });

  it('discards late AI generation after a principal and project switch', async () => {
    const fixture = TestBed.createComponent(DetectiveAiPanelComponent);
    fixture.componentRef.setInput('context', {
      kind: 'cloud',
      storage: 'firestore',
      spaceID: 'S1',
      project: 'P1',
    });
    fixture.componentRef.setInput('identity', 'S1/P1/actor-a');
    fixture.detectChanges();
    const panel = fixture.componentInstance as unknown as {
      text: { set(value: string): void };
      generate(): Promise<void>;
      proposals(): AiProposal[];
      draft(): unknown;
      message(): string;
    };
    panel.text.set('Old project text');
    const pending = new Subject<{ proposals: AiProposal[]; matches: [] }>();
    client.aiGenerate.mockReturnValue(pending.asObservable());
    const generating = panel.generate();
    fixture.componentRef.setInput('context', {
      kind: 'cloud',
      storage: 'firestore',
      spaceID: 'S2',
      project: 'P2',
    });
    fixture.componentRef.setInput('identity', 'S2/P2/actor-b');
    fixture.detectChanges();
    pending.next({ proposals: [extracted], matches: [] });
    pending.complete();
    await generating;
    expect(panel.proposals()).toEqual([]);
    expect(panel.draft()).toBeUndefined();
    expect(panel.message()).toBe('');
  });

  it('sends edited Check bindings and typed expected values for server review', async () => {
    const fixture = TestBed.createComponent(DetectiveAiPanelComponent);
    fixture.componentRef.setInput('context', {
      kind: 'cloud',
      storage: 'firestore',
      spaceID: 'S1',
      project: 'P1',
    });
    fixture.detectChanges();
    const proposal: AiProposal = {
      ...extracted,
      id: 'check-binding',
      digest: 'binding-digest',
      draft: {
        kind: 'draft-check',
        title: 'Invoice count',
        sources: [],
        check: {
          id: 'invoice-check',
          title: 'Invoice count',
          version: 0,
          inputs: [],
          steps: [
            {
              id: 'invoices',
              kind: 'query',
              queryId: 'invoice-list',
              validators: [
                {
                  id: 'rows',
                  scope: 'set',
                  kind: 'row-count',
                  severity: 'error',
                },
              ],
            },
          ],
        },
      },
    };
    const panel = fixture.componentInstance as unknown as {
      selectProposal(item: AiProposal): void;
      addCheckStepBinding(step: number): void;
      updateCheckStepBinding(
        step: number,
        binding: number,
        patch: { input?: string; fromInput?: string },
      ): void;
      setStepExpected(
        step: number,
        validator: number,
        raw: string,
        type: 'integer',
      ): void;
      review(): Promise<void>;
    };
    panel.selectProposal(proposal);
    panel.addCheckStepBinding(0);
    panel.updateCheckStepBinding(0, 0, {
      input: 'customer_id',
      fromInput: 'customer_id',
    });
    panel.setStepExpected(0, 0, '7', 'integer');
    client.aiReview.mockReturnValue(
      of({
        ...proposal,
        id: 'reviewed-binding',
        parentProposalId: proposal.id,
      }),
    );
    await panel.review();
    expect(client.aiReview).toHaveBeenCalledWith(expect.any(Object), {
      review: {
        proposalId: proposal.id,
        digest: proposal.digest,
        draft: expect.objectContaining({
          check: expect.objectContaining({
            steps: [
              expect.objectContaining({
                bindings: [{ input: 'customer_id', fromInput: 'customer_id' }],
                validators: [
                  expect.objectContaining({
                    expected: { type: 'integer', value: '7' },
                  }),
                ],
              }),
            ],
          }),
        }),
      },
    });
  });

  it('drops late review and confirmation after a principal switch', async () => {
    const fixture = TestBed.createComponent(DetectiveAiPanelComponent);
    const context = {
      kind: 'cloud',
      storage: 'firestore',
      spaceID: 'S1',
      project: 'P1',
    };
    fixture.componentRef.setInput('context', context);
    fixture.componentRef.setInput('identity', 'S1/P1/actor-a');
    fixture.componentRef.setInput('state', state);
    fixture.detectChanges();
    const panel = fixture.componentInstance as unknown as {
      selectProposal(item: AiProposal): void;
      review(): Promise<void>;
      confirm(): Promise<void>;
      selected(): AiProposal | undefined;
      receipt(): unknown;
    };
    panel.selectProposal(extracted);
    const reviewReply = new Subject<AiProposal>();
    client.aiReview.mockReturnValue(reviewReply.asObservable());
    const reviewing = panel.review();
    fixture.componentRef.setInput('identity', 'S1/P1/actor-b');
    fixture.detectChanges();
    reviewReply.next(derived);
    reviewReply.complete();
    await reviewing;
    expect(panel.selected()).toBeUndefined();

    panel.selectProposal(derived);
    const confirmReply = new Subject<{
      operationId: string;
      resourceId: string;
    }>();
    client.aiConfirm.mockReturnValue(confirmReply.asObservable());
    const confirming = panel.confirm();
    fixture.componentRef.setInput('identity', 'S1/P1/actor-c');
    fixture.detectChanges();
    confirmReply.next({ operationId: 'operation-old', resourceId: 'case-old' });
    confirmReply.complete();
    await confirming;
    expect(panel.receipt()).toBeUndefined();
  });

  it('drops a late proposal page after project scope changes', async () => {
    const fixture = TestBed.createComponent(DetectiveAiPanelComponent);
    fixture.componentRef.setInput('context', {
      kind: 'cloud',
      storage: 'firestore',
      spaceID: 'S1',
      project: 'P1',
    });
    fixture.componentRef.setInput('identity', 'S1/P1/actor-a');
    fixture.detectChanges();
    const panel = fixture.componentInstance as unknown as {
      cursor: { set(value: string): void };
      hasMore: { set(value: boolean): void };
      loadMore(): Promise<void>;
      proposals(): AiProposal[];
    };
    panel.cursor.set('cursor-1');
    panel.hasMore.set(true);
    const pageReply = new Subject<{
      proposals: AiProposal[];
      hasMore: boolean;
    }>();
    client.aiProposals.mockReturnValue(pageReply.asObservable());
    const loading = panel.loadMore();
    fixture.componentRef.setInput('context', {
      kind: 'cloud',
      storage: 'firestore',
      spaceID: 'S2',
      project: 'P2',
    });
    fixture.componentRef.setInput('identity', 'S2/P2/actor-a');
    fixture.detectChanges();
    pageReply.next({ proposals: [extracted], hasMore: false });
    pageReply.complete();
    await loading;
    expect(panel.proposals()).toEqual([]);
  });
});
