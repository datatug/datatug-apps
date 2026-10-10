import {
  createHostedDemoDbQuery,
  withHostedDemoDbSource,
} from '../../hosted-demo-db-query';
import {
  toProjectQueryWire,
  fromProjectQueryWire,
} from '../../project-query-contract';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';
import { resolve } from 'node:path';
import { nativeFixture } from '../../public-data/native-fixture.spec-helper';
import { PublicDataService } from '../../public-data/public-data.service';
import { NgTemplateOutlet } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectorRef,
  CUSTOM_ELEMENTS_SCHEMA,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { IonSelect, IonSelectOption, NavController } from '@ionic/angular';
import { Firestore } from 'firebase/firestore';
import { parseTugQL, resolveTugQL } from '@dalgo/core';
import { ErrorLogger } from '@sneat/core';
import { RANDOM_ID_OPTIONS, RandomIdService } from '@sneat/random';
import {
  AgentContextService,
  InvestigationContextService,
  SemanticApiService,
  type RunQueryResponse,
} from '@sneat/datatug-semantic';
import {
  BehaviorSubject,
  Observable,
  Subject,
  firstValueFrom,
  of,
  throwError,
} from 'rxjs';

import {
  QueryPageComponent,
  extractLinkedEntityNames,
} from './query-page.component';
import { IQueryEditorState, IQueryState } from '../../../editor/models';
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
import { ProjectService } from '../../../services/project/project.service';
import { QueryEditorStateService } from '../../query-editor-state-service';
import { QueryWorkspaceLayoutComponent } from './query-workspace-layout.component';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { FederatedQueryService } from '../../federated-query.service';
import { PublicSqliteQueryService } from '../../public-sqlite-query.service';
import { GitHubProjectActivityService } from '../../../services/project/github-project-activity.service';
import { graphFixturePlan } from '../../public-data/native-graph.spec-helper';
import { graphStableIdentity } from '../../public-data/native-graph-executor';
import {
  createOutputStores,
  replaceGraphOutput,
  openLocalResult,
  deleteLocalResult,
  type LocalResultDescriptor,
} from '../../federated-local-results';
import { INITIAL_CANONICAL_PINS } from '../../public-data/canonical-metadata';
import {
  SAVED_SCENARIO_PUBLICATION_BLOCKER,
  type PublicDataScenario,
} from '../../public-data/public-data-scenario';

function agentContextStub(securityContextId: string | undefined = 'sctx-1') {
  return {
    securityContextId: signal(securityContextId),
    refresh: vi.fn(() => of(undefined)),
  };
}

function githubProjectActivityStub() {
  return {
    resolve: vi.fn(() => of(undefined)),
    reportForCurrentProject: vi.fn(() => of(undefined)),
  };
}

function setRouterNavigation(
  router: Router,
  info: unknown,
  id: number,
  successful = false,
): void {
  const currentNavigation = router.currentNavigation as unknown as ReturnType<
    typeof vi.fn
  >;
  const lastSuccessfulNavigation = router.lastSuccessfulNavigation as unknown as ReturnType<
    typeof vi.fn
  >;
  currentNavigation.mockReturnValue({ id, extras: { info } });
  if (successful) {
    lastSuccessfulNavigation.mockReturnValue({ id, extras: { info } });
  }
}

function clearCurrentRouterNavigation(router: Router): void {
  const currentNavigation = router.currentNavigation as unknown as ReturnType<
    typeof vi.fn
  >;
  currentNavigation.mockReturnValue(null);
}

function setRouteId(id: string): void {
  Object.defineProperty(TestBed.inject(ActivatedRoute), 'snapshot', {
    configurable: true,
    value: { queryParamMap: convertToParamMap({ id }) },
  });
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
          provide: GitHubProjectActivityService,
          useValue: githubProjectActivityStub(),
        },
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
            currentNavigation: vi.fn(() => null),
            lastSuccessfulNavigation: vi.fn(() => null),
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

  // G-A1c: where the back button goes with no history: the project's queries (its address is the one
  // `projectUrl()` writes), in the folder of this query.
  it.each([
    [
      'an agent project',
      { storeId: 'localhost:8989', projectId: 'datatug-demo-project' },
      'customers',
      '/store/localhost:8989/project/datatug-demo-project/queries?folder=customers',
    ],
    [
      'an agent project, query in no folder',
      { storeId: 'localhost:8989', projectId: 'p1' },
      '',
      '/store/localhost:8989/project/p1/queries?folder=',
    ],
    [
      'a GitHub project',
      { storeId: 'github.com', projectId: 'chinook-demo@datatug@' },
      'sales',
      '/project/github.com/datatug/chinook-demo/queries?folder=sales',
    ],
    [
      'a GitHub project in a folder',
      { storeId: 'github.com', projectId: 'r@o@d' },
      'sales',
      '/project/github.com/o/r/tree/HEAD/d/-/queries?folder=sales',
    ],
  ])(
    'the back button goes to the queries of %s',
    (_name, ref, folder, href) => {
      component.project = { ref };
      component.queryFolderPath = folder;
      expect(component.queriesBackHref).toBe(href);
    },
  );

  it('the back button goes to the root while there is no project', () => {
    component.queryFolderPath = 'sales';
    expect(component.queriesBackHref).toBe('/?folder=sales');
  });
});

