import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { PopoverController } from '@ionic/angular';
import { ErrorLogger } from '@sneat/core';
import {
  InvestigationContextService,
  SemanticApiService,
} from '@sneat/datatug-semantic';
import { of } from 'rxjs';

import { EnvDbTablePageComponent } from './env-db-table.page';
import { IEnvDbTableContext, IProjectContext } from '../../../nav/nav-models';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { ProjectService } from '../../../services/project/project.service';
import { AgentService } from '../../../services/repo/agent.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';

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
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
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
        { provide: PopoverController, useValue: { create: vi.fn() } },
        { provide: DatatugNavService, useValue: { goTable: vi.fn() } },
        {
          provide: SemanticApiService,
          useValue: { getSemanticColumns: vi.fn(() => of([])) },
        },
        {
          provide: InvestigationContextService,
          useValue: { addValue: vi.fn(), items: () => [] },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn(() => Promise.resolve(true)) },
        },
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
    semanticColumnsResponse: unknown[] = [],
  ): Promise<EnvDbTablePageComponent> {
    getSemanticColumnsMock = vi.fn(() => of(semanticColumnsResponse));
    routerMock = { navigate: vi.fn(() => Promise.resolve(true)) };
    await TestBed.configureTestingModule({
      imports: [EnvDbTablePageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: { logError: vi.fn(), logErrorHandler: vi.fn(() => vi.fn()) },
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
        { provide: PopoverController, useValue: { create: vi.fn() } },
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
      { column: 'CustomerId', entity: 'Customer', field: 'ID', provenance: 'declared' },
    ]);

    expect(getSemanticColumnsMock).toHaveBeenCalledWith({
      project: 'demo-project',
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
      { column: 'CustomerId', entity: 'Customer', field: 'ID', provenance: 'inferred' },
    ]);

    const customerIdCol = (component.grid?.columns || []).find(
      (c) => c.field === 'CustomerId',
    );
    expect(customerIdCol?.title).toContain('helpCircleOutline');
    expect(customerIdCol?.title).toContain('semantic-marker--inferred');
  });

  it('sets selection from the clicked cell using the loaded semantic mapping', async () => {
    component = await createComponent([
      { column: 'CustomerId', entity: 'Customer', field: 'ID', provenance: 'declared' },
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
      { column: 'CustomerId', entity: 'Customer', field: 'ID', provenance: 'declared' },
    ]);

    const cellEl = document.createElement('div');
    cellEl.setAttribute('tabulator-field', 'FirstName');
    const event = { target: cellEl } as unknown as Event;
    const row = { getData: () => ({ FirstName: 'Bob' }) };

    component.onGridRowClick(event, row);

    expect(component.selection()).toBeUndefined();
  });

  it('closeContextPanel clears the selection', async () => {
    component = await createComponent([
      { column: 'CustomerId', entity: 'Customer', field: 'ID', provenance: 'declared' },
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

  it('onOpenQuery navigates to the query page route carrying the resolved bindings as router state', async () => {
    component = await createComponent();
    component.project = project;

    component.onOpenQuery({
      queryId: 'customer-invoices',
      bindings: [{ parameterId: 'CustomerId', entity: 'Customer', field: 'ID', value: 5 }],
    });

    expect(routerMock.navigate).toHaveBeenCalledWith(
      ['/store', 'localhost:8989', 'project', 'demo-project', 'query', 'customer-invoices'],
      {
        state: {
          bindings: [
            { parameterId: 'CustomerId', entity: 'Customer', field: 'ID', value: 5 },
          ],
        },
      },
    );
  });

  it('onOpenQuery does nothing without a project', async () => {
    component = await createComponent();
    component.project = undefined;

    component.onOpenQuery({ queryId: 'customer-invoices', bindings: [] });

    expect(routerMock.navigate).not.toHaveBeenCalled();
  });
});
