import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { ErrorLogger } from '@sneat/core';
import {
  AgentContextService,
  ApplicableQueriesResponse,
  InvestigationContextService,
  MockSemanticApi,
  SemanticApiService,
} from '@sneat/datatug-semantic';
import { of } from 'rxjs';

import { InvestigationContextPageComponent } from './investigation-context-page.component';
import { IProjectContext } from '../../../nav/nav-models';
import { DatatugCoreModule } from '../../../core/datatug-core.module';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { DatatugServicesProjectModule } from '../../../services/project/datatug-services-project.module';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';

const project: IProjectContext = {
  ref: { storeId: 'localhost:8989', projectId: 'demo-project' },
};

const APPLICABLE: ApplicableQueriesResponse = {
  applicable: [
    {
      queryId: 'customer-purchases-by-genre',
      targets: [{ source: 'chinook', label: 'Chinook (SQLite)' }],
      selectedSource: 'chinook',
      bindings: [
        {
          parameterId: 'CustomerId',
          value: { type: 'integer', value: '5' },
          origin: 'context',
          originEvidence: 'client-reported',
        },
      ],
      chain: [
        {
          parameterId: 'CustomerId',
          explanation: 'maps to Customer.ID (declared)',
        },
        { parameterId: 'CustomerId', explanation: 'requires Customer.ID' },
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

function agentContextStub(securityContextId: string | undefined = 'sctx-1') {
  return {
    securityContextId: signal(securityContextId),
    refresh: vi.fn(() => of(undefined)),
  };
}

describe('InvestigationContextPageComponent', () => {
  let fixture: ComponentFixture<InvestigationContextPageComponent>;
  let component: InvestigationContextPageComponent;
  let mock: MockSemanticApi;
  let context: InvestigationContextService;
  let navigateSpy: ReturnType<typeof vi.fn>;

  async function create(
    fixtures: { applicable?: ApplicableQueriesResponse } = {},
  ) {
    mock = new MockSemanticApi(fixtures);
    navigateSpy = vi.fn(() => Promise.resolve(true));

    await TestBed.configureTestingModule({
      imports: [InvestigationContextPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: SemanticApiService,
          useValue: mock as unknown as SemanticApiService,
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(project),
            currentEnv: of({ id: 'production' }),
          },
        },
        { provide: Router, useValue: { navigate: navigateSpy, events: of() } },
        {
          provide: NavController,
          useValue: { navigateForward: vi.fn(() => Promise.resolve(true)) },
        },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: AgentContextService, useValue: agentContextStub() },
      ],
    })
      // The component's own `imports` (project-menu-top.component.ts's
      // sibling fix, S135, 2026-09-10) pull in `DatatugServicesNavModule`
      // et al. so the real `DatatugNavContextService` chain resolves at
      // runtime (`... -> ProjectService -> DatatugStoreServiceFactory ->
      // DatatugStoreFirestoreService -> Firestore`) — a standalone
      // component's own declared `imports` sit closer in the injector tree
      // than `TestBed`'s `providers` override above, so without removing
      // them here the real chain wins over the `DatatugNavContextService`
      // stub and fails on the unprovided `Firestore` token. `remove` (not
      // `set: { imports: [] }`, the pattern the smoke-test-only sibling
      // specs use) keeps every other declared import — and the real
      // template — intact, since these tests assert actual rendered DOM.
      .overrideComponent(InvestigationContextPageComponent, {
        remove: {
          imports: [
            DatatugCoreModule,
            DatatugServicesNavModule,
            DatatugServicesProjectModule,
            DatatugServicesStoreModule,
            DatatugServicesUnsortedModule,
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(InvestigationContextPageComponent);
    component = fixture.componentInstance;
    context = TestBed.inject(InvestigationContextService);
  }

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('shows the empty state and makes no server request when nothing is in context', async () => {
    await create();
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.investigation-context-page__empty'),
    ).toBeTruthy();
    expect(mock.calls).toEqual([]);
  });

  describe('with two collected values, one disabled', () => {
    beforeEach(async () => {
      await create({ applicable: APPLICABLE });
      // Same scope the component's own effect will set from
      // DatatugNavContextService's stubbed project/env + agentContextStub()'s default
      // securityContextId — set it up front so these pre-render addValue() calls land
      // in the basket the component actually reads (InvestigationContextService.addValue
      // is a transient no-op with no active scope, Task 15 item 2).
      context.setScope({
        project: 'demo-project',
        environment: 'production',
        securityContextId: 'sctx-1',
      });
      context.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });
      const country = context.addValue({
        entityField: { entity: 'Country', field: 'Name' },
        value: 'Canada',
        label: 'Country.Name = Canada',
        source: 'related',
      });
      context.setEnabled(country.id, false);

      fixture.detectChanges();
      TestBed.tick();
      fixture.detectChanges();
    });

    it('REQ:context-basket — lists every collected value (enabled and disabled) with its source', () => {
      const items: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll(
          '.investigation-context-page__item',
        ),
      );
      expect(items).toHaveLength(2);
      const customerItem = items.find((el) =>
        el.textContent?.includes('Customer.ID = 5'),
      );
      expect(customerItem?.textContent).toContain('from grid');
      const countryItem = items.find((el) =>
        el.textContent?.includes('Country.Name = Canada'),
      );
      expect(countryItem?.classList).toContain(
        'investigation-context-page__item--disabled',
      );
    });

    it('REQ:applicable-queries — resolves applicable queries from the enabled context only, tagged origin "context", as wire Facts', () => {
      const call = mock.calls.find((c) => c.method === 'getApplicableQueries');
      expect(call?.request).toMatchObject({
        project: 'demo-project',
        environment: 'production',
        securityContextId: 'sctx-1',
        values: [
          {
            entity: 'Customer',
            field: 'ID',
            value: { type: 'integer', value: '5' },
            origin: 'context',
          },
        ],
      });
    });

    it('AC:applicable-with-chain — renders the applicable query with its chain and the not-yet list with the missing parameter id', () => {
      const items: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('ion-item[button="true"]'),
      );
      const applicable = items.find((el) =>
        el.textContent?.includes('customer-purchases-by-genre'),
      );
      expect(applicable?.textContent).toContain(
        'maps to Customer.ID (declared) → requires Customer.ID',
      );

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

    it('disabling the last enabled item calls InvestigationContextService.setEnabled and stops requesting applicable queries (no server call for an empty context)', async () => {
      // First rendered ion-toggle is Customer.ID = 5's (insertion order) — the
      // only enabled item at this point, per the outer beforeEach.
      const toggle: HTMLElement =
        fixture.nativeElement.querySelector('ion-toggle');
      const callsBefore = mock.calls.filter(
        (c) => c.method === 'getApplicableQueries',
      ).length;

      toggle.dispatchEvent(new CustomEvent('ionChange'));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const customer = context
        .items()
        .find((i) => i.label === 'Customer.ID = 5');
      expect(customer?.enabled).toBe(false);

      // REQ:applicable-queries — with nothing enabled, the page must not send an
      // empty-values request to the server; it just clears the list locally.
      // Asserted against the component's own signals (proven to reflect the
      // effect's outcome immediately after the flush above — see the DOM
      // rendering of the very same signals covered by the initial-render
      // tests in this file) rather than the rendered DOM text, whose
      // OnPush re-render lands on a later, less deterministic tick in this
      // test harness.
      const callsAfter = mock.calls.filter(
        (c) => c.method === 'getApplicableQueries',
      ).length;
      expect(callsAfter).toBe(callsBefore);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const protectedComponent = component as any;
      expect(protectedComponent.applicable()).toEqual([]);
      expect(protectedComponent.notYet()).toEqual([]);
      expect(
        fixture.nativeElement.querySelector('.investigation-context-page__item')
          ?.textContent,
      ).toContain('Customer.ID = 5'); // still listed, just disabled
    });

    it('removing an item calls InvestigationContextService.removeValue', () => {
      // Scope by row (first item = Customer.ID = 5, insertion order) rather
      // than an aria-label on ion-button: Ionic's real hydrated ion-button
      // moves/delegates aria-label into its shadow-DOM internal <button>, so
      // it is not queryable on the light-DOM host in this test environment.
      const firstRow: HTMLElement = fixture.nativeElement.querySelector(
        '.investigation-context-page__item',
      );
      expect(firstRow.textContent).toContain('Customer.ID = 5');
      const removeButton = firstRow.querySelector('ion-button') as HTMLElement;
      removeButton.dispatchEvent(new Event('click'));
      fixture.detectChanges();

      expect(
        context.items().find((i) => i.label === 'Customer.ID = 5'),
      ).toBeUndefined();
      expect(context.items()).toHaveLength(1);
    });

    it('opening an applicable query navigates to the query page carrying its resolved wire bindings/targets', () => {
      const items: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('ion-item[button="true"]'),
      );
      const applicable = items.find((el) =>
        el.textContent?.includes('customer-purchases-by-genre'),
      ) as HTMLElement;
      applicable.dispatchEvent(new Event('click'));

      expect(navigateSpy).toHaveBeenCalledWith(
        [
          '/store',
          'localhost:8989',
          'project',
          'demo-project',
          'query',
          'customer-purchases-by-genre',
        ],
        {
          queryParams: { id: 'customer-purchases-by-genre' },
          state: {
            bindings: APPLICABLE.applicable[0].bindings,
            targets: APPLICABLE.applicable[0].targets,
            selectedSource: APPLICABLE.applicable[0].selectedSource,
          },
        },
      );
    });
  });

  describe('opening an applicable query whose id is folder-qualified (datatug-cli#219)', () => {
    const FOLDER_QUALIFIED_APPLICABLE: ApplicableQueriesResponse = {
      applicable: [
        {
          queryId: 'customers/customer-invoices',
          targets: [{ source: 'chinook', label: 'Chinook (SQLite)' }],
          selectedSource: 'chinook',
          bindings: [],
          chain: [],
          missing: [],
          ambiguous: [],
          state: 'runnable',
        },
      ],
      notYet: [],
    };

    beforeEach(async () => {
      await create({ applicable: FOLDER_QUALIFIED_APPLICABLE });
      context.setScope({
        project: 'demo-project',
        environment: 'production',
        securityContextId: 'sctx-1',
      });
      context.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });

      fixture.detectChanges();
      TestBed.tick();
      fixture.detectChanges();
    });

    it('encodes the folder-qualified queryId as a single routable path segment, keeping the raw id in the id query param', () => {
      const items: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('ion-item[button="true"]'),
      );
      const applicable = items.find((el) =>
        el.textContent?.includes('customers/customer-invoices'),
      ) as HTMLElement;
      applicable.dispatchEvent(new Event('click'));

      expect(navigateSpy).toHaveBeenCalledWith(
        [
          '/store',
          'localhost:8989',
          'project',
          'demo-project',
          'query',
          // Single `%2F`-encoded segment — see the matching
          // EnvDbTablePageComponent.onOpenQuery spec for why.
          'customers%2Fcustomer-invoices',
        ],
        {
          queryParams: { id: 'customers/customer-invoices' },
          state: {
            bindings: FOLDER_QUALIFIED_APPLICABLE.applicable[0].bindings,
            targets: FOLDER_QUALIFIED_APPLICABLE.applicable[0].targets,
            selectedSource:
              FOLDER_QUALIFIED_APPLICABLE.applicable[0].selectedSource,
          },
        },
      );
    });
  });
});
