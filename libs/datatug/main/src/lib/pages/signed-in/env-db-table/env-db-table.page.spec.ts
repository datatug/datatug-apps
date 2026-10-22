import { CardLookupService } from '../../../cards/card-lookup.service';
import { ProjectCardsService } from '../../../cards/project-cards.service';
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  input,
  output,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
import {
  routingParamDbCatalogId,
  routingParamEnvironmentId,
} from '../../../core/datatug-routing-params';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { ProjectService } from '../../../services/project/project.service';
import { AgentService } from '../../../services/repo/agent.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { provideMockErrorLogger } from '../../../testing/error-logger.spec-helper';

@Component({ selector: 'sneat-datatug-sql', standalone: true, template: '' })
class SqlEditorHostStub {
  readonly sql = input('');
  readonly readonly = input(false);
  readonly disabled = input(false);
  readonly sqlChanged = output<string>();
}

function sqlEditorTemplate(): string {
  const template = readFileSync(
    resolve(
      'libs/datatug/main/src/lib/pages/signed-in/env-db-table/env-db-table.page.html',
    ),
    'utf8',
  );
  const start = template.indexOf('<ion-item class="sql-editor');
  const end = template.indexOf('</ion-item>', start);
  if (start < 0 || end < 0) {
    throw new Error(
      'Could not locate the maintained database SQL editor fragment.',
    );
  }
  return template.slice(start, end + '</ion-item>'.length);
}

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
        get: (key: string) =>
          key === routingParamEnvironmentId ? 'production' : null,
      },
      params: {},
    },
  };
}

// The page provides its own CardLookupService; these specs replace the component's providers.
const cardTestProviders = [
  CardLookupService,
  {
    provide: ProjectCardsService,
    useValue: { listCards: vi.fn(() => of([])), getCard: vi.fn() },
  },
];

describe('EnvDbTablePage', () => {
  let component: EnvDbTablePageComponent;
  let fixture: ComponentFixture<EnvDbTablePageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EnvDbTablePageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
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
        ...cardTestProviders,
      ],
    })
      .overrideComponent(EnvDbTablePageComponent, {
        set: {
          imports: [SqlEditorHostStub],
          template: sqlEditorTemplate(),
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EnvDbTablePageComponent);
    component = fixture.componentInstance;
  });

  it('renders the shared SQL editor as a read-only source viewer', () => {
    const template = readFileSync(
      resolve(
        'libs/datatug/main/src/lib/pages/signed-in/env-db-table/env-db-table.page.html',
      ),
      'utf8',
    );
    expect(template).toContain(
      '<sneat-datatug-sql [sql]="sql" [readonly]="true"',
    );
    expect(template).not.toContain('<code-editor');
  });

  it('mounts the maintained SQL source as read-only without a change handler', () => {
    fixture.detectChanges();

    const sqlEditor = fixture.debugElement.query(
      By.directive(SqlEditorHostStub),
    );
    expect(sqlEditor).not.toBeNull();
    expect(sqlEditor.componentInstance.sql()).toBe('select * from');
    expect(sqlEditor.componentInstance.readonly()).toBe(true);
    expect(sqlEditor.componentInstance.disabled()).toBe(false);
    sqlEditor.componentInstance.sqlChanged.emit('SELECT 1;');
    fixture.detectChanges();
    expect(component.sql).toBe('select * from');
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('opened from a card link (REQ:table-identity)', () => {
    function linkRoute(tableType: string, query: Record<string, string>) {
      const params: Record<string, string> = {
        storeId: 'http-127.0.0.1:8989',
        projectId: 'demo',
        environmentId: 'local',
        dbCatalogId: 'chinook',
        tableType,
      };
      const paramMap = { get: (k: string) => params[k] ?? null, keys: Object.keys(params) };
      const queryParamMap = { get: (k: string) => query[k] ?? null, keys: Object.keys(query) };
      const snapshot = { paramMap, queryParamMap, params, pathFromRoot: [] as unknown[] };
      snapshot.pathFromRoot = [snapshot];
      return { snapshot, paramMap: of(paramMap), queryParamMap: of(queryParamMap) };
    }

    function create(tableType: string, query: Record<string, string>) {
      // The suite's route stub is a plain object: point it at this link's address before the page reads it.
      Object.assign(TestBed.inject(ActivatedRoute), linkRoute(tableType, query));
      return TestBed.createComponent(EnvDbTablePageComponent).componentInstance;
    }

    it('reads the segment as the whole name when schema is present, and opens on the metadata', () => {
      const page = create('a.b', { schema: '' });
            expect(page.tab).toBe('columns');
      expect(page.tableRef()).toEqual({
        storeId: 'http-127.0.0.1:8989',
        project: 'demo',
        env: 'local',
        source: 'chinook',
        table: { schema: '', name: 'a.b' },
      });
    });

    it('opens a schemaless Album, which used to become schema "Album" with no name', () => {
      const page = create('Album', { schema: '' });
      expect(page.tableRef()?.table).toEqual({ schema: '', name: 'Album' });
    });

    it('keeps the dotted reading and the grid for an in-app address with no schema', () => {
      const page = create('main.Album', {});
      expect(page.tableRef()?.table).toEqual({ schema: 'main', name: 'Album' });
      expect(page.tab).toBe('grid');
    });
  });

});

