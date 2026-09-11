import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Firestore } from 'firebase/firestore';
import { ErrorLogger } from '@sneat/core';
import { RANDOM_ID_OPTIONS, RandomIdService } from '@sneat/random';
import {
  AgentContextService,
  InvestigationContextService,
  SemanticApiService,
} from '@sneat/datatug-semantic';
import { Observable, Subject, of, throwError } from 'rxjs';

import { QueryPageComponent, extractLinkedEntityNames } from './query-page.component';
import { IQueryEditorState } from '../../../editor/models';
import { IProjectContext } from '../../../nav/nav-models';
import {
  IQueryDef,
  ISqlQueryRequest,
  ITextQueryRequest,
  QueryType,
} from '../../../models/definition/query-def';
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
  let runFixture: ComponentFixture<QueryPageComponent>;
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
          template: '<ul aria-label="Access blockers">@for (blocker of accessBlockers(); track $index) {<li>{{ blocker }}</li>}</ul>',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    investigationContext = TestBed.inject(InvestigationContextService);
    runFixture = TestBed.createComponent(QueryPageComponent);
    const created = runFixture.componentInstance;
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

  it('AC:bound-from-selection literal wording — renders "5 · from selection"', async () => {
    component = await createComponent({ bindings: [selectionBinding] }); // selection = 5
    const [selectionRendered] = component.visibleBindings();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((component as any).bindingFieldLabel(selectionRendered)).toBe('Customer.ID');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((component as any).bindingValueLabel(selectionRendered)).toBe('5 · from selection');
  });

  it('AC:context-carries literal wording — renders "7 · from context"', async () => {
    component = await createComponent({});
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 7,
      label: 'Customer.ID = 7',
      source: 'grid',
    });
    TestBed.tick();
    const [contextRendered] = component.visibleBindings();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((component as any).bindingValueLabel(contextRendered)).toBe('7 · from context');
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

  it('receives multiple ACL blockers asynchronously and clears them on retry', async () => {
    component = await createComponent({});
    runFixture.detectChanges();
    await runFixture.whenStable();
    const pending = new Subject<never>();
    runQueryMock.mockReturnValue(pending);
    component.runQuery();
    pending.error(
      new HttpErrorResponse({
        status: 403,
        error: {
          error: {
            code: 'ACCESS_DENIED',
            message: 'Access denied',
            requestId: 'r1',
          },
          details: {
            authorization: {
              apiVersion: 'dtql.org/authorization/v1',
              requestId: 'r1',
              mode: 'execution',
              scope: 'request',
              result: 'deny',
              allowed: false,
              hypothetical: false,
              operations: [],
              layers: [],
              restrictions: [],
              coverage: {
                evaluation: 'partial',
                disclosure: 'redacted',
                truncated: false,
                unevaluated: [],
              },
              blockers: [
                {
                  operationId: 'q',
                  code: 'COLUMN_READ_DENIED',
                  scope: 'column',
                  layerId: 'ingitdb',
                },
                {
                  operationId: 'q',
                  code: 'ACCESS_DENIED',
                  scope: 'operation',
                  layerId: 'openvaultdb',
                },
              ],
            },
          },
        },
      }),
    );
    await runFixture.whenStable();
    expect(runFixture.nativeElement.textContent).toContain(
      'ingitdb: COLUMN_READ_DENIED',
    );
    expect(runFixture.nativeElement.textContent).toContain(
      'openvaultdb: ACCESS_DENIED',
    );
    runQueryMock.mockReturnValue(new Subject<never>());
    component.runQuery();
    expect(component.accessBlockers()).toEqual([]);
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
    // LEAD ASSUMPTION 2026-09-10 (AvailableSnapshot's own doc comment,
    // @sneat/datatug-semantic) — the sibling "details.availableSnapshots" key a
    // SOURCE_UNAVAILABLE response for an HTTP query with a recorded fixture carries;
    // runSnapshot() reads the snapshotId from HERE, never fabricating one client-side.
    const sourceUnavailable = new HttpErrorResponse({
      status: 503,
      error: {
        error: { code: 'SOURCE_UNAVAILABLE', message: 'live request failed', requestId: 'req-2' },
        details: {
          availableSnapshots: [
            { snapshotId: 'exchange-rates-2026-09-01', recordedAt: '2026-09-01T00:00:00Z' },
          ],
        },
      },
    });
    runQueryMock.mockReturnValue(throwError(() => sourceUnavailable));

    component.runQuery();

    expect(component.sourceUnavailable()).toBe(true);
    expect(component.availableSnapshot()).toEqual({
      snapshotId: 'exchange-rates-2026-09-01',
      recordedAt: '2026-09-01T00:00:00Z',
    });
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
    expect(runQueryMock.mock.calls[1][0]).toMatchObject({
      mode: 'snapshot',
      snapshotId: 'exchange-rates-2026-09-01',
    });
    expect(component.sourceUnavailable()).toBe(false);
    expect(component.runResult()).toEqual(snapshotResponse);
  });

  it('runSnapshot() is a no-op when the server reported no recorded snapshot at all', async () => {
    component = await createComponent({});
    component.project = project;
    const sourceUnavailableNoFixture = new HttpErrorResponse({
      status: 503,
      error: {
        error: { code: 'SOURCE_UNAVAILABLE', message: 'live request failed', requestId: 'req-3' },
        // No "details" key at all — this query has no recorded fixture.
      },
    });
    runQueryMock.mockReturnValue(throwError(() => sourceUnavailableNoFixture));

    component.runQuery();

    expect(component.sourceUnavailable()).toBe(true);
    expect(component.availableSnapshot()).toBeUndefined();
    expect(runQueryMock).toHaveBeenCalledTimes(1);

    component.runSnapshot();

    // Never sends a mode:snapshot request with a fabricated/empty snapshotId.
    expect(runQueryMock).toHaveBeenCalledTimes(1);
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

/**
 * S96 — api-contract.md "Binding and context behavior": "The user can clear a value;
 * a cleared required value blocks Run until supplied." The demo project's real queries
 * (`customer-invoices`, `customer-purchases-by-genre`) declare `CustomerId` with
 * `isRequired: true` (datatug-demo-projects/demo-project-1/queries/customers/*.query.json)
 * — the describe block above never sets `required` on its own `queryDef` fixture (see
 * its own `clearBinding` test: "optional param, not required"), so it cannot see what
 * happens for the parameter shape the journey e2e (S89/S90/S92/S96) actually exercises.
 * `resolveBindings()`'s own `unresolved()` helper (binding-resolver.ts) already returns
 * `blocked: 'missing-required'` for a required parameter with no candidate value —
 * these tests lock that production behavior in at the component level, for both ways a
 * bound value can be emptied: this page's own "Clear this binding" button
 * ({@link QueryPageComponent.clearBinding}) and disabling the Investigation Context's
 * own chip ({@link InvestigationContextService.setEnabled}, REQ:context-basket — the
 * literal action AC:context-carries names: "disabling the chip empties it").
 */
describe('QueryPageComponent — clearing a required parameter blocks Run (S96)', () => {
  let component: QueryPageComponent;
  let runQueryMock: ReturnType<typeof vi.fn>;
  let investigationContext: InvestigationContextService;

  const project: IProjectContext = {
    ref: { storeId: 'localhost:8989', projectId: 'demo-project' },
  };

  const requiredQueryDef: IQueryDef = {
    id: 'customer-purchases-by-genre',
    title: 'Customer purchases by genre',
    request: { queryType: QueryType.SQL, text: '' } as ISqlQueryRequest,
    parameters: [
      {
        id: 'CustomerId',
        type: 'integer',
        isRequired: true,
        meta: { entity: 'Customer', field: 'ID' },
      },
    ],
  };

  const requiredEditorState: IQueryEditorState = {
    currentQueryId: requiredQueryDef.id,
    activeQueries: [
      {
        id: requiredQueryDef.id,
        queryType: QueryType.SQL,
        request: requiredQueryDef.request,
        def: requiredQueryDef,
      },
    ],
  } as unknown as IQueryEditorState;

  const selectionBinding = {
    parameterId: 'CustomerId',
    value: { type: 'integer' as const, value: '5' },
    origin: 'selection' as const,
    originEvidence: 'client-reported' as const,
  };

  async function createComponent(
    historyState: Record<string, unknown> = {},
  ): Promise<QueryPageComponent> {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: historyState },
      writable: true,
      configurable: true,
    });
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
            queryEditorState: of(requiredEditorState),
            updateQueryState: vi.fn(),
            openQuery: vi.fn(),
            newQuery: vi.fn(),
            getQueryState: vi.fn(),
            saveQuery: vi.fn(),
          },
        },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn() } },
        { provide: SemanticApiService, useValue: { runQuery: runQueryMock } },
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

    investigationContext = TestBed.inject(InvestigationContextService);
    const created = TestBed.createComponent(QueryPageComponent).componentInstance;
    created.project = project;
    created.envId = 'production';
    investigationContext.setScope({
      project: 'demo-project',
      environment: 'production',
      securityContextId: 'sctx-1',
    });
    return created;
  }

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('clearing a required parameter bound from selection stays visible as missing-required and blocks Run', async () => {
    component = await createComponent({ bindings: [selectionBinding] });
    expect(component.bindings()[0]).toEqual(
      expect.objectContaining({ parameterId: 'CustomerId', value: { type: 'integer', value: '5' } }),
    );

    component.clearBinding('CustomerId');

    expect(component.bindings()[0].blocked).toBe('missing-required');
    expect(component.visibleBindings()).toHaveLength(1); // still shown, never silently hidden
    expect(component.hasBlockedBindings()).toBe(true);
    expect(component.effectiveBindings()).toEqual([]);

    component.project = project;
    component.runQuery();
    expect(runQueryMock).not.toHaveBeenCalled();
    expect(component.runError()).toBeTruthy();
  });

  it('clearing a required parameter bound from context stays visible as missing-required and blocks Run', async () => {
    component = await createComponent({});
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 5,
      label: 'Customer.ID = 5',
      source: 'grid',
    });
    TestBed.tick();
    expect(component.bindings()[0].origin).toBe('context');

    component.clearBinding('CustomerId');

    expect(component.bindings()[0].blocked).toBe('missing-required');
    expect(component.hasBlockedBindings()).toBe(true);

    component.project = project;
    component.runQuery();
    expect(runQueryMock).not.toHaveBeenCalled();
  });

  it('disabling the Investigation Context chip (not clearing the page-local binding) empties a required from-context binding the same way (AC:context-carries "disabling the chip empties it")', async () => {
    component = await createComponent({});
    const item = investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 5,
      label: 'Customer.ID = 5',
      source: 'grid',
    });
    TestBed.tick();
    expect(component.bindings()[0]).toEqual(
      expect.objectContaining({ parameterId: 'CustomerId', origin: 'context', value: { type: 'integer', value: '5' } }),
    );

    investigationContext.setEnabled(item.id, false);
    TestBed.tick();

    expect(component.bindings()[0].blocked).toBe('missing-required');
    expect(component.hasBlockedBindings()).toBe(true);

    // Re-enabling restores the binding without the user ever having clicked
    // "Clear this binding" on the page itself.
    investigationContext.setEnabled(item.id, true);
    TestBed.tick();

    expect(component.bindings()[0]).toEqual(
      expect.objectContaining({ parameterId: 'CustomerId', origin: 'context', value: { type: 'integer', value: '5' } }),
    );
  });
});

