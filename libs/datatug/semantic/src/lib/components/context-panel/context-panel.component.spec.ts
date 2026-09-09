import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ApplicableQueriesResponse,
  SemanticRelatedResponse,
} from '../../models/models';
import { InvestigationContextService } from '../../services/investigation-context.service';
import { MockSemanticApi } from '../../services/mock-semantic-api';
import { SemanticApiService } from '../../services/semantic-api.service';
import { ContextPanelComponent } from './context-panel.component';

const RELATED: SemanticRelatedResponse = [
  {
    lookupId: 'invoices',
    label: 'Invoices',
    source: 'chinook',
    collection: 'Invoice',
    count: 7,
  },
  {
    lookupId: 'support-notes',
    label: 'Support notes',
    source: 'support-notes',
    collection: 'notes',
    count: 2,
  },
];

const APPLICABLE: ApplicableQueriesResponse = {
  applicable: [
    {
      queryId: 'customer-invoices',
      bindings: [
        { parameterId: 'customerId', entity: 'Customer', field: 'ID', value: 5 },
      ],
      chain: ['CustomerId', 'maps to Customer.ID (declared)', 'requires Customer.ID'],
    },
  ],
  notYet: [{ queryId: 'invoice-lines', missing: ['Invoice.ID'] }],
};

const RELATED_ROWS = {
  invoices: {
    recordset: { columns: [{ name: 'InvoiceId' }], rows: [[1], [2]] },
    limitations: [],
  },
};

describe('ContextPanelComponent', () => {
  let fixture: ComponentFixture<ContextPanelComponent>;
  let component: ContextPanelComponent;
  let mock: MockSemanticApi;
  let context: InvestigationContextService;

  async function createWithSelection() {
    mock = new MockSemanticApi({
      related: RELATED,
      applicable: APPLICABLE,
      relatedRows: RELATED_ROWS,
    });
    await TestBed.configureTestingModule({
      imports: [ContextPanelComponent],
      providers: [
        { provide: SemanticApiService, useValue: mock as unknown as SemanticApiService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContextPanelComponent);
    component = fixture.componentInstance;
    context = TestBed.inject(InvestigationContextService);

    fixture.componentRef.setInput('project', 'demo-project-1');
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
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContextPanelComponent);
    fixture.componentRef.setInput('project', 'demo-project-1');
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();

    expect(mock.calls).toEqual([]);
    expect(fixture.nativeElement.querySelector('.context-panel__meaning')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('ion-item').length).toBe(0);
  });

  describe('J2 — from a value to related knowledge', () => {
    beforeEach(createWithSelection);

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

    it('requested related for the selected entity/field/value only from the server', () => {
      const call = mock.calls.find((c) => c.method === 'getRelated');
      expect(call?.request).toMatchObject({
        project: 'demo-project-1',
        entity: 'Customer',
        field: 'ID',
        value: 5,
      });
    });

    it('AC:applicable-with-chain — shows the applicable query with its resolution chain', () => {
      // Find by text, to not depend on DOM ordering assumptions.
      const items: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('ion-item[button="true"]'),
      );
      const applicable = items.find((el) =>
        el.textContent?.includes('customer-invoices'),
      );
      expect(applicable?.textContent).toContain(
        'CustomerId → maps to Customer.ID (declared) → requires Customer.ID',
      );
    });

    it('AC:applicable-with-chain — lists "invoice-lines" as not yet applicable with the missing field', () => {
      const notYet: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('ion-item[color="light"]'),
      );
      const invoiceLines = notYet.find((el) =>
        el.textContent?.includes('invoice-lines'),
      );
      expect(invoiceLines?.textContent).toContain(
        'not yet applicable — needs Invoice.ID',
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
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        source: 'grid',
      });
    });

    it('emits openQuery with the queryId and bindings when an applicable query is opened', () => {
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

    it('AC:related-across-sources — expanding a related lookup fetches rows from the server, not the browser', () => {
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
        value: 5,
      });
      expect(
        fixture.nativeElement.querySelector('.context-panel__related-rows'),
      ).toBeTruthy();
    });
  });

  describe('J3 — applicable queries resolve against selection AND the active context', () => {
    it('includes an enabled context value alongside the selection in the applicable-queries request', async () => {
      mock = new MockSemanticApi({ related: [], applicable: { applicable: [], notYet: [] } });
      await TestBed.configureTestingModule({
        imports: [ContextPanelComponent],
        providers: [
          { provide: SemanticApiService, useValue: mock as unknown as SemanticApiService },
        ],
      }).compileComponents();

      context = TestBed.inject(InvestigationContextService);
      context.addValue({
        entityField: { entity: 'Country', field: 'Name' },
        value: 'Canada',
        label: 'Country.Name = Canada',
        source: 'related',
      });

      fixture = TestBed.createComponent(ContextPanelComponent);
      fixture.componentRef.setInput('project', 'demo-project-1');
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
      const values = (call?.request as { values: unknown[] }).values;
      expect(values).toEqual(
        expect.arrayContaining([
          { entity: 'Customer', field: 'ID', value: 5, origin: 'grid' },
          { entity: 'Country', field: 'Name', value: 'Canada', origin: 'context' },
        ]),
      );
    });
  });

  describe('J4 — restricted principal: related counts can be withheld', () => {
    it('AC:related-respects-policy — a null count renders "count unavailable"', async () => {
      mock = new MockSemanticApi({
        related: [
          {
            lookupId: 'invoices',
            label: 'Invoices',
            source: 'chinook',
            collection: 'Invoice',
            count: null,
          },
        ],
        applicable: { applicable: [], notYet: [] },
      });
      await TestBed.configureTestingModule({
        imports: [ContextPanelComponent],
        providers: [
          { provide: SemanticApiService, useValue: mock as unknown as SemanticApiService },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(ContextPanelComponent);
      fixture.componentRef.setInput('project', 'demo-project-1');
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
});