// REQ:semantic-markers-in-grid, REQ:context-basket (INTEGRATION.md §2-3).
describe('EnvDbTablePage — semantic markers and cell selection', () => {
  let component: EnvDbTablePageComponent;
  let getSemanticColumnsMock: ReturnType<typeof vi.fn>;
  let logErrorMock: ReturnType<typeof vi.fn>;
  let routerMock: {
    navigate: ReturnType<typeof vi.fn>;
    navigateByUrl: ReturnType<typeof vi.fn>;
  };

  const project: IProjectContext = {
    ref: { storeId: 'localhost:8989', projectId: 'demo-project' },
  };
  const table: IEnvDbTableContext = {
    schema: 'main',
    name: 'Customer',
    meta: {
      name: 'Customer',
      dbType: 'BASE TABLE',
      schema: 'main',
      columns: [
        { name: 'CustomerId', dbType: 'integer' },
        { name: 'FirstName', dbType: 'string' },
      ],
    },
  };

  async function createComponent(
    semanticColumns: unknown[] = [],
  ): Promise<EnvDbTablePageComponent> {
    getSemanticColumnsMock = vi.fn(() => of({ columns: semanticColumns }));
    logErrorMock = vi.fn();
    routerMock = {
      navigate: vi.fn(() => Promise.resolve(true)),
      navigateByUrl: vi.fn(() => Promise.resolve(true)),
    };
    await TestBed.configureTestingModule({
      imports: [EnvDbTablePageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: logErrorMock,
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
        ...cardTestProviders,
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

    const columns = component.grid()?.columns || [];
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

    const customerIdCol = (component.grid()?.columns || []).find(
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
      physical: {
        source: component.dbId || '',
        collection: 'Customer',
        column: 'CustomerId',
      },
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
    const meta = table.meta;
    if (!meta) throw new Error('Expected the fixture table metadata');
    component.table = {
      ...table,
      meta: {
        ...meta,
        foreignKeys: [
          {
            name: 'FK_Customer_Country',
            columns: ['CountryId'],
            refTable: { schema: 'main', name: 'Country' },
          },
        ],
      },
    };

    const cellEl = document.createElement('div');
    cellEl.setAttribute('tabulator-field', 'CountryId');
    const event = { target: cellEl } as unknown as Event;
    const row = { getData: () => ({ CountryId: 7 }) };

    component.onGridRowClick(event, row);

    expect(component.selection()).toBeUndefined();
  });

  describe('project cards for the clicked cell', () => {
    const lookupOf = (c: EnvDbTablePageComponent) =>
      (c as unknown as { cardLookup: CardLookupService }).cardLookup;

    it('looks cards up by physical table and column with the meaning from the semantic mapping', async () => {
      component = await createComponent([
        { column: 'CustomerId', entity: 'Customer', field: 'ID', provenance: 'declared' },
      ]);
      component.onGridCellSelected({
        row: {},
        column: { field: 'CustomerId' },
        rowData: { CustomerId: 5, Name: 'Ann' },
      });

      const cell = lookupOf(component).cell();
      expect(cell?.identity).toEqual({
        table: `${component.table?.schema}.${component.table?.name}`,
        column: 'CustomerId',
        entity: { entity: 'Customer', field: 'ID' },
      });
      expect(cell?.value).toBe(5);
      expect(cell?.row).toEqual({ CustomerId: 5, Name: 'Ann' });
    });

    it('takes the meaning from the foreign key when the column has no semantic mapping', async () => {
      component = await createComponent([]);
      const meta = table.meta;
      if (!meta) throw new Error('Expected the fixture table metadata');
      component.table = {
        ...table,
        meta: {
          ...meta,
          foreignKeys: [
            {
              name: 'FK_Customer_Country',
              columns: ['CountryId'],
              refTable: { schema: 'main', name: 'Country' },
            },
          ],
        },
      };
      component.onGridCellSelected({
        row: {},
        column: { field: 'CountryId' },
        rowData: { CountryId: 7 },
      });
      expect(component.selection()).toBeUndefined();
      expect(lookupOf(component).cell()?.identity.entity).toEqual({
        entity: 'Country',
        field: 'CountryId',
      });
    });

    it('looks cards up from one source: a click selects semantically, the cell selection feeds the cards', async () => {
      component = await createComponent([
        { column: 'CustomerId', entity: 'Customer', field: 'ID', provenance: 'declared' },
      ]);
      const select = vi.spyOn(lookupOf(component), 'select');
      const cellEl = document.createElement('div');
      cellEl.setAttribute('tabulator-field', 'CustomerId');
      component.onGridRowClick(
        { target: cellEl } as unknown as Event,
        { getData: () => ({ CustomerId: 5 }) },
      );
      expect(component.selection()?.value).toBe(5);
      expect(select).not.toHaveBeenCalled();
      component.onGridCellSelected({ row: {}, column: { field: 'CustomerId' }, rowData: { CustomerId: 5 } });
      expect(select).toHaveBeenCalledTimes(1);
    });

    it('looks cards up when the grid selects a cell by keyboard or touch, anchored on that cell', async () => {
      component = await createComponent([
        { column: 'CustomerId', entity: 'Customer', field: 'ID', provenance: 'declared' },
      ]);
      const element = document.createElement('div');
      element.getBoundingClientRect = () => ({ left: 40, bottom: 90 }) as DOMRect;
      const row = { getCell: vi.fn(() => ({ getElement: () => element })) };
      component.onGridCellSelected({
        row,
        column: { field: 'CustomerId' },
        rowData: { CustomerId: 9, Name: 'Bob' },
      });
      const cell = lookupOf(component).cell();
      expect(row.getCell).toHaveBeenCalledWith('CustomerId');
      expect(cell?.value).toBe(9);
      expect(cell?.identity.entity).toEqual({ entity: 'Customer', field: 'ID' });
      expect(cell?.anchor).toEqual({ x: 40, y: 90 });
      // a grid that cannot say where the cell is still selects it
      component.onGridCellSelected({
        row: {},
        column: { field: 'CustomerId' },
        rowData: { CustomerId: 10 },
      });
      expect(lookupOf(component).cell()?.value).toBe(10);
      expect(lookupOf(component).cell()?.anchor).toBeUndefined();
    });

    it('opens the side pane for a matching card even without a semantic selection, and closing hides it', async () => {
      component = await createComponent([]);
      const lookup = lookupOf(component);
      expect(component.paneOpen()).toBe(false);
      lookup.resolvedCell.set({ identity: { column: 'x' }, value: 1 });
      lookup.matches.set([{ card: { id: 'c', title: 'C' }, parameterId: 'p', rank: 4 }]);
      expect(component.paneOpen()).toBe(true);
      component.closeContextPanel();
      expect(component.paneOpen()).toBe(false);
    });
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

    expect(routerMock.navigateByUrl).toHaveBeenCalledWith(
      '/store/localhost:8989/project/demo-project/query/customer-invoices?id=customer-invoices',
      {
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

  it('onOpenQuery encodes a folder-qualified queryId as a single routable path segment, keeping the raw id in the id query param', async () => {
    component = await createComponent();
    component.project = project;

    component.onOpenQuery({
      queryId: 'customers/customer-invoices',
      bindings: [],
      targets: [],
      state: 'runnable',
    });

    // A single, `%2F`-encoded segment — an un-encoded `customers/customer-invoices` here would split into two path
    // segments and never match the `query/:queryId` route (single param) — and the raw id as the `id` query value.
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith(
      '/store/localhost:8989/project/demo-project/query/customers%2Fcustomer-invoices?id=customers%2Fcustomer-invoices',
      {
        state: {
          bindings: [],
          targets: [],
          selectedSource: undefined,
        },
      },
    );
  });

  // G-A1c: the query page is at the address `projectUrl()` writes, a GitHub project's short address included.
  it.each([
    [
      'a GitHub project',
      { storeId: 'github.com', projectId: 'chinook-demo@datatug@' },
      '/project/github.com/datatug/chinook-demo/query/customers%2Fcustomer-invoices?id=customers%2Fcustomer-invoices',
    ],
    [
      'a GitHub project in a folder',
      { storeId: 'github', projectId: 'r@o@d' },
      '/project/github.com/o/r/tree/HEAD/d/-/query/customers%2Fcustomer-invoices?id=customers%2Fcustomer-invoices',
    ],
  ])(
    'onOpenQuery opens the query of %s at its address',
    async (_name, ref, address) => {
      component = await createComponent();
      component.project = { ref };

      component.onOpenQuery({
        queryId: 'customers/customer-invoices',
        bindings: [],
        targets: [],
        state: 'runnable',
      });

      expect(routerMock.navigateByUrl).toHaveBeenCalledWith(
        address,
        expect.any(Object),
      );
      expect(logErrorMock).not.toHaveBeenCalled();
    },
  );

  it('onOpenQuery navigates nowhere, and says so, for a project that has no exact address', async () => {
    component = await createComponent();
    component.project = {
      ref: { storeId: 'localhost:8989', projectId: '50%' },
    };

    component.onOpenQuery({
      queryId: 'customer-invoices',
      bindings: [],
      targets: [],
      state: 'runnable',
    });

    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('no exact address'),
      }),
      'Failed to open query',
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

    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
  });
});

/**
 * Regression (lane S89): `DatatugNavContextService.processEnvDbTable()` never
 * actually resolves `IEnvDbTableContext.meta` — the code that would (looking
 * up the table's columns/FKs from the loaded project) is commented out
 * ("TODO(help-wanted)"). So in production, `currentEnvDbTable` only ever
 * emits `{schema, name}`, `meta` always undefined. The page's own
 * subscription handler used to gate the entire row fetch behind
 * `if (currentTable.meta)`, so `loadData()` (`AgentService.select` ->
 * `GET /exec/select`) never fired at all — matching lane S87's real-browser
 * finding: every precondition request succeeds, yet the page never issues
 * `exec/select`/`exec/run_query`. `buildGridColumns()` already tolerates a
 * missing `meta` (empty scaffold, replaced by `setupGrid()` off the real
 * recordset once `loadData()` resolves), and `loadData()`/`AgentService.select`
 * only ever needed the table's schema+name, not its full metadata.
 */
describe('EnvDbTablePage — row fetch fires without table.meta', () => {
  function routeStubWithDb(dbId: string | null) {
    return {
      queryParamMap: of({ get: () => null }),
      paramMap: of({ get: () => null }),
      snapshot: {
        paramMap: {
          get: (key: string) => {
            if (key === routingParamEnvironmentId) {
              return 'production';
            }
            if (key === routingParamDbCatalogId) {
              return dbId;
            }
            return null;
          },
        },
        params: {},
      },
    };
  }

  it('calls AgentService.select once project/env/db/table are known, even though table.meta is never resolved', async () => {
    const project: IProjectContext = {
      ref: { storeId: 'localhost:8989', projectId: 'demo-project' },
    };
    // No `meta` — this is what DatatugNavContextService actually emits today.
    const table: IEnvDbTableContext = { schema: 'main', name: 'Album' };
    const selectMock = vi.fn(() => of({ commands: [] }));

    await TestBed.configureTestingModule({
      imports: [EnvDbTablePageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
        {
          provide: ActivatedRoute,
          useValue: routeStubWithDb('chinook-local'),
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
        { provide: AgentService, useValue: { select: selectMock } },
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
        ...cardTestProviders,
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

    TestBed.createComponent(EnvDbTablePageComponent);

    expect(selectMock).toHaveBeenCalledWith('localhost:8989', {
      proj: 'demo-project',
      env: 'production',
      db: 'chinook-local',
      from: 'main.Album',
      limit: 100,
    });
  });

  /**
   * Regression (lane S89, finding 2): `AgentService.select()` declared
   * `Observable<IExecuteResponse>` (the `commands[]` envelope belonging to
   * the separate `POST /exec/execute_commands` route) but `GET /exec/select`
   * actually returns a flat `{columns: string[], rows: Record<string,
   * unknown>[]}` (datatug-cli's `QueryResultResponse` — confirmed against a
   * live agent). The old `processResponse()`/`setupGrid()` tried to unwrap
   * `response.commands[0].items[0].value`, which is always `undefined`
   * against the real shape, so `setupGrid()` always threw `Error: !cols` and
   * no `.tabulator-row` ever rendered — even once the row-fetch request
   * itself started firing (the fix above).
   */
  it('renders grid rows straight from the real, flat exec/select response shape', async () => {
    const project: IProjectContext = {
      ref: { storeId: 'localhost:8989', projectId: 'demo-project' },
    };
    const table: IEnvDbTableContext = { schema: 'main', name: 'Album' };
    const selectMock = vi.fn(() =>
      of({
        columns: ['AlbumId', 'Title'],
        rows: [
          { AlbumId: 1, Title: 'For Those About To Rock' },
          { AlbumId: 2, Title: 'Balls to the Wall' },
        ],
      }),
    );

    await TestBed.configureTestingModule({
      imports: [EnvDbTablePageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
        {
          provide: ActivatedRoute,
          useValue: routeStubWithDb('chinook-local'),
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
        { provide: AgentService, useValue: { select: selectMock } },
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
        ...cardTestProviders,
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

    const component = TestBed.createComponent(
      EnvDbTablePageComponent,
    ).componentInstance;

    expect(component.grid()?.rows).toEqual([
      { AlbumId: 1, Title: 'For Those About To Rock' },
      { AlbumId: 2, Title: 'Balls to the Wall' },
    ]);
    expect(component.grid()?.columns?.map((c) => c.field)).toEqual([
      'AlbumId',
      'Title',
    ]);
  });
});

/**
 * Feature J4 (hub spec/features/core-investigation-loop/README.md): "Browse Customer
 * with an allowed projection: only Canadian rows return, Email is absent, and the
 * header states the applied limitations." `exec/select`'s `ISelectResponse` now
 * carries `limitations`/`provenance` additively (lane S101, datatug-cli) — today's
 * servers still omit them. This page exposes them as signals
 * (`limitations`/`executionProfile`) feeding the shared
 * `sneat-datatug-limitation-header` component the query page already renders (REQ:
 * limitation-visible); that component's own spec covers the rendered text in full, so
 * these tests only prove the page wires the right values through, including the
 * "nothing to show" default.
 */
describe('EnvDbTablePage — table page states the applied limitations (J4)', () => {
  const project: IProjectContext = {
    ref: { storeId: 'localhost:8989', projectId: 'demo-project' },
  };
  const table: IEnvDbTableContext = { schema: 'main', name: 'Customer' };

  function routeStubWithDb(dbId: string | null) {
    return {
      queryParamMap: of({ get: () => null }),
      paramMap: of({ get: () => null }),
      snapshot: {
        paramMap: {
          get: (key: string) => {
            if (key === routingParamEnvironmentId) {
              return 'production';
            }
            if (key === routingParamDbCatalogId) {
              return dbId;
            }
            return null;
          },
        },
        params: {},
      },
    };
  }

  async function createComponent(
    selectResponse: unknown,
  ): Promise<EnvDbTablePageComponent> {
    const selectMock = vi.fn(() => of(selectResponse));
    await TestBed.configureTestingModule({
      imports: [EnvDbTablePageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
        {
          provide: ActivatedRoute,
          useValue: routeStubWithDb('chinook-local'),
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
        { provide: AgentService, useValue: { select: selectMock } },
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
        ...cardTestProviders,
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

  it('AC:restricted-rows-and-columns — exposes limitations/executionProfile from exec/select for the shared header', async () => {
    const component = await createComponent({
      columns: ['CustomerId', 'FirstName'],
      rows: [{ CustomerId: 1, FirstName: 'Luís' }],
      limitations: [
        {
          policy: 'customers-support',
          rowsFiltered: true,
          hiddenColumns: ['Email'],
        },
      ],
      provenance: {
        source: 'chinook-local',
        mode: 'live',
        observedAt: '2026-09-09T00:00:00Z',
        executionProfile: 'protected',
      },
    });

    expect(component.limitations()).toEqual([
      {
        policy: 'customers-support',
        rowsFiltered: true,
        hiddenColumns: ['Email'],
      },
    ]);
    expect(component.executionProfile()).toBe('protected');
  });

  it("renders no limitation header data when exec/select omits limitations/provenance (today's servers)", async () => {
    const component = await createComponent({
      columns: ['CustomerId', 'FirstName'],
      rows: [{ CustomerId: 1, FirstName: 'Luís' }],
    });

    expect(component.limitations()).toEqual([]);
    expect(component.executionProfile()).toBeUndefined();
  });
});

/**
 * Regression (lane S90, journey J2/J3): `securityContextId` (Task 15's scope
 * gate every Scope-bearing call must carry) resolves asynchronously from
 * `GET /agent-info` (`AgentContextService`), independently of — and, in
 * practice, later than — the table-load path. `loadSemanticColumns()` used
 * to read `agentContext.securityContextId()` synchronously once and
 * silently skip the request forever if it wasn't ready yet at that exact
 * moment — confirmed live: `GET /datatug/semantic/columns` was never
 * requested at all, even though `/datatug/agent-info` always eventually
 * resolved (a few requests later). With `semanticColumns` staying empty
 * forever, `onGridRowClick` never found a mapping for the clicked column,
 * so `sneat-datatug-context-panel` never opened.
 */
describe('EnvDbTablePage — semantic columns wait for the security-context scope gate', () => {
  it('fires getSemanticColumns once securityContextId becomes available, not only if it already was', () => {
    const project: IProjectContext = {
      ref: { storeId: 'localhost:8989', projectId: 'demo-project' },
    };
    const table: IEnvDbTableContext = { schema: 'main', name: 'Customer' };
    const getSemanticColumnsMock = vi.fn(() => of({ columns: [] }));
    // Not yet resolved — mirrors the real timing: agent-info hasn't
    // responded when the table-load path first runs. Built inline, not via
    // agentContextStub(undefined): a default-parameter call receiving
    // `undefined` falls back to its own default ('sctx-1'), which would
    // silently defeat this test.
    const agentContext = {
      securityContextId: signal<string | undefined>(undefined),
      refresh: vi.fn(() => of(undefined)),
    };

    TestBed.configureTestingModule({
      imports: [EnvDbTablePageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
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
          useValue: { select: vi.fn(() => of({ columns: [], rows: [] })) },
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
        {
          provide: Router,
          useValue: { navigate: vi.fn(() => Promise.resolve(true)) },
        },
        { provide: AgentContextService, useValue: agentContext },
        ...cardTestProviders,
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

    TestBed.createComponent(EnvDbTablePageComponent);

    expect(getSemanticColumnsMock).not.toHaveBeenCalled();

    // agent-info resolves later.
    agentContext.securityContextId.set('sctx-1');
    TestBed.tick();

    expect(getSemanticColumnsMock).toHaveBeenCalledWith({
      project: 'demo-project',
      environment: 'production',
      securityContextId: 'sctx-1',
      source: '',
      collection: 'Customer',
    });
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
        provideMockErrorLogger(),
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
        // Component-level providers are not in play for `new` in an injection context.
        ...cardTestProviders,
      ],
    });
  });

  it('constructs from its own declared imports, the site that threw NG0201', () => {
    expect(() =>
      TestBed.runInInjectionContext(() => new EnvDbTablePageComponent()),
    ).not.toThrow();
  });

  // DatatugNavContextService is now providedIn: 'root'
  // (nav-context-root-singletons) — no longer grouped with AgentService
  // below, which is still module-provided.
  it('resolves DatatugNavContextService, which is `providedIn: root`', () => {
    expect(TestBed.inject(DatatugNavContextService, null)).toBeTruthy();
  });

  // ProjectService is now providedIn: 'root' too
  // (nav-context-root-singletons) — no longer grouped with AgentService
  // below, which is still module-provided.
  it('resolves ProjectService, which is `providedIn: root`', () => {
    expect(TestBed.inject(ProjectService, null)).toBeTruthy();
  });

  it('resolves AgentService, which is provided by a module and never `providedIn: root`', () => {
    expect(TestBed.inject(AgentService, null)).toBeTruthy();
  });
});