/**
 * Regression (lane S92, journey J2/J3): `@sneat/random`'s `RandomIdService` is
 * `@Injectable()` with no `providedIn`, and nothing in this app ever imports
 * the package's own `RandomModule` or otherwise root-provides the service —
 * only its `RANDOM_ID_OPTIONS` injection token is provided, in
 * `apps/datatug-app/src/main.ts`. `QueryPageComponent` (and
 * `QueriesUiService`/`SqlQueryEditorComponent`) `inject(RandomIdService)` as
 * an eager field initializer, so the dependency is resolved unconditionally
 * at construction — confirmed live: navigating straight to `/query/:id` (the
 * context panel's "open a query" hand-off) threw `NG0201: No provider found
 * for \`RandomIdService\`. Source: Standalone[_QueryPageComponent]` before any
 * of this component's own binding-resolution logic ever ran, for every
 * query, new or existing. The two describes above cannot see this: they stub
 * `RandomIdService` directly. Here the component is left exactly as
 * production declares it (its own `imports:` are the only thing satisfying
 * `DatatugNavContextService`/`QueryContextSqlService`/`QueriesService`/
 * `QueryEditorStateService`/`Coordinator`), and `RandomIdService` +
 * `RANDOM_ID_OPTIONS` are provided the same way `apps/datatug-app/src/main.ts`
 * provides them app-wide (the actual fix) — not via this component's own
 * `imports:`, since that file is where the real app wires this up.
 */
