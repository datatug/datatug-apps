import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { RandomIdService } from '@sneat/random';
import {
  InvestigationContextService,
  SemanticApiService,
} from '@sneat/datatug-semantic';
import { of, throwError } from 'rxjs';

import { QueryPageComponent } from './query-page.component';
import { IQueryEditorState } from '../../../editor/models';
import { IProjectContext } from '../../../nav/nav-models';
import { IQueryDef, ISqlQueryRequest, QueryType } from '../../../models/definition/query-def';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { QueryContextSqlService } from '../../query-context-sql.service';
import { QueriesService } from '../../queries.service';
import { Coordinator } from '../../../executor/coordinator';
import { QueryEditorStateService } from '../../query-editor-state-service';
import { EnvironmentService } from '../../../services/unsorted/environment.service';

describe('SqlEditorPage', () => {
  let component: QueryPageComponent;
  let fixture: ComponentFixture<QueryPageComponent>;

  beforeEach(async () => {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: { query: undefined } },
      writable: true,
      configurable: true,
    });
    await TestBed.configureTestingModule({
      imports: [QueryPageComponent],
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
          provide: RandomIdService,
          useValue: { newRandomId: vi.fn(() => 'test-id') },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(undefined),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
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
          },
        },
        {
          provide: QueryContextSqlService,
          useValue: { setSql: vi.fn(), setTarget: vi.fn() },
        },
        { provide: QueriesService, useValue: {} },
        { provide: Coordinator, useValue: { execute: vi.fn() } },
        {
          provide: QueryEditorStateService,
          useValue: {
            queryEditorState: of(undefined),
            updateQueryState: vi.fn(),
            openQuery: vi.fn(),
            newQuery: vi.fn(),
            getQueryState: vi.fn(),
            saveQuery: vi.fn(),
          },
        },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn() } },
        {
          provide: SemanticApiService,
          useValue: { runQuery: vi.fn() },
        },
        {
          provide: InvestigationContextService,
          useValue: { bindingsFor: vi.fn(() => []) },
        },
      ],
    })
      .overrideComponent(QueryPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(QueryPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

// REQ:parameter-auto-binding, REQ:no-hidden-filters (INTEGRATION.md §6).
describe('QueryPageComponent — semantic parameter binding and run', () => {
  let component: QueryPageComponent;
  let bindingsForMock: ReturnType<typeof vi.fn>;
  let runQueryMock: ReturnType<typeof vi.fn>;

  const project: IProjectContext = {
    ref: { storeId: 'localhost:8989', projectId: 'demo-project' },
  };

  const queryDef: IQueryDef = {
    id: 'customer-invoices',
    title: 'Customer invoices',
    request: { queryType: QueryType.SQL, text: '' } as ISqlQueryRequest,
    parameters: [
      {
        id: 'CustomerId',
        type: 'integer',
        meta: { entity: 'Customer', field: 'ID' },
      },
    ],
  };

  const editorState: IQueryEditorState = {
    currentQueryId: queryDef.id,
    activeQueries: [
      {
        id: queryDef.id,
        queryType: QueryType.SQL,
        request: queryDef.request,
        def: queryDef,
      },
    ],
  } as unknown as IQueryEditorState;

  async function createComponent(
    historyState: Record<string, unknown> = {},
    contextBindings: unknown[] = [],
  ): Promise<QueryPageComponent> {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: historyState },
      writable: true,
      configurable: true,
    });
    // Configured before TestBed.createComponent() below (not after) because the
    // component reads `queryEditorState` (an `of(editorState)` — synchronous) and
    // calls updateBindings() -> investigationContext.bindingsFor() during its own
    // constructor, i.e. before this function returns.
    bindingsForMock = vi.fn(() => contextBindings);
    runQueryMock = vi.fn();
    await TestBed.configureTestingModule({
      imports: [QueryPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: { logError: vi.fn(), logErrorHandler: vi.fn(() => vi.fn()) },
        },
        { provide: RandomIdService, useValue: { newRandomId: vi.fn(() => 'test-id') } },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(undefined),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
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
          useValue: { navigate: vi.fn(() => Promise.resolve(true)), events: of() },
        },
        {
          provide: QueryContextSqlService,
          useValue: { setSql: vi.fn(), setTarget: vi.fn() },
        },
        { provide: QueriesService, useValue: {} },
        { provide: Coordinator, useValue: { execute: vi.fn() } },
        {
          provide: QueryEditorStateService,
          useValue: {
            queryEditorState: of(editorState),
            updateQueryState: vi.fn(),
            openQuery: vi.fn(),
            newQuery: vi.fn(),
            getQueryState: vi.fn(),
            saveQuery: vi.fn(),
          },
        },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn() } },
        { provide: SemanticApiService, useValue: { runQuery: runQueryMock } },
        {
          provide: InvestigationContextService,
          useValue: { bindingsFor: bindingsForMock },
        },
      ],
    })
      .overrideComponent(QueryPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    return TestBed.createComponent(QueryPageComponent).componentInstance;
  }

  const contextBinding = {
    parameterId: 'CustomerId',
    entityField: { entity: 'Customer', field: 'ID' },
    value: 7,
    label: 'Customer.ID = 7',
    source: 'grid',
    contextItemId: 'Customer.ID=7',
  };

  it('binds a parameter from context when no selection binding is present', async () => {
    component = await createComponent({}, [contextBinding]);

    expect(bindingsForMock).toHaveBeenCalledWith([
      { id: 'CustomerId', meta: { entity: 'Customer', field: 'ID' } },
    ]);
    expect(component.effectiveBindings()).toEqual([
      {
        parameterId: 'CustomerId',
        entityField: { entity: 'Customer', field: 'ID' },
        value: 7,
        label: 'Customer.ID = 7',
        origin: 'context',
      },
    ]);
  });

  it('selection (router state from the context panel) wins over context for the same parameter', async () => {
    component = await createComponent(
      {
        bindings: [{ parameterId: 'CustomerId', entity: 'Customer', field: 'ID', value: 5 }],
      },
      [contextBinding],
    );

    expect(component.effectiveBindings()).toEqual([
      {
        parameterId: 'CustomerId',
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        origin: 'selection',
      },
    ]);
  });

  it('clearBinding removes a binding from effectiveBindings without touching bindings()', async () => {
    component = await createComponent({}, [contextBinding]);

    component.clearBinding('CustomerId');

    expect(component.effectiveBindings()).toEqual([]);
    expect(component.bindings().length).toBe(1);
  });

  it('runQuery sends only effectiveBindings and stores the response', async () => {
    const response = {
      recordset: { columns: [{ name: 'InvoiceId' }], rows: [[1]] },
      limitations: [],
      bindingsApplied: [
        { parameterId: 'CustomerId', entity: 'Customer', field: 'ID', value: 7, origin: 'context' },
      ],
    };
    component = await createComponent({}, [contextBinding]);
    runQueryMock.mockReturnValue(of(response));
    component.project = project;

    component.runQuery();

    expect(runQueryMock).toHaveBeenCalledWith({
      project: 'demo-project',
      queryId: 'customer-invoices',
      parameters: { CustomerId: 7 },
    });
    expect(component.runResult()).toEqual(response);
    expect(component.running()).toBe(false);
    expect(component.runError()).toBeUndefined();
  });

  it('runQuery does not include a cleared binding', async () => {
    component = await createComponent({}, [contextBinding]);
    runQueryMock.mockReturnValue(
      of({ recordset: { columns: [], rows: [] }, limitations: [], bindingsApplied: [] }),
    );
    component.project = project;
    component.clearBinding('CustomerId');

    component.runQuery();

    expect(runQueryMock).toHaveBeenCalledWith({
      project: 'demo-project',
      queryId: 'customer-invoices',
      parameters: {},
    });
  });

  it('runQuery reports the failure without hiding it', async () => {
    component = await createComponent({}, []);
    runQueryMock.mockReturnValue(throwError(() => ({ message: 'ACCESS_DENIED' })));
    component.project = project;

    component.runQuery();

    expect(component.runError()).toBe('ACCESS_DENIED');
    expect(component.running()).toBe(false);
    expect(component.runResult()).toBeUndefined();
  });

  it('runQuery does nothing without a project', async () => {
    component = await createComponent({}, []);
    component.project = undefined;

    component.runQuery();

    expect(runQueryMock).not.toHaveBeenCalled();
  });
});