describe('QueryPageComponent — new SQL draft navigation', () => {
  it.each([
    ['public GitHub project', undefined],
    ['private GitHub clone', 'cloud' as const],
  ])(
    'restores an editable draft after project context loads in a %s',
    async (_name, projectApi) => {
      sessionStorage.clear();
      const ref = {
        storeId: 'github.com',
        projectId: 'demo@buyer@project',
        ...(projectApi ? { projectApi, branch: 'main' } : {}),
      };
      const query: IQueryDef = {
        id: 'draft-1',
        title: 'Query #1',
        draft: true,
        request: { queryType: QueryType.SQL, text: '' },
      };
      const replaceState = vi.fn((state: Record<string, unknown>) => {
        Object.defineProperty(window, 'history', {
          value: { ...window.history, state, replaceState },
          writable: true,
          configurable: true,
        });
      });
      Object.defineProperty(window, 'history', {
        value: {
          ...window.history,
          state: { action: 'create', project: { ref }, query },
          replaceState,
        },
        writable: true,
        configurable: true,
      });
      const currentProject = new Subject<IProjectContext | undefined>();
      const getRevision = vi.fn(() =>
        of({
          query: {
            id: query.id,
            title: query.title,
            type: 'SQL',
            text: 'SELECT 1',
            connectionId: 'chinook-sqlite',
          },
          revision: 'revision-1',
          branchHead: 'branch-next',
          saveSupported: true,
        }),
      );
      const saveRevision = vi.fn((_ref: unknown, request: { query: unknown }) =>
        of({
          query: request.query,
          revision: 'revision-1',
          branchHead: 'branch-next',
        }),
      );
      const queryParams = convertToParamMap({
        id: query.id,
        editor: 'text',
        ...(projectApi ? { projectApi, branch: 'main' } : {}),
      });
      const params = convertToParamMap({
        storeId: ref.storeId,
        projectId: ref.projectId,
      });
      await TestBed.configureTestingModule({
        imports: [QueryPageComponent],
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
        providers: [
          {
            provide: GitHubProjectActivityService,
            useValue: githubProjectActivityStub(),
          },
          {
            provide: ErrorLogger,
            useValue: {
              logError: vi.fn(),
              logErrorHandler: vi.fn(() => vi.fn()),
            },
          },
          {
            provide: RandomIdService,
            useValue: { newRandomId: vi.fn(() => 'draft-1') },
          },
          {
            provide: DatatugNavContextService,
            useValue: {
              currentProject,
              currentEnv: of(undefined),
              setCurrentEnvironment: vi.fn(),
            },
          },
          {
            provide: ActivatedRoute,
            useValue: {
              queryParamMap: of(queryParams),
              paramMap: of(params),
              snapshot: {
                queryParamMap: queryParams,
                paramMap: params,
                params: {},
              },
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
          {
            provide: QueriesService,
            useValue: {
              authorityDenied: () => of(undefined),
              authentication: () => of({ status: 'signedOut' }),
              getRevision,
              capabilities: () => of({ querySave: true }),
              branches: () =>
                of({
                  branches: [{ name: 'main', head: 'branch-initial' }],
                  currentBranch: 'main',
                }),
              saveRevision,
            },
          },
          { provide: ProjectService, useValue: { getFull: vi.fn() } },
          { provide: Coordinator, useValue: { execute: vi.fn() } },
          QueryEditorStateService,
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

      const editor = TestBed.inject(QueryEditorStateService);
      editor.newQuery({
        id: query.id,
        title: query.title,
        queryType: QueryType.SQL,
        request: query.request,
        def: query,
        isNew: true,
      });
      const openQuery = vi.spyOn(editor, 'openQuery');
      const component =
        TestBed.createComponent(QueryPageComponent).componentInstance;
      expect(openQuery).not.toHaveBeenCalled();
      currentProject.next({ ref });
      expect(editor.getQueryState(query.id)?.isNew).toBe(true);
      expect(getRevision).not.toHaveBeenCalled();
      expect(component.queryBodyText()).toBe('');
      expect(component.canChoosePublicSqliteSource()).toBe(true);
      expect(component.queryState.isNew).toBe(true);

      component.queryTextChanged({
        detail: { value: 'SELECT 1' },
      } as unknown as Event);
      component.publicSqliteSourceChanged({
        detail: { value: 'chinook-sqlite' },
      } as unknown as Event);
      expect(component.queryDef()?.request).toEqual({
        queryType: QueryType.SQL,
        text: 'SELECT 1',
      });
      expect(component.queryDef()?.connectionId).toBe('chinook-sqlite');
      if (projectApi === 'cloud') {
        await firstValueFrom(editor.saveQuery(component.queryState, ref));
        expect(saveRevision).toHaveBeenCalledOnce();
        expect(saveRevision.mock.calls[0][1]).toMatchObject({
          ifNoneMatch: true,
          expectedBranchHead: 'branch-initial',
          query: {
            id: query.id,
            text: 'SELECT 1',
            connectionId: 'chinook-sqlite',
          },
        });
        expect(replaceState).toHaveBeenCalledOnce();
        expect(history.state.action).toBeUndefined();
        expect(history.state.query).toBeUndefined();

        currentProject.next(undefined);
        currentProject.next({ ref });
        const reloaded =
          TestBed.createComponent(QueryPageComponent).componentInstance;
        expect(getRevision).toHaveBeenCalledOnce();
        expect(reloaded.queryBodyText()).toBe('SELECT 1');
        expect(reloaded.queryDef()?.connectionId).toBe('chinook-sqlite');
      }
    },
  );
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
  let federatedRunMock: ReturnType<typeof vi.fn>;
  let federatedGetPageMock: ReturnType<typeof vi.fn>;
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

  async function createTugQLAuthor(source: string): Promise<QueryPageComponent> {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'chinook-invoice-author',
      connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.DTQL, text: source },
    };
    const created = await createComponent({}, definition);
    created.queryState = {
      ...created.queryState,
      id: definition.id,
      connectionId: definition.connectionId,
      queryType: QueryType.DTQL,
      request: definition.request,
    };
    created.project = {
      ref: { storeId: 'github.com', projectId: 'demo@buyer@project' },
    };
    created.queryDef.set(definition);
    created.setAuthorMode('code');
    return created;
  }

  it('offers explicit SQLite binding for a cloned GitHub project, not only the canonical demo ID', async () => {
    component = await createComponent();
    expect(component.canChoosePublicSqliteSource()).toBe(false);
    component.project = {
      ref: {
        storeId: 'github.com',
        projectId: 'demo@buyer@project',
        projectApi: 'cloud',
        branch: 'main',
      },
    };
    component.queryDef.set({
      ...queryDef,
      request: { queryType: QueryType.SQL, text: 'SELECT 1' },
    });
    expect(component.canChoosePublicSqliteSource()).toBe(true);
  });

  it('reports a changed GitHub query draft once without counting an unchanged editor value', async () => {
    component = await createComponent();
    component.project = {
      ref: {
        storeId: 'github.com',
        projectId: 'demo@buyer@project',
        projectApi: 'cloud',
        branch: 'main',
      },
    };
    const activity = TestBed.inject(
      GitHubProjectActivityService,
    ) as unknown as ReturnType<typeof githubProjectActivityStub>;

    expect(activity.reportForCurrentProject).not.toHaveBeenCalled();
    component.queryTextChanged(
      new CustomEvent('ionInput', { detail: { value: 'SELECT 1' } }),
    );
    component.queryTextChanged(
      new CustomEvent('ionInput', { detail: { value: 'SELECT 1' } }),
    );

    expect(activity.reportForCurrentProject).toHaveBeenCalledOnce();
    expect(activity.reportForCurrentProject).toHaveBeenCalledWith(
      component.project.ref,
      'test-id',
      'query_edit',
    );
  });

  it('pages a browser SQLite result locally without asking the federated pager', async () => {
    component = await createComponent();
    const activity = TestBed.inject(
      GitHubProjectActivityService,
    ) as unknown as ReturnType<typeof githubProjectActivityStub>;
    component.project = {
      ref: {
        storeId: 'github.com',
        projectId: 'demo@buyer@project',
        projectApi: 'cloud',
        branch: 'main',
      },
    };
    component.queryDef.set({
      ...queryDef,
      connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.SQL, text: 'SELECT 1' },
    });
    const rows = Array.from({ length: 150 }, (_, index) => [
      { type: 'integer' as const, value: String(index) },
    ]);
    vi.spyOn(TestBed.inject(PublicSqliteQueryService), 'run').mockResolvedValue(
      {
        recordset: { columns: [{ name: 'n', type: 'integer' }], rows },
        limitations: [],
        bindingsApplied: [],
        truncated: false,
        provenance: {
          source: 'fixture',
          queryId: queryDef.id,
          mode: 'snapshot',
          observedAt: '2026-10-09T00:00:00Z',
          executionProfile: 'protected',
        },
      },
    );
    component.runQuery();
    expect(activity.reportForCurrentProject).toHaveBeenCalledWith(
      component.project.ref,
      'test-id',
      'query_execution_dispatched',
    );
    await vi.waitFor(() => expect(component.resultTotalRows()).toBe(150));
    expect(component.visibleResultRows()).toHaveLength(100);
    await component.changeResultPage(1);
    expect(component.visibleResultRows()).toHaveLength(50);
    expect(component.visibleResultRows()[0][0].value).toBe('100');
    expect(federatedGetPageMock).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'])(
    'clears a stale browser SQLite run on %s without rendering its outcome',
    async (outcome) => {
      component = await createComponent();
      component.project = {
        ref: {
          storeId: 'github.com',
          projectId: 'demo@buyer@project',
          projectApi: 'cloud',
          branch: 'main',
        },
      };
      const definition = {
        ...queryDef,
        connectionId: 'chinook-sqlite',
        request: { queryType: QueryType.SQL, text: 'SELECT 1' },
      };
      component.queryDef.set(definition);
      let resolveRun!: (
        result: Awaited<ReturnType<PublicSqliteQueryService['run']>>,
      ) => void;
      let rejectRun!: (error: Error) => void;
      vi.spyOn(
        TestBed.inject(PublicSqliteQueryService),
        'run',
      ).mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            resolveRun = resolve;
            rejectRun = reject;
          }),
      );
      component.runQuery();
      expect(component.running()).toBe(true);
      component.queryDef.set({
        ...definition,
        request: { queryType: QueryType.SQL, text: 'SELECT 2' },
      });
      if (outcome === 'resolve')
        resolveRun({
          recordset: {
            columns: [{ name: 'n', type: 'integer' }],
            rows: [[{ type: 'integer', value: '1' }]],
          },
          limitations: [],
          bindingsApplied: [],
          truncated: false,
          provenance: {
            source: 'fixture',
            queryId: queryDef.id,
            mode: 'snapshot',
            observedAt: '2026-10-09T00:00:00Z',
            executionProfile: 'protected',
          },
        });
      else rejectRun(new Error('old failure'));
      await vi.waitFor(() => expect(component.running()).toBe(false));
      expect(component.runResult()).toBeUndefined();
      expect(component.runError()).toBeUndefined();
    },
  );

  it('discards a deferred Author preview after the user switches query identity', async () => {
    const authorDefinition: IQueryDef = {
      ...queryDef,
      id: 'chinook-invoice-author',
      connectionId: 'chinook-sqlite',
      request: {
        queryType: QueryType.DTQL,
        text: 'from Invoice\nlimit 10\nselect InvoiceId',
      },
    };
    component = await createComponent({}, authorDefinition);
    component.project = {
      ref: {
        storeId: 'github.com',
        projectId: 'demo@buyer@project',
        projectApi: 'cloud',
        branch: 'main',
      },
    };
    component.queryState = {
      ...component.queryState,
      id: authorDefinition.id,
      connectionId: authorDefinition.connectionId,
      queryType: QueryType.DTQL,
      request: authorDefinition.request,
    };
    component.queryDef.set(authorDefinition);
    component.authorCustomerId.set('1');
    component.authorDraftRevision.set(1);
    let finishPreview!: (
      plan: Awaited<ReturnType<PublicSqliteQueryService['prepareTugQL']>>,
    ) => void;
    vi.spyOn(
      TestBed.inject(PublicSqliteQueryService),
      'prepareTugQL',
    ).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPreview = resolve;
        }),
    );
    const pending = component.previewTugql();
    component.queryState = { ...component.queryState, id: 'another-query' };
    component.queryDef.set({ ...authorDefinition, id: 'another-query' });
    finishPreview({
      sql: 'SELECT "InvoiceId" FROM "Invoice" LIMIT 10',
      fixedBindings: Object.freeze([]),
      bindingNames: Object.freeze(['CustomerId']),
      sourceId: 'chinook-sqlite',
      fixtureSha256: 'fixture',
      schemaVersion: 'schema',
      draftRevision: 1,
    });
    await pending;
    expect(component.authorPlan()).toBeUndefined();
  });

  it('keeps structural SQL preview when CustomerId is missing or changes', async () => {
    component = await createComponent();
    const preview = Object.freeze({
      sql: 'SELECT "i"."InvoiceId" FROM "Invoice" AS "i" WHERE "i"."CustomerId" = ? LIMIT 10',
      fixedBindings: Object.freeze([]),
      bindingNames: Object.freeze(['CustomerId']),
      sourceId: 'chinook-sqlite' as const,
      fixtureSha256: 'fixture',
      schemaVersion: 'schema',
      draftRevision: 1,
    });
    component.authorPlan.set(preview);

    expect(component.authorCustomerIdValid()).toBe(false);
    component.authorCustomerIdChanged(
      new CustomEvent('ionInput', { detail: { value: '42' } }),
    );
    expect(component.authorCustomerIdValid()).toBe(true);
    expect(component.authorPlan()).toBe(preview);

    component.authorCustomerIdChanged(
      new CustomEvent('ionInput', { detail: { value: '42.5' } }),
    );
    expect(component.authorCustomerIdValid()).toBe(false);
    expect(component.authorPlan()).toBe(preview);
    component.authorCustomerIdChanged(
      new CustomEvent('ionInput', { detail: { value: '' } }),
    );
    expect(component.authorCustomerIdValid()).toBe(false);
    expect(component.authorPlan()).toBe(preview);
  });

  it('opens an unsupported joined Author draft in Code without overriding an explicit mode choice', async () => {
    const source =
      'from Invoice as i join Customer as c on i.CustomerId = c.CustomerId';
    const definition: IQueryDef = {
      ...queryDef,
      id: 'chinook-customer-invoice-join',
      connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.DTQL, text: source },
    };
    component = await createComponent({}, definition);

    expect(component.authorMode()).toBe('code');
    component.setAuthorMode('compose');
    component.authorComposeTextChanged(`${source}\n-- keep my draft`);

    expect(component.authorMode()).toBe('compose');
    expect(component.queryBodyText()).toBe(`${source}\n-- keep my draft`);
  });

  it('opens a supported scan in Compose and keeps explicit Code mode while editing', async () => {
    const source = [
      'parameters (',
      '  @CustomerId integer required',
      ')',
      'from Invoice as i',
      'where i.CustomerId = @CustomerId',
      'limit 100',
      'select i.InvoiceId',
    ].join('\n');
    const definition: IQueryDef = {
      ...queryDef,
      id: 'chinook-invoice-author',
      connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.DTQL, text: source },
    };
    component = await createComponent({}, definition);

    expect(component.authorMode()).toBe('compose');
    component.setAuthorMode('code');
    component.authorComposeTextChanged(source.replace('limit 100', 'limit 90'));

    expect(component.authorMode()).toBe('code');
    expect(component.queryBodyText()).toBe(
      source.replace('limit 100', 'limit 90'),
    );
  });

  it('formats mixed keyword case and indentation, preserves comments and identifiers, and restores exact source', async () => {
    const source = [
      'PARAMETERS (',
      '\t@CustomerId INTEGER REQUIRED',
      ')',
      'fRoM Invoice AS i',
      '-- Keep CustomerId and MixedCase exactly as authored',
      'wHeRe i.CustomerId = @CustomerId',
      'LiMiT 100',
      'sElEcT i.InvoiceId',
    ].join('\n');
    component = await createTugQLAuthor(source);
    const plan = {
      sql: 'prepared',
      fixedBindings: Object.freeze([]),
      bindingNames: Object.freeze(['CustomerId']),
      sourceId: 'chinook-sqlite' as const,
      fixtureSha256: 'fixture',
      schemaVersion: 'schema',
      draftRevision: 1,
    };
    component.authorPlan.set(plan);
    const prepare = vi.spyOn(
      TestBed.inject(PublicSqliteQueryService),
      'prepareTugQL',
    );
    const execute = vi.spyOn(
      TestBed.inject(PublicSqliteQueryService),
      'runTugQL',
    );

    component.formatAuthorTugQL();
    const formatted = component.queryBodyText() ?? '';
    expect(formatted).toContain('FROM Invoice AS i');
    expect(formatted).toContain('\t@CustomerId INTEGER REQUIRED');
    expect(formatted).toContain(
      '-- Keep CustomerId and MixedCase exactly as authored',
    );
    expect(formatted).toContain('i.CustomerId = @CustomerId');
    expect(formatted).toContain('SELECT i.InvoiceId');
    expect(formatted).not.toContain('fRoM');
    expect(component.authorPlan()).toBeUndefined();
    expect(component.canUndoAuthorFormat()).toBe(true);
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();

    component.undoAuthorTugQLFormat();
    expect(component.queryBodyText()).toBe(source);
    expect(component.canUndoAuthorFormat()).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps a prepared plan and does not create Undo when formatting is a no-op', async () => {
    const source = 'from Invoice as i\nlimit 100\nselect i.InvoiceId';
    component = await createTugQLAuthor(source);
    const plan = {
      sql: 'SELECT "InvoiceId" FROM "Invoice" LIMIT 100',
      fixedBindings: Object.freeze([]),
      bindingNames: Object.freeze([]),
      sourceId: 'chinook-sqlite' as const,
      fixtureSha256: 'fixture',
      schemaVersion: 'schema',
      draftRevision: 1,
    };
    component.authorPlan.set(plan);
    const revision = component.authorDraftRevision();

    component.formatAuthorTugQL();

    expect(component.queryBodyText()).toBe(source);
    expect(component.authorPlan()).toBe(plan);
    expect(component.authorDraftRevision()).toBe(revision);
    expect(component.canUndoAuthorFormat()).toBe(false);
  });

  it('preserves a malformed multiline SELECT exactly and reports the formatter diagnostic', async () => {
    const source = 'from Invoice\nselect\n  InvoiceId\n  CustomerId';
    component = await createTugQLAuthor(source);
    const plan = { sql: 'prepared' } as never;
    component.authorPlan.set(plan);

    component.formatAuthorTugQL();

    expect(component.queryBodyText()).toBe(source);
    expect(component.authorPlan()).toBe(plan);
    expect(component.canUndoAuthorFormat()).toBe(false);
    expect(component.authorFormatStatus()).toContain('was not changed');
    expect(component.authorFormatStatus()).toContain(
      "multiline SELECT requires '(' on the SELECT header line",
    );
  });

  it.each([
    [
      'multiline string',
      "from Invoice as i\nwhere i.Name = 'Mixed\nCase'\nselect i.InvoiceId",
    ],
    [
      'multiline quoted identifier',
      'from Invoice as i\nwhere i."MiXeD\nCase" = 1\nselect i.InvoiceId',
    ],
  ] as const)(
    'keeps a %s draft exact and reports a diagnostic without previewing or running',
    async (_kind, source) => {
      component = await createTugQLAuthor(source);
      const plan = { sql: 'prepared' } as never;
      component.authorPlan.set(plan);
      const revision = component.authorDraftRevision();
      const sqlite = TestBed.inject(PublicSqliteQueryService);
      const prepare = vi.spyOn(sqlite, 'prepareTugQL');
      const execute = vi.spyOn(sqlite, 'runTugQL');

      component.formatAuthorTugQL();

      expect(component.queryBodyText()).toBe(source);
      expect(component.authorFormatStatus()).toBe(
        'TugQL was not changed: quoted value cannot continue across lines',
      );
      expect(component.authorPlan()).toBe(plan);
      expect(component.authorDraftRevision()).toBe(revision);
      expect(prepare).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('formats single-line doubled quotes, tabs, and Unicode without changing the literal', async () => {
    const literal = "'Tab\t雪 ''quoted'''";
    const source = `FrOm Invoice as i\nWhErE i.Name = ${literal}\nSeLeCt i.InvoiceId`;
    component = await createTugQLAuthor(source);

    component.formatAuthorTugQL();

    const formatted = component.queryBodyText() ?? '';
    expect(formatted).not.toBe(source);
    expect(formatted).toContain(literal);
    expect(parseTugQL(formatted).diagnostics).toEqual([]);
    expect(component.authorFormatStatus()).toBe('TugQL formatted.');

    component.undoAuthorTugQLFormat();
    expect(component.queryBodyText()).toBe(source);
  });

  it('keeps a compact parenthesized CTE and scalar SELECT resolvable after formatting', async () => {
    const source = [
      'WITH Recent AS (',
      '  FrOm Invoice AS i',
      '  LIMIT 1',
      '  SELECT i.InvoiceId',
      ')',
      'FROM Recent AS r',
      'SELECT (',
      '  Latest AS (',
      '    FROM Recent AS nested',
      '    LIMIT 1',
      '    SELECT nested.InvoiceId',
      '  )',
      ')',
    ].join('\n');
    component = await createTugQLAuthor(source);

    component.formatAuthorTugQL();

    const parsed = parseTugQL(component.queryBodyText() ?? '');
    expect(component.authorFormatStatus()).toBe('TugQL formatted.');
    expect(parsed.diagnostics).toEqual([]);
    const resolution = resolveTugQL(parsed.document, {
      authorizedSchemas: [
        {
          version: 'schema-v1',
          tables: [
            {
              name: 'Invoice',
              fields: [
                { name: 'InvoiceId', type: 'integer', authorized: true },
              ],
            },
          ],
        },
      ],
      relationships: [],
      pinnedImports: [],
      bindings: [],
    });

    expect(resolution.diagnostics).toEqual([]);
    expect(resolution.resolved?.columns).toEqual([
      {
        name: 'Latest',
        type: 'integer',
        lineage: [{ source: 'i', field: 'InvoiceId' }],
      },
    ]);
  });

  it('recognizes the maintained TugQL definition when query state still says SQL', async () => {
    component = await createTugQLAuthor('FrOm Invoice as i');
    component.queryState = {
      ...component.queryState,
      queryType: QueryType.SQL,
    };

    component.formatAuthorTugQL();

    expect(component.queryBodyText()).toBe('from Invoice as i');
    expect(component.canUndoAuthorFormat()).toBe(true);
  });

  it.each(['compose', 'running', 'saving', 'non-author', 'non-text'] as const)(
    'guards formatting while %s',
    async (guard) => {
      component = await createTugQLAuthor('FrOm Invoice as i');
      if (guard === 'compose') component.setAuthorMode('compose');
      if (guard === 'running') component.running.set(true);
      if (guard === 'saving')
        component.queryState = { ...component.queryState, isSaving: true };
      if (guard === 'non-author')
        component.queryDef.update((current) =>
          current ? { ...current, connectionId: 'other-source' } : current,
        );
      if (guard === 'non-text')
        component.queryDef.update((current) =>
          current
            ? {
                ...current,
                request: {
                  queryType: QueryType.HTTP,
                  url: 'https://example.test',
                },
              }
            : current,
        );

      component.formatAuthorTugQL();

      expect(component.queryBodyText()).toBe(
        guard === 'non-text' ? undefined : 'FrOm Invoice as i',
      );
      expect(component.authorDraftRevision()).toBe(0);
    },
  );

  it('invalidates Undo after a Compose edit and checks principal scope live before synchronization', async () => {
    component = await createTugQLAuthor('FrOm Invoice as i');
    component.formatAuthorTugQL();
    const formatted = component.queryBodyText();
    component.setAuthorMode('compose');
    component.authorComposeTextChanged(`${formatted}\n-- manual edit`);
    component.setAuthorMode('code');
    component.undoAuthorTugQLFormat();
    expect(component.queryBodyText()).toBe(`${formatted}\n-- manual edit`);

    component.authorComposeTextChanged('FrOm Invoice as i');
    component.formatAuthorTugQL();
    expect(component.canUndoAuthorFormat()).toBe(true);
    agentContext.securityContextId.set('sctx-2');
    component.undoAuthorTugQLFormat();
    expect(component.queryBodyText()).toBe(formatted);
    expect(component.canUndoAuthorFormat()).toBe(false);
  });

  it.each(['query', 'project', 'environment'] as const)(
    'does not restore formatted source after the live %s scope changes before synchronization',
    async (scope) => {
      component = await createTugQLAuthor('FrOm Invoice as i');
      component.formatAuthorTugQL();
      const formatted = component.queryBodyText();
      expect(component.canUndoAuthorFormat()).toBe(true);

      if (scope === 'query') {
        component.queryDef.update((definition) =>
          definition ? { ...definition, id: 'another-query' } : definition,
        );
      } else if (scope === 'project') {
        component.project = {
          ref: { storeId: 'github.com', projectId: 'another-project' },
        };
      } else {
        component.envId = 'staging';
      }

      component.undoAuthorTugQLFormat();

      expect(component.queryBodyText()).toBe(formatted);
      expect(component.canUndoAuthorFormat()).toBe(false);
      expect(component.authorFormatStatus()).toContain(
        'draft or query context changed',
      );
    },
  );

  it('waits for an asynchronously loaded definition before choosing the cold mode', async () => {
    const source = [
      'parameters (',
      '  @CustomerId integer required',
      ')',
      'from Invoice as i',
      'where i.CustomerId = @CustomerId',
      'limit 100',
      'select i.InvoiceId',
    ].join('\n');
    const definition: IQueryDef = {
      ...queryDef,
      id: 'chinook-invoice-author',
      connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.DTQL, text: source },
    };
    const editor = new Subject<IQueryEditorState>();
    component = await createComponent({}, queryDef, '<p></p>', {
      editor,
      project: of(project),
    });
    const loadingState: IQueryState = {
      id: definition.id,
      queryType: QueryType.DTQL,
      request: definition.request,
    };
    editor.next({
      ...editorState,
      currentQueryId: definition.id,
      activeQueries: [loadingState],
    });

    expect(component.authorMode()).toBe('code');

    editor.next({
      ...editorState,
      currentQueryId: definition.id,
      activeQueries: [{ ...loadingState, def: definition }],
    });

    expect(component.authorMode()).toBe('compose');
  });

  it('reselects the cold mode after a same-query security scope change', async () => {
    const source = [
      'parameters (',
      '  @CustomerId integer required',
      ')',
      'from Invoice as i',
      'where i.CustomerId = @CustomerId',
      'limit 100',
      'select i.InvoiceId',
    ].join('\n');
    const definition: IQueryDef = {
      ...queryDef,
      id: 'chinook-invoice-author',
      connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.DTQL, text: source },
    };
    component = await createComponent({}, definition);
    component.setAuthorMode('code');
    expect(component.authorMode()).toBe('code');

    agentContext.securityContextId.set('sctx-2');
    await runFixture.whenStable();

    expect(component.authorMode()).toBe('compose');
  });

  it('cancels a scheduled lookup focus when the destination scope is superseded', async () => {
    component = await createComponent(
      {},
      queryDef,
      '<h2 #authorLookupHeading tabindex="-1">Invoice lookup</h2>',
    );
    component.queryState = {
      ...component.queryState,
      id: 'chinook-invoice-author',
    };
    runFixture.detectChanges();
    const heading = runFixture.nativeElement.querySelector('h2');
    const internals = component as unknown as {
      focusAuthorLookupAfterRender(): void;
      invalidateHistoryScope(): void;
      setQueryId(id?: string | null, isNew?: boolean): void;
    };

    internals.focusAuthorLookupAfterRender();
    internals.invalidateHistoryScope();
    await runFixture.whenStable();

    expect(document.activeElement).not.toBe(heading);
  });

  it('does not focus the lookup heading when navigation is rejected', async () => {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'chinook-customer-invoice-join',
      connectionId: 'chinook-sqlite',
      request: {
        queryType: QueryType.DTQL,
        text: 'from Invoice as i join Customer as c on i.CustomerId = c.CustomerId',
      } as unknown as ITextQueryRequest,
    };
    component = await createComponent({}, definition);
    component.project = {
      ref: { storeId: 'github.com', projectId: 'demo@buyer@project' },
    };
    component.queryState = {
      ...component.queryState,
      id: definition.id,
      queryType: QueryType.DTQL,
      request: definition.request,
      authorBindings: { CustomerId: '1' },
      authorBindingProvenance: {
        CustomerId: { origin: 'manual', originEvidence: 'client-reported' },
      },
    };
    component.queryDef.set(definition);
    component.authorCustomerId.set('1');
    component.runResult.set({
      recordset: {
        columns: [{ name: 'CustomerId', type: 'integer' }],
        rows: [[{ type: 'integer', value: '1' }]],
      },
      publicSqliteReceipt: {
        executionId: 'join-run-1',
        draftRevision: 0,
        relationship: {
          id: 'FK_Invoice_Customer_CustomerId',
          version: '1',
          fromSource: 'Invoice',
          toSource: 'Customer',
          joinType: 'inner',
          pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
        },
        outputColumns: [
          {
            name: 'CustomerId',
            type: 'integer',
            lineage: [{ source: 'Invoice', field: 'CustomerId' }],
          },
        ],
        clientReportedBinding: {
          origin: 'manual',
          originEvidence: 'client-reported',
        },
      },
      bindingsApplied: [
        {
          parameterId: 'CustomerId',
          value: { type: 'integer', value: '1' },
          origin: 'manual',
          originEvidence: 'client-reported',
        },
      ],
    } as never);

    const lookupDefinition: IQueryDef = {
      ...definition,
      id: 'chinook-invoice-author',
      request: { queryType: QueryType.DTQL, text: 'from Invoice as i' },
    };
    const queries = TestBed.inject(QueriesService);
    Object.assign(queries, { getQuery: vi.fn(() => of(lookupDefinition)) });
    const editor = TestBed.inject(QueryEditorStateService);
    vi.spyOn(editor, 'openAuthorizedQuery').mockReturnValue({
      id: lookupDefinition.id,
      queryType: QueryType.DTQL,
      request: lookupDefinition.request,
      def: lookupDefinition,
    });
    const router = TestBed.inject(Router);
    vi.mocked(router.navigate).mockResolvedValue(false);
    const focusAuthorLookupAfterRender = vi.spyOn(
      component as unknown as { focusAuthorLookupAfterRender(): void },
      'focusAuthorLookupAfterRender',
    );
    const internals = component as unknown as {
      currentQueryIdentity(): symbol;
      openAuthorCustomerLookup(
        columnIndex: number,
        columnName: string,
        rowIndex: number,
        executionId: string,
        customerId: string,
        identity: symbol,
      ): Promise<void>;
    };

    await internals.openAuthorCustomerLookup(
      0,
      'CustomerId',
      0,
      'join-run-1',
      '1',
      internals.currentQueryIdentity(),
    );

    expect(router.navigate).toHaveBeenCalledOnce();
    expect(focusAuthorLookupAfterRender).not.toHaveBeenCalled();
    expect(component.queryId).toBe(definition.id);
    expect(component.queryState.authorBindings?.['CustomerId']).toBe('1');
    expect(editor.openAuthorizedQuery).not.toHaveBeenCalled();

    vi.mocked(router.navigate).mockRejectedValue(new Error('route rejected'));
    await internals.openAuthorCustomerLookup(
      0,
      'CustomerId',
      0,
      'join-run-1',
      '1',
      internals.currentQueryIdentity(),
    );

    expect(router.navigate).toHaveBeenCalledTimes(2);
    expect(focusAuthorLookupAfterRender).not.toHaveBeenCalled();
    expect(component.queryId).toBe(definition.id);
    expect(component.queryState.authorBindings?.['CustomerId']).toBe('1');
    expect(editor.openAuthorizedQuery).not.toHaveBeenCalled();
  });

  it('selects the mobile Editor pane before focusing a successfully opened lookup', async () => {
    const scenario = await createJoinedLookupScenario(
      '<sneat-query-workspace-layout><div query-workspace-editor><h2 #authorLookupHeading tabindex="-1">Invoice lookup</h2></div><div query-workspace-results>Results</div></sneat-query-workspace-layout>',
    );
    const layout = runFixture.debugElement.query(
      By.directive(QueryWorkspaceLayoutComponent),
    ).componentInstance as QueryWorkspaceLayoutComponent;
    const focusAuthorLookupAfterRender = vi.spyOn(
      component as unknown as { focusAuthorLookupAfterRender(): void },
      'focusAuthorLookupAfterRender',
    );
    layout.mobilePane.set('results');
    const targetState: IQueryState = {
      id: scenario.lookupDefinition.id,
      queryType: QueryType.DTQL,
      request: scenario.lookupDefinition.request,
      def: scenario.lookupDefinition,
    };
    vi.mocked(scenario.editor.openAuthorizedQuery).mockImplementation(() => {
      component.queryState = targetState;
      component.queryDef.set(scenario.lookupDefinition);
      runFixture.detectChanges();
      return targetState;
    });
    const updateQueryState = vi.mocked(scenario.editor.updateQueryState);
    vi.mocked(scenario.router.navigate).mockImplementation(async (_commands, extras) => {
      const navigationInfo = extras?.info;
      setRouterNavigation(scenario.router, navigationInfo, 41);
      setRouteId(scenario.lookupDefinition.id);
      scenario.internals.setQueryId(scenario.lookupDefinition.id);
      runFixture.detectChanges();
      setRouterNavigation(scenario.router, navigationInfo, 41, true);
      return true;
    });

    runFixture.detectChanges();
    await runFixture.whenStable();
    const heading = runFixture.nativeElement.querySelector('h2') as HTMLElement;
    const headingFocus = vi.spyOn(heading, 'focus');
    expect(
      (
        component as unknown as {
          authorLookupHeading?: { nativeElement: HTMLElement };
        }
      ).authorLookupHeading?.nativeElement,
    ).toBe(heading);

    await scenario.internals.openAuthorCustomerLookup(
      0,
      'CustomerId',
      0,
      'join-run-1',
      '1',
      scenario.internals.currentQueryIdentity(),
    );
    runFixture.detectChanges();
    await runFixture.whenRenderingDone();
    await runFixture.whenStable();

    expect(scenario.router.navigate).toHaveBeenCalledOnce();
    expect(scenario.editor.openAuthorizedQuery).toHaveBeenCalledOnce();
    expect(layout.mobilePane()).toBe('editor');
    expect(focusAuthorLookupAfterRender).toHaveBeenCalledOnce();
    expect(headingFocus).toHaveBeenCalledOnce();
    expect(updateQueryState).toHaveBeenCalledWith(
      expect.objectContaining({
        authorBindings: { CustomerId: '1' },
        authorBindingProvenance: {
          CustomerId: expect.objectContaining({
            origin: 'selection',
            sourceQueryId: scenario.definition.id,
          }),
        },
      }),
    );
    expect(runQueryMock).not.toHaveBeenCalled();
  });

  it('cancels scheduled lookup focus when CustomerId changes before the next render', async () => {
    const scenario = await createJoinedLookupScenario(
      '<h2 #authorLookupHeading tabindex="-1">Invoice lookup</h2>',
    );
    component.queryState = {
      ...component.queryState,
      id: scenario.lookupDefinition.id,
      queryType: QueryType.DTQL,
      request: scenario.lookupDefinition.request,
    };
    component.queryDef.set(scenario.lookupDefinition);
    runFixture.detectChanges();
    await runFixture.whenStable();
    const heading = runFixture.nativeElement.querySelector('h2') as HTMLElement;
    const headingFocus = vi.spyOn(heading, 'focus');
    (
      component as unknown as { focusAuthorLookupAfterRender(): void }
    ).focusAuthorLookupAfterRender();

    component.authorCustomerIdChanged(
      new CustomEvent('ionChange', { detail: { value: '2' } }),
    );
    runFixture.detectChanges();
    await runFixture.whenStable();

    expect(headingFocus).not.toHaveBeenCalled();
  });

  it('cancels scheduled lookup focus when the author draft changes before the next render', async () => {
    const scenario = await createJoinedLookupScenario(
      '<h2 #authorLookupHeading tabindex="-1">Invoice lookup</h2>',
    );
    component.queryState = {
      ...component.queryState,
      id: scenario.lookupDefinition.id,
      queryType: QueryType.DTQL,
      request: scenario.lookupDefinition.request,
    };
    component.queryDef.set(scenario.lookupDefinition);
    runFixture.detectChanges();
    await runFixture.whenStable();
    const heading = runFixture.nativeElement.querySelector('h2') as HTMLElement;
    const headingFocus = vi.spyOn(heading, 'focus');
    (
      component as unknown as { focusAuthorLookupAfterRender(): void }
    ).focusAuthorLookupAfterRender();

    component.queryTextChanged(
      new CustomEvent('ionChange', {
        detail: { value: 'from Invoice as i\nselect i.InvoiceId' },
      }),
    );
    runFixture.detectChanges();
    await runFixture.whenStable();

    expect(headingFocus).not.toHaveBeenCalled();
  });

  it('does not commit a selected lookup after its navigation scope changes', async () => {
    const scenario = await createJoinedLookupScenario();
    const route = TestBed.inject(ActivatedRoute);
    const focus = vi.spyOn(
      component as unknown as { focusAuthorLookupAfterRender(): void },
      'focusAuthorLookupAfterRender',
    );
    const targetState: IQueryState = {
      id: scenario.lookupDefinition.id,
      queryType: QueryType.DTQL,
      request: scenario.lookupDefinition.request,
      def: scenario.lookupDefinition,
    };
    vi.mocked(scenario.editor.openAuthorizedQuery).mockReturnValue(targetState);
    const updateQueryState = vi.mocked(scenario.editor.updateQueryState);
    let resolveNavigation!: (navigated: boolean) => void;
    vi.mocked(scenario.router.navigate).mockImplementation(
      (_commands, extras) =>
        new Promise<boolean>((resolve) => {
          resolveNavigation = resolve;
          Object.defineProperty(route, 'snapshot', {
            configurable: true,
            value: {
              queryParamMap: convertToParamMap({
                id: scenario.lookupDefinition.id,
              }),
            },
          });
          setRouterNavigation(scenario.router, extras?.info, 42);
          scenario.internals.setQueryId(scenario.lookupDefinition.id);
          const complete = resolve;
          resolveNavigation = (navigated) => {
            if (navigated)
              setRouterNavigation(
                scenario.router,
                extras?.info,
                42,
                true,
              );
            complete(navigated);
          };
        }),
    );

    const pending = scenario.internals.openAuthorCustomerLookup(
      0,
      'CustomerId',
      0,
      'join-run-1',
      '1',
      scenario.internals.currentQueryIdentity(),
    );
    await vi.waitFor(() => expect(resolveNavigation).toBeTypeOf('function'));
    agentContext.securityContextId.set('sctx-after-navigation');
    scenario.internals.syncScopeAndBindings();
    resolveNavigation(true);
    await pending;

    expect(scenario.editor.openAuthorizedQuery).not.toHaveBeenCalled();
    expect(scenario.editor.openQuery).toHaveBeenCalledWith(
      scenario.lookupDefinition.id,
    );
    expect(updateQueryState).not.toHaveBeenCalled();
    expect(component.queryState.authorBindings?.['CustomerId']).toBe('1');
    expect(focus).not.toHaveBeenCalled();
  });

  it('restores source URL and state when an observed target navigation is canceled', async () => {
    const scenario = await createJoinedLookupScenario();
    let cancelTargetNavigation!: () => void;
    vi.mocked(scenario.router.navigate).mockImplementation(
      (_commands, extras) => {
        const id = extras?.queryParams?.['id'];
        const info = extras?.info;
        if (id === scenario.lookupDefinition.id) {
          setRouterNavigation(scenario.router, info, 60);
          setRouteId(scenario.lookupDefinition.id);
          scenario.internals.setQueryId(scenario.lookupDefinition.id);
          return new Promise<boolean>((resolve) => {
            cancelTargetNavigation = () => resolve(false);
          });
        }

        setRouterNavigation(scenario.router, info, 61);
        setRouteId(scenario.definition.id);
        scenario.internals.setQueryId(scenario.definition.id);
        setRouterNavigation(scenario.router, info, 61, true);
        return Promise.resolve(true);
      },
    );
    const pending = scenario.internals.openAuthorCustomerLookup(
      0,
      'CustomerId',
      0,
      'join-run-1',
      '1',
      scenario.internals.currentQueryIdentity(),
    );
    await vi.waitFor(() =>
      expect(cancelTargetNavigation).toBeTypeOf('function'),
    );
    cancelTargetNavigation();
    await pending;

    expect(scenario.router.navigate).toHaveBeenCalledTimes(2);
    expect(TestBed.inject(ActivatedRoute).snapshot.queryParamMap.get('id')).toBe(
      scenario.definition.id,
    );
    expect(component.queryId).toBe(scenario.definition.id);
    expect(scenario.editor.openQuery).not.toHaveBeenCalledWith(
      scenario.lookupDefinition.id,
    );
    expect(scenario.editor.openAuthorizedQuery).not.toHaveBeenCalled();
    expect(scenario.editor.updateQueryState).not.toHaveBeenCalled();
  });

  it('reconciles a still-owned target URL if source rollback is rejected', async () => {
    const scenario = await createJoinedLookupScenario();
    let cancelTargetNavigation!: () => void;
    vi.mocked(scenario.router.navigate).mockImplementation(
      (_commands, extras) => {
        const id = extras?.queryParams?.['id'];
        const info = extras?.info;
        if (id === scenario.lookupDefinition.id) {
          setRouterNavigation(scenario.router, info, 62);
          setRouteId(scenario.lookupDefinition.id);
          scenario.internals.setQueryId(scenario.lookupDefinition.id);
          return new Promise<boolean>((resolve) => {
            cancelTargetNavigation = () => resolve(false);
          });
        }
        setRouterNavigation(scenario.router, info, 63);
        return Promise.resolve(false).then((navigated) => {
          clearCurrentRouterNavigation(scenario.router);
          return navigated;
        });
      },
    );
    const pending = scenario.internals.openAuthorCustomerLookup(
      0,
      'CustomerId',
      0,
      'join-run-1',
      '1',
      scenario.internals.currentQueryIdentity(),
    );
    await vi.waitFor(() =>
      expect(cancelTargetNavigation).toBeTypeOf('function'),
    );
    cancelTargetNavigation();
    await pending;

    expect(scenario.router.navigate).toHaveBeenCalledTimes(2);
    expect(scenario.router.navigate.mock.calls[1][1]).toEqual(
      expect.objectContaining({ replaceUrl: true }),
    );
    expect(TestBed.inject(ActivatedRoute).snapshot.queryParamMap.get('id')).toBe(
      scenario.lookupDefinition.id,
    );
    expect(scenario.editor.openQuery).toHaveBeenCalledWith(
      scenario.lookupDefinition.id,
    );
    expect(scenario.editor.openAuthorizedQuery).not.toHaveBeenCalled();
    expect(scenario.editor.updateQueryState).not.toHaveBeenCalled();
    expect(component.queryState.authorBindingProvenance?.['CustomerId']?.origin).toBe(
      'manual',
    );
  });

  it('does not roll back over a newer navigation to the same lookup target', async () => {
    const scenario = await createJoinedLookupScenario();
    let resolveLookupNavigation!: (navigated: boolean) => void;
    let lookupNavigationInfo: unknown;
    vi.mocked(scenario.router.navigate).mockImplementation(
      (_commands, extras) => {
        lookupNavigationInfo = extras?.info;
        setRouterNavigation(scenario.router, lookupNavigationInfo, 70);
        setRouteId(scenario.lookupDefinition.id);
        scenario.internals.setQueryId(scenario.lookupDefinition.id);
        return new Promise<boolean>((resolve) => {
          resolveLookupNavigation = resolve;
        });
      },
    );
    const pending = scenario.internals.openAuthorCustomerLookup(
      0,
      'CustomerId',
      0,
      'join-run-1',
      '1',
      scenario.internals.currentQueryIdentity(),
    );
    await vi.waitFor(() =>
      expect(resolveLookupNavigation).toBeTypeOf('function'),
    );

    const independentNavigationInfo = { source: 'user-navigation' };
    setRouterNavigation(scenario.router, independentNavigationInfo, 71);
    setRouteId(scenario.lookupDefinition.id);
    scenario.internals.setQueryId(scenario.lookupDefinition.id);
    setRouterNavigation(scenario.router, independentNavigationInfo, 71, true);
    resolveLookupNavigation(true);
    await pending;

    expect(scenario.router.navigate).toHaveBeenCalledOnce();
    expect(scenario.editor.openQuery).toHaveBeenCalledWith(
      scenario.lookupDefinition.id,
    );
    expect(scenario.editor.openAuthorizedQuery).not.toHaveBeenCalled();
    expect(scenario.editor.updateQueryState).not.toHaveBeenCalled();
    expect(component.queryState.authorBindingProvenance?.['CustomerId']?.origin).toBe(
      'manual',
    );
  });

  it('keeps an edit made before the owned route emission and never applies the stale selection', async () => {
    const scenario = await createJoinedLookupScenario();
    let emitLookupRoute!: () => void;
    let resolveLookupNavigation!: (navigated: boolean) => void;
    vi.mocked(scenario.router.navigate).mockImplementation(
      (_commands, extras) => {
        if (extras?.queryParams?.['id'] === scenario.lookupDefinition.id) {
          const navigationInfo = extras.info;
          setRouterNavigation(scenario.router, navigationInfo, 80);
          return new Promise<boolean>((resolve) => {
            resolveLookupNavigation = (navigated) => {
              if (navigated)
                setRouterNavigation(scenario.router, navigationInfo, 80, true);
              resolve(navigated);
            };
            emitLookupRoute = () => {
              setRouteId(scenario.lookupDefinition.id);
              scenario.internals.setQueryId(scenario.lookupDefinition.id);
            };
          });
        }

        const restoreInfo = extras?.info;
        setRouterNavigation(scenario.router, restoreInfo, 81);
        setRouteId(scenario.definition.id);
        scenario.internals.setQueryId(scenario.definition.id);
        setRouterNavigation(scenario.router, restoreInfo, 81, true);
        return Promise.resolve(true);
      },
    );
    const pending = scenario.internals.openAuthorCustomerLookup(
      0,
      'CustomerId',
      0,
      'join-run-1',
      '1',
      scenario.internals.currentQueryIdentity(),
    );
    await vi.waitFor(() =>
      expect(emitLookupRoute).toBeTypeOf('function'),
    );
    component.authorCustomerIdChanged(
      new CustomEvent('ionChange', { detail: { value: '2' } }),
    );
    emitLookupRoute();
    resolveLookupNavigation(true);
    await pending;

    expect(scenario.router.navigate).toHaveBeenCalledTimes(2);
    expect(scenario.router.navigate.mock.calls[1][1]?.queryParams).toEqual(
      expect.objectContaining({ id: scenario.definition.id }),
    );
    expect(scenario.router.navigate.mock.calls[1][1]).toEqual(
      expect.objectContaining({ replaceUrl: true }),
    );
    expect(scenario.editor.openAuthorizedQuery).not.toHaveBeenCalled();
    expect(scenario.editor.updateQueryState).toHaveBeenCalledWith(
      expect.objectContaining({
        authorBindings: { CustomerId: '2' },
        authorBindingProvenance: {
          CustomerId: expect.objectContaining({ origin: 'manual' }),
        },
      }),
    );
    expect(component.queryState.authorBindings?.['CustomerId']).toBe('2');
  });

  it('restores the source route when an edit makes an observed lookup navigation stale', async () => {
    const scenario = await createJoinedLookupScenario();
    let resolveNavigation!: (navigated: boolean) => void;
    vi.mocked(scenario.router.navigate).mockImplementation(
      (_commands, extras) => {
        const id = extras?.queryParams?.['id'];
        if (id === scenario.lookupDefinition.id) {
          setRouteId(scenario.lookupDefinition.id);
          setRouterNavigation(scenario.router, extras?.info, 43);
          scenario.internals.setQueryId(id);
          return new Promise<boolean>((resolve) => {
            resolveNavigation = (navigated) => {
              if (navigated)
                setRouterNavigation(
                  scenario.router,
                  extras?.info,
                  43,
                  true,
                );
              resolve(navigated);
            };
          });
        }
        setRouteId(scenario.definition.id);
        setRouterNavigation(scenario.router, extras?.info, 44);
        scenario.internals.setQueryId(scenario.definition.id);
        setRouterNavigation(scenario.router, extras?.info, 44, true);
        return Promise.resolve(true);
      },
    );

    const pending = scenario.internals.openAuthorCustomerLookup(
      0,
      'CustomerId',
      0,
      'join-run-1',
      '1',
      scenario.internals.currentQueryIdentity(),
    );
    await vi.waitFor(() => expect(resolveNavigation).toBeTypeOf('function'));
    component.queryTextChanged(
      new CustomEvent('ionChange', { detail: { value: 'from Invoice as i -- keep local draft' } }),
    );
    resolveNavigation(true);
    await pending;

    expect(scenario.router.navigate).toHaveBeenCalledTimes(2);
    expect(scenario.router.navigate.mock.calls[1][1]?.queryParams).toEqual(
      expect.objectContaining({ id: scenario.definition.id }),
    );
    expect(scenario.editor.openAuthorizedQuery).not.toHaveBeenCalled();
    expect(component.queryState.request?.text).toContain('keep local draft');
    expect(component.queryState.authorBindingProvenance?.['CustomerId']?.origin).toBe(
      'manual',
    );
  });

  it('does not show an old navigation failure after the CustomerId changes', async () => {
    const scenario = await createJoinedLookupScenario();
    let resolveNavigation!: (navigated: boolean) => void;
    vi.mocked(scenario.router.navigate).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveNavigation = resolve;
        }),
    );
    const pending = scenario.internals.openAuthorCustomerLookup(
      0,
      'CustomerId',
      0,
      'join-run-1',
      '1',
      scenario.internals.currentQueryIdentity(),
    );
    await vi.waitFor(() => expect(resolveNavigation).toBeTypeOf('function'));
    component.authorCustomerIdChanged(
      new CustomEvent('ionChange', { detail: { value: '2' } }),
    );
    resolveNavigation(false);
    await pending;

    expect(component.authorCustomerId()).toBe('2');
    expect(component.authorError()).toBeUndefined();
    expect(scenario.editor.openAuthorizedQuery).not.toHaveBeenCalled();
    expect(runQueryMock).not.toHaveBeenCalled();
  });

  it('aborts and invalidates an active author run when Code is edited', async () => {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'author-edit-test',
      connectionId: 'chinook-sqlite',
      request: {
        queryType: QueryType.DTQL,
        text: 'from Invoice as i',
      } as unknown as ITextQueryRequest,
    };
    component = await createComponent({}, definition);
    component.queryState = {
      ...component.queryState,
      id: definition.id,
      queryType: QueryType.DTQL,
      request: definition.request,
    };
    component.queryDef.set(definition);
    component.running.set(true);
    const abortController = new AbortController();
    (component as unknown as { authorRunAbort?: AbortController }).authorRunAbort =
      abortController;

    component.queryTextChanged(
      new CustomEvent('ionInput', {
        detail: { value: 'from Invoice as i limit 3' },
      }),
    );

    expect(abortController.signal.aborted).toBe(true);
    expect(component.running()).toBe(false);
    expect(component.authorDraftRevision()).toBe(1);
    expect(component.queryDef()?.request.text).toBe(
      'from Invoice as i limit 3',
    );
  });

  it('leaves the real shared editor on the source when lookup navigation is canceled', async () => {
    const source: IQueryDef = {
      id: 'q',
      connectionId: 'chinook-sqlite',
      request: {
        queryType: QueryType.DTQL,
        text: 'from Invoice as i join Customer as c on i.CustomerId = c.CustomerId',
      } as unknown as ITextQueryRequest,
    };
    const target: IQueryDef = {
      id: 'chinook-invoice-author',
      connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.DTQL, text: 'from Invoice as i' },
    };
    const privateProject = {
      ref: {
        storeId: 'github.com',
        projectId: 'repo@owner@folder',
        projectApi: 'cloud' as const,
        branch: 'work',
      },
    };
    const getRevision = vi.fn((_ref: unknown, id: string) =>
      of({
        query: toProjectQueryWire(id === source.id ? source : target),
        revision: `rev-${id}`,
        branchHead: 'head',
        saveSupported: false,
      }),
    );
    const queries = {
      authentication: () =>
        of({ status: 'authenticated', user: { uid: 'lookup-test-user' } }),
      authorityDenied: () => new Subject<typeof privateProject.ref>(),
      getRevision,
    };
    component = await createComponent(
      {},
      source,
      '<p></p>',
      { realEditor: true, queries, project: of(privateProject) },
    );
    component.project = privateProject;
    runFixture.detectChanges();
    await runFixture.whenStable();
    const editor = TestBed.inject(QueryEditorStateService);
    editor.openAuthorizedQuery(source.id, source);
    runFixture.detectChanges();
    await runFixture.whenStable();
    expect(editor.getQueryState(source.id)?.def?.id).toBe(source.id);
    expect(component.queryId).toBe(source.id);
    expect(component.queryDef()).toMatchObject(source);

    component.authorCustomerId.set('1');
    component.runResult.set({
      recordset: {
        columns: [{ name: 'CustomerId', type: 'integer' }],
        rows: [[{ type: 'integer', value: '1' }]],
      },
      publicSqliteReceipt: {
        executionId: 'source-run',
        draftRevision: 0,
        relationship: {
          id: 'FK_Invoice_Customer_CustomerId',
          version: '1',
          fromSource: 'i',
          toSource: 'c',
          joinType: 'inner',
          pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
        },
        outputColumns: [
          {
            name: 'CustomerId',
            type: 'integer',
            lineage: [{ source: 'i', field: 'CustomerId' }],
          },
        ],
        clientReportedBinding: {
          origin: 'manual',
          originEvidence: 'client-reported',
        },
      },
      bindingsApplied: [
        {
          parameterId: 'CustomerId',
          value: { type: 'integer', value: '1' },
          origin: 'manual',
          originEvidence: 'client-reported',
        },
      ],
    } as never);
    const openAuthorizedQuery = vi.spyOn(editor, 'openAuthorizedQuery');
    const router = TestBed.inject(Router);
    vi.mocked(router.navigate).mockResolvedValue(false);
    const internals = component as unknown as {
      currentQueryIdentity(): symbol;
      openAuthorCustomerLookup(
        columnIndex: number,
        columnName: string,
        rowIndex: number,
        executionId: string,
        customerId: string,
        identity: symbol,
      ): Promise<void>;
    };

    await internals.openAuthorCustomerLookup(
      0,
      'CustomerId',
      0,
      'source-run',
      '1',
      internals.currentQueryIdentity(),
    );

    expect(getRevision).toHaveBeenCalledWith(
      privateProject.ref,
      target.id,
    );
    const state = await firstValueFrom(editor.queryEditorState);
    expect(router.navigate).toHaveBeenCalledOnce();
    expect(openAuthorizedQuery).not.toHaveBeenCalled();
    expect(state.currentQueryId).toBe(source.id);
    expect(editor.getQueryState(source.id)?.authorBindings).toBeUndefined();
    expect(editor.getQueryState(target.id)).toBeUndefined();
    expect(component.queryId).toBe(source.id);
    expect(component.runResult()?.publicSqliteReceipt?.executionId).toBe(
      'source-run',
    );
  });

  it('marks a committed result previous when same-value selection provenance is changed to manual', async () => {
    component = await createComponent();
    component.authorCustomerId.set('1');
    component.authorDraftRevision.set(2);
    component.queryState = {
      ...component.queryState,
      authorBindings: { CustomerId: '1' },
      authorBindingProvenance: {
        CustomerId: {
          origin: 'selection',
          originEvidence: 'client-reported',
          sourceQueryId: 'chinook-customer-invoice-join',
          sourceColumn: 'CustomerId',
        },
      },
    };
    const result = {
      bindingsApplied: [
        {
          parameterId: 'CustomerId',
          value: { type: 'integer', value: '1' },
          origin: 'selection',
          originEvidence: 'client-reported',
        },
      ],
      publicSqliteReceipt: {
        draftRevision: 2,
        clientReportedBinding: {
          origin: 'selection',
          originEvidence: 'client-reported',
          sourceQueryId: 'chinook-customer-invoice-join',
          sourceColumn: 'CustomerId',
        },
      },
    };
    component.runResult.set(result as never);
    expect(component.publicSqliteRunIsStale(result as never)).toBe(false);
    const bindingRevision = component.authorBindingRevision();

    component.authorCustomerIdChanged(
      new CustomEvent('ionInput', { detail: { value: '1' } }),
    );

    expect(component.authorBindingRevision()).toBe(bindingRevision + 1);
    expect(component.authorCustomerIdOrigin()).toMatchObject({
      origin: 'manual',
      originEvidence: 'client-reported',
    });
    expect(component.publicSqliteRunIsStale(result as never)).toBe(true);
  });

  it('retains executed results when the authorized lookup read fails', async () => {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'chinook-customer-invoice-join',
      connectionId: 'chinook-sqlite',
      request: {
        queryType: QueryType.DTQL,
        text: 'from Invoice as i join Customer as c on i.CustomerId = c.CustomerId',
      } as unknown as ITextQueryRequest,
    };
    component = await createComponent({}, definition);
    component.project = {
      ref: {
        storeId: 'github.com',
        projectId: 'demo@buyer@project',
        projectApi: 'cloud',
        branch: 'main',
      },
    };
    component.queryState = {
      ...component.queryState,
      id: definition.id,
      queryType: QueryType.DTQL,
      request: definition.request,
      authorBindings: { CustomerId: '1' },
      authorBindingProvenance: {
        CustomerId: { origin: 'manual', originEvidence: 'client-reported' },
      },
    };
    component.queryDef.set(definition);
    component.authorCustomerId.set('1');
    const result = {
      recordset: {
        columns: [{ name: 'CustomerId', type: 'integer' }],
        rows: [[{ type: 'integer', value: '1' }]],
      },
      limitations: [],
      truncated: false,
      provenance: {
        source: 'fixture',
        queryId: definition.id,
        mode: 'live',
        observedAt: '2026-10-10T00:00:00Z',
        executionProfile: 'protected',
      },
      bindingsApplied: [
        {
          parameterId: 'CustomerId',
          value: { type: 'integer', value: '1' },
          origin: 'manual',
          originEvidence: 'client-reported',
        },
      ],
      publicSqliteReceipt: {
        executionId: 'join-run-1',
        draftRevision: 0,
        sql: 'SELECT 1',
        bindingNames: ['CustomerId'],
        sourceId: 'chinook-sqlite',
        fixtureSha256: 'fixture',
        schemaVersion: 'schema',
        relationship: {
          id: 'FK_Invoice_Customer_CustomerId',
          version: '1',
          fromSource: 'Invoice',
          toSource: 'Customer',
          joinType: 'inner',
          pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
        },
        outputColumns: [
          {
            name: 'CustomerId',
            type: 'integer',
            lineage: [{ source: 'Invoice', field: 'CustomerId' }],
          },
        ],
        clientReportedBinding: {
          origin: 'manual',
          originEvidence: 'client-reported',
        },
      },
    };
    component.runResult.set(result as never);
    const getRevision = vi.fn(() => throwError(() => new Error('read denied')));
    Object.assign(TestBed.inject(QueriesService), { getRevision });
    const editor = TestBed.inject(QueryEditorStateService);
    const openAuthorizedQuery = vi.spyOn(editor, 'openAuthorizedQuery');
    const focusAuthorLookupAfterRender = vi.spyOn(
      component as unknown as { focusAuthorLookupAfterRender(): void },
      'focusAuthorLookupAfterRender',
    );
    const internals = component as unknown as {
      currentQueryIdentity(): symbol;
      openAuthorCustomerLookup(
        columnIndex: number,
        columnName: string,
        rowIndex: number,
        executionId: string,
        customerId: string,
        identity: symbol,
      ): Promise<void>;
    };

    await internals.openAuthorCustomerLookup(
      0,
      'CustomerId',
      0,
      'join-run-1',
      '1',
      internals.currentQueryIdentity(),
    );

    expect(getRevision).toHaveBeenCalledOnce();
    expect(component.queryId).toBe(definition.id);
    expect(component.runResult()).toBe(result);
    expect(component.authorError()).toContain('lookup could not be opened');
    expect(openAuthorizedQuery).not.toHaveBeenCalled();
    expect(focusAuthorLookupAfterRender).not.toHaveBeenCalled();
  });

  async function createComponent(
    historyState: Record<string, unknown> = {},
    definition: IQueryDef = queryDef,
    template = '<ul aria-label="Access blockers">@for (blocker of accessBlockers(); track $index) {<li>{{ blocker }}</li>}</ul>',
    navigation?: {
      editor?: Observable<IQueryEditorState>;
      project: Observable<IProjectContext>;
      realEditor?: boolean;
      queries?: unknown;
    },
  ): Promise<QueryPageComponent> {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: historyState },
      writable: true,
      configurable: true,
    });
    runQueryMock = vi.fn();
    federatedRunMock = vi.fn();
    federatedGetPageMock = vi.fn();
    agentContext = agentContextStub();
    await TestBed.configureTestingModule({
      imports: [QueryPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: GitHubProjectActivityService,
          useValue: githubProjectActivityStub(),
        },
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
            currentProject: navigation?.project ?? of(project),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of(
              convertToParamMap(
                navigation?.realEditor
                  ? { id: 'q', projectApi: 'cloud', branch: 'work' }
                  : {},
              ),
            ),
            paramMap: of(
              convertToParamMap(
                navigation?.realEditor
                  ? { storeId: 'github.com', projectId: 'repo@owner@folder' }
                  : {},
              ),
            ),
            snapshot: {
              paramMap: convertToParamMap({}),
              queryParamMap: convertToParamMap(
                navigation?.realEditor
                  ? { id: 'q', projectApi: 'cloud', branch: 'work' }
                  : {},
              ),
              params: {},
            },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
            events: of(),
            currentNavigation: vi.fn(() => null),
            lastSuccessfulNavigation: vi.fn(() => null),
          },
        },
        {
          provide: QueryContextSqlService,
          useValue: { setSql: vi.fn(), setTarget: vi.fn() },
        },
        { provide: QueriesService, useValue: navigation?.queries ?? {} },
        { provide: ProjectService, useValue: { getFull: vi.fn() } },
        { provide: Coordinator, useValue: { execute: vi.fn() } },
        {
          provide: QueryEditorStateService,
          ...(navigation?.realEditor
            ? { useClass: QueryEditorStateService }
            : {
                useValue: {
                  queryEditorState:
                    navigation?.editor ??
                    of(
                      definition === queryDef
                        ? editorState
                        : {
                            ...editorState,
                            currentQueryId: definition.id,
                            activeQueries: [
                              {
                                id: definition.id,
                                queryType: QueryType.SQL,
                                request: definition.request,
                                def: definition,
                              },
                            ],
                          },
                    ),
                  updateQueryState: vi.fn(),
                  openQuery: vi.fn(),
                  openAuthorizedQuery: vi.fn(),
                  newQuery: vi.fn(),
                  getQueryState: vi.fn(),
                  saveQuery: vi.fn(),
                },
              }),
        },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn() } },
        { provide: SemanticApiService, useValue: { runQuery: runQueryMock } },
        {
          provide: FederatedQueryService,
          useValue: {
            run: federatedRunMock,
            getPage: federatedGetPageMock,
            dispose: vi.fn().mockResolvedValue(undefined),
            listLocalResults: vi.fn().mockResolvedValue([]),
            openLocalResult: vi.fn(),
            associateLocalResult: vi.fn().mockResolvedValue(undefined),
            deleteLocalResult: vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: AgentContextService, useValue: agentContext },
      ],
    })
      .overrideComponent(QueryPageComponent, {
        set: {
          imports: [
            NgTemplateOutlet,
            ...(template.includes('<sneat-query-workspace-layout')
              ? [QueryWorkspaceLayoutComponent]
              : []),
            ...(template.includes('<ion-select')
              ? [IonSelect, IonSelectOption]
              : []),
          ],
          template,
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
    factId: 'selection-customer-5',
  };

  async function createJoinedLookupScenario(
    template = '<p></p>',
  ): Promise<{
    definition: IQueryDef;
    lookupDefinition: IQueryDef;
    editor: QueryEditorStateService;
    router: Router;
    internals: {
      currentQueryIdentity(): symbol;
      openAuthorCustomerLookup(
        columnIndex: number,
        columnName: string,
        rowIndex: number,
        executionId: string,
        customerId: string,
        identity: symbol,
      ): Promise<void>;
      setQueryId(id?: string | null, isNew?: boolean): void;
      pendingAuthorLookupNavigation?: {
        routeObserved: boolean;
        observedNavigationId?: number;
        routeSuperseded: boolean;
      };
      syncScopeAndBindings(): void;
    };
  }> {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'chinook-customer-invoice-join',
      connectionId: 'chinook-sqlite',
      request: {
        queryType: QueryType.DTQL,
        text: 'from Invoice as i join Customer as c on i.CustomerId = c.CustomerId',
      } as unknown as ITextQueryRequest,
    };
    component = await createComponent({}, definition, template);
    component.project = {
      ref: { storeId: 'github.com', projectId: 'demo@buyer@project' },
    };
    component.queryState = {
      ...component.queryState,
      id: definition.id,
      queryType: QueryType.DTQL,
      request: definition.request,
      authorBindings: { CustomerId: '1' },
      authorBindingProvenance: {
        CustomerId: { origin: 'manual', originEvidence: 'client-reported' },
      },
    };
    component.queryDef.set(definition);
    component.authorCustomerId.set('1');
    component.runResult.set({
      recordset: {
        columns: [{ name: 'CustomerId', type: 'integer' }],
        rows: [[{ type: 'integer', value: '1' }]],
      },
      publicSqliteReceipt: {
        executionId: 'join-run-1',
        draftRevision: 0,
        relationship: {
          id: 'FK_Invoice_Customer_CustomerId',
          version: '1',
          fromSource: 'i',
          toSource: 'c',
          joinType: 'inner',
          pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
        },
        outputColumns: [
          {
            name: 'CustomerId',
            type: 'integer',
            lineage: [{ source: 'i', field: 'CustomerId' }],
          },
        ],
        clientReportedBinding: {
          origin: 'manual',
          originEvidence: 'client-reported',
        },
      },
      bindingsApplied: [
        {
          parameterId: 'CustomerId',
          value: { type: 'integer', value: '1' },
          origin: 'manual',
          originEvidence: 'client-reported',
        },
      ],
    } as never);

    const lookupDefinition: IQueryDef = {
      ...definition,
      id: 'chinook-invoice-author',
      request: { queryType: QueryType.DTQL, text: 'from Invoice as i' },
    };
    Object.assign(TestBed.inject(QueriesService), {
      getQuery: vi.fn(() => of(lookupDefinition)),
    });
    const editor = TestBed.inject(QueryEditorStateService);
    const router = TestBed.inject(Router);
    return {
      definition,
      lookupDefinition,
      editor,
      router,
      internals: component as unknown as {
        currentQueryIdentity(): symbol;
        openAuthorCustomerLookup(
          columnIndex: number,
          columnName: string,
          rowIndex: number,
          executionId: string,
          customerId: string,
          identity: symbol,
        ): Promise<void>;
        setQueryId(id?: string | null, isNew?: boolean): void;
        pendingAuthorLookupNavigation?: {
          routeObserved: boolean;
          observedNavigationId?: number;
          routeSuperseded: boolean;
        };
        syncScopeAndBindings(): void;
      },
    };
  }

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('clears the rendered private editor on same-UID read revocation instead of rendering cached content', async () => {
    const privateProject = {
      ref: {
        storeId: 'github.com',
        projectId: 'repo@owner@folder',
        projectApi: 'cloud' as const,
        branch: 'work',
      },
    };
    const read = new Subject<{
      query: ReturnType<typeof toProjectQueryWire>;
      revision: string;
      branchHead: string;
    }>();
    const denied = new Subject<typeof privateProject.ref>();
    const queries = {
      authentication: () =>
        of({ status: 'authenticated', user: { uid: 'same-actor' } }),
      authorityDenied: () => denied,
      getRevision: vi.fn(() => read),
    };
    component = await createComponent(
      {},
      queryDef,
      '<p>{{ queryState.title }}</p><pre>{{ queryState.request?.text }}</pre>',
      { realEditor: true, queries, project: of(privateProject) },
    );
    component.project = privateProject;
    const editor = TestBed.inject(QueryEditorStateService);
    editor.openQuery('q');
    read.next({
      query: {
        ...toProjectQueryWire(createHostedDemoDbQuery('q')),
        title: 'Private query',
        text: 'private body',
      },
      revision: 'rev',
      branchHead: 'head',
    });
    runFixture.detectChanges();
    await runFixture.whenStable();
    expect(runFixture.nativeElement.textContent).toContain('private body');
    expect(runFixture.nativeElement.textContent).toContain('Private query');
    component.historicalDefinition.set(queryDef);
    editor.openQuery('q');
    await runFixture.whenStable();
    expect(component.historicalDefinition()).toBeUndefined();
    expect(runFixture.nativeElement.textContent).not.toContain('private body');
    read.error({ status: 403 });
    await runFixture.whenStable();
    expect(runFixture.nativeElement.textContent).not.toContain('Private query');
    expect(runFixture.nativeElement.textContent).not.toContain('private body');
    expect(component.queryDef()).toBeUndefined();
  });

  it.each(['running', 'saving', 'unsupported'])(
    'disables the actual hosted picker while %s',
    async (state) => {
      const definition = createHostedDemoDbQuery('q');
      component = await createComponent(
        {},
        definition,
        '<ion-select [disabled]="running() || queryState.isSaving || queryState.saveSupported === false" />',
      );
      // Read the actual production picker expression, so a duplicate binding cannot mask one guard.
      const html = readFileSync(
        resolve(
          'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
        ),
        'utf8',
      );
      const picker = html.match(
        /<ion-select\b[^>]*aria-label="Hosted DemoDB database and table"[^>]*>[\s\S]*?<\/ion-select>/,
      )?.[0];
      expect(picker?.match(/\[disabled\]/g)).toHaveLength(1);
      expect(picker).toMatch(
        /\[disabled\]="\s*running\(\)\s*\|\|\s*queryState\.isSaving\s*\|\|\s*queryState\.saveSupported\s*===\s*false\s*"/,
      );
      component.running.set(state === 'running');
      component.queryState = {
        ...component.queryState,
        isSaving: state === 'saving',
        saveSupported: state !== 'unsupported',
      };
      runFixture.detectChanges();
      await runFixture.whenStable();
      expect(
        runFixture.nativeElement.querySelector('ion-select').disabled,
      ).toBeTruthy();
    },
  );

  it.each(['chinook.Customer', 'adventureworks.Person.Person'])(
    'runs a saved/cold-read %s query with no local CLI or environment',
    async (source) => {
      const definition = fromProjectQueryWire(
        toProjectQueryWire(
          withHostedDemoDbSource(createHostedDemoDbQuery('new-q'), source),
        ),
      );
      component = await createComponent({}, definition);
      component.project = {
        ref: {
          storeId: 'github.com',
          projectId: 'user-repo@user@datatug',
          projectApi: 'cloud',
          branch: 'work',
        },
      };
      component.envId = undefined;
      federatedRunMock.mockResolvedValue(historyResultFor(definition));
      component.runQuery();
      await runFixture.whenStable();
      expect(federatedRunMock.mock.calls[0][0]).toEqual(definition);
      expect(definition.federation?.ovdbBaseUrl).toBe(
        'https://demodb.dev/ovdb',
      );
      expect(definition.federation?.tables[0].name).toBe(
        source === 'chinook.Customer' ? 'Customer' : 'Person.Person',
      );
      expect(runQueryMock).not.toHaveBeenCalled();
      expect(TestBed.inject(Coordinator).execute).not.toHaveBeenCalled();
      expect(component.runError()).toBeUndefined();
    },
  );

  it('maps the current result page to safe AG Grid columns and preserves exact typed values', async () => {
    component = await createComponent();
    component.runResult.set({
      ...historyResultFor(queryDef),
      recordset: {
        columns: [
          { name: 'customer.id', type: 'decimal' },
          { name: 'customer.id', type: 'integer' },
          { name: 'payload.data', type: 'string' },
        ],
        rows: [
          [
            { type: 'decimal', value: '9007199254740993.0000000000000001' },
            { type: 'integer', value: '900719925474099312345' },
            { type: 'string', value: '{"nested.value":1}' },
          ],
          [
            { type: 'decimal', value: '2.50' },
            { type: 'integer', value: '2' },
            { type: 'string', value: '{"nested.value":2}' },
          ],
        ],
      },
      totalRows: undefined,
    });
    const columns = component.resultGridColumnDefs();
    expect(
      columns.map(({ colId, field, headerName }) => ({
        colId,
        field,
        headerName,
      })),
    ).toEqual([
      { colId: 'result_0', field: 'result_0', headerName: 'customer.id' },
      { colId: 'result_1', field: 'result_1', headerName: 'customer.id' },
      { colId: 'result_2', field: 'result_2', headerName: 'payload.data' },
    ]);
    expect(component.resultGridRows()).toEqual([
      {
        result_0: '9007199254740993.0000000000000001',
        result_1: '900719925474099312345',
        result_2: '{"nested.value":1}',
      },
      { result_0: '2.50', result_1: '2', result_2: '{"nested.value":2}' },
    ]);
    component.resultPageIndex.set(1);
    expect(component.resultGridColumnDefs()).toBe(columns);
    expect(component.resultGridRows()).toEqual([]);

    const template = readFileSync(
      resolve(
        'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
      ),
      'utf8',
    );
    expect(template).toContain('[columnDefs]="resultGridColumnDefs()"');
    expect(template).toContain('[rowData]="resultGridRows()"');
    expect(template).toContain(
      '[overlayNoRowsTemplate]="resultGridNoRowsTemplate"',
    );
    expect(template).not.toContain('<table');
  });

  it('keeps accepted plan review state across no-op editor emissions and resets it for a definition edit', async () => {
    const definition: IQueryDef = {
      ...historyDefinition(),
      request: {
        queryType: QueryType.DTQL,
        text: 'from:\n  name: Person\n  alias: p\n',
      } as unknown as ITextQueryRequest,
    };
    const editor = new BehaviorSubject(historyStateFor(definition));
    component = await createComponent({}, definition, '<p></p>', {
      editor,
      project: of(project),
    });
    component.publicDataRevisionAcknowledged.set(true);
    component.savedPlanReview.acknowledged.set('accepted-fingerprint');

    editor.next({
      ...editor.value,
      activeQueries: editor.value.activeQueries.map((query) => ({
        ...query,
        isSaving: true,
      })),
    });
    await runFixture.whenStable();
    expect(component.publicDataRevisionAcknowledged()).toBe(true);
    expect(component.savedPlanReview.acknowledged()).toBe(
      'accepted-fingerprint',
    );

    const edited = editor.value.activeQueries[0];
    editor.next({
      ...editor.value,
      activeQueries: [
        {
          ...edited,
          request: {
            queryType: QueryType.DTQL,
            text: 'from:\n  name: Person\n  alias: p\nlimit: 5\n',
          } as unknown as ITextQueryRequest,
        },
      ],
    });
    await runFixture.whenStable();
    expect(component.publicDataRevisionAcknowledged()).toBe(false);
    expect(component.savedPlanReview.acknowledged()).toBeUndefined();
  });

  it('opens saved history and pages all three grids locally with original pins and timestamp, no run or metadata fetch', async () => {
    const definition = {
      ...queryDef,
      federation: {
        ovdbBaseUrl: 'https://runtime.example',
        tables: [],
        nativeGraph: graphFixturePlan(),
      },
    };
    const template =
      '<p>{{ selectedHistoricalResult() ? "Historical local result" : "idle" }}</p><p>{{ runResult()?.provenance?.observedAt }}</p><pre>{{ historicalPins() }}</pre><span>{{ relatedResultSet() }} {{ resultTotalRows() }}</span>@for (row of visibleResultRows(); track $index) {<span>{{ displayValue(row[0]) }}</span>}';
    component = await createComponent({}, definition, template);
    runFixture.detectChanges();
    const service = TestBed.inject(FederatedQueryService);
    const ref = { id: 'datatug-output-100000-abc', generation: 1 };
    const historical = {
      localResult: ref,
      recordset: {
        columns: [{ name: 'Affiliation', type: 'string' }],
        rows: [{ type: 'string', value: 'original-affiliation' }].map(
          (cell) => [cell],
        ),
      },
      totalRows: 150,
      relatedRecordsets: [
        {
          id: 'locations',
          label: 'Locations',
          totalRows: 135,
          recordset: {
            columns: [{ name: 'Location', type: 'string' }],
            rows: [[{ type: 'string', value: 'original-location' }]],
          },
        },
        {
          id: 'aliases',
          label: 'Alternate names',
          totalRows: 115,
          recordset: {
            columns: [{ name: 'Alias', type: 'string' }],
            rows: [[{ type: 'string', value: 'original-alias' }]],
          },
        },
      ],
      limitations: [],
      bindingsApplied: [],
      truncated: false,
      provenance: {
        observedAt: '2026-10-01T09:30:00Z',
        source: 'fixture',
        queryId: definition.id,
        mode: 'live',
        executionProfile: 'protected',
      },
    };
    vi.mocked(service.openLocalResult).mockResolvedValue({
      result: historical,
      executedDefinition: definition,
      descriptor: { ...ref } as LocalResultDescriptor,
    } as Awaited<ReturnType<typeof service.openLocalResult>>);
    const metadata = TestBed.inject(PublicDataService);
    const loadMetadata = vi.spyOn(metadata, 'revalidate');
    await component.openHistoricalResult(ref.id);
    await runFixture.whenStable();
    expect(runFixture.nativeElement.textContent).toContain(
      'Historical local result',
    );
    expect(runFixture.nativeElement.textContent).toContain(
      '2026-10-01T09:30:00Z',
    );
    expect(runFixture.nativeElement.textContent).toContain(
      'original-affiliation',
    );
    expect(component.historicalDefinition()).toEqual(definition);
    await component.changeRelatedResultSet('locations');
    await runFixture.whenStable();
    expect(component.resultTotalRows()).toBe(135);
    expect(runFixture.nativeElement.textContent).toContain('original-location');
    await component.changeRelatedResultSet('aliases');
    await runFixture.whenStable();
    expect(component.resultTotalRows()).toBe(115);
    expect(runFixture.nativeElement.textContent).toContain('original-alias');
    federatedGetPageMock.mockResolvedValue([
      [{ type: 'string', value: 'alias-page-2' }],
    ]);
    await component.changeResultPage(1);
    await runFixture.whenStable();
    expect(federatedGetPageMock).toHaveBeenCalledWith(1, 'aliases', ref);
    expect(runFixture.nativeElement.textContent).toContain('alias-page-2');
    expect(federatedRunMock).not.toHaveBeenCalled();
    expect(runQueryMock).not.toHaveBeenCalled();
    expect(loadMetadata).not.toHaveBeenCalled();
  });

  it('shows unavailable local history and discards a delayed old page after choosing a different historical artifact', async () => {
    component = await createComponent();
    const service = TestBed.inject(FederatedQueryService);
    vi.mocked(service.openLocalResult).mockRejectedValue(
      new Error('No local result available.'),
    );
    await component.openHistoricalResult('missing');
    expect(component.localHistoryError()).toContain('No local result');
    expect(federatedRunMock).not.toHaveBeenCalled();
    const result = {
      localResult: { id: 'old', generation: 1 },
      recordset: { columns: [], rows: [] },
      totalRows: 150,
      limitations: [],
      bindingsApplied: [],
      provenance: { observedAt: 'old', queryId: 'old', source: 'fixture' },
    };
    component.runResult.set(result as never);
    component.selectedHistoricalResult.set(result.localResult);
    let release!: (rows: unknown) => void;
    federatedGetPageMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = component.changeResultPage(1);
    const next = {
      ...result,
      localResult: { id: 'new', generation: 1 },
      recordset: {
        columns: [],
        rows: [[{ type: 'string', value: 'new-row' }]],
      },
    };
    vi.mocked(service.openLocalResult).mockResolvedValue({
      result: next,
      executedDefinition: queryDef,
      descriptor: {} as LocalResultDescriptor,
    } as Awaited<ReturnType<typeof service.openLocalResult>>);
    await component.openHistoricalResult('new');
    release([[{ type: 'string', value: 'stale-row' }]]);
    await pending;
    expect(component.visibleResultRows()).toEqual(next.recordset.rows);
    expect(component.resultPageIndex()).toBe(0);
  });

  const historyDefinition = (): IQueryDef => ({
    ...queryDef,
    federation: {
      ovdbBaseUrl: 'https://runtime.example',
      tables: [],
      nativeGraph: graphFixturePlan(),
    },
  });
  const historyStateFor = (definition: IQueryDef): IQueryEditorState =>
    ({
      currentQueryId: definition.id,
      activeQueries: [
        {
          id: definition.id,
          queryType: QueryType.DTQL,
          request: definition.request,
          def: definition,
        },
      ],
    }) as IQueryEditorState;
  const historyResultFor = (
    definition: IQueryDef,
    id = 'datatug-output-100000-abc',
  ) =>
    ({
      localResult: { id, generation: 1 },
      nativeGraph: {
        planIdentity: graphStableIdentity(definition.federation?.nativeGraph),
        stageActions: [],
      },
      recordset: {
        columns: [{ name: 'Affiliation', type: 'string' }],
        rows: [[{ type: 'string', value: 'original-row' }]],
      },
      totalRows: 150,
      limitations: [],
      bindingsApplied: [],
      truncated: false,
      provenance: {
        observedAt: '2026-10-01T09:30:00Z',
        queryId: definition.id,
        source: 'synthetic',
        mode: 'live',
        executionProfile: 'protected',
      },
    }) as Awaited<ReturnType<FederatedQueryService['run']>>;
  const historyResultTemplate = (): string =>
    readFileSync(
      resolve(
        'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
      ),
      'utf8',
    )
      .split('  @if (runResult(); as result) {')[1]
      .split('  </ng-template>')[0]
      .replace(/^/, '@if (runResult(); as result) {');

  it('retains a frozen successful receipt across a failed and partial rerun, then clears it on scope change', async () => {
    const definition = historyDefinition();
    const editor = new BehaviorSubject(historyStateFor(definition));
    const projects = new BehaviorSubject(project);
    const template = readFileSync(
      resolve(
        'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
      ),
      'utf8',
    );
    component = await createComponent({}, definition, template, {
      editor,
      project: projects,
    });
    let now = 10;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    let finishInitial!: (
      result: Awaited<ReturnType<FederatedQueryService['run']>>,
    ) => void;
    let failRerun!: (error: Error) => void;
    let finishLate!: (
      result: Awaited<ReturnType<FederatedQueryService['run']>>,
    ) => void;
    federatedRunMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishInitial = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failRerun = reject;
          }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          ...historyResultFor(definition, 'partial-output'),
          hasMore: true,
          provenance: {
            ...historyResultFor(definition).provenance,
            observedAt: '2026-10-10T10:00:00Z',
            source: 'partial attempt',
          },
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLate = resolve;
          }),
      );

    component.runQuery();
    const firstRunOptions = federatedRunMock.mock.calls[0][5] as {
      onFirstRecord?: (at: number) => void;
    };
    now = 20;
    firstRunOptions.onFirstRecord?.(performance.timeOrigin + now);
    now = 42;
    const firstResult = historyResultFor(definition);
    finishInitial(firstResult);
    await runFixture.whenStable();

    const receipt = component.committedRun();
    expect(receipt?.timing).toEqual({
      firstRecordMs: 10,
      allResultsLoadedMs: 32,
      noRecords: false,
    });
    expect(receipt?.result).not.toBe(firstResult);
    expect(Object.isFrozen(receipt?.result)).toBe(true);

    component.runQuery();
    failRerun(new Error('The next run failed.'));
    await runFixture.whenStable();
    expect(component.runResult()).toBe(firstResult);
    expect(component.committedRun()).toBe(receipt);
    expect(runFixture.nativeElement.textContent.replace(/\s+/g, ' ')).toContain(
      'Previous successful run · query customer-invoices',
    );
    expect(
      runFixture.nativeElement
        .querySelector('[data-testid="query-run-timings"]')
        ?.textContent.replace(/\s+/g, ' '),
    ).toContain('Time to first record: 10 ms · All results loaded in 32 ms');
    expect(runFixture.nativeElement.textContent).toContain(
      'The next run failed.',
    );

    component.runQuery();
    await runFixture.whenStable();
    expect(component.runResult()?.hasMore).toBe(true);
    expect(component.committedRun()).toBe(receipt);
    expect(
      runFixture.nativeElement
        .querySelector('[data-testid="previous-committed-result"]')
        ?.textContent.replace(/\s+/g, ' '),
    ).toContain('synthetic · observed 2026-10-01T09:30:00Z');
    expect(
      runFixture.nativeElement
        .querySelector('[data-testid="previous-run-timings"]')
        ?.textContent.replace(/\s+/g, ' '),
    ).toContain('Time to first record: 10 ms · All results loaded in 32 ms');
    expect(
      runFixture.nativeElement.querySelector(
        '[data-testid="previous-committed-result"]',
      )?.textContent,
    ).toContain('original-row');
    expect(
      runFixture.nativeElement.querySelector(
        '[data-testid="result-provenance"]',
      )?.textContent,
    ).toContain('partial attempt');

    component.runQuery();
    agentContext.securityContextId.set('sctx-2');
    await runFixture.whenStable();
    expect(component.committedRun()).toBeUndefined();
    expect(component.runResult()).toBeUndefined();
    expect(component.resultGridRows()).toEqual([]);
    finishLate(firstResult);
    await runFixture.whenStable();
    expect(component.committedRun()).toBeUndefined();
    expect(component.runResult()).toBeUndefined();
    expect(component.resultGridRows()).toEqual([]);
    clock.mockRestore();
  });

  it('applies a late federated row count only to the still-current completed receipt', async () => {
    const definition = historyDefinition();
    component = await createComponent({}, definition, historyResultTemplate());
    federatedRunMock.mockResolvedValue(historyResultFor(definition));

    component.runQuery();
    await runFixture.whenStable();
    const originalReceipt = component.committedRun();
    const onFinished = federatedRunMock.mock.calls.at(-1)?.[4] as
      | ((totalRows: number) => void)
      | undefined;
    expect(originalReceipt?.result.totalRows).toBe(150);
    expect(onFinished).toBeTypeOf('function');

    onFinished?.(173);
    await runFixture.whenStable();

    const updatedReceipt = component.committedRun();
    expect(component.runResult()?.totalRows).toBe(173);
    expect(updatedReceipt?.result.totalRows).toBe(173);
    expect(updatedReceipt).not.toBe(originalReceipt);
    expect(originalReceipt?.result.totalRows).toBe(150);
    expect(Object.isFrozen(updatedReceipt?.result)).toBe(true);
  });

  it('keeps the last receipt labeled with its executed query when the selected query body changes', async () => {
    const definition = historyDefinition();
    const editor = new BehaviorSubject(historyStateFor(definition));
    component = await createComponent(
      {},
      definition,
      readFileSync(
        resolve(
          'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
        ),
        'utf8',
      ),
      { editor, project: new BehaviorSubject(project) },
    );
    const result = historyResultFor(definition);
    federatedRunMock.mockResolvedValue(result);

    component.runQuery();
    await runFixture.whenStable();
    const receipt = component.committedRun();
    expect(receipt?.executedDefinition.request).toEqual(definition.request);

    const editedDefinition = {
      ...definition,
      request: { ...definition.request, text: 'select * from changed_source' },
    };
    editor.next(historyStateFor(editedDefinition));
    await runFixture.whenStable();

    expect(component.committedRun()).toBe(receipt);
    expect(component.committedRun()?.executedDefinition.request).toEqual(
      definition.request,
    );
    expect(component.runResult()).toBe(result);
    expect(
      runFixture.nativeElement.querySelector(
        '[data-testid="previous-committed-result"]',
      ),
    ).not.toBeNull();
    expect(runFixture.nativeElement.textContent).toContain(
      'Previous successful run',
    );
  });

  it('clears and fences federated output when the in-memory bearer token changes or clears', async () => {
    const definition = historyDefinition();
    const template = readFileSync(
      resolve(
        'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
      ),
      'utf8',
    );
    component = await createComponent({}, definition, template);
    const setToken = (value: string): void => component['setOvdbToken'](value);
    setToken('first-secret-token');

    let finishInitial!: (
      result: Awaited<ReturnType<FederatedQueryService['run']>>,
    ) => void;
    let finishAfterReplacement!: (
      result: Awaited<ReturnType<FederatedQueryService['run']>>,
    ) => void;
    let finishAfterClear!: (
      result: Awaited<ReturnType<FederatedQueryService['run']>>,
    ) => void;
    federatedRunMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishInitial = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishAfterReplacement = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishAfterClear = resolve;
          }),
      );

    component.runQuery();
    expect(federatedRunMock.mock.calls.at(-1)?.[2]).toBe('first-secret-token');
    finishInitial(historyResultFor(definition));
    await runFixture.whenStable();
    const receipt = component.committedRun();
    expect(receipt).toBeDefined();
    expect(JSON.stringify(receipt)).not.toContain('first-secret-token');

    component.runQuery();
    setToken('replacement-secret-token');
    await runFixture.whenStable();
    expect(component.runResult()).toBeUndefined();
    expect(component.committedRun()).toBeUndefined();
    finishAfterReplacement(
      historyResultFor(definition, 'late-after-replacement'),
    );
    await runFixture.whenStable();
    expect(component.runResult()).toBeUndefined();
    expect(component.committedRun()).toBeUndefined();

    component.runQuery();
    expect(federatedRunMock.mock.calls.at(-1)?.[2]).toBe(
      'replacement-secret-token',
    );
    setToken('');
    await runFixture.whenStable();
    expect(component.runResult()).toBeUndefined();
    expect(component.committedRun()).toBeUndefined();
    finishAfterClear(historyResultFor(definition, 'late-after-clear'));
    await runFixture.whenStable();
    expect(component.runResult()).toBeUndefined();
    expect(component.committedRun()).toBeUndefined();
  });

  it('freezes an accurate target label and shows only executed text and native graph pins', async () => {
    const definition: IQueryDef = {
      ...historyDefinition(),
      request: {
        queryType: QueryType.DTQL,
        text: 'from:\n  name: Person\n  alias: p\nlimit: 5',
      } as unknown as ITextQueryRequest,
    };
    const editor = new BehaviorSubject(historyStateFor(definition));
    component = await createComponent(
      {},
      definition,
      readFileSync(
        resolve(
          'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
        ),
        'utf8',
      ),
      { editor, project: new BehaviorSubject(project) },
    );
    federatedRunMock.mockResolvedValue(historyResultFor(definition));

    component.runQuery();
    await runFixture.whenStable();
    expect(component.committedRun()?.scope.target).toBe(
      'OVDB at https://runtime.example',
    );

    editor.next(
      historyStateFor({
        ...definition,
        request: {
          ...definition.request,
          text: 'from: changed',
        } as ITextQueryRequest,
      }),
    );
    await runFixture.whenStable();

    const previous = runFixture.nativeElement.querySelector(
      '[data-testid="previous-committed-result"]',
    ) as HTMLElement;
    expect(previous.textContent).toContain('OVDB at https://runtime.example');
    expect(previous.textContent).toContain('from:');
    expect(previous.textContent).toContain('Executed plan and pins');
    expect(previous.textContent).not.toContain('ovdbBaseUrl');
    expect(previous.textContent).not.toContain('expectedSourceRights');
    expect(previous.textContent).not.toContain('runtime.example/ovdb');
  });

  it('omits HTTP URL and request body from a retained executed-request inspector', async () => {
    const definition: IQueryDef = {
      ...queryDef,
      request: {
        queryType: QueryType.HTTP,
        method: 'GET',
        url: 'https://user:credential@example.test/private?token=url-secret',
        body: 'request-body-secret',
      } as IQueryDef['request'],
    };
    const editor = new BehaviorSubject(historyStateFor(definition));
    const template = readFileSync(
      resolve(
        'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
      ),
      'utf8',
    );
    component = await createComponent({}, definition, template, {
      editor,
      project: new BehaviorSubject(project),
    });
    component.availableTargets.set([
      { source: 'opaque-source-17', label: 'Exchange rates (HTTP)' },
    ]);
    component.selectedSource.set('opaque-source-17');
    component.queryState = {
      ...component.queryState,
      activeEnv: { id: 'production', title: 'Production' },
    };
    const response: RunQueryResponse = {
      recordset: { columns: [], rows: [] },
      limitations: [],
      bindingsApplied: [
        {
          parameterId: 'AccessToken',
          value: { type: 'string', value: 'runtime-binding-secret' },
          origin: 'manual',
          originEvidence: 'client-reported',
        },
      ],
      truncated: false,
      provenance: {
        source: 'fixture',
        queryId: definition.id,
        mode: 'live',
        observedAt: '2026-10-10T11:00:00Z',
        executionProfile: 'protected',
      },
    };
    runQueryMock.mockReturnValueOnce(of(response));

    component.runQuery();
    await runFixture.whenStable();
    expect(component.committedRun()?.scope.target).toBe(
      'Exchange rates (HTTP)',
    );
    expect(component.committedRun()?.scope.environment).toBe(
      'Environment Production',
    );
    const receipt = component.committedRun();
    expect(receipt?.executedDefinition.request).toEqual({
      queryType: QueryType.HTTP,
      method: 'GET',
    });
    expect(typeof receipt?.queryIdentity).toBe('symbol');
    expect(receipt?.result.bindingsApplied).toEqual([
      {
        parameterId: 'AccessToken',
        type: 'string',
        set: true,
        origin: 'manual',
        originEvidence: 'client-reported',
      },
    ]);
    const serializedReceipt = JSON.stringify(receipt);
    for (const secret of [
      'credential',
      'url-secret',
      'request-body-secret',
      'runtime-binding-secret',
      'example.test',
    ]) {
      expect(serializedReceipt).not.toContain(secret);
    }
    editor.next(
      historyStateFor({
        ...definition,
        request: {
          ...definition.request,
          body: 'new-body',
        } as IQueryDef['request'],
      }),
    );
    await runFixture.whenStable();

    const previous = runFixture.nativeElement.querySelector(
      '[data-testid="previous-committed-result"]',
    ) as HTMLElement;
    expect(previous.textContent).toContain(
      'GET request. URL and request body are omitted',
    );
    expect(previous.textContent).toContain('Exchange rates (HTTP)');
    expect(previous.textContent).not.toContain('opaque-source-17');
    expect(previous.textContent).not.toContain('url-secret');
    expect(previous.textContent).not.toContain('request-body-secret');
    expect(previous.textContent).not.toContain('example.test');
  });

  it('clears retained results after an authorization denial while ordinary failures retain them', async () => {
    const template = readFileSync(
      resolve(
        'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
      ),
      'utf8',
    );
    component = await createComponent({}, queryDef, template);
    const response: RunQueryResponse = {
      recordset: {
        columns: [{ name: 'n', type: 'integer' }],
        rows: [[{ type: 'integer', value: '1' }]],
      },
      limitations: [],
      bindingsApplied: [],
      truncated: false,
      provenance: {
        source: 'fixture',
        queryId: queryDef.id,
        mode: 'live',
        observedAt: '2026-10-10T11:00:00Z',
        executionProfile: 'protected',
      },
    };
    runQueryMock.mockReturnValueOnce(of(response));
    component.runQuery();
    await runFixture.whenStable();
    expect(component.committedRun()).toBeDefined();

    runQueryMock.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 403,
            error: {
              error: {
                code: 'ACCESS_DENIED',
                message: 'Access denied',
                requestId: 'r-denied',
              },
            },
          }),
      ),
    );
    component.runQuery();
    await runFixture.whenStable();

    expect(component.runError()).toBe('Access denied');
    expect(component.committedRun()).toBeUndefined();
    expect(component.runResult()).toBeUndefined();
    expect(component.resultGridRows()).toEqual([]);
  });

  it('clears a retained OVDB result when the next federated attempt is denied', async () => {
    const definition = historyDefinition();
    component = await createComponent({}, definition, historyResultTemplate());
    federatedRunMock.mockResolvedValueOnce(historyResultFor(definition));
    component.runQuery();
    await runFixture.whenStable();
    expect(component.committedRun()).toBeDefined();

    federatedRunMock.mockRejectedValueOnce(
      new Error('OVDB database whole-query execution failed (403).'),
    );
    component.runQuery();
    await runFixture.whenStable();

    expect(component.runError()).toContain('(403)');
    expect(component.runResult()).toBeUndefined();
    expect(component.committedRun()).toBeUndefined();
    expect(component.resultGridRows()).toEqual([]);
  });

  it('reports first decoded record and clean full-result completion from the same monotonic run start', async () => {
    const definition = historyDefinition();
    component = await createComponent({}, definition, historyResultTemplate());
    let now = 10;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    let complete!: (
      result: Awaited<ReturnType<FederatedQueryService['run']>>,
    ) => void;
    federatedRunMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );

    component.runQuery();
    const extras = federatedRunMock.mock.calls[0][5] as {
      onFirstRecord?: (at: number) => void;
    };
    now = 20;
    extras.onFirstRecord?.(performance.timeOrigin + now);
    now = 42;
    complete(historyResultFor(definition));
    await runFixture.whenStable();

    expect(component.queryRunTiming()).toEqual({
      firstRecordMs: 10,
      allResultsLoadedMs: 32,
      noRecords: false,
    });
    expect(
      runFixture.nativeElement.textContent.replace(/\s+/g, ' ').trim(),
    ).toContain('Time to first record: 10 ms · All results loaded in 32 ms');
    clock.mockRestore();
  });

  it('shows no first-record duration for an empty successful result', async () => {
    const definition = historyDefinition();
    component = await createComponent({}, definition, historyResultTemplate());
    let now = 5;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    let complete!: (
      result: Awaited<ReturnType<FederatedQueryService['run']>>,
    ) => void;
    federatedRunMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );

    component.runQuery();
    now = 24;
    complete({
      ...historyResultFor(definition),
      totalRows: 0,
      recordset: { columns: [], rows: [] },
    });
    await runFixture.whenStable();

    expect(component.queryRunTiming()).toEqual({
      allResultsLoadedMs: 19,
      noRecords: true,
    });
    expect(
      runFixture.nativeElement.textContent.replace(/\s+/g, ' ').trim(),
    ).toContain(
      'Time to first record: No records · All results loaded in 19 ms',
    );
    clock.mockRestore();
  });

  it('clears first-record timing when the run fails after decoding a row', async () => {
    const definition = historyDefinition();
    component = await createComponent({}, definition, historyResultTemplate());
    let now = 5;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    let fail!: (error: Error) => void;
    federatedRunMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );

    component.runQuery();
    const extras = federatedRunMock.mock.calls[0][5] as {
      onFirstRecord?: (at: number) => void;
    };
    now = 12;
    extras.onFirstRecord?.(performance.timeOrigin + now);
    fail(new Error('The final result footer was invalid.'));
    await runFixture.whenStable();

    expect(component.queryRunTiming()).toBeUndefined();
    expect(
      runFixture.nativeElement.querySelector(
        '[data-testid="query-run-timings"]',
      ),
    ).toBeNull();
    expect(component.runError()).toContain('final result footer');
    clock.mockRestore();
  });

  it('does not call a visible first page all results loaded', async () => {
    const definition = historyDefinition();
    component = await createComponent({}, definition, historyResultTemplate());
    component.federatedMode.set('visible');
    federatedRunMock.mockResolvedValue(historyResultFor(definition));

    component.runQuery();
    await runFixture.whenStable();

    expect(component.queryRunTiming()).toBeUndefined();
    expect(
      runFixture.nativeElement.querySelector(
        '[data-testid="query-run-timings"]',
      ),
    ).toBeNull();
  });

  it.each([
    { hasMore: true },
    { truncated: true },
    {
      runtimeRead: {
        pins: {},
        pages: {
          'db.items': {
            limit: 10,
            offset: 0,
            rows: 10,
            complete: false,
            possiblyMore: true,
          },
        },
      },
    },
  ])(
    'withholds full-result timing when the result is incomplete: %j',
    async (incomplete) => {
      const definition = historyDefinition();
      component = await createComponent(
        {},
        definition,
        historyResultTemplate(),
      );
      federatedRunMock.mockResolvedValue({
        ...historyResultFor(definition),
        ...incomplete,
      });

      component.runQuery();
      await runFixture.whenStable();

      expect(component.queryRunTiming()).toBeUndefined();
      expect(
        runFixture.nativeElement.querySelector(
          '[data-testid="query-run-timings"]',
        ),
      ).toBeNull();
    },
  );

  it('discards first-record timing and completion when the user leaves during the run', async () => {
    const definition = historyDefinition();
    component = await createComponent({}, definition, historyResultTemplate());
    let now = 5;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    let finish!: (
      result: Awaited<ReturnType<FederatedQueryService['run']>>,
    ) => void;
    federatedRunMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    component.runQuery();
    const extras = federatedRunMock.mock.calls[0][5] as {
      onFirstRecord?: (at: number) => void;
    };
    now = 12;
    extras.onFirstRecord?.(performance.timeOrigin + now);
    component.ngOnDestroy();
    now = 20;
    finish(historyResultFor(definition));
    await runFixture.whenStable();

    expect(component.queryRunTiming()).toBeUndefined();
    expect(component.runResult()).toBeUndefined();
    clock.mockRestore();
  });

  it('ignores an old first-record event after a replacement run starts', async () => {
    const definition = historyDefinition();
    const editor = new BehaviorSubject(historyStateFor(definition));
    component = await createComponent({}, definition, historyResultTemplate(), {
      editor,
      project: of(project),
    });
    let now = 10;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    let finishOld!: (
      result: Awaited<ReturnType<FederatedQueryService['run']>>,
    ) => void;
    let finishNew!: (
      result: Awaited<ReturnType<FederatedQueryService['run']>>,
    ) => void;
    federatedRunMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishNew = resolve;
          }),
      );

    component.runQuery();
    const oldExtras = federatedRunMock.mock.calls[0][5] as {
      onFirstRecord?: (at: number) => void;
    };
    Object.assign(definition.federation?.nativeGraph ?? {}, { aliases: false });
    editor.next(historyStateFor(definition));
    now = 20;
    component.runQuery();
    const newExtras = federatedRunMock.mock.calls[1][5] as {
      onFirstRecord?: (at: number) => void;
    };
    oldExtras.onFirstRecord?.(performance.timeOrigin + 15);
    newExtras.onFirstRecord?.(performance.timeOrigin + 27);
    now = 35;
    finishNew(historyResultFor(definition));
    await runFixture.whenStable();
    finishOld(historyResultFor(definition));
    await Promise.resolve();

    expect(component.queryRunTiming()).toEqual({
      firstRecordMs: 7,
      allResultsLoadedMs: 15,
      noRecords: false,
    });
    clock.mockRestore();
  });

  it('renders exact plain P1 evidence from actual IndexedDB reopening in the original grid and preserves all three sets', async () => {
    const definition = historyDefinition();
    component = await createComponent({}, definition, historyResultTemplate());
    const tokens = [
      '-0',
      '1e400',
      '-1e400',
      '0e400',
      '1.0000000000000001',
      '9007199254740990.5',
      '{"nested":[-0,1e3,9007199254740993]}',
    ];
    const result = {
      ...historyResultFor(definition),
      relatedRecordsets: [
        {
          id: 'locations',
          label: 'Locations',
          parentSet: 'affiliations',
          parentField: 'Affiliation',
          totalRows: tokens.length,
          recordset: {
            columns: [{ name: 'Exact reference evidence', type: 'string' }],
            rows: tokens.map((token) => [
              { type: 'string' as const, value: token },
            ]),
          },
        },
        {
          id: 'aliases',
          label: 'Alternate names',
          parentSet: 'locations',
          parentField: 'Location',
          totalRows: 0,
          recordset: { columns: [{ name: 'Alias', type: 'string' }], rows: [] },
        },
      ],
    } as Awaited<ReturnType<FederatedQueryService['run']>>;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(
        `datatug-output-100000-${crypto.randomUUID()}`,
        2,
      );
      request.onupgradeneeded = () => createOutputStores(request.result);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const descriptor = await replaceGraphOutput(
      db,
      definition,
      result,
      result.recordset.rows,
      1,
    );
    db.close();
    try {
      vi.mocked(
        TestBed.inject(FederatedQueryService).openLocalResult,
      ).mockImplementation(openLocalResult);
      await component.openHistoricalResult(descriptor.id);
      await component.changeRelatedResultSet('locations');
      await runFixture.whenStable();
      const values = component
        .resultGridRows()
        .flatMap((row) => Object.values(row));
      expect(values).toEqual(tokens);
      expect(component.historicalDefinition()).toEqual(definition);
      await component.changeRelatedResultSet('aliases');
      await runFixture.whenStable();
      expect(component.visibleResultRows()).toEqual([]);
      await component.changeRelatedResultSet('affiliations');
      await runFixture.whenStable();
      expect(
        component.resultGridRows().flatMap((row) => Object.values(row)),
      ).toContain('original-row');
      expect(federatedRunMock).not.toHaveBeenCalled();
      expect(runQueryMock).not.toHaveBeenCalled();
    } finally {
      await deleteLocalResult(descriptor.id);
    }
  });

  it.each(['aliases', 'fields', 'selection', 'operator', 'pins', 'in-place'])(
    'marks completed output historical immediately on %s edit and preserves executed pins',
    async (change) => {
      const definition = historyDefinition(),
        originalDefinition = structuredClone(definition),
        editor = new BehaviorSubject(historyStateFor(definition));
      component = await createComponent(
        {},
        definition,
        historyResultTemplate(),
        { editor, project: of(project) },
      );
      const result = historyResultFor(definition);
      federatedRunMock.mockResolvedValue(result);
      component.runQuery();
      await runFixture.whenStable();
      expect(
        runFixture.nativeElement.querySelector(
          '[data-testid="result-provenance"]',
        ).textContent,
      ).toContain('live');
      const changed =
          change === 'in-place' ? definition : structuredClone(definition),
        plan = changed.federation?.nativeGraph;
      if (!plan) throw new Error('Missing graph fixture.');
      // These are editor drafts, never admitted for execution by this test.
      if (change === 'aliases' || change === 'in-place')
        Object.assign(plan, { aliases: false });
      if (change === 'fields')
        Object.assign(plan.stages.locations, {
          fields: [...plan.stages.locations.fields, 'draft_field'],
        });
      if (change === 'selection') Object.assign(plan.selection, { rows: 999 });
      if (change === 'operator')
        Object.assign(plan.envelope.graphs[0].edges[1], {
          projection: 'draft-operator/1',
        });
      if (change === 'pins')
        Object.assign(plan.stages.locations.runtime, {
          manifestSha256: 'e'.repeat(64),
        });
      editor.next(historyStateFor(changed));
      await runFixture.whenStable();
      expect(component.runResult()).toBe(result);
      expect(component.selectedHistoricalResult()).toEqual(result.localResult);
      expect(component.historicalDefinition()).toEqual(originalDefinition);
      expect(runFixture.nativeElement.textContent).toContain(
        'Historical local result',
      );
      expect(runFixture.nativeElement.textContent).toContain(
        '2026-10-01T09:30:00Z',
      );
      expect(
        component.resultGridRows().flatMap((row) => Object.values(row)),
      ).toContain('original-row');
      expect(
        runFixture.nativeElement.querySelector(
          '[data-testid="result-provenance"]',
        ).textContent,
      ).not.toContain('live');
      expect(TestBed.inject(FederatedQueryService).dispose).toHaveBeenCalled();
      expect(federatedRunMock).toHaveBeenCalledOnce();
      expect(runQueryMock).not.toHaveBeenCalled();
    },
  );

  it.each(['edit', 'history', 'destroy'])(
    'invalidates actual service startup before Worker creation on %s',
    async (action) => {
      const definition = historyDefinition(),
        editor = new BehaviorSubject(historyStateFor(definition));
      component = await createComponent(
        {},
        definition,
        historyResultTemplate(),
        { editor, project: of(project) },
      );
      const service = TestBed.inject(FederatedQueryService),
        actual = new FederatedQueryService();
      const construct = vi.fn();
      vi.stubGlobal('Worker', construct);
      let release!: () => void;
      const cleanup = vi.spyOn(indexedDB, 'databases').mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve([]);
          }),
      );
      federatedRunMock.mockImplementation(actual.run.bind(actual));
      vi.mocked(service.dispose).mockImplementation(
        actual.dispose.bind(actual),
      );
      vi.mocked(service.openLocalResult).mockRejectedValue(
        new Error('Fixture unavailable.'),
      );
      try {
        component.runQuery();
        await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
        if (action === 'edit') {
          Object.assign(definition.federation?.nativeGraph ?? {}, {
            aliases: false,
          });
          editor.next(historyStateFor(definition));
        }
        if (action === 'history')
          await component.openHistoricalResult('fixture');
        if (action === 'destroy') component.ngOnDestroy();
        await Promise.resolve();
        await Promise.resolve();
        expect(component.running()).toBe(false);
        expect(component.runResult()).toBeUndefined();
        release();
        await runFixture.whenStable();
        expect(construct).not.toHaveBeenCalled();
        expect(component.runResult()).toBeUndefined();
        expect(component.runError()).toBeUndefined();
      } finally {
        cleanup.mockRestore();
        vi.unstubAllGlobals();
      }
    },
  );

  it.each(['edit', 'silent-in-place'])(
    'does not publish delayed output live across %s mutation and fences all old callbacks',
    async (action) => {
      const definition = historyDefinition(),
        editor = new BehaviorSubject(historyStateFor(definition));
      component = await createComponent(
        {},
        definition,
        historyResultTemplate(),
        { editor, project: of(project) },
      );
      let finish!: (
        value: Awaited<ReturnType<FederatedQueryService['run']>>,
      ) => void;
      federatedRunMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      component.runQuery();
      const oldCall = federatedRunMock.mock.calls.at(-1);
      Object.assign(definition.federation?.nativeGraph ?? {}, {
        aliases: false,
      });
      if (action === 'edit') editor.next(historyStateFor(definition));
      oldCall?.[1]?.({ phase: 'old' } as Parameters<
        NonNullable<Parameters<FederatedQueryService['run']>[1]>
      >[0]);
      oldCall?.[4]?.(999);
      finish(historyResultFor(oldCall?.[0] as IQueryDef));
      await runFixture.whenStable();
      expect(component.runResult()).toBeUndefined();
      expect(component.federatedProgress()).toBeUndefined();
      expect(
        component.resultGridRows().flatMap((row) => Object.values(row)),
      ).not.toContain('original-row');
      expect(component.running()).toBe(false);
    },
  );

  it.each(['resolve', 'reject'])(
    'old completion %s cannot finalize or report errors into an immediate replacement',
    async (outcome) => {
      const definition = historyDefinition(),
        editor = new BehaviorSubject(historyStateFor(definition));
      component = await createComponent(
        {},
        definition,
        historyResultTemplate(),
        { editor, project: of(project) },
      );
      let finishOld!: (
          value: Awaited<ReturnType<FederatedQueryService['run']>>,
        ) => void,
        failOld!: (error: Error) => void;
      let finishNew!: (
        value: Awaited<ReturnType<FederatedQueryService['run']>>,
      ) => void;
      federatedRunMock
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              finishOld = resolve;
              failOld = reject;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishNew = resolve;
            }),
        );
      component.runQuery();
      const original = structuredClone(definition);
      Object.assign(definition.federation?.nativeGraph ?? {}, {
        aliases: false,
      });
      editor.next(historyStateFor(definition));
      component.runQuery();
      expect(component.running()).toBe(true);
      if (outcome === 'resolve') finishOld(historyResultFor(original));
      else failOld(new Error('Old failure.'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(component.running()).toBe(true);
      expect(component.runError()).toBeUndefined();
      expect(component.runResult()).toBeUndefined();
      const replacement = historyResultFor(
        definition,
        'datatug-output-100000-new',
      );
      finishNew(replacement);
      await runFixture.whenStable();
      expect(component.runResult()).toBe(replacement);
      expect(component.running()).toBe(false);
    },
  );

  it.each(['resolve', 'reject'])(
    'fences delayed local open %s across actual editor and project subscriptions',
    async (outcome) => {
      const definition = historyDefinition(),
        editor = new BehaviorSubject(historyStateFor(definition)),
        projects = new BehaviorSubject(project);
      component = await createComponent(
        {},
        definition,
        historyResultTemplate(),
        { editor, project: projects },
      );
      const service = TestBed.inject(FederatedQueryService);
      let resolveOpen!: (
          value: Awaited<ReturnType<typeof service.openLocalResult>>,
        ) => void,
        rejectOpen!: (error: Error) => void;
      vi.mocked(service.openLocalResult).mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            resolveOpen = resolve;
            rejectOpen = reject;
          }),
      );
      const pending = component.openHistoricalResult(
        'datatug-output-100000-abc',
      );
      await vi.waitFor(() =>
        expect(service.openLocalResult).toHaveBeenCalledOnce(),
      );
      const other = { ...historyDefinition(), id: 'other-query' };
      projects.next({
        ref: { storeId: 'other-store', projectId: 'other-project' },
      });
      editor.next(historyStateFor(other));
      const current = historyResultFor(other, 'datatug-output-100000-def');
      component.runResult.set(current);
      if (outcome === 'resolve')
        resolveOpen({
          result: historyResultFor(definition),
          executedDefinition: definition,
          descriptor: {} as LocalResultDescriptor,
        });
      else rejectOpen(new Error('Old artifact failed.'));
      await pending;
      await runFixture.whenStable();
      expect(component.runResult()).toBe(current);
      expect(component.historicalDefinition()).toBeUndefined();
      expect(component.localHistoryError()).toBeUndefined();
      expect(component.localHistoryLoading()).toBe(false);
      expect(federatedRunMock).not.toHaveBeenCalled();
      expect(runQueryMock).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'clears deleted displayed artifact with historical=%s and keeps another view usable',
    async (historical) => {
      const definition = historyDefinition();
      component = await createComponent(
        {},
        definition,
        historyResultTemplate(),
      );
      const service = TestBed.inject(FederatedQueryService),
        result = historyResultFor(definition);
      component.runResult.set(result);
      if (historical)
        component.selectedHistoricalResult.set(result.localResult);
      if (!result.localResult) throw new Error('Missing graph result.');
      await component.deleteHistoricalResult(result.localResult.id);
      await runFixture.whenStable();
      expect(component.runResult()).toBeUndefined();
      expect(component.visibleResultRows()).toEqual([]);
      expect(
        component.resultGridRows().flatMap((row) => Object.values(row)),
      ).not.toContain('original-row');
      const other = historyResultFor(definition, 'datatug-output-100000-def');
      vi.mocked(service.openLocalResult).mockResolvedValue({
        result: other,
        executedDefinition: definition,
        descriptor: {} as LocalResultDescriptor,
      });
      if (!other.localResult) throw new Error('Missing other graph result.');
      await component.openHistoricalResult(other.localResult.id);
      federatedGetPageMock.mockResolvedValue([
        [{ type: 'string', value: 'other-page' }],
      ]);
      await component.changeResultPage(1);
      expect(component.visibleResultRows()[0][0].value).toBe('other-page');
      expect(service.deleteLocalResult).toHaveBeenCalledExactlyOnceWith(
        result.localResult.id,
      );
    },
  );

  it('reopens saved immutable provenance without lookup, exposes changed revisions and rejects a stored eligibility flag', async () => {
    const file = INITIAL_CANONICAL_PINS.directory;
    const saved: PublicDataScenario = {
      source: {
        schema: file,
        module: 'fixture',
        entity: 'Customer',
        property: 'Country',
        datatype: 'string',
        namespace: 'fixture-labels',
      },
      canonical: {
        ...INITIAL_CANONICAL_PINS,
        directory: { ...file, revision: 'b'.repeat(40) },
      },
      attachment: file,
      snapshot: file,
      model: file,
      meaning: file,
      decision: file,
      decisionScope: 'fixture-only',
      namespace: 'fixture-native',
      projection: 'identity',
      equality: 'utf8-byte-exact',
      rights: {
        source: 'fixture',
        model: 'fixture',
        meaning: 'fixture',
        attribution: 'fixture',
      },
      observedAt: '2026-10-05',
      eligible: true,
      unavailableReason: 'pending',
    };
    const definition: IQueryDef = {
      ...queryDef,
      id: 'saved-fixture',
      federation: { ovdbBaseUrl: 'https://demodb.dev/ovdb', tables: [] },
      publicData: saved,
    };
    component = await createComponent({}, definition);
    expect(component.queryDef()?.publicData).toEqual(saved);
    expect(component.publicDataRevisionChanges()).toEqual(['directory']);
    expect(federatedRunMock).not.toHaveBeenCalled();
    component.runQuery();
    expect(component.runError()).toMatch(/revisions changed/);
    component.publicDataRevisionAcknowledged.set(true);
    component.runQuery();
    expect(component.runError()).toBe(SAVED_SCENARIO_PUBLICATION_BLOCKER);
    expect(federatedRunMock).not.toHaveBeenCalled();
  });

  it.each(['canonical', 'data-only', 'configuration-only'] as const)(
    'discloses proposed %s pins before changed-pin acknowledgement and separate storage copy without a data query',
    async (change) => {
      const native = await nativeFixture('ror', true);
      vi.stubGlobal('fetch', native.http);
      try {
        const metadata = new PublicDataService(),
          oldPins = await native.publish();
        const source = native.contract.source as Parameters<
          PublicDataService['discover']
        >[0];
        const discovery = await metadata.discoverDeclared(
          native.context,
          new AbortController().signal,
          oldPins,
        );
        const definition = metadata.scenario(
          source,
          discovery,
          discovery.suggestions[0],
          { userRows: 1000, userOffset: 0 },
          discovery.declaredSources?.[0],
        );
        const original = structuredClone(definition);
        const pins =
          change === 'canonical'
            ? await native.publish('b'.repeat(40))
            : oldPins;
        if (change !== 'canonical') {
          if (change === 'data-only') {
            const updated = await native.put(
              native.data,
              '[{"affiliation_id":"changed","ror_id":null}]',
            );
            Object.assign(native.context.catalog.sha256, {
              affiliations: updated.sha256,
            });
          }
          const configuration = await native.put(
            { ...native.context.configuration, revision: 'd'.repeat(40) },
            JSON.stringify(native.context.catalog),
          );
          Object.assign(native.context, { configuration });
        }
        const html = readFileSync(
          resolve(
            'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
          ),
          'utf8',
        );
        const template = html
          .split('<ion-content color="light">')[1]
          .split('  <ng-template #queryEditor>')[1]
          .split(
            '  @if (!isTugqlAuthorJourney()) {\n    <ion-card>\n      <ion-item>\n        <ion-input',
          )[0];
        native.http.mockClear();
        component = await createComponent({}, definition, template);
        Object.assign(component.savedPlanReview, {
          configured: async () => native.context,
        });
        const injected = TestBed.inject(PublicDataService),
          revalidate = injected.revalidate.bind(injected);
        const checked = vi
          .spyOn(injected, 'revalidate')
          .mockImplementation((query, signal) =>
            revalidate(query, signal, pins, native.context),
          );
        const create = vi.fn((_project, query) => of(structuredClone(query)));
        Object.assign(TestBed.inject(QueriesService), { createQuery: create });
        runFixture.detectChanges();
        await runFixture.whenStable();
        expect(native.http).not.toHaveBeenCalled();
        expect(runFixture.nativeElement.textContent).toContain(
          'Saved source release v2.13',
        );
        const click = async (label: string) => {
          const buttons = Array.from(
            runFixture.nativeElement.querySelectorAll('ion-button'),
          ) as HTMLElement[];
          const button = buttons.find(
            (value) => value.textContent?.trim() === label,
          );
          expect(button).toBeDefined();
          button?.click();
          await runFixture.whenStable();
        };
        await click('Check current metadata');
        await checked.mock.results[0].value;
        await runFixture.whenStable();
        if (change === 'data-only') {
          const review = component.savedPlanReview.review();
          expect(review?.compatible).toBe(false);
          expect(review?.copy).toBeUndefined();
          expect(review?.observedDeclared?.data.sha256).not.toBe(
            original.publicData?.declaredSource?.data.sha256,
          );
          expect(runFixture.nativeElement.textContent).toContain(
            review?.observedDeclared?.data.sha256,
          );
          expect(runFixture.nativeElement.textContent).toContain(
            'new reviewed admission',
          );
          expect(create).not.toHaveBeenCalled();
          expect(component.queryDef()).toEqual(original);
          expect(federatedRunMock).not.toHaveBeenCalled();
          return;
        }
        expect(component.savedPlanReview.review()?.compatible).toBe(true);
        expect(runFixture.nativeElement.textContent).toContain(
          change === 'canonical'
            ? 'Changed pins: canonical directory'
            : 'Changed pins: configured source/schema/data/mapping',
        );
        const details = runFixture.nativeElement.querySelector(
          '[data-testid="checked-public-data-provenance"]',
        ) as HTMLDetailsElement;
        expect(details.open).toBe(false);
        details.querySelector('summary')?.click();
        await runFixture.whenStable();
        expect(details.open).toBe(true);
        const proposed = component.savedPlanReview.review()?.copy?.publicData;
        if (
          !proposed?.declaredSource ||
          !proposed.native ||
          !original.publicData?.declaredSource
        )
          throw new Error(
            'Missing proposed or original declared native source.',
          );
        const declared = proposed.declaredSource,
          originalData = original.publicData;
        for (const ref of [
          declared.configuration,
          declared.data,
          proposed.source.schema,
          proposed.attachment,
          proposed.model,
          proposed.meaning,
          proposed.snapshot,
          proposed.decision,
          proposed.native.dataset,
          proposed.native.provenance,
        ]) {
          for (const value of Object.values(ref))
            expect(details.textContent).toContain(value);
        }
        expect(details.textContent).toContain('Mapping ror_id → ror_id');
        expect(details.textContent).toContain('ROR:URL');
        expect(details.textContent).toContain('key affiliation_id');
        expect(details.textContent).toContain(
          'do not grant semantic admission or execution',
        );
        expect(declared.data.sha256).toBe(
          originalData.declaredSource?.data.sha256,
        );
        expect(component.savedPlanReview.acknowledged()).toBeUndefined();
        const save = Array.from(
          runFixture.nativeElement.querySelectorAll('ion-button'),
        ).find(
          (button) =>
            (button as HTMLElement).textContent?.trim() ===
            'Save separate pending plan',
        ) as HTMLButtonElement;
        expect(save.disabled).toBe(true);
        expect(create).not.toHaveBeenCalled();
        expect(federatedRunMock).not.toHaveBeenCalled();
        await click('Acknowledge this metadata check');
        await click('Save separate pending plan');
        expect(create).toHaveBeenCalledOnce();
        expect(create.mock.calls[0][1].publicData.eligible).toBe(false);
        expect(component.queryDef()).toEqual(original);
        component.resultPageIndex.set(1);
        component.runQuery();
        expect(component.resultPageIndex()).toBe(1);
        expect(federatedRunMock).not.toHaveBeenCalled();
        expect(runQueryMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('runs a federated query in the browser and exposes its download and lookup progress', async () => {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'sales',
      request: { queryType: QueryType.DTQL, text: 'from: Invoice' },
      federation: { ovdbBaseUrl: 'http://127.0.0.1:50501', tables: [] },
      parameters: [],
    };
    component = await createComponent({}, definition);
    const response: RunQueryResponse = {
      recordset: {
        columns: [{ name: 'country', type: 'string' }],
        rows: [[{ type: 'string', value: 'Alpha' }]],
      },
      limitations: [],
      bindingsApplied: [],
      truncated: false,
      provenance: {
        source: 'direct OVDB',
        queryId: 'sales',
        mode: 'live',
        observedAt: '2026-09-23T00:00:00Z',
        executionProfile: 'protected',
      },
    };
    federatedRunMock.mockImplementation(
      (_definition: IQueryDef, onProgress: (progress: unknown) => void) => {
        onProgress({
          rowsLoaded: 103,
          rowsProcessed: 100,
          requestsCompleted: 2,
          requestsInFlight: 0,
          requestsPending: 0,
        });
        return Promise.resolve(response);
      },
    );
    component.runQuery();
    await Promise.resolve();
    expect(federatedRunMock).toHaveBeenCalledOnce();
    expect(runQueryMock).not.toHaveBeenCalled();
    expect(component.federatedProgress()).toEqual({
      rowsLoaded: 103,
      rowsProcessed: 100,
      requestsCompleted: 2,
      requestsInFlight: 0,
      requestsPending: 0,
    });
    expect(component.runResult()).toEqual(response);
  });

  it('defaults a flat left join to visible rows and lets the user switch to full result', async () => {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'detail-join',
      request: {
        queryType: QueryType.DTQL,
        text: JSON.stringify({
          from: {
            database: 'sales',
            name: 'Invoice',
            alias: 'i',
            joins: [
              {
                type: 'left',
                from: { database: 'geo', name: 'Country', alias: 'c' },
                on: [
                  {
                    left: { field: 'country_id', source: 'i' },
                    op: '==',
                    right: { field: 'id', source: 'c' },
                  },
                ],
              },
            ],
          },
          columns: [
            { field: 'id', source: 'i' },
            { field: 'name', source: 'c' },
          ],
        }),
      },
      federation: {
        ovdbBaseUrl: 'http://127.0.0.1:50501',
        tables: [
          { database: 'sales', name: 'Invoice', fields: ['id', 'country_id'] },
          { database: 'geo', name: 'Country', fields: ['id', 'name'] },
        ],
      },
    };
    component = await createComponent({}, definition);
    expect(component.federatedMode()).toBe('visible');
    expect(component.ovdbDestination()).toBe('http://127.0.0.1:50501');
    federatedRunMock.mockResolvedValue({
      recordset: { columns: [], rows: [] },
      limitations: [],
      bindingsApplied: [],
      truncated: false,
    });
    component.federatedMode.set('full');
    component.runQuery();
    expect(federatedRunMock).toHaveBeenCalledWith(
      definition,
      expect.any(Function),
      '',
      'full',
      expect.any(Function),
      expect.objectContaining({ onFirstRecord: expect.any(Function) }),
    );
  });

  it('shows only one result page at a time for a large federated recordset', async () => {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'many-sales',
      request: { queryType: QueryType.DTQL, text: 'from: Invoice' },
      federation: { ovdbBaseUrl: 'http://127.0.0.1:50501', tables: [] },
      parameters: [],
    };
    component = await createComponent({}, definition);
    federatedRunMock.mockResolvedValue({
      recordset: {
        columns: [{ name: 'id', type: 'integer' }],
        rows: Array.from({ length: 205 }, (_, index) => [
          { type: 'integer', value: String(index + 1) },
        ]),
      },
      limitations: [],
      bindingsApplied: [],
      truncated: false,
      provenance: {
        source: 'direct OVDB',
        queryId: 'many-sales',
        mode: 'live',
        observedAt: '2026-09-23T00:00:00Z',
        executionProfile: 'protected',
      },
    } satisfies RunQueryResponse);
    component.runQuery();
    await Promise.resolve();
    expect(component.visibleResultRows()).toHaveLength(100);
    expect(component.visibleResultRows()[0][0].value).toBe('1');
    component.resultPageIndex.set(2);
    expect(component.visibleResultRows()).toHaveLength(5);
    expect(component.visibleResultRows()[0][0].value).toBe('201');
    expect(component.resultPageEnd()).toBe(205);
    await vi.waitFor(() => expect(component.running()).toBe(false));
    component.runQuery();
    await Promise.resolve();
    expect(component.resultPageIndex()).toBe(0);
  });

  it('fetches a browser-worker result page without retaining all output rows', async () => {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'paged-sales',
      request: { queryType: QueryType.DTQL, text: 'from: Invoice' },
      federation: { ovdbBaseUrl: 'http://127.0.0.1:50501', tables: [] },
      parameters: [],
    };
    component = await createComponent({}, definition);
    federatedRunMock.mockResolvedValue({
      recordset: {
        columns: [{ name: 'id', type: 'integer' }],
        rows: [[{ type: 'integer', value: '1' }]],
      },
      totalRows: 120_000,
      limitations: [],
      bindingsApplied: [],
      truncated: false,
      provenance: {
        source: 'direct OVDB',
        queryId: 'paged-sales',
        mode: 'live',
        observedAt: '2026-09-23T00:00:00Z',
        executionProfile: 'protected',
      },
    });
    federatedGetPageMock.mockResolvedValue([
      [{ type: 'integer', value: '101' }],
    ]);
    component.runQuery();
    await Promise.resolve();
    expect(component.resultTotalRows()).toBe(120_000);
    expect(component.visibleResultRows()).toHaveLength(1);
    await component.changeResultPage(1);
    expect(federatedGetPageMock).toHaveBeenCalledWith(
      1,
      'affiliations',
      undefined,
    );
    expect(component.visibleResultRows()).toEqual([
      [{ type: 'integer', value: '101' }],
    ]);
    expect(component.resultPageEnd()).toBe(200);
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

  it('preserves an open query binding when an overlay fact is promoted until the user accepts rebinding', async () => {
    component = await createComponent({});
    const overlay = investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 11,
      label: 'Customer.ID = 11',
      source: 'grid',
      layer: 'hypothesis:H17',
      role: 'suspected',
    });
    TestBed.tick();
    expect(component.effectiveBindings()).toEqual([]);

    investigationContext.applyPromotion(
      overlay.id,
      'hypothesis:H17',
      'affected',
    );
    TestBed.tick();

    expect(component.effectiveBindings()).toEqual([]);
    expect(component.rebindSuggestions()).toEqual([
      expect.objectContaining({
        parameterId: 'CustomerId',
        previous: expect.objectContaining({ parameterId: 'CustomerId' }),
        suggested: expect.objectContaining({
          value: { type: 'integer', value: '11' },
          origin: 'context',
        }),
      }),
    ]);

    component.acceptRebind('CustomerId');

    expect(component.rebindSuggestions()).toEqual([]);
    expect(component.effectiveBindings()).toEqual([
      expect.objectContaining({
        parameterId: 'CustomerId',
        value: { type: 'integer', value: '11' },
      }),
    ]);
  });

  it('accepts one of two promotion rebinds without changing the other parameter', async () => {
    const twoParameterQuery: IQueryDef = {
      ...queryDef,
      parameters: [
        ...(queryDef.parameters ?? []),
        {
          id: 'ComparisonCustomerId',
          type: 'integer',
          meta: { entity: 'Customer', field: 'ID' },
        },
      ],
    };
    component = await createComponent({}, twoParameterQuery);
    const overlay = investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 11,
      label: 'Customer.ID = 11',
      source: 'grid',
      layer: 'hypothesis:H17',
    });
    TestBed.tick();
    investigationContext.applyPromotion(
      overlay.id,
      'hypothesis:H17',
      'affected',
    );
    TestBed.tick();

    expect(
      component.rebindSuggestions().map((item) => item.parameterId),
    ).toEqual(['CustomerId', 'ComparisonCustomerId']);

    component.acceptRebind('CustomerId');

    expect(
      component.rebindSuggestions().map((item) => item.parameterId),
    ).toEqual(['ComparisonCustomerId']);
    expect(
      component.bindings().find((item) => item.parameterId === 'CustomerId'),
    ).toMatchObject({
      value: { type: 'integer', value: '11' },
      origin: 'context',
    });
    expect(
      component
        .bindings()
        .find((item) => item.parameterId === 'ComparisonCustomerId')?.value,
    ).toBeUndefined();
  });

  it('keeps the accepted binding when the user declines a promotion rebind', async () => {
    component = await createComponent({});
    const overlay = investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 11,
      label: 'Customer.ID = 11',
      source: 'grid',
      layer: 'hypothesis:H17',
    });
    TestBed.tick();
    investigationContext.applyPromotion(
      overlay.id,
      'hypothesis:H17',
      'affected',
    );
    TestBed.tick();

    component.keepCurrentBinding('CustomerId');

    expect(component.rebindSuggestions()).toEqual([]);
    expect(component.effectiveBindings()).toEqual([]);

    investigationContext.addValue({
      entityField: { entity: 'Country', field: 'Name' },
      value: 'Ireland',
      label: 'Country.Name = Ireland',
      source: 'manual',
    });
    TestBed.tick();

    expect(component.rebindSuggestions()).toEqual([]);
    expect(component.effectiveBindings()).toEqual([]);
  });

  it('lets the user choose affected while keeping healthy control visible as another compare side', async () => {
    component = await createComponent({});
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 7,
      label: 'Affected customer',
      source: 'manual',
      role: 'affected',
    });
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 9,
      label: 'Healthy control',
      source: 'manual',
      role: 'healthy_control',
    });
    TestBed.tick();
    const unresolved = component.bindings()[0];
    expect(unresolved.blocked).toBe('ambiguous');
    const affected = unresolved.cohortOptions?.find(
      (option) => option.role === 'affected',
    );
    expect(affected).toBeDefined();
    if (!affected) {
      throw new Error('Expected an affected cohort choice');
    }

    component.chooseContextCohort('CustomerId', affected.factKey);

    const selected = component.bindings()[0];
    expect(selected).toMatchObject({ role: 'affected', origin: 'context' });
    expect(selected.cohortOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'healthy_control' }),
      ]),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((component as any).bindingValueLabel(selected)).toBe(
      '7 · from context · affected',
    );
  });

  it('treats a direct user edit as the new accepted snapshot after promotion', async () => {
    component = await createComponent({});
    const overlay = investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 11,
      label: 'Customer.ID = 11',
      source: 'grid',
      layer: 'hypothesis:H17',
    });
    TestBed.tick();
    investigationContext.applyPromotion(
      overlay.id,
      'hypothesis:H17',
      'affected',
    );
    TestBed.tick();
    expect(component.rebindSuggestions()).toHaveLength(1);

    component.editBinding('CustomerId', { type: 'integer', value: '23' });

    expect(component.rebindSuggestions()).toEqual([]);
    expect(component.effectiveBindings()).toEqual([
      expect.objectContaining({
        parameterId: 'CustomerId',
        value: { type: 'integer', value: '23' },
        origin: 'user',
      }),
    ]);
  });

  it('resets promotion rebinding when the security context changes in the same project and environment', async () => {
    component = await createComponent({});
    const overlay = investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 11,
      label: 'Customer.ID = 11',
      source: 'grid',
      layer: 'hypothesis:H17',
    });
    TestBed.tick();
    investigationContext.applyPromotion(
      overlay.id,
      'hypothesis:H17',
      'affected',
    );
    TestBed.tick();
    expect(component.rebindSuggestions()).toHaveLength(1);

    agentContext.securityContextId.set('sctx-2');
    TestBed.tick();

    expect(component.rebindSuggestions()).toEqual([]);
    expect(component.effectiveBindings()).toEqual([]);
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
    expect((component as any).bindingFieldLabel(selectionRendered)).toBe(
      'Customer.ID',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((component as any).bindingValueLabel(selectionRendered)).toBe(
      '5 · from selection',
    );
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
    expect((component as any).bindingValueLabel(contextRendered)).toBe(
      '7 · from context',
    );
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
      recordset: {
        columns: [{ name: 'InvoiceId', type: 'integer' }],
        rows: [[{ type: 'integer', value: '1' }]],
      },
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
    const contextItem = investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 7,
      label: 'Customer.ID = 7',
      source: 'grid',
      role: 'affected',
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
      bindingOrigins: [
        {
          parameterId: 'CustomerId',
          origin: 'context',
          factId: contextItem.id,
        },
      ],
      mode: 'live',
    });
    expect(component.runResult()).toEqual(response);
    expect(
      (
        component as unknown as {
          appliedBindingRole: (
            binding: (typeof response.bindingsApplied)[number],
          ) => string | undefined;
        }
      ).appliedBindingRole(response.bindingsApplied[0]),
    ).toBe('affected');
    expect(component.running()).toBe(false);
    expect(component.runError()).toBeUndefined();
  });

  it('ignores an older semantic response after a newer run of the same query', async () => {
    component = await createComponent();
    const earlier = new Subject<RunQueryResponse>();
    const later = new Subject<RunQueryResponse>();
    const response = (value: string): RunQueryResponse => ({
      recordset: {
        columns: [{ name: 'result', type: 'string' }],
        rows: [[{ type: 'string' as const, value }]],
      },
      limitations: [],
      bindingsApplied: [],
      provenance: {
        source: 'fixture',
        mode: 'live' as const,
        observedAt: `2026-10-10T10:00:0${value === 'new' ? '2' : '1'}Z`,
        queryId: queryDef.id,
        executionProfile: 'protected' as const,
      },
      truncated: false,
    });
    runQueryMock.mockReturnValueOnce(earlier).mockReturnValueOnce(later);

    component.runQuery();
    component.runQuery();
    const latest = response('new');
    later.next(latest);
    await runFixture.whenStable();
    earlier.next(response('old'));
    await runFixture.whenStable();

    expect(component.runResult()).toEqual(latest);
    expect(component.committedRun()?.result.recordset.rows[0][0].value).toBe(
      'new',
    );
    expect(component.running()).toBe(false);
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

  it('does not run a selected value when an old candidate omitted its fact provenance', async () => {
    component = await createComponent({
      bindings: [{ ...selectionBinding, factId: undefined }],
    });
    component.project = project;

    component.runQuery();

    expect(runQueryMock).not.toHaveBeenCalled();
    expect(component.runError()).toContain('provenance');
  });

  it('runQuery reports the failure without hiding it', async () => {
    component = await createComponent({});
    runQueryMock.mockReturnValue(
      throwError(() => ({ message: 'ACCESS_DENIED' })),
    );
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
        error: {
          code: 'SOURCE_UNAVAILABLE',
          message: 'live request failed',
          requestId: 'req-2',
        },
        details: {
          availableSnapshots: [
            {
              snapshotId: 'exchange-rates-2026-09-01',
              recordedAt: '2026-09-01T00:00:00Z',
            },
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
        error: {
          code: 'SOURCE_UNAVAILABLE',
          message: 'live request failed',
          requestId: 'req-3',
        },
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
    factId: 'selection-customer-5',
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
          provide: GitHubProjectActivityService,
          useValue: githubProjectActivityStub(),
        },
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
    const created =
      TestBed.createComponent(QueryPageComponent).componentInstance;
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
      expect.objectContaining({
        parameterId: 'CustomerId',
        value: { type: 'integer', value: '5' },
      }),
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
      expect.objectContaining({
        parameterId: 'CustomerId',
        origin: 'context',
        value: { type: 'integer', value: '5' },
      }),
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
      expect.objectContaining({
        parameterId: 'CustomerId',
        origin: 'context',
        value: { type: 'integer', value: '5' },
      }),
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
          provide: GitHubProjectActivityService,
          useValue: githubProjectActivityStub(),
        },
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
          provide: GitHubProjectActivityService,
          useValue: githubProjectActivityStub(),
        },
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
  let fixture: ComponentFixture<QueryPageComponent>;

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
    request: {
      queryType: QueryType.SQL,
      text: legacySqlText,
    } as ISqlQueryRequest,
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

  async function createComponent(
    def: IQueryDef,
    template = '',
  ): Promise<QueryPageComponent> {
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
    const editor = new BehaviorSubject(editorState);

    await TestBed.configureTestingModule({
      imports: [QueryPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: GitHubProjectActivityService,
          useValue: githubProjectActivityStub(),
        },
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
            queryEditorState: editor,
            updateQueryState: vi.fn((state: IQueryState) =>
              editor.next({
                ...editor.value,
                activeQueries: editor.value.activeQueries.map((query) =>
                  query.id === state.id ? state : query,
                ),
              }),
            ),
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
          template,
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(QueryPageComponent);
    return fixture.componentInstance;
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
      request: {
        queryType: QueryType.HTTP,
        url: 'https://example.test',
        method: 'GET',
      },
    };
    component = await createComponent(httpDef);

    expect(component.queryBodyText()).toBeUndefined();
  });

  it('keeps an empty text editor mounted while the user types, clears, and types again', async () => {
    const blankSql: IQueryDef = {
      id: 'new-query',
      title: 'New query',
      request: { queryType: QueryType.SQL, text: '' } as ISqlQueryRequest,
    };
    component = await createComponent(
      blankSql,
      '@if (queryBodyText() !== undefined) {<ion-textarea data-testid="query-body-text" [value]="queryBodyText()" (ionInput)="queryTextChanged($event)"></ion-textarea>}',
    );
    fixture.detectChanges();
    const getEditor = () =>
      fixture.nativeElement.querySelector(
        '[data-testid="query-body-text"]',
      ) as HTMLElement | null;
    expect(getEditor()).not.toBeNull();

    const edit = async (value: string) => {
      const editor = getEditor();
      expect(editor).not.toBeNull();
      editor?.dispatchEvent(
        new CustomEvent('ionInput', {
          detail: { value },
          bubbles: true,
        }),
      );
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await edit('select 1');
    expect(component.queryBodyText()).toBe('select 1');
    expect(getEditor()).not.toBeNull();
    await edit('');
    expect(component.queryBodyText()).toBe('');
    expect(getEditor()).not.toBeNull();
    await edit('select 2');
    expect(component.queryBodyText()).toBe('select 2');
    expect(getEditor()).not.toBeNull();
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
        {
          id: 'p1',
          type: 'integer',
          meta: { entity: 'Customer', field: 'ID' },
        },
      ],
      recordsets: [
        {
          name: 'r',
          columns: [
            {
              name: 'c1',
              type: 'integer',
              meta: { entity: 'Invoice', field: 'ID' },
            },
            {
              name: 'c2',
              type: 'integer',
              meta: { entity: 'Customer', field: 'ID' },
            }, // dup
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
      request: {
        queryType: QueryType.SQL,
        text: 'SELECT * FROM dbo.Artist',
      } as ISqlQueryRequest,
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
      request: {
        queryType: QueryType.HTTP,
        url: 'https://example.test',
        method: 'GET',
      },
    };

    expect(extractLinkedEntityNames(def)).toEqual([]);
  });
});