describe('QueryPageComponent dependency injection', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: {} },
      writable: true,
      configurable: true,
    });
    TestBed.configureTestingModule({
      // Importing the standalone component brings its own `imports` into the
      // testing injector — nothing else here provides the datatug services.
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
        // ChangeDetectorRef is a real, per-view Angular construct that
        // `TestBed.runInInjectionContext(() => new X())` (below) cannot
        // resolve — there's no actual component view backing a raw `new`
        // call, unlike a genuine `TestBed.createComponent`. Confirmed this
        // is purely a test-methodology gap, not a production one: the real
        // browser reproduction (journey J2/J3) never raised this — only
        // RandomIdService, then AppContextService, then HttpExecutor, all
        // fixed above/below.
        { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } },
        // The actual fix under test: app-wide root providers
        // (apps/datatug-app/src/main.ts), not anything QueryPageComponent's
        // own `imports:` declares.
        RandomIdService,
        { provide: RANDOM_ID_OPTIONS, useValue: { len: 9 } },
      ],
    });
  });

  it('constructs from its own declared imports plus the app-level RandomIdService provider, the site that threw NG0201', () => {
    expect(() =>
      TestBed.runInInjectionContext(() => new QueryPageComponent()),
    ).not.toThrow();
  });

  it('throws NG0201 for RandomIdService when the app-level provider is missing (proves the test above is not a false positive)', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
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
        // RandomIdService deliberately NOT provided here.
      ],
    });

    expect(() =>
      TestBed.runInInjectionContext(() => new QueryPageComponent()),
    ).toThrow(/RandomIdService/);
  });
});

