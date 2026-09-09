import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Firestore } from 'firebase/firestore';
import { ErrorLogger } from '@sneat/core';
import {
  AgentContextService,
  InvestigationContextService,
  SemanticApiService,
} from '@sneat/datatug-semantic';
import { of } from 'rxjs';

import { EnvDbTablePageComponent } from './env-db-table.page';
import { IEnvDbTableContext, IProjectContext } from '../../../nav/nav-models';
import { routingParamEnvironmentId } from '../../../core/datatug-routing-params';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { ProjectService } from '../../../services/project/project.service';
import { AgentService } from '../../../services/repo/agent.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';

function agentContextStub(securityContextId: string | undefined = 'sctx-1') {
  return {
    securityContextId: signal(securityContextId),
    refresh: vi.fn(() => of(undefined)),
  };
}

/** Route mock whose `snapshot.paramMap.get` resolves `routingParamEnvironmentId` — the
 * component reads `envId` from it in its constructor, and every semantic-columns request
 * now needs it (Scope.environment, plan Task 12). */
function activatedRouteStub() {
  return {
    queryParamMap: of({ get: () => null }),
    paramMap: of({ get: () => null }),
    snapshot: {
      paramMap: {
        get: (key: string) => (key === routingParamEnvironmentId ? 'production' : null),
      },
      params: {},
    },
  };
}

