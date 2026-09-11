import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
  ApplicableQueriesResponse,
  SemanticRelatedResponse,
} from '../../../contract/types';
import { AgentContextService } from '../../services/agent-context.service';
import { explainSkippedCondition } from '../../services/binding-resolver';
import { InvestigationContextService } from '../../services/investigation-context.service';
import { MockSemanticApi } from '../../services/mock-semantic-api';
import { SemanticApiService } from '../../services/semantic-api.service';
import { ContextPanelComponent } from './context-panel.component';

const RELATED: SemanticRelatedResponse = {
  related: [
    { lookupId: 'invoices', label: 'Invoices', source: 'chinook', collection: 'Invoice', count: 7 },
    { lookupId: 'support-notes', label: 'Support notes', source: 'support-notes', collection: 'notes', count: 2 },
  ],
  truncated: false,
};

const APPLICABLE: ApplicableQueriesResponse = {
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
        // A server that mirrors api-contract.md's `Fact.condition` paragraph reports a
        // skipped non-`==` context fact as a `chain` step, not a hidden filter — this
        // panel's chain rendering (`chainText`) is already generic, so the exact same
        // wording this client's own resolver uses (`explainSkippedCondition`) renders
        // here with no template change needed.
        {
          parameterId: 'InvoiceDate',
          factId: 'ctx-invoicedate-gt',
          explanation: explainSkippedCondition('>'),
        },
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

const RELATED_ROWS = {
  invoices: {
    recordset: {
      columns: [{ name: 'InvoiceId', type: 'integer' }],
      rows: [[{ type: 'integer', value: '1' }], [{ type: 'integer', value: '2' }]],
    },
    limitations: [],
    bindingsApplied: [],
    provenance: {
      source: 'chinook',
      mode: 'live' as const,
      observedAt: '2026-09-09T12:00:00Z',
      executionProfile: 'protected' as const,
    },
    truncated: false,
  },
};

function agentContextStub(securityContextId: string | undefined = 'sctx-1') {
  return {
    securityContextId: signal(securityContextId),
    refresh: vi.fn(() => of(undefined)),
  };
}

describe('ContextPanelComponent', () => {
  let fixture: ComponentFixture<ContextPanelComponent>;
  let component: ContextPanelComponent;
  let mock: MockSemanticApi;
  let context: InvestigationContextService;

  async function createWithSelection(agentContext = agentContextStub()) {
    mock = new MockSemanticApi({
      related: RELATED,
      applicable: APPLICABLE,
      relatedRows: RELATED_ROWS,
    });
    await TestBed.configureTestingModule({
      imports: [ContextPanelComponent],
      providers: [
        { provide: SemanticApiService, useValue: mock as unknown as SemanticApiService },
        { provide: AgentContextService, useValue: agentContext },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContextPanelComponent);
    component = fixture.componentInstance;
    context = TestBed.inject(InvestigationContextService);

    fixture.componentRef.setInput('project', 'demo-project-1');
    fixture.componentRef.setInput('environment', 'production');
    fixture.componentRef.setInput('selection', {
      entity: 'Customer',
      field: 'ID',
      value: 5,
      label: 'Customer.ID = 5',
      source: 'grid',
    });
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
  }

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('makes no request and shows nothing before any value is selected', async () => {
    mock = new MockSemanticApi();
    await TestBed.configureTestingModule({
      imports: [ContextPanelComponent],
      providers: [
        { provide: SemanticApiService, useValue: mock as unknown as SemanticApiService },
        { provide: AgentContextService, useValue: agentContextStub() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContextPanelComponent);
    fixture.componentRef.setInput('project', 'demo-project-1');
    fixture.componentRef.setInput('environment', 'production');
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();

    expect(mock.calls).toEqual([]);
    expect(fixture.nativeElement.querySelector('.context-panel__meaning')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('ion-item').length).toBe(0);
  });

  /**
   * Regression (lane S90): the server rejects `POST /datatug/semantic/related`
   * with `INVALID_REQUEST` on `fact.physical` ("is required to compute
   * related lookups") when it's missing — confirmed live against a real
   * agent. A host page that resolved the selection from a `GET
   * /semantic/columns` mapping (e.g. `EnvDbTablePageComponent`) has
   * `source`/`collection`/`column` on hand and now passes them through as
   * `SemanticSelection.physical`; this asserts `toFact()`/this component
   * forward it onto the wire `Fact` unchanged, rather than dropping it.
   */
  it('forwards SemanticSelection.physical onto the wire Fact sent to getRelated', async () => {
    mock = new MockSemanticApi({
      related: RELATED,
      applicable: APPLICABLE,
      relatedRows: RELATED_ROWS,
    });
    await TestBed.configureTestingModule({
      imports: [ContextPanelComponent],
      providers: [
        { provide: SemanticApiService, useValue: mock as unknown as SemanticApiService },
        { provide: AgentContextService, useValue: agentContextStub() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContextPanelComponent);
    fixture.componentRef.setInput('project', 'demo-project-1');
    fixture.componentRef.setInput('environment', 'production');
    fixture.componentRef.setInput('selection', {
      entity: 'Customer',
      field: 'ID',
      value: 5,
      label: 'Customer.ID = 5',
      source: 'grid',
      physical: { source: 'chinook-local', collection: 'Customer', column: 'CustomerId' },
    });
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();

    const call = mock.calls.find((c) => c.method === 'getRelated');
    expect(call?.request).toMatchObject({
      fact: {
        physical: {
          source: 'chinook-local',
          collection: 'Customer',
          column: 'CustomerId',
        },
      },
    });
  });

  describe('J2 — from a value to related knowledge', () => {
    beforeEach(() => createWithSelection());

    it('renders the selected meaning', () => {
      const header = fixture.nativeElement.querySelector(
        '.context-panel__meaning ion-label',
      );
      expect(header.textContent).toContain('Customer.ID = 5');
    });

    it('AC:related-across-sources — lists related lookups from the server with source and count', () => {
      const items = fixture.nativeElement.querySelectorAll(
        'ion-item[button="true"]',
      );
      const relatedItem = Array.from(items).find((el) =>
        (el as HTMLElement).textContent?.includes('Invoices'),
      ) as HTMLElement;
      expect(relatedItem).toBeTruthy();
      expect(relatedItem.textContent).toContain('chinook');
      expect(relatedItem.querySelector('ion-badge')?.textContent?.trim()).toBe(
        '7',
      );
    });

    it('POSTs a Scope + Fact for the selected entity/field/value, never facts in the URL', () => {
      const call = mock.calls.find((c) => c.method === 'getRelated');
      expect(call?.request).toMatchObject({
        project: 'demo-project-1',
        environment: 'production',
        securityContextId: 'sctx-1',
        fact: {
          entity: 'Customer',
          field: 'ID',
          value: { type: 'integer', value: '5' },
          origin: 'selection',
        },
      });
    });

    it('AC:applicable-with-chain — shows the applicable query with its resolution chain', () => {
      const items: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('ion-item[button="true"]'),
      );
      const applicable = items.find((el) =>
        el.textContent?.includes('customer-invoices'),
      );
      expect(applicable?.textContent).toContain('maps to Customer.ID (declared)');
    });

    it('renders a skipped non-equality-condition chain step verbatim (api-contract.md Fact.condition — REQ:no-hidden-filters)', () => {
      const items: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('ion-item[button="true"]'),
      );
      const applicable = items.find((el) =>
        el.textContent?.includes('customer-invoices'),
      );
      expect(applicable?.textContent).toContain(explainSkippedCondition('>'));
    });

    it('AC:applicable-with-chain — lists "invoice-lines" as not yet applicable with the missing parameter id', () => {
      const notYet: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('ion-item[color="light"]'),
      );
      const invoiceLines = notYet.find((el) =>
        el.textContent?.includes('invoice-lines'),
      );
      expect(invoiceLines?.textContent).toContain(
        'not yet applicable — needs InvoiceId',
      );
    });

    it('"Add to context" calls InvestigationContextService.addValue with the selection', () => {
      const button: HTMLElement = fixture.nativeElement.querySelector(
        '.context-panel__meaning ion-button',
      );
      button.dispatchEvent(new Event('click'));
      fixture.detectChanges();

      expect(context.items()).toHaveLength(1);
      expect(context.items()[0]).toMatchObject({
        entity: 'Customer',
        field: 'ID',
        value: { type: 'integer', value: '5' },
        source: 'grid',
      });
    });

    it('emits openQuery with the queryId, wire bindings and targets when an applicable query is opened', () => {
      const emitted: { queryId: string }[] = [];
      component.openQuery.subscribe((e) => emitted.push(e));

      const items: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('ion-item[button="true"]'),
      );
      const applicable = items.find((el) =>
        el.textContent?.includes('customer-invoices'),
      ) as HTMLElement;
      applicable.dispatchEvent(new Event('click'));

      expect(emitted).toHaveLength(1);
      expect(emitted[0].queryId).toBe('customer-invoices');
    });

    it('AC:related-across-sources — expanding a related lookup POSTs Scope + lookupId + typed value', () => {
      const items: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('ion-item[button="true"]'),
      );
      const invoicesRow = items.find((el) =>
        el.textContent?.includes('Invoices'),
      ) as HTMLElement;
      invoicesRow.dispatchEvent(new Event('click'));
      fixture.detectChanges();

      const rowsCall = mock.calls.find((c) => c.method === 'getRelatedRows');
      expect(rowsCall?.request).toMatchObject({
        lookupId: 'invoices',
        value: { type: 'integer', value: '5' },
      });
      expect(
        fixture.nativeElement.querySelector('.context-panel__related-rows'),
      ).toBeTruthy();
    });
  });

  describe('needs-target candidates', () => {
    it('are rendered clickable and emit openQuery with their targets', async () => {
      mock = new MockSemanticApi({
        related: { related: [], truncated: false },
        applicable: {
          applicable: [],
          notYet: [
            {
              queryId: 'exchange-rate-for-customer-currency',
              targets: [
                { source: 'chinook', label: 'Chinook (SQLite)' },
                { source: 'exchange-rates-http', label: 'Exchange rates (HTTP)' },
              ],
              bindings: [],
              chain: [],
              missing: [],
              ambiguous: [],
              state: 'needs-target',
            },
          ],
        },
      });
      await TestBed.configureTestingModule({
        imports: [ContextPanelComponent],
        providers: [
          { provide: SemanticApiService, useValue: mock as unknown as SemanticApiService },
          { provide: AgentContextService, useValue: agentContextStub() },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(ContextPanelComponent);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('project', 'demo-project-1');
      fixture.componentRef.setInput('environment', 'production');
      fixture.componentRef.setInput('selection', {
        entity: 'Customer',
        field: 'ID',
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });
      fixture.detectChanges();
      TestBed.tick();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const emitted: { queryId: string; targets: unknown }[] = [];
      component.openQuery.subscribe((e) => emitted.push(e));

      // Query the plain (non-custom-element) <p> directly rather than `ion-item`'s own
      // `.textContent` — once Ionic's real Stencil web components finish lazy-loading
      // (asynchronously, on first use, shared across this whole spec file's tests), a
      // custom element's own `.textContent` becomes unreliable in happy-dom while its
      // plain-HTML descendants stay normal.
      const needsTarget = fixture.nativeElement.querySelector(
        'ion-item[button="true"]',
      ) as HTMLElement;
      expect(needsTarget).toBeTruthy();
      const needsTargetText = needsTarget.querySelector('p')?.textContent;
      expect(needsTargetText).toContain('needs a target');
      needsTarget.dispatchEvent(new Event('click'));

      expect(emitted).toHaveLength(1);
      expect(emitted[0].queryId).toBe('exchange-rate-for-customer-currency');
      expect(emitted[0].targets).toHaveLength(2);
    });
  });

  describe('J3 — applicable queries resolve against selection AND the active context', () => {
    it('includes an enabled context value alongside the selection in the applicable-queries request', async () => {
      mock = new MockSemanticApi({
        related: { related: [], truncated: false },
        applicable: { applicable: [], notYet: [] },
      });
      await TestBed.configureTestingModule({
        imports: [ContextPanelComponent],
        providers: [
          { provide: SemanticApiService, useValue: mock as unknown as SemanticApiService },
          { provide: AgentContextService, useValue: agentContextStub() },
        ],
      }).compileComponents();

      context = TestBed.inject(InvestigationContextService);
      // Same scope the component below will resolve (project/environment inputs +
      // agentContextStub()'s default securityContextId) — the pre-seeded fact must
      // land in the basket the component actually reads from.
      context.setScope({
        project: 'demo-project-1',
        environment: 'production',
        securityContextId: 'sctx-1',
      });
      context.addValue({
        entityField: { entity: 'Country', field: 'Name' },
        value: 'Canada',
        label: 'Country.Name = Canada',
        source: 'related',
      });

      fixture = TestBed.createComponent(ContextPanelComponent);
      fixture.componentRef.setInput('project', 'demo-project-1');
      fixture.componentRef.setInput('environment', 'production');
      fixture.componentRef.setInput('selection', {
        entity: 'Customer',
        field: 'ID',
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });
      fixture.detectChanges();
      TestBed.tick();
      fixture.detectChanges();

      const call = mock.calls.find((c) => c.method === 'getApplicableQueries');
      const values = (call?.request as { values: { entity: string; field: string }[] })
        .values;
      expect(values).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entity: 'Customer',
            field: 'ID',
            value: { type: 'integer', value: '5' },
            origin: 'selection',
          }),
          expect.objectContaining({
            entity: 'Country',
            field: 'Name',
            value: { type: 'string', value: 'Canada' },
            origin: 'context',
          }),
        ]),
      );
    });
  });

  describe('J4 — restricted principal: related counts can be withheld', () => {
    it('AC:related-respects-policy — a null count renders "count unavailable"', async () => {
      mock = new MockSemanticApi({
        related: {
          related: [
            { lookupId: 'invoices', label: 'Invoices', source: 'chinook', collection: 'Invoice', count: null },
          ],
          truncated: false,
        },
        applicable: { applicable: [], notYet: [] },
      });
      await TestBed.configureTestingModule({
        imports: [ContextPanelComponent],
        providers: [
          { provide: SemanticApiService, useValue: mock as unknown as SemanticApiService },
          { provide: AgentContextService, useValue: agentContextStub() },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(ContextPanelComponent);
      fixture.componentRef.setInput('project', 'demo-project-1');
      fixture.componentRef.setInput('environment', 'production');
      fixture.componentRef.setInput('selection', {
        entity: 'Customer',
        field: 'ID',
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });
      fixture.detectChanges();
      TestBed.tick();
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('ion-badge');
      expect(badge.textContent.trim()).toBe('count unavailable');
    });
  });

  describe('STALE_CONTEXT', () => {
    it('clears the Investigation Context and refreshes agent-info, surfacing a retry prompt', async () => {
      const staleError = new HttpErrorResponse({
        status: 409,
        error: {
          error: {
            code: 'STALE_CONTEXT',
            message: 'securityContextId no longer valid',
            requestId: 'req-1',
          },
        },
      });
      mock = {
        calls: [],
        getRelated: vi.fn(() => throwError(() => staleError)),
        getApplicableQueries: vi.fn(() => throwError(() => staleError)),
        getRelatedRows: vi.fn(),
        getSemanticColumns: vi.fn(),
        runQuery: vi.fn(),
      } as unknown as MockSemanticApi;

      const agentContext = agentContextStub();
      await TestBed.configureTestingModule({
        imports: [ContextPanelComponent],
        providers: [
          { provide: SemanticApiService, useValue: mock as unknown as SemanticApiService },
          { provide: AgentContextService, useValue: agentContext },
        ],
      }).compileComponents();

      context = TestBed.inject(InvestigationContextService);
      context.setScope({
        project: 'demo-project-1',
        environment: 'production',
        securityContextId: 'sctx-1',
      });
      context.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 1,
        label: 'Customer.ID = 1',
        source: 'grid',
      });
      expect(context.items()).toHaveLength(1);

      fixture = TestBed.createComponent(ContextPanelComponent);
      fixture.componentRef.setInput('project', 'demo-project-1');
      fixture.componentRef.setInput('environment', 'production');
      fixture.componentRef.setInput('selection', {
        entity: 'Customer',
        field: 'ID',
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });
      fixture.detectChanges();
      TestBed.tick();
      fixture.detectChanges();

      expect(context.items()).toHaveLength(0);
      expect(agentContext.refresh).toHaveBeenCalled();
      const errorEl = fixture.nativeElement.querySelector('ion-text[color="danger"]');
      expect(errorEl.textContent).toContain('session changed');
    });
  });
});