/**
 * S155 — founder ruling 2026-09-10: "Query page does not show query text and
 * linked entities/collections", reproduced live against the founder's own
 * URL (`.../query/artists%2Fartists_with_albums?id=...&editor=text&env=local`,
 * the real GitHub-store demo project). Live reproduction (this task) found
 * the data was ALREADY correct — `queryState.request.text`/`.def` load fine
 * (see `github-project-reader.service.spec.ts`'s own `getQuery` coverage,
 * unchanged by this task) — the query page template itself just never
 * rendered any of it: no body editor at all for SQL/DTQL (the old
 * `sneat-datatug-sql-query` binding, `query-page.component.html`, was
 * commented out and never replaced — confirmed by the pre-existing S136
 * comment on `apps/datatug-app/e2e/github-store.spec.ts`'s own
 * `getQueryBodyText()` helper) and no "linked entities" section anywhere.
 * `queryBodyText`/`linkedEntities` (new signals, `query-page.component.ts`)
 * are what the template now reads — these tests assert them directly, the
 * same way every other describe block in this file asserts component
 * signals rather than rendered DOM (this file overrides the template to
 * `''` throughout — real DOM rendering is covered instead by
 * `github-store.spec.ts`'s own Playwright case for this exact query).
 * `extractLinkedEntityNames()` has its own dedicated, TestBed-free tests
 * below this describe block.
 */
describe('QueryPageComponent — query text and linked entities display (S155)', () => {
  let component: QueryPageComponent;

  const project: IProjectContext = {
    ref: {
      storeId: 'github.com',
      projectId: 'datatug-demo-projects@datatug@demo-project-1',
    },
  };

  // The real `artists/artists_with_albums.sql`/`.sql.json` shape
  // (datatug/datatug-demo-projects, demo-project-1/queries/artists/) — the
  // founder's own reproduction query. Its `.sql.json` file is just
  // `{"title": "Artists with albums"}` (confirmed live against the real
  // repo) — no `parameters`/`recordsets` at all, exactly the case
  // `extractLinkedEntityNames()`'s SQL-text fallback exists for.
  const legacySqlText =
    'SELECT ar.*, (SELECT COUNT(1) FROM Album al WHERE al.ArtistId = ar.ArtistID) as AlbumsCount FROM Artist as ar ORDER BY (SELECT COUNT(1) FROM Album al WHERE al.ArtistId = ar.ArtistID) DESC';
  const legacySqlDef: IQueryDef = {
    id: 'artists/artists_with_albums',
    title: 'Artists with albums',
    request: { queryType: QueryType.SQL, text: legacySqlText } as ISqlQueryRequest,
  };

  // The real `customers/customer-invoices.query.json`/`.query.dtql` shape —
  // a DTQL query whose parameters/recordsets already carry `meta.entity`
  // (confirmed live against the real repo), the metadata path.
  const dtqlDef: IQueryDef = {
    id: 'customers/customer-invoices',
    title: 'Customer invoices',
    request: {
      queryType: QueryType.DTQL,
      text: 'from:\n  name: Invoice\n',
    } as unknown as ITextQueryRequest,
    parameters: [
      {
        id: 'CustomerId',
        type: 'integer',
        isRequired: true,
        meta: { entity: 'Customer', field: 'ID' },
      },
    ],
    recordsets: [
      {
        name: 'result',
        columns: [
          {
            name: 'InvoiceId',
            type: 'integer',
            meta: { entity: 'Invoice', field: 'ID' },
          },
          {
            name: 'Total',
            type: 'number',
            meta: { entity: 'Invoice', field: 'Total' },
          },
        ],
      },
    ],
  };

  async function createComponent(def: IQueryDef): Promise<QueryPageComponent> {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: {} },
      writable: true,
      configurable: true,
    });
    const editorState: IQueryEditorState = {
      currentQueryId: def.id,
      activeQueries: [
        {
          id: def.id,
          queryType: def.request.queryType,
          request: def.request,
          def,
        },
      ],
    } as unknown as IQueryEditorState;

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
        { provide: SemanticApiService, useValue: { runQuery: vi.fn() } },
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

    return TestBed.createComponent(QueryPageComponent).componentInstance;
  }

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('a direct-URL-loaded legacy SQL query (no parameters/recordsets metadata) exposes its own text and, from a FROM/JOIN scan, the tables it references', async () => {
    component = await createComponent(legacySqlDef);

    expect(component.queryBodyText()).toBe(legacySqlText);
    expect(component.linkedEntities()).toEqual(['Album', 'Artist']);
  });

  it('a DTQL query with parameter/recordset meta.entity exposes those entities, not a text-parsed guess', async () => {
    component = await createComponent(dtqlDef);

    expect(component.queryBodyText()).toBe('from:\n  name: Invoice\n');
    expect(component.linkedEntities()).toEqual(['Customer', 'Invoice']);
  });

  it('an HTTP query has no body text (queryBodyText is only for a text-shaped request)', async () => {
    const httpDef: IQueryDef = {
      id: 'reference/country-facts',
      title: 'Country facts',
      request: { queryType: QueryType.HTTP, url: 'https://example.test', method: 'GET' },
    };
    component = await createComponent(httpDef);

    expect(component.queryBodyText()).toBeUndefined();
  });
});