describe('EnvDbTablePage', () => {
  let component: EnvDbTablePageComponent;
  let fixture: ComponentFixture<EnvDbTablePageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EnvDbTablePageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: activatedRouteStub(),
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(undefined),
            currentEnv: of(undefined),
            currentEnvDbTable: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: ProjectService,
          useValue: { watchProjectSummary: vi.fn(), getFull: vi.fn() },
        },
        { provide: AgentService, useValue: { select: vi.fn() } },
        { provide: DatatugNavService, useValue: { goTable: vi.fn() } },
        {
          provide: SemanticApiService,
          useValue: { getSemanticColumns: vi.fn(() => of({ columns: [] })) },
        },
        {
          provide: InvestigationContextService,
          useValue: { addValue: vi.fn(), items: () => [] },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn(() => Promise.resolve(true)) },
        },
        { provide: AgentContextService, useValue: agentContextStub() },
      ],
    })
      .overrideComponent(EnvDbTablePageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EnvDbTablePageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

// REQ:semantic-markers-in-grid, REQ:context-basket (INTEGRATION.md §2-3).
describe('EnvDbTablePage — semantic markers and cell selection', () => {
  let component: EnvDbTablePageComponent;
  let getSemanticColumnsMock: ReturnType<typeof vi.fn>;
  let routerMock: { navigate: ReturnType<typeof vi.fn> };

  const project: IProjectContext = {
    ref: { storeId: 'localhost:8989', projectId: 'demo-project' },
  };
  const table: IEnvDbTableContext = {
    schema: 'main',
    name: 'Customer',
    meta: {
      name: 'Customer',
      schema: 'main',
      columns: [
        { name: 'CustomerId', dbType: 'integer' },
        { name: 'FirstName', dbType: 'string' },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };

  async function createComponent(
    semanticColumns: unknown[] = [],
  ): Promise<EnvDbTablePageComponent> {
    getSemanticColumnsMock = vi.fn(() => of({ columns: semanticColumns }));
    routerMock = { navigate: vi.fn(() => Promise.resolve(true)) };
    await TestBed.configureTestingModule({
      imports: [EnvDbTablePageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: activatedRouteStub(),
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(project),
            currentEnv: of(undefined),
            currentEnvDbTable: of(table),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: ProjectService,
          useValue: { watchProjectSummary: vi.fn(), getFull: vi.fn() },
        },
        {
          provide: AgentService,
          useValue: { select: vi.fn(() => of({ commands: [] })) },
        },
        { provide: DatatugNavService, useValue: { goTable: vi.fn() } },
        {
          provide: SemanticApiService,
          useValue: { getSemanticColumns: getSemanticColumnsMock },
        },
        {
          provide: InvestigationContextService,
          useValue: { addValue: vi.fn(), items: () => [] },
        },
        { provide: Router, useValue: routerMock },
        { provide: AgentContextService, useValue: agentContextStub() },
      ],
    })
      .overrideComponent(EnvDbTablePageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    return TestBed.createComponent(EnvDbTablePageComponent).componentInstance;
  }

  it('marks a mapped column header and leaves an unmapped one alone', async () => {
    component = await createComponent([
      {
        column: 'CustomerId',
        entity: 'Customer',
        field: 'ID',
        provenance: 'declared',
      },
    ]);

    expect(getSemanticColumnsMock).toHaveBeenCalledWith({
      project: 'demo-project',
      environment: 'production',
      securityContextId: 'sctx-1',
      source: component.dbId || '',
      collection: 'Customer',
    });

    const columns = component.grid?.columns || [];
    const customerIdCol = columns.find((c) => c.field === 'CustomerId');
    const firstNameCol = columns.find((c) => c.field === 'FirstName');

    expect(customerIdCol?.title).toContain('<ion-icon');
    expect(customerIdCol?.title).toContain('pricetag');
    expect(customerIdCol?.title).toContain('Customer.ID');
    expect(firstNameCol?.title).toBe('FirstName');
    expect(firstNameCol?.title).not.toContain('<ion-icon');
  });

  it('uses the inferred-provenance icon for an inferred mapping', async () => {
    component = await createComponent([
      {
        column: 'CustomerId',
        entity: 'Customer',
        field: 'ID',
        provenance: 'inferred',
      },
    ]);

    const customerIdCol = (component.grid?.columns || []).find(
      (c) => c.field === 'CustomerId',
    );
    expect(customerIdCol?.title).toContain('helpCircleOutline');
    expect(customerIdCol?.title).toContain('semantic-marker--inferred');
  });

  it('sets selection from the clicked cell using the loaded semantic mapping', async () => {
    component = await createComponent([
      {
        column: 'CustomerId',
        entity: 'Customer',
        field: 'ID',
        provenance: 'declared',
      },
    ]);

    const cellEl = document.createElement('div');
    cellEl.setAttribute('tabulator-field', 'CustomerId');
    const event = { target: cellEl } as unknown as Event;
    const row = { getData: () => ({ CustomerId: 5 }) };

    component.onGridRowClick(event, row);

    expect(component.selection()).toEqual({
      entity: 'Customer',
      field: 'ID',
      value: 5,
      label: 'Customer.ID = 5',
      source: component.dbId || 'grid',
    });
    expect(component.hasSelection()).toBe(true);
  });

  it('clears selection when the clicked column has no semantic mapping', async () => {
    component = await createComponent([
      {
        column: 'CustomerId',
        entity: 'Customer',
        field: 'ID',
        provenance: 'declared',
      },
    ]);

    const cellEl = document.createElement('div');
    cellEl.setAttribute('tabulator-field', 'FirstName');
    const event = { target: cellEl } as unknown as Event;
    const row = { getData: () => ({ FirstName: 'Bob' }) };

    component.onGridRowClick(event, row);

    expect(component.selection()).toBeUndefined();
  });

  // Full-cutover regression (REQ:context-basket, INTEGRATION.md §3): clicking a
  // foreign-key-backed cell used to open @sneat/datagrid's hard-coded
  // CellPopoverComponent via a Tabulator cell formatter, independent of any
  // semantic mapping. That code path (cellFormatter/getColFk/PopoverController)
  // is deleted; an FK column with no server-reported semantic mapping now behaves
  // exactly like any other unmapped column — no popover, no selection — proving
  // there is no second, parallel cell-click mechanism left beside the context panel.
  it('does not select an FK-backed cell that the server has not mapped semantically', async () => {
    component = await createComponent([]);
    component.table = {
      ...table,
      meta: {
        ...(table.meta as Record<string, unknown>),
        foreignKeys: [
          {
            name: 'FK_Customer_Country',
            columns: ['CountryId'],
            refTable: { schema: 'main', name: 'Country' },
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    };

    const cellEl = document.createElement('div');
    cellEl.setAttribute('tabulator-field', 'CountryId');
    const event = { target: cellEl } as unknown as Event;
    const row = { getData: () => ({ CountryId: 7 }) };

    component.onGridRowClick(event, row);

    expect(component.selection()).toBeUndefined();
  });

  it('closeContextPanel clears the selection', async () => {
    component = await createComponent([
      {
        column: 'CustomerId',
        entity: 'Customer',
        field: 'ID',
        provenance: 'declared',
      },
    ]);
    component.selection.set({
      entity: 'Customer',
      field: 'ID',
      value: 5,
      label: 'Customer.ID = 5',
      source: 'grid',
    });

    component.closeContextPanel();

    expect(component.selection()).toBeUndefined();
  });

  it('onOpenQuery navigates to the query page route carrying the resolved wire bindings/targets as router state', async () => {
    component = await createComponent();
    component.project = project;

    component.onOpenQuery({
      queryId: 'customer-invoices',
      bindings: [
        {
          parameterId: 'CustomerId',
          value: { type: 'integer', value: '5' },
          origin: 'selection',
          originEvidence: 'client-reported',
        },
      ],
      targets: [{ source: 'chinook', label: 'Chinook (SQLite)' }],
      selectedSource: 'chinook',
      state: 'runnable',
    });

    expect(routerMock.navigate).toHaveBeenCalledWith(
      [
        '/store',
        'localhost:8989',
        'project',
        'demo-project',
        'query',
        'customer-invoices',
      ],
      {
        queryParams: { id: 'customer-invoices' },
        state: {
          bindings: [
            {
              parameterId: 'CustomerId',
              value: { type: 'integer', value: '5' },
              origin: 'selection',
              originEvidence: 'client-reported',
            },
          ],
          targets: [{ source: 'chinook', label: 'Chinook (SQLite)' }],
          selectedSource: 'chinook',
        },
      },
    );
  });

  it('onOpenQuery does nothing without a project', async () => {
    component = await createComponent();
    component.project = undefined;

    component.onOpenQuery({
      queryId: 'customer-invoices',
      bindings: [],
      targets: [],
      state: 'runnable',
    });

    expect(routerMock.navigate).not.toHaveBeenCalled();
  });
});

/**
 * Regression for `NG0201: No provider found for DatatugNavContextService.
 * Source: Standalone[EnvDbTablePageComponent]`, thrown for real every time the
 * table page was reached by URL, which left the grid unrendered (journey J1's
 * Album step). The two describes above cannot see it: they stub every injected
 * service AND blank the component's own `imports`, so they prove the class
 * constructs under hand-fed doubles, not that the app can build it.
 *
 * Here the component is left exactly as production declares it, so the only
 * thing that can satisfy these injections is its own `imports` list, and only
 * leaf I/O (HTTP, Firestore, router, navigation) is stubbed. The template is
 * never rendered: `TestBed.createComponent` on this page fails in this
 * environment for an unrelated, pre-existing reason (its real child tree
 * reaches a directive whose `providersResolver` runs against a second
 * @angular/core copy and throws "Cannot read properties of null (reading
 * 'firstCreatePass')"), and that reproduces identically with the original
 * component and every service stubbed. Construction is the right site anyway:
 * NG0201 came from this component's own `inject()` field initializers.
 */
describe('EnvDbTablePage dependency injection', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      // Importing the standalone component brings its own `imports` into the
      // testing injector — nothing else here provides the datatug services.
      imports: [EnvDbTablePageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
            events: of(),
            url: '/',
          },
        },
        {
          provide: NavController,
          useValue: {
            navigateForward: vi.fn(() => Promise.resolve(true)),
            navigateRoot: vi.fn(),
          },
        },
        { provide: HttpClient, useValue: { get: vi.fn(() => of({})) } },
        { provide: Firestore, useValue: {} },
      ],
    });
  });

  it('constructs from its own declared imports, the site that threw NG0201', () => {
    expect(() =>
      TestBed.runInInjectionContext(() => new EnvDbTablePageComponent()),
    ).not.toThrow();
  });

  it.each([
    ['DatatugNavContextService', DatatugNavContextService],
    ['ProjectService', ProjectService],
    ['AgentService', AgentService],
  ])(
    'resolves %s, which is provided by a module and never `providedIn: root`',
    (_name, token) => {
      expect(TestBed.inject(token, null)).toBeTruthy();
    },
  );
});
