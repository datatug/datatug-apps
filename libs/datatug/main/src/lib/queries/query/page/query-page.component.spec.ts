import { HttpErrorResponse } from '@angular/common/http';
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { RandomIdService } from '@sneat/random';
import {
  AgentContextService,
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

function agentContextStub(securityContextId: string | undefined = 'sctx-1') {
  return {
    securityContextId: signal(securityContextId),
    refresh: vi.fn(() => of(undefined)),
  };
}

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
          useValue: { bindingsFor: vi.fn(() => []), clear: vi.fn() },
        },
        { provide: AgentContextService, useValue: agentContextStub() },
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
  let investigationContextClearMock: ReturnType<typeof vi.fn>;
  let agentContext: ReturnType<typeof agentContextStub>;

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
    investigationContextClearMock = vi.fn();
    agentContext = agentContextStub();
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
          useValue: { bindingsFor: bindingsForMock, clear: investigationContextClearMock },
        },
        { provide: AgentContextService, useValue: agentContext },
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

    const created = TestBed.createComponent(QueryPageComponent).componentInstance;
    created.envId = 'production';
    return created;
  }

  const contextBinding = {
    parameterId: 'CustomerId',
    entityField: { entity: 'Customer', field: 'ID' },
    value: 7,
    label: 'Customer.ID = 7',
    source: 'grid',
    contextItemId: 'Customer.ID=7',
  };

  const selectionBinding = {
    parameterId: 'CustomerId',
    value: { type: 'integer' as const, value: '5' },
    origin: 'selection' as const,
    originEvidence: 'client-reported' as const,
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
        value: { type: 'integer', value: '7' },
        label: 'Customer.ID = 7',
        origin: 'context',
      },
    ]);
  });

  it('selection (router state from the context panel, a wire Binding[]) wins over context for the same parameter', async () => {
    component = await createComponent({ bindings: [selectionBinding] }, [contextBinding]);

    expect(component.effectiveBindings()).toEqual([
      {
        parameterId: 'CustomerId',
        entityField: { entity: 'Customer', field: 'ID' },
        value: { type: 'integer', value: '5' },
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

  it('runQuery sends the full ExecutionRequest (Scope + typed parameters + bindingOrigins) and stores the response', async () => {
    const response = {
      recordset: { columns: [{ name: 'InvoiceId', type: 'integer' }], rows: [[{ type: 'integer', value: '1' }]] },
      limitations: [],
      bindingsApplied: [
        {
          parameterId: 'CustomerId',
          value: { type: 'integer', value: '7' },
          origin: 'context',
          originEvidence: 'client-reported',
        },
      ],
      provenance: {
        source: 'chinook',
        mode: 'live',
        observedAt: '2026-09-09T12:00:00Z',
        executionProfile: 'protected',
      },
      truncated: false,
    };
    component = await createComponent({}, [contextBinding]);
    runQueryMock.mockReturnValue(of(response));
    component.project = project;

    component.runQuery();

    expect(runQueryMock).toHaveBeenCalledWith({
      project: 'demo-project',
      environment: 'production',
      securityContextId: 'sctx-1',
      queryId: 'customer-invoices',
      source: undefined,
      parameters: { CustomerId: { type: 'integer', value: '7' } },
      bindingOrigins: [{ parameterId: 'CustomerId', origin: 'context' }],
      mode: 'live',
    });
    expect(component.runResult()).toEqual(response);
    expect(component.running()).toBe(false);
    expect(component.runError()).toBeUndefined();
  });

  it('runQuery does not include a cleared binding', async () => {
    component = await createComponent({}, [contextBinding]);
    runQueryMock.mockReturnValue(
      of({
        recordset: { columns: [], rows: [] },
        limitations: [],
        bindingsApplied: [],
        provenance: {
          source: 'chinook',
          mode: 'live',
          observedAt: '2026-09-09T12:00:00Z',
          executionProfile: 'protected',
        },
        truncated: false,
      }),
    );
    component.project = project;
    component.clearBinding('CustomerId');

    component.runQuery();

    expect(runQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ parameters: {}, bindingOrigins: [] }),
    );
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

  it('runQuery does nothing without an environment (envId unset)', async () => {
    component = await createComponent({}, []);
    component.project = project;
    component.envId = undefined;

    component.runQuery();

    expect(runQueryMock).not.toHaveBeenCalled();
  });

  it('TARGET_REQUIRED populates availableTargets from the error, never a hidden source', async () => {
    component = await createComponent({}, []);
    component.project = project;
    const targetRequired = new HttpErrorResponse({
      status: 400,
      error: {
        error: {
          code: 'TARGET_REQUIRED',
          message: 'choose a target',
          requestId: 'req-1',
          targets: [
            { source: 'chinook', label: 'Chinook (SQLite)' },
            { source: 'exchange-rates-http', label: 'Exchange rates (HTTP)' },
          ],
        },
      },
    });
    runQueryMock.mockReturnValue(throwError(() => targetRequired));

    component.runQuery();

    expect(component.availableTargets()).toEqual([
      { source: 'chinook', label: 'Chinook (SQLite)' },
      { source: 'exchange-rates-http', label: 'Exchange rates (HTTP)' },
    ]);
    expect(component.running()).toBe(false);
  });

  it('SOURCE_UNAVAILABLE on a live run offers an explicit snapshot retry, never a silent fallback', async () => {
    component = await createComponent({}, []);
    component.project = project;
    const sourceUnavailable = new HttpErrorResponse({
      status: 503,
      error: {
        error: { code: 'SOURCE_UNAVAILABLE', message: 'live request failed', requestId: 'req-2' },
      },
    });
    runQueryMock.mockReturnValue(throwError(() => sourceUnavailable));

    component.runQuery();

    expect(component.sourceUnavailable()).toBe(true);
    expect(runQueryMock).toHaveBeenCalledTimes(1);
    expect(runQueryMock.mock.calls[0][0]).toMatchObject({ mode: 'live' });

    const snapshotResponse = {
      recordset: { columns: [], rows: [] },
      limitations: [],
      bindingsApplied: [],
      provenance: {
        source: 'exchange-rates-http',
        mode: 'snapshot',
        snapshotId: 'exchange-rates-2026-09-01',
        observedAt: '2026-09-01T00:00:00Z',
        executionProfile: 'protected',
      },
      truncated: false,
    };
    runQueryMock.mockReturnValue(of(snapshotResponse));

    component.runSnapshot();

    expect(runQueryMock).toHaveBeenCalledTimes(2);
    expect(runQueryMock.mock.calls[1][0]).toMatchObject({ mode: 'snapshot' });
    expect(component.sourceUnavailable()).toBe(false);
    expect(component.runResult()).toEqual(snapshotResponse);
  });

  it('STALE_CONTEXT clears the Investigation Context and refreshes agent-info', async () => {
    component = await createComponent({}, []);
    component.project = project;
    const staleContext = new HttpErrorResponse({
      status: 409,
      error: {
        error: { code: 'STALE_CONTEXT', message: 'stale', requestId: 'req-3' },
      },
    });
    runQueryMock.mockReturnValue(throwError(() => staleContext));

    component.runQuery();

    expect(investigationContextClearMock).toHaveBeenCalled();
    expect(agentContext.refresh).toHaveBeenCalled();
    expect(component.runError()).toContain('session changed');
  });
});