/**
 * `extractLinkedEntityNames()` (query-page.component.ts) in isolation — no
 * TestBed needed, a pure function. See its own doc comment for why the SQL
 * fallback exists and when it does/doesn't apply.
 */
describe('extractLinkedEntityNames', () => {
  it('returns nothing for an undefined definition', () => {
    expect(extractLinkedEntityNames(undefined)).toEqual([]);
  });

  it('prefers parameter/recordset meta.entity, deduplicated and sorted, over any text scan', () => {
    const def: IQueryDef = {
      id: 'q',
      title: 'q',
      request: {
        queryType: QueryType.SQL,
        text: 'SELECT 1 FROM Ignored',
      } as ISqlQueryRequest,
      parameters: [
        { id: 'p1', type: 'integer', meta: { entity: 'Customer', field: 'ID' } },
      ],
      recordsets: [
        {
          name: 'r',
          columns: [
            { name: 'c1', type: 'integer', meta: { entity: 'Invoice', field: 'ID' } },
            { name: 'c2', type: 'integer', meta: { entity: 'Customer', field: 'ID' } }, // dup
          ],
        },
      ],
    };

    expect(extractLinkedEntityNames(def)).toEqual(['Customer', 'Invoice']);
  });

  it('falls back to a FROM/JOIN scan of the SQL text when there is no metadata at all (the legacy .sql.json shape)', () => {
    const def: IQueryDef = {
      id: 'artists_with_albums',
      title: 'Artists with albums',
      request: {
        queryType: QueryType.SQL,
        text: 'SELECT ar.* FROM Artist as ar INNER JOIN Album al ON al.ArtistId = ar.ArtistID',
      } as ISqlQueryRequest,
    };

    expect(extractLinkedEntityNames(def)).toEqual(['Album', 'Artist']);
  });

  it('the SQL-text fallback also handles a schema-qualified table name', () => {
    const def: IQueryDef = {
      id: 'q',
      title: 'q',
      request: { queryType: QueryType.SQL, text: 'SELECT * FROM dbo.Artist' } as ISqlQueryRequest,
    };

    expect(extractLinkedEntityNames(def)).toEqual(['Artist']);
  });

  it('never SQL-parses a DTQL body (its text is YAML, not SQL) — no metadata means no entities', () => {
    const def: IQueryDef = {
      id: 'q',
      title: 'q',
      request: {
        queryType: QueryType.DTQL,
        text: 'from:\n  name: Invoice\n',
      } as unknown as ITextQueryRequest,
    };

    expect(extractLinkedEntityNames(def)).toEqual([]);
  });

  it('returns nothing for an HTTP query with no metadata', () => {
    const def: IQueryDef = {
      id: 'q',
      title: 'q',
      request: { queryType: QueryType.HTTP, url: 'https://example.test', method: 'GET' },
    };

    expect(extractLinkedEntityNames(def)).toEqual([]);
  });
});
