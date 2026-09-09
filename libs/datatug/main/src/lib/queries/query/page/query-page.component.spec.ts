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
import { Observable, of, throwError } from 'rxjs';

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
    sessionStorage.clear();
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

// REQ:parameter-auto-binding, REQ:no-hidden-filters (INTEGRATION.md §6), Task 15 item 3
// (binding-resolver.ts precedence/ambiguity/conflict). Uses the REAL
// InvestigationContextService (not a bindingsFor() mock) so scope-keyed storage,
// typed equality and the resolver's precedence are exercised end to end, the same as
// production — see investigation-context.service.spec.ts / binding-resolver.spec.ts
// for those units' own isolated coverage.
describe('QueryPageComponent — semantic parameter binding and run', () => {
  let component: QueryPageComponent;
  let runQueryMock: ReturnType<typeof vi.fn>;
  let agentContext: ReturnType<typeof agentContextStub>;
  let investigationContext: InvestigationContextService;

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
  ): Promise<QueryPageComponent> {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: historyState },
      writable: true,
      configurable: true,
    });
    runQueryMock = vi.fn();
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
            currentProject: of(project),
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

    investigationContext = TestBed.inject(InvestigationContextService);
    const created = TestBed.createComponent(QueryPageComponent).componentInstance;
    created.project = project;
    created.envId = 'production';
    // The component's own effect/constructor already calls setScope once project/env/
    // securityContextId are all available (Task 15 item 2), but DatatugNavContextService
    // is stubbed here rather than reactive, so nudge it once explicitly the same way a
    // real change-detection tick would.
    investigationContext.setScope({
      project: 'demo-project',
      environment: 'production',
      securityContextId: 'sctx-1',
    });
    return created;
  }

  const selectionBinding = {
    parameterId: 'CustomerId',
    value: { type: 'integer' as const, value: '5' },
    origin: 'selection' as const,
    originEvidence: 'client-reported' as const,
  };

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('binds a parameter from context when no selection binding is present', async () => {
    component = await createComponent({});
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 7,
      label: 'Customer.ID = 7',
      source: 'grid',
    });
    TestBed.tick(); // flush the component's own investigationContext.items()-reactive effect

    expect(component.effectiveBindings()).toEqual([
      expect.objectContaining({
        parameterId: 'CustomerId',
        value: { type: 'integer', value: '7' },
        origin: 'context',
      }),
    ]);
  });

  it('selection (router state from the context panel, a wire Binding[]) is reported as origin "selection", not "context", when both agree', async () => {
    // A context fact that agrees with the selection value is NOT a conflict — the
    // resolver still reports the higher-precedence tier's origin (REQ:parameter-auto-
    // binding: "an explicit user edit wins; otherwise one compatible selected fact
    // wins; otherwise ... a context fact"), proving selection is checked BEFORE
    // context even when the outcome value happens to be identical either way.
    component = await createComponent({ bindings: [selectionBinding] }); // selection = 5
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 5, // agrees with the selection — not a conflict
      label: 'Customer.ID = 5',
      source: 'grid',
    });
    TestBed.tick();

    expect(component.effectiveBindings()).toEqual([
      expect.objectContaining({
        parameterId: 'CustomerId',
        value: { type: 'integer', value: '5' },
        origin: 'selection',
      }),
    ]);
    expect(component.hasBlockedBindings()).toBe(false);
  });

  it('clearBinding removes a binding from effectiveBindings without touching bindings() presence', async () => {
    component = await createComponent({ bindings: [selectionBinding] });

    component.clearBinding('CustomerId');

    expect(component.effectiveBindings()).toEqual([]);
    expect(component.bindings().length).toBe(1);
    expect(component.bindings()[0].blocked).toBeUndefined(); // optional param, not required
  });

  it('two distinct context facts for the same field are ambiguous and block Run', async () => {
    component = await createComponent({});
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 7,
      label: 'Customer.ID = 7',
      source: 'grid',
    });
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 9,
      label: 'Customer.ID = 9',
      source: 'related',
    });
    TestBed.tick();

    expect(component.bindings()[0].blocked).toBe('ambiguous');
    expect(component.hasBlockedBindings()).toBe(true);
    expect(component.effectiveBindings()).toEqual([]);

    component.project = project;
    component.runQuery();
    expect(runQueryMock).not.toHaveBeenCalled();
    expect(component.runError()).toBeTruthy();
  });

  it('a selection value conflicting with a different context value blocks Run until confirmed (AC:typed-context-isolation)', async () => {
    component = await createComponent({ bindings: [selectionBinding] }); // selection = 5
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 9, // conflicts with selection's 5
      label: 'Customer.ID = 9',
      source: 'grid',
    });
    TestBed.tick();

    expect(component.bindings()[0].blocked).toBe('conflict-unconfirmed');
    expect(component.hasBlockedBindings()).toBe(true);

    component.project = project;
    component.runQuery();
    expect(runQueryMock).not.toHaveBeenCalled();

    component.confirmConflict('CustomerId');

    expect(component.bindings()[0]).toEqual(
      expect.objectContaining({
        parameterId: 'CustomerId',
        value: { type: 'integer', value: '5' },
        origin: 'selection',
      }),
    );
    expect(component.hasBlockedBindings()).toBe(false);
  });

  it('typed distinctness: integer 5 vs string "5" from selection vs context is a conflict, never silently equal', async () => {
    component = await createComponent({ bindings: [selectionBinding] }); // selection = integer 5
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: '5', // string "5" — typed-distinct from integer 5
      label: 'Customer.ID = "5"',
      source: 'grid',
    });
    TestBed.tick();

    expect(component.bindings()[0].blocked).toBe('conflict-unconfirmed');
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
    component = await createComponent({});
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 7,
      label: 'Customer.ID = 7',
      source: 'grid',
    });
    TestBed.tick();
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
    component = await createComponent({});
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 7,
      label: 'Customer.ID = 7',
      source: 'grid',
    });
    TestBed.tick();
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
    component = await createComponent({});
    runQueryMock.mockReturnValue(throwError(() => ({ message: 'ACCESS_DENIED' })));
    component.project = project;

    component.runQuery();

    expect(component.runError()).toBe('ACCESS_DENIED');
    expect(component.running()).toBe(false);
    expect(component.runResult()).toBeUndefined();
  });

  it('runQuery does nothing without a project', async () => {
    component = await createComponent({});
    component.project = undefined;

    component.runQuery();

    expect(runQueryMock).not.toHaveBeenCalled();
  });

  it('runQuery does nothing without an environment (envId unset)', async () => {
    component = await createComponent({});
    component.project = project;
    component.envId = undefined;

    component.runQuery();

    expect(runQueryMock).not.toHaveBeenCalled();
  });

  it('TARGET_REQUIRED populates availableTargets from the error, never a hidden source', async () => {
    component = await createComponent({});
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
    component = await createComponent({});
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

  it('a late run response for a scope the user has since left is discarded (Task 15 item 4)', async () => {
    component = await createComponent({});
    component.project = project;
    const response = {
      recordset: { columns: [], rows: [] },
      limitations: [],
      bindingsApplied: [],
      provenance: {
        source: 'chinook',
        mode: 'live' as const,
        observedAt: '2026-09-09T12:00:00Z',
        executionProfile: 'protected' as const,
      },
      truncated: false,
    };
    // Don't resolve synchronously — simulate an in-flight request.
    let resolveRun!: (value: typeof response) => void;
    runQueryMock.mockReturnValue(
      new Observable<typeof response>((subscriber) => {
        resolveRun = (value) => {
          subscriber.next(value);
          subscriber.complete();
        };
      }),
    );

    component.runQuery();
    // User switches principal/scope while the request is still in flight.
    investigationContext.setScope({
      project: 'demo-project',
      environment: 'production',
      securityContextId: 'sctx-2',
    });
    resolveRun(response);

    expect(component.runResult()).toBeUndefined();
  });

  it('STALE_CONTEXT clears the Investigation Context and refreshes agent-info', async () => {
    component = await createComponent({});
    component.project = project;
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 1,
      label: 'Customer.ID = 1',
      source: 'grid',
    });
    expect(investigationContext.items()).toHaveLength(1);
    const staleContext = new HttpErrorResponse({
      status: 409,
      error: {
        error: { code: 'STALE_CONTEXT', message: 'stale', requestId: 'req-3' },
      },
    });
    runQueryMock.mockReturnValue(throwError(() => staleContext));

    component.runQuery();

    expect(investigationContext.items()).toHaveLength(0);
    expect(agentContext.refresh).toHaveBeenCalled();
    expect(component.runError()).toContain('session changed');
  });
});
