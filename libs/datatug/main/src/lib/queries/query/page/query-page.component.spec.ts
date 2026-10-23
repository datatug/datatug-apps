import { ProjectMeaningsService } from '../../../meanings/project-meanings.service';
import { SneatAuthStateService } from '@sneat/auth-core';
import { DemoTableDraftService } from '../../demo-table-draft.service';
import { createHostedDemoDbQuery, withHostedDemoDbSource } from '../../hosted-demo-db-query';
import { toProjectQueryWire, fromProjectQueryWire } from '../../project-query-contract';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';
import { nativeFixture } from '../../public-data/native-fixture.spec-helper';
import { PublicDataService } from '../../public-data/public-data.service';
import { NgTemplateOutlet } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, CUSTOM_ELEMENTS_SCHEMA, type Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { IonSelect, IonSelectOption, NavController } from '@ionic/angular';
import { Firestore } from 'firebase/firestore';
import { parseDTQL, parseTugQL, resolveTugQL } from '@dalgo/core';
import { ErrorLogger } from '@sneat/core';
import { RANDOM_ID_OPTIONS, RandomIdService } from '@sneat/random';
import { AgentContextService, InvestigationContextService, SemanticApiService, type RunQueryResponse } from '@sneat/datatug-semantic';
import { BehaviorSubject, Observable, Subject, firstValueFrom, of, throwError } from 'rxjs';
import { QueryPageComponent, extractLinkedEntityNames } from './query-page.component';
import { IQueryEditorState, IQueryState } from '../../../editor/models';
import { IProjectContext } from '../../../nav/nav-models';
import type { IProjectFull } from '../../../models/definition/project';
import type { IProjectRef } from '../../../core/project-context';
import type { IParameterDef } from '../../../models/definition/parameter';
import { IQueryDef, IHttpQueryRequest, ISqlQueryRequest, ITextQueryRequest, QueryType } from '../../../models/definition/query-def';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { QueryContextSqlService } from '../../query-context-sql.service';
import { QueriesService } from '../../queries.service';
import { Coordinator } from '../../../executor/coordinator';
import { ProjectService } from '../../../services/project/project.service';
import { PUBLIC_CHINOOK_CUSTOMER_FK } from '../../public-sqlite-tugql';
import { QueryEditorStateService } from '../../query-editor-state-service';
import { AgentLinkApiService, LinkProblemError } from '../../../agent-links/agent-link-api.service';
import { decodeStoredResult } from '../../../agent-links/query-result/query-result';
import { DTQL_TEXT, PROMPT_TEXT, editorReadyResult, invoiceCustomerResult } from '../../../agent-links/query-result/query-result.spec-helper';
import { QueryWorkspaceLayoutComponent } from './query-workspace-layout.component';
import { SessionWorkspaceService } from '../../../session-context/session-workspace.service';
import { SneatDatatugPageTitleComponent } from '../../../components/page-title/sneat-datatug-page-title.component';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { FederatedQueryService, type FederatedQueryProgress, type FederatedQueryResult } from '../../federated-query.service';
import { PublicSqliteQueryService, type PublicSqliteSourceDiscovery } from '../../public-sqlite-query.service';
import type { PublicSqliteQueryPreview } from '../../public-sqlite-tugql';
import { PUBLIC_CHINOOK_COMPARISON_TARGETS } from '../../public-sqlite-comparison';
import type { ComparisonWorkerObservation } from '../../public-sqlite-comparison';
import { testAuthorProof } from './author-query-proof.spec-helper';
import { GitHubProjectActivityService } from '../../../services/project/github-project-activity.service';
import { DetectiveClientService, type HostedQueryResponse } from '../../../detective/detective-client.service';
import { QueryDispatchService } from '../../query-dispatch.service';
import { ProjectQueryApiService } from '../../../services/project/project-query-api.service';
import { GithubProjectReaderService } from '../../../services/repo/github/github-project-reader.service';
import { BrowserSqliteQueryService } from '../../browser-sqlite-query.service';
import type { QueryDispatchRequest } from '../../query-dispatch';
import type { DetectiveState } from '../../../detective/models';
import { graphFixturePlan } from '../../public-data/native-graph.spec-helper';
import { graphStableIdentity } from '../../public-data/native-graph-executor';
import { createOutputStores, replaceGraphOutput, openLocalResult, deleteLocalResult, type LocalResultDescriptor } from '../../federated-local-results';
import { INITIAL_CANONICAL_PINS } from '../../public-data/canonical-metadata';
import { SAVED_SCENARIO_PUBLICATION_BLOCKER, type PublicDataScenario } from '../../public-data/public-data-scenario';
import { provideMockErrorLogger } from '../../../testing/error-logger.spec-helper';
import { SqlEditorHostStub, agentContextStub, asReadWire, clearCurrentRouterNavigation, createDispatchFixtures, detectiveClientStub, githubProjectActivityStub, queryDispatchTestStub, resolve, setRouteId, setRouterNavigation } from './query-page.spec-helper';

const fx = createDispatchFixtures();

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
        { provide: ProjectMeaningsService, useValue: {} },
        {
          provide: GitHubProjectActivityService,
          useValue: githubProjectActivityStub(),
        },
        provideMockErrorLogger(),
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
        { provide: DemoTableDraftService, useValue: { read: vi.fn(), consume: vi.fn() } },
        { provide: QueriesService, useValue: { devicePersonal: { list: vi.fn(async () => []) } } },
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
        { provide: DetectiveClientService, useValue: detectiveClientStub() },
        { provide: QueryDispatchService, useValue: queryDispatchTestStub(fx) },
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

  it.each([false, true])('restores a validated demo table draft while preserving existing editor text: %s', async (existing) => {
    const ref = { storeId: 'github.com', projectId: 'repo@owner@folder', projectApi: 'cloud' as const, branch: 'main' };
    component.project = { ref } as IProjectContext;
    component.queryState = { ...component.queryState, id: 'demo-query', isNew: true };
    component['demoDraftEntry'] = { token: 'token', identityKey: 'unit-restore', queryId: 'demo-query' };
    const params = convertToParamMap({ demoDraft: 'token', runtime: 'runtime-live', env: 'dev' });
    Object.defineProperty(TestBed.inject(ActivatedRoute), 'snapshot', { configurable: true, value: { queryParamMap: params, paramMap: convertToParamMap({}) } });
    Object.assign(TestBed.inject(QueriesService), { authentication: () => of({ status: 'authenticated', user: { uid: 'actor' } }) });
    const definition = { id: '', connectionId: 'chinook-sqlite', request: { queryType: QueryType.DTQL, text: 'from:\n  name: "Artist"\nlimit: 100\n' } } as IQueryDef;
    vi.mocked(TestBed.inject(DemoTableDraftService).read).mockResolvedValue(definition);
    const editor = TestBed.inject(QueryEditorStateService);
    vi.mocked(editor.getQueryState).mockReturnValue({ id: 'demo-query', isNew: true, queryType: QueryType.DTQL, request: { queryType: QueryType.DTQL, text: existing ? 'my existing draft' : '' } as ITextQueryRequest });
    await component['restoreDemoTableDraft']();
    if (existing) {
      expect(editor.updateQueryState).not.toHaveBeenCalled();
      expect(component.runError()).toContain('already has an unsaved draft');
    } else {
      expect(editor.updateQueryState).toHaveBeenCalledWith(expect.objectContaining({ id: 'demo-query', isNew: true, connectionId: 'chinook-sqlite', request: definition.request }));
      expect(TestBed.inject(DemoTableDraftService).read).toHaveBeenCalledWith('token', ref, 'runtime-live', 'dev', 'actor');
    }
  });

  it.each(['auth before', 'catalog', 'auth after'] as const)('retries the same validated demo table draft after transient %s failure', async (stage) => {
    const ref = { storeId: 'github.com', projectId: 'repo@owner@folder', projectApi: 'cloud' as const, branch: 'main' };
    component.project = { ref } as IProjectContext;
    component.queryState = { ...component.queryState, id: 'demo-query', isNew: true };
    component['demoDraftEntry'] = { token: 'token', identityKey: 'unit-restore', queryId: 'demo-query' };
    Object.defineProperty(TestBed.inject(ActivatedRoute), 'snapshot', { configurable: true, value: { queryParamMap: convertToParamMap({ demoDraft: 'token', runtime: 'runtime-live', env: 'dev' }), paramMap: convertToParamMap({}) } });
    const authenticated = of({ status: 'authenticated', user: { uid: 'actor' } });
    const auth = vi.fn(() => authenticated);
    if (stage === 'auth before') auth.mockReturnValueOnce(throwError(() => new Error('temporary auth failure')));
    if (stage === 'auth after') auth.mockReturnValueOnce(authenticated).mockReturnValueOnce(throwError(() => new Error('temporary auth failure')));
    Object.assign(TestBed.inject(QueriesService), { authentication: auth });
    const drafts = TestBed.inject(DemoTableDraftService);
    const definition = { id: '', connectionId: 'chinook-sqlite', request: { queryType: QueryType.DTQL, text: 'from: Artist\nlimit: 100' } } as IQueryDef;
    vi.mocked(drafts.read).mockResolvedValue(definition);
    if (stage === 'catalog') vi.mocked(drafts.read).mockRejectedValueOnce(new Error('temporary catalog failure'));
    const editor = TestBed.inject(QueryEditorStateService);
    vi.mocked(editor.getQueryState).mockReturnValue({ id: 'demo-query', isNew: true, queryType: QueryType.DTQL });
    await component['restoreDemoTableDraft']();
    expect(component.runError()).toContain('temporary');
    expect(drafts.consume).not.toHaveBeenCalled();
    await component['restoreDemoTableDraft']();
    expect(component.runError()).toBeUndefined();
    expect(editor.updateQueryState).toHaveBeenCalledOnce();
    expect(drafts.consume).toHaveBeenCalledExactlyOnceWith('token');
    const reads = vi.mocked(drafts.read).mock.calls.length;
    await component['restoreDemoTableDraft']();
    expect(drafts.read).toHaveBeenCalledTimes(reads);
  });

  it('does not clear a newer draft attempt or show a stale draft failure', async () => {
    const ref = { storeId: 'github.com', projectId: 'repo@owner@folder', projectApi: 'cloud' as const, branch: 'main' };
    component.project = { ref } as IProjectContext;
    component.queryState = { ...component.queryState, id: 'demo-query', isNew: true };
    component['demoDraftEntry'] = { token: 'token', identityKey: 'unit-restore', queryId: 'demo-query' };
    component['demoDraftEntry'] = { token: 'old-token', identityKey: 'unit-restore', queryId: 'demo-query' };
    const snapshot = { queryParamMap: convertToParamMap({ demoDraft: 'old-token' }), paramMap: convertToParamMap({}) };
    Object.defineProperty(TestBed.inject(ActivatedRoute), 'snapshot', { configurable: true, value: snapshot });
    Object.assign(TestBed.inject(QueriesService), { authentication: () => of({ status: 'authenticated', user: { uid: 'actor' } }) });
    const drafts = TestBed.inject(DemoTableDraftService);
    let reject: ((error: Error) => void) | undefined;
    vi.mocked(drafts.read).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValueOnce({ id: '', connectionId: 'chinook-sqlite', request: { queryType: QueryType.DTQL, text: 'from: Artist' } } as IQueryDef);
    vi.mocked(TestBed.inject(QueryEditorStateService).getQueryState).mockReturnValue({ id: 'demo-query', isNew: true, queryType: QueryType.DTQL });
    const old = component['restoreDemoTableDraft']();
    await Promise.resolve();
    snapshot.queryParamMap = convertToParamMap({ demoDraft: 'new-token' });
    component['demoDraftEntry'] = { token: 'new-token', identityKey: 'unit-restore', queryId: 'demo-query' };
    await component['restoreDemoTableDraft']();
    reject?.(new Error('stale failure'));
    await old;
    expect(component.runError()).toBeUndefined();
    expect(drafts.consume).toHaveBeenCalledExactlyOnceWith('new-token');
    await component['restoreDemoTableDraft']();
    expect(drafts.read).toHaveBeenCalledTimes(2);
  });

  it.each(['query', 'route'])('never replaces an explicitly addressed saved query through a table token: %s', async (address) => {
    component.project = { ref: { storeId: 'github.com', projectId: 'repo@owner@folder', projectApi: 'cloud', branch: 'main' } } as IProjectContext;
    component.queryState = { ...component.queryState, id: 'saved-query' };
    Object.defineProperty(TestBed.inject(ActivatedRoute), 'snapshot', { configurable: true, value: {
      queryParamMap: convertToParamMap({ demoDraft: 'token', ...(address === 'query' ? { id: 'saved-query' } : {}) }),
      paramMap: convertToParamMap(address === 'route' ? { queryId: 'saved-query' } : {}),
    } });
    await component['restoreDemoTableDraft']();
    expect(component.runError()).toContain('cannot replace an existing saved query');
    expect(TestBed.inject(DemoTableDraftService).read).not.toHaveBeenCalled();
    expect(TestBed.inject(QueryEditorStateService).updateQueryState).not.toHaveBeenCalled();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('switches chart and AG Grid over one admitted held result without execution', () => {
    const sourceId = 'ovdb:demo/northwind/Orders';
    const held = {
      recordset: {
        columns: [{ name: 'country', type: 'string' }, { name: 'orders', type: 'integer' }],
        rows: [[{ type: 'string', value: 'France' }, { type: 'integer', value: '2' }]],
      },
      limitations: [], bindingsApplied: [], truncated: false,
      provenance: { mode: 'live', source: 'Saved query', observedAt: '2026-10-16T00:00:00Z' },
      sourceRights: [{ sourceId, source: { serverId: 'demo', databaseId: 'northwind', recordset: 'Orders' }, declaredAt: { serverId: 'demo', databaseId: 'northwind', recordset: 'Orders' }, declarationScope: 'recordset', declaration: { spdx: 'MIT' }, evidenceOrigin: 'publisher-verified', pins: [], transformations: [] }],
      usedSourceIds: [sourceId], totalRows: 1, hasMore: false,
    } as unknown as FederatedQueryResult;
    component.runResult.set(held);
    component.resultChartCategory.set('country');
    component.resultChartMeasure.set('orders');
    expect(component.resultChartReason()).toBe('');
    const gridRows = component.resultGridRows();
    component.resultChartView.set('chart');
    expect(component.resultChartVisible()).toBe(true);
    expect(component.resultChartHeld()?.recordset).toBe(held.recordset);
    expect(component.resultGridRows()).toBe(gridRows);
    component.resultChartView.set('grid');
    expect(component.runResult()).toBe(held);
    expect(TestBed.inject(SemanticApiService).runQuery).not.toHaveBeenCalled();
    component.resultChartView.set('chart');
    component.runResult.set({ ...held, usedSourceIds: undefined });
    expect(component.resultChartReason()).toContain('rights');
    expect(component.resultChartVisible()).toBe(false);
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

  it('does not normalize after Back when another project has the same Query URL', () => {
    const router = TestBed.inject(Router) as unknown as {
      navigate: ReturnType<typeof vi.fn>;
      routerState: { root: { children: unknown[] } };
    };
    const cachedQueryRoute = TestBed.inject(ActivatedRoute);
    const replacementQueryRoute = {
      snapshot: { ...cachedQueryRoute.snapshot },
      children: [],
    } as unknown as ActivatedRoute;
    const differentIdQueryRoute = {
      snapshot: {
        ...cachedQueryRoute.snapshot,
        queryParamMap: convertToParamMap({ id: 'query-b' }),
        paramMap: convertToParamMap({ queryId: 'query-b' }),
      },
      children: [],
    } as unknown as ActivatedRoute;
    router.routerState = {
      root: {
        children: [
          { children: [replacementQueryRoute] },
          { children: [differentIdQueryRoute] },
        ],
      },
    };

    component.ionViewDidEnter();

    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not normalize while a navigation is in flight', () => {
    const router = TestBed.inject(Router) as unknown as {
      currentNavigation: ReturnType<typeof vi.fn>;
      navigate: ReturnType<typeof vi.fn>;
      routerState: { root: { children: unknown[] } };
    };
    router.routerState = {
      root: { children: [TestBed.inject(ActivatedRoute)] },
    };
    router.currentNavigation.mockReturnValue({ id: 2 });

    component.ionViewWillEnter();
    component.ionViewDidEnter();

    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('normalizes the URL when the Query route is active again on reentry', () => {
    const componentRoute = TestBed.inject(ActivatedRoute);
    const activeRouteProxy = {
      snapshot: componentRoute.snapshot,
      children: [],
    } as unknown as ActivatedRoute;
    const router = TestBed.inject(Router) as unknown as {
      navigate: ReturnType<typeof vi.fn>;
      routerState: { root: { children: unknown[] } };
    };
    router.routerState = {
      root: { children: [activeRouteProxy] },
    };

    component.ionViewWillEnter();
    component.ionViewDidEnter();

    expect(router.navigate).toHaveBeenCalledOnce();
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
        request: { queryType: QueryType.SQL, text: '' } as ISqlQueryRequest,
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
        { provide: ProjectMeaningsService, useValue: {} },
          {
            provide: GitHubProjectActivityService,
            useValue: githubProjectActivityStub(),
          },
          provideMockErrorLogger(),
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
              devicePersonal: { list: vi.fn(async () => []) },
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
          { provide: DetectiveClientService, useValue: detectiveClientStub() },
        { provide: QueryDispatchService, useValue: queryDispatchTestStub(fx) },
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
        title: queryDef.title,
        queryType: QueryType.SQL,
        request: queryDef.request,
        def: queryDef,
      },
    ],
  } as unknown as IQueryEditorState;

  async function createTugQLAuthor(
    source: string,
    projectEvents?: Observable<IProjectContext | undefined>,
  ): Promise<QueryPageComponent> {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'chinook-invoice-author',
      connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.DTQL, text: source } as ITextQueryRequest,
    };
    const created = await createComponent(
      {},
      definition,
      undefined,
      projectEvents ? { project: projectEvents } : undefined,
    );
    created.queryState = {
      ...created.queryState,
      id: definition.id,
      connectionId: definition.connectionId,
      queryType: QueryType.DTQL,
      request: definition.request,
    };
    created.project = {
      ref: { storeId: 'github.com', projectId: 'demo@buyer@project' },
      summary: {
        id: 'demo@buyer@project',
        title: 'Demo project',
        access: 'public',
      },
    };
    (
      created as unknown as { comparisonAccessProjectRef?: IProjectRef }
    ).comparisonAccessProjectRef = created.project.ref;
    created.comparisonProjectAccess.set('public');
    created.queryDef.set(definition);
    created.setAuthorMode('code');
    return created;
  }

  async function settleQueryPage(): Promise<void> {
    runFixture.detectChanges();
    await runFixture.whenStable();
  }

  const sourceDiscovery: PublicSqliteSourceDiscovery = {
    fixtureSha256: 'fixture-sha256',
    schemaVersion: 'schema-v1',
    invoiceFields: [
      { name: 'CustomerId', type: 'integer' },
      { name: 'InvoiceId', type: 'integer' },
      { name: 'InvoiceDate', type: 'datetime' },
    ],
    customerFields: [
      { name: 'CustomerId', type: 'integer' },
      { name: 'FirstName', type: 'string' },
      { name: 'LastName', type: 'string' },
      { name: 'Email', type: 'string' },
    ],
    relationship: {
      id: 'FK_Invoice_Customer_CustomerId',
      version: 'relationship-v1',
      from: { schema: 'main', table: 'Invoice' },
      to: { schema: 'main', table: 'Customer' },
      pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
    },
    relationshipProvenance: 'chinook.refs.json · Core v1 declared foreign key',
    cardinality: 'many invoices to one customer · declared',
    crossSourceCost: 'unknown',
  };

  const authorSource = [
    'parameters (',
    '  @CustomerId integer required',
    ')',
    'from Invoice as i',
    'where i.CustomerId = @CustomerId',
    'limit 100',
    'select i.InvoiceId, i.InvoiceDate',
    '',
  ].join('\n');

  // query-workspace#ac:author-workspace-clarity: explain the actual model gates.
  it('explains each Run gate and only previews after the explicit recovery action', async () => {
    component = await createTugQLAuthor(authorSource);
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    const prepare = vi
      .spyOn(sqlite, 'prepareTugQL')
      .mockResolvedValue(comparisonPreview(component.authorDraftRevision()));
    const run = vi.spyOn(sqlite, 'runTugQL');
    expect(component.authorRunReadiness()).toMatchObject({
      blocked: true,
      action: 'parameters',
      message: 'Customer ID is required to Run.',
    });
    expect(component.authorRunParameterWarning()).toBeUndefined();
    component.runQuery();
    expect(component.authorRunParameterWarning()).toBe(
      'Customer ID is required to Run.',
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    component.authorCustomerIdChanged(
      new CustomEvent('ionInput', { detail: { value: '1' } }),
    );
    expect(component.authorRunParameterWarning()).toBeUndefined();
    component.authorCustomerIdChanged(
      new CustomEvent('ionInput', { detail: { value: '' } }),
    );
    expect(component.authorRunParameterWarning()).toBeUndefined();
    component.authorCustomerIdChanged(
      new CustomEvent('ionInput', { detail: { value: '1.5' } }),
    );
    expect(component.authorRunParameterWarning()).toBeUndefined();
    expect(component.authorRunReadiness().message).toContain('whole number');
    component.runQuery();
    expect(component.authorRunParameterWarning()).toContain('whole number');
    expect(prepare).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    component.authorCustomerId.set('1');
    expect(component.authorRunParameterWarning()).toBeUndefined();
    component.authorCustomerIdChanged(
      new CustomEvent('ionInput', { detail: { value: '' } }),
    );
    expect(component.authorRunParameterWarning()).toBeUndefined();
    component.authorCustomerIdChanged(
      new CustomEvent('ionInput', { detail: { value: '1' } }),
    );
    expect(component.authorRunParameterWarning()).toBeUndefined();
    expect(component.authorRunReadiness()).toMatchObject({
      blocked: true,
      action: 'preview',
    });
    component.setAuthorMode('preview');
    component.authorContextTabChanged('related');
    expect(prepare).not.toHaveBeenCalled();
    component.recoverAuthorRun();
    expect(component.authorRunReadiness().message).toBe(
      'Preparing SQL preview…',
    );
    await runFixture.whenStable();
    expect(prepare).toHaveBeenCalledOnce();
    expect(component.authorRunReadiness().blocked).toBe(false);
    expect(run).not.toHaveBeenCalled();
    component.authorDraftRevision.update((value) => value + 1);
    expect(component.authorRunReadiness().action).toBe('preview');
    component.authorError.set('Unsupported source');
    expect(component.authorRunReadiness()).toMatchObject({
      blocked: true,
      action: 'code',
    });
    component.queryState = { ...component.queryState, isSaving: true };
    expect(component.authorRunReadiness().message).toBe('Saving query…');
    component.running.set(true);
    expect(component.authorRunReadiness().message).toBe('Running query…');
  });

  it('keeps an unsupported preview failure as a hard Run gate before an empty binding', async () => {
    component = await createTugQLAuthor(authorSource);
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    const prepare = vi
      .spyOn(sqlite, 'prepareTugQL')
      .mockRejectedValue(new Error('Unsupported source'));
    const run = vi.spyOn(sqlite, 'runTugQL');
    await component.previewTugql();
    expect(prepare).toHaveBeenCalledOnce();
    expect(component.authorError()).toBe('Unsupported source');
    expect(component.authorCustomerId()).toBe('');
    expect(component.authorRunReadiness()).toMatchObject({
      blocked: true,
      action: 'code',
    });
    component.runQuery();
    expect(component.authorRunParameterWarning()).toBeUndefined();
    component.authorCustomerIdChanged(
      new CustomEvent('ionInput', { detail: { value: '1' } }),
    );
    component.authorCustomerIdChanged(
      new CustomEvent('ionInput', { detail: { value: '' } }),
    );
    expect(component.authorError()).toBe('Unsupported source');
    expect(component.authorRunReadiness()).toMatchObject({
      blocked: true,
      action: 'code',
    });
    component.runQuery();
    expect(component.authorRunParameterWarning()).toBeUndefined();
    expect(prepare).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it('clears an attempted binding warning when project, environment, or security scope changes', async () => {
    component = await createTugQLAuthor(authorSource);
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    const prepare = vi.spyOn(sqlite, 'prepareTugQL');
    const run = vi.spyOn(sqlite, 'runTugQL');
    const sync = (): void =>
      (
        component as unknown as { syncScopeAndBindings(): void }
      ).syncScopeAndBindings();
    const originalProject = component.project;
    if (!originalProject)
      throw new Error('Expected the Author project fixture.');
    const originalEnvironment = component.envId;
    const originalSecurityContext = agentContext.securityContextId();
    const changes = [
      () => {
        component.project = {
          ...originalProject,
          ref: { ...originalProject.ref, projectId: 'other-project' },
        };
      },
      () => {
        component.envId = 'other-environment';
      },
      () => {
        agentContext.securityContextId.set('other-principal');
      },
    ];
    const restores = [
      () => {
        component.project = originalProject;
      },
      () => {
        component.envId = originalEnvironment;
      },
      () => {
        agentContext.securityContextId.set(originalSecurityContext);
      },
    ];
    for (let index = 0; index < changes.length; index++) {
      component.runQuery();
      expect(component.authorRunParameterWarning()).toBe(
        'Customer ID is required to Run.',
      );
      changes[index]();
      sync();
      expect(component.authorRunParameterWarning()).toBeUndefined();
      restores[index]();
      sync();
      expect(component.authorRunParameterWarning()).toBeUndefined();
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('releases preview loading after an asynchronous failure', async () => {
    component = await createTugQLAuthor(authorSource);
    component.authorCustomerId.set('1');
    let rejectPreview!: (error: Error) => void;
    vi.spyOn(
      TestBed.inject(PublicSqliteQueryService),
      'prepareTugQL',
    ).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectPreview = reject;
        }),
    );
    const pending = component.previewTugql();
    expect(component.authorPreviewLoading()).toBe(true);
    rejectPreview(new Error('Unsupported execution profile'));
    await pending;
    expect(component.authorPreviewLoading()).toBe(false);
    expect(component.authorRunReadiness()).toMatchObject({
      blocked: true,
      action: 'code',
    });
    expect(component.authorError()).toBe('Unsupported execution profile');
  });

  it('offers a useful runner limitation for a parameter-free draft without an input', async () => {
    component = await createTugQLAuthor(
      'from Invoice as i\nlimit 100\nselect i.InvoiceId\n',
    );
    expect(component.authorHasCustomerIdParameter()).toBe(false);
    expect(component.authorRunReadiness()).toMatchObject({
      blocked: true,
      action: 'code',
    });
    expect(component.authorRunReadiness().message).toContain(
      'parameter-free draft',
    );
    component.authorCodeChanged(authorSource);
    component.authorCustomerId.set('1');
    expect(component.authorHasCustomerIdParameter()).toBe(true);
    component.authorCodeChanged(
      'from Invoice as i\nlimit 100\nselect i.InvoiceId\n',
    );
    expect(component.authorHasCustomerIdParameter()).toBe(false);
    expect(component.authorCustomerIdValid()).toBe(true);
    component.authorPlan.set(
      comparisonPreview(component.authorDraftRevision()),
    );
    expect(component.authorRunReadiness()).toMatchObject({
      blocked: true,
      action: 'code',
    });
    component.authorContextTabChanged('related');
    component.recoverAuthorRun();
    expect(component.authorMode()).toBe('code');
    expect(component.workspaceTab()).toBe('tugql');
    expect(component.activeAuthorContextTab()).toBeUndefined();
  });

  it('allows a fresh explicit preview after editing a pending draft and fences the old finally', async () => {
    component = await createTugQLAuthor(authorSource);
    component.authorCustomerId.set('1');
    let resolveOld!: (plan: PublicSqliteQueryPreview) => void;
    let resolveNew!: (plan: PublicSqliteQueryPreview) => void;
    vi.spyOn(TestBed.inject(PublicSqliteQueryService), 'prepareTugQL')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve;
          }),
      );
    const pendingOld = component.previewTugql();
    const oldRevision = component.authorDraftRevision();
    expect(component.authorPreviewLoading()).toBe(true);
    component.authorCodeChanged(authorSource + '\n');
    expect(component.authorPreviewLoading()).toBe(false);
    expect(component.authorRunReadiness().action).toBe('preview');
    const pendingNew = component.previewTugql();
    expect(component.authorPreviewLoading()).toBe(true);
    resolveOld(comparisonPreview(oldRevision));
    await pendingOld;
    expect(component.authorPreviewLoading()).toBe(true);
    expect(component.authorPlan()).toBeUndefined();
    const currentPlan = comparisonPreview(component.authorDraftRevision());
    resolveNew(currentPlan);
    await pendingNew;
    expect(component.authorPreviewLoading()).toBe(false);
    expect(component.authorPlan()).toBe(currentPlan);
  });

  it('keeps equivalent-definition Preview success and failure current but discards edit-and-revert', async () => {
    component = await createTugQLAuthor(authorSource);
    component.authorCustomerId.set('1');
    let resolveFirst!: (plan: PublicSqliteQueryPreview) => void;
    let rejectSecond!: (error: Error) => void;
    let resolveThird!: (plan: PublicSqliteQueryPreview) => void;
    vi.spyOn(TestBed.inject(PublicSqliteQueryService), 'prepareTugQL')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectSecond = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveThird = resolve; }));

    const pendingFirst = component.previewTugql();
    const previousDefinition = component.queryDef();
    component.authorCustomerIdChanged(
      new CustomEvent('ionInput', { detail: { value: '1' } }),
    );
    // The unit's editor-state service is stubbed, so deliver the emitted
    // state to the real page handler. It rebuilds the effective definition.
    (component as unknown as {
      onQueryEditorStateChanged: (state: IQueryEditorState) => void;
    }).onQueryEditorStateChanged({
      currentQueryId: component.queryState.id,
      activeQueries: [{ ...component.queryState, def: previousDefinition }],
    } as IQueryEditorState);
    expect(component.queryDef()).not.toBe(previousDefinition);
    expect(component.queryDef()).toEqual(previousDefinition);
    const currentPlan = comparisonPreview(component.authorDraftRevision());
    resolveFirst(currentPlan);
    await pendingFirst;
    expect(component.authorPlan()).toBe(currentPlan);
    expect(component.authorRunReadiness().blocked).toBe(false);

    const pendingSecond = component.previewTugql();
    const currentDefinition = component.queryDef();
    component.authorCustomerIdChanged(
      new CustomEvent('ionInput', { detail: { value: '1' } }),
    );
    (component as unknown as {
      onQueryEditorStateChanged: (state: IQueryEditorState) => void;
    }).onQueryEditorStateChanged({
      currentQueryId: component.queryState.id,
      activeQueries: [{ ...component.queryState, def: currentDefinition }],
    } as IQueryEditorState);
    expect(component.queryDef()).not.toBe(currentDefinition);
    expect(component.queryDef()).toEqual(currentDefinition);
    rejectSecond(new Error('current preview failure'));
    await pendingSecond;
    expect(component.authorError()).toContain('current preview failure');
    expect(component.authorPlan()).toBeUndefined();

    const pendingThird = component.previewTugql();
    component.authorCodeChanged(`${authorSource}\n`);
    component.authorCodeChanged(authorSource);
    resolveThird(comparisonPreview(component.authorDraftRevision()));
    await pendingThird;
    expect(component.authorPlan()).toBeUndefined();
    expect(component.authorRunReadiness()).toMatchObject({
      blocked: true,
      action: 'preview',
    });
  });

  it('keeps the Current row on the focused or clicked row, never on the checked rows, and remembers the grid layout under an id-only key', async () => {
    component = await createTugQLAuthor(authorSource);
    const rawRows = [
      [{ type: 'integer', value: '121' }],
      [{ type: 'integer', value: '143' }],
    ] as const;
    component.runResult.set({
      ...historyResultFor(queryDef),
      recordset: {
        columns: [{ name: 'InvoiceId', type: 'integer' }],
        rows: rawRows,
      },
    } as FederatedQueryResult);
    await component.changeRelatedResultSet('affiliations');
    const rows = component.resultGridRows();
    const setSelected = vi.fn();
    const api = {
      getDisplayedRowAtIndex: (index: number) => ({
        data: rows[index],
        setSelected,
      }),
      refreshCells: vi.fn(),
      forEachNode: vi.fn(),
    };
    component.authorResultRowClicked({ api, data: rows[0] } as never);
    expect(component.currentAuthorResultRow()?.row).toBe(rawRows[0]);
    // Ticking the checkbox of the second row selects it for export and copy; the Current row stays.
    component.authorResultSelectionChanged({
      api,
      selectedNodes: [{ data: rows[1], isSelected: () => true }],
    } as never);
    expect(component.currentAuthorResultRow()?.row).toBe(rawRows[0]);
    // Moving the focus moves the Current row without checking anything.
    component.authorResultCellFocused({ rowIndex: 1, api } as never);
    expect(component.currentAuthorResultRow()?.row).toBe(rawRows[1]);
    const inspectedLeaf = component.currentAuthorResultRow();
    const snapshot = component.authorResultSnapshotKey();
    component.authorResultRowClicked({ api, node: { group: true }, data: rows[0] } as never);
    component.authorResultRowClicked({ api, node: { footer: true }, data: rows[0] } as never);
    component.authorResultCellFocused({ rowIndex: 2, api: { getDisplayedRowAtIndex: () => ({ group: true }) } } as never);
    expect(component.currentAuthorResultRow()).toBe(inspectedLeaf);
    expect(component.authorResultSnapshotKey()).toBe(snapshot);
    expect(component.resultGridAnalyticsScope()).toContain('2 loaded rows on page 1');
    expect(setSelected).not.toHaveBeenCalled();

    const key = component.resultGridStateKey();
    expect(key).toMatch(
      /^datatug\.grid\.v1:[^:]+:[^:]+:(query|source|result)$/,
    );
    expect(key).not.toContain('143');
    expect(key).not.toContain('InvoiceId');
  });

  it('keeps the inspected marker and sheet on the latest raw row, closes on replacement and restores caller focus', async () => {
    component = await createTugQLAuthor(authorSource);
    const rawRows = [
      [{ type: 'integer', value: '121' }],
      [{ type: 'integer', value: '143' }],
    ] as const;
    const result = {
      ...historyResultFor(queryDef),
      recordset: {
        columns: [{ name: 'InvoiceId', type: 'integer' }],
        rows: rawRows,
      },
    } as FederatedQueryResult;
    component.runResult.set(result);
    await component.changeRelatedResultSet('affiliations');
    const rows = component.resultGridRows();
    const refreshCells = vi.fn();
    const rule = component.authorResultRowClassRules['author-inspected-row'];
    if (typeof rule !== 'function')
      throw new Error('Expected an identity-based row rule');
    const appliedRules: [number, boolean][] = [];
    const nodes = rows.map((data, index) => ({
      data,
      setData: vi.fn(() => appliedRules.push([index, rule({ data } as never)])),
    }));
    const api = {
      getDisplayedRowAtIndex: () => ({ data: rows[1] }),
      refreshCells,
      forEachNode: (visit: (node: (typeof nodes)[number]) => void) =>
        nodes.forEach(visit),
    };
    component.authorResultRowClicked({ api, data: rows[0] } as never);
    component.authorResultCellFocused({ rowIndex: 1, api } as never);
    component.authorResultCellFocused({ rowIndex: null, api } as never);
    expect(component.currentAuthorResultRow()?.row).toBe(rawRows[1]);
    expect(appliedRules.slice(-2)).toEqual([
      [0, false],
      [1, true],
    ]);
    expect(nodes[0].setData).toHaveBeenCalledWith(rows[0]);
    expect(nodes[1].setData).toHaveBeenCalledWith(rows[1]);
    const renderer = component.resultGridColumnDefs()[0].cellRenderer;
    const cell = renderer({
      data: rows[1],
      value: '143',
      node: { rowIndex: 1 },
    });
    expect(
      cell.querySelector('[aria-label="Current row, position 2"]')?.textContent,
    ).toBe('▶');
    expect(
      renderer({ data: rows[0], value: '121', node: { rowIndex: 0 } })
        .textContent,
    ).toBe('121');
    expect(refreshCells).toHaveBeenCalledWith({
      columns: ['result_0'],
      force: true,
    });
    const caller = document.createElement('button');
    document.body.append(caller);
    component.openAuthorRowDetails({
      currentTarget: caller,
    } as unknown as Event);
    expect(component.authorRowDetailsOpen()).toBe(true);
    component.authorResultRowClicked({ data: rows[0], api } as never);
    expect(component.currentAuthorResultRow()?.row).toBe(rawRows[0]);
    component.authorRowDetailsDismissed();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    expect(document.activeElement).toBe(caller);
    component.openAuthorRowDetails({
      currentTarget: caller,
    } as unknown as Event);
    component.resultPageLoading.set(true);
    await runFixture.whenStable();
    expect(component.authorRowDetailsOpen()).toBe(false);
    component.resultPageLoading.set(false);
    component.openAuthorRowDetails({
      currentTarget: caller,
    } as unknown as Event);
    component.runResult.set({ ...result });
    expect(component.currentAuthorResultRow()).toBeUndefined();
    expect(rule({ data: rows[0] } as never)).toBe(false);
    expect(rule({ data: rows[1] } as never)).toBe(false);
    expect(rule({ data: {} } as never)).toBe(false);
    await runFixture.whenStable();
    expect(component.authorRowDetailsOpen()).toBe(false);
    component.authorResultRowClicked({ data: rows[1], api } as never);
    expect(component.currentAuthorResultRow()).toBeUndefined();
    caller.remove();
  });

  it('does not restore sheet focus into a connected cached page after leaving its route', async () => {
    component = await createTugQLAuthor(authorSource);
    component.runResult.set({
      ...historyResultFor(queryDef),
      recordset: {
        columns: [{ name: 'InvoiceId', type: 'integer' }],
        rows: [[{ type: 'integer', value: '1' }]],
      },
    } as FederatedQueryResult);
    await component.changeRelatedResultSet('affiliations');
    component.authorResultRowClicked({
      data: component.resultGridRows()[0],
    } as never);
    const caller = document.createElement('button');
    const destination = document.createElement('button');
    document.body.append(caller, destination);
    component.openAuthorRowDetails({
      currentTarget: caller,
    } as unknown as Event);
    component.ionViewWillLeave();
    destination.focus();
    component.authorRowDetailsDismissed();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    expect(document.activeElement).toBe(destination);
    caller.remove();
    destination.remove();
  });

  it('keeps unsupported declarations visible alongside the supported Customer ID control', async () => {
    component = await createTugQLAuthor(`parameters (
  @CustomerId integer required
  @Other string required
)
from Invoice as i
where i.CustomerId = @CustomerId
limit 100
select i.InvoiceId
`);
    expect(component.authorHasCustomerIdParameter()).toBe(true);
    expect(component.authorUnsupportedParameterNames()).toEqual(['Other']);
    const template = readFileSync(
      resolve(
        'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
      ),
      'utf8',
    );
    const panelStart = template.indexOf(
      'data-testid="author-parameters-panel"',
    );
    const supportedControls = template.indexOf(
      '@if (authorHasCustomerIdParameter())',
      panelStart,
    );
    const unsupportedDeclarations = template.indexOf(
      '@if (authorUnsupportedParameterNames().length)',
      supportedControls,
    );
    expect(unsupportedDeclarations).toBeGreaterThan(supportedControls);
    expect(
      template
        .slice(unsupportedDeclarations - 24, unsupportedDeclarations)
        .trimEnd(),
    ).toMatch(/\}\s*$/u);
  });

  it('does not report zero parameters while an invalid draft hides its declarations', async () => {
    component = await createTugQLAuthor(`parameters (
  @Other string required
)
from Invoice as i
select (
`);
    component.authorContextTabChanged('parameters');
    await settleQueryPage();

    expect(component.authorParameterDeclarationCount()).toBeUndefined();
    expect(component.authorParameterCountLabel()).toBe(
      'Parameter count unavailable',
    );
    const template = readFileSync(
      resolve(
        'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
      ),
      'utf8',
    );
    expect(template).toContain(
      'Parameter declarations are unavailable until TugQL diagnostics are corrected.',
    );
    const zeroParameterBranch = template.indexOf(
      '@else if (authorParameterDeclarationCount() === 0)',
    );
    expect(zeroParameterBranch).toBeGreaterThan(-1);
    expect(template).toContain(
      '@else if (authorParameterDeclarationCount() === undefined)',
    );
    expect(
      template.indexOf(
        'No query parameters are declared in this draft.',
        zeroParameterBranch,
      ),
    ).toBeGreaterThan(zeroParameterBranch);
  });

  it('requires explicit source metadata refresh after editing a valid draft in Sources', async () => {
    component = await createTugQLAuthor(authorSource);
    await settleQueryPage();
    const discovery = vi
      .spyOn(
        TestBed.inject(PublicSqliteQueryService),
        'discoverInvoiceCustomerSources',
      )
      .mockResolvedValue(sourceDiscovery);
    const execute = vi.spyOn(
      TestBed.inject(PublicSqliteQueryService),
      'runTugQL',
    );
    const prepare = vi.spyOn(
      TestBed.inject(PublicSqliteQueryService),
      'prepareTugQL',
    );
    component.authorContextTabChanged('sources');
    component.authorSourcesToggled(true);
    await vi.waitFor(() =>
      expect(component.authorSourceMetadata()).toBe(sourceDiscovery),
    );
    expect(discovery).toHaveBeenCalledTimes(1);
    expect(component.workspaceTab()).toBe('sources');

    component.queryTextChanged(
      new CustomEvent('ionInput', {
        detail: { value: authorSource.replace('limit 100', 'limit 99') },
      }),
      false,
    );
    expect(component.authorSourceMetadata()).toBeUndefined();
    expect(component.authorSourceMessage()).toContain(
      'metadata is stale. Refresh',
    );
    expect(discovery).toHaveBeenCalledTimes(1);
    await settleQueryPage();

    const pageTemplate = readFileSync(
      resolve(
        'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
      ),
      'utf8',
    );
    const sourceComponentTemplate = readFileSync(
      resolve(
        'libs/datatug/main/src/lib/queries/query/page/author-participating-sources.component.html',
      ),
      'utf8',
    );
    expect(pageTemplate).toContain(
      '(refreshRequested)="authorSourcesToggled(true)"',
    );
    expect(sourceComponentTemplate).toContain(
      'data-testid="author-sources-refresh"',
    );
    expect(sourceComponentTemplate).toContain('[disabled]="disabled()"');
    component.authorSourcesToggled(true);
    await vi.waitFor(() => expect(discovery).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(component.authorSourceMetadata()).toBe(sourceDiscovery),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('cancels late Sources discovery on tab exit and reads again only when Sources is reopened', async () => {
    component = await createTugQLAuthor(authorSource);
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    let completeFirst!: (value: typeof sourceDiscovery) => void;
    const discovery = vi.spyOn(sqlite, 'discoverInvoiceCustomerSources')
      .mockImplementationOnce(() => new Promise((resolve) => { completeFirst = resolve; }))
      .mockResolvedValue(sourceDiscovery);
    component.authorContextTabChanged('sources');
    component.authorSourcesToggled(true);
    expect(discovery).toHaveBeenCalledTimes(1);
    expect(component.authorSourceLoading()).toBe(true);

    component.setAuthorMode('code');
    expect(component.workspaceTab()).toBe('tugql');
    expect(component.activeAuthorContextTab()).toBeUndefined();
    expect(component.authorSourceLoading()).toBe(false);
    completeFirst(sourceDiscovery);
    await settleQueryPage();
    expect(component.authorSourceMetadata()).toBeUndefined();
    expect(discovery).toHaveBeenCalledTimes(1);

    component.authorContextTabChanged('sources');
    component.authorSourcesToggled(true);
    await vi.waitFor(() => expect(component.authorSourceMetadata()).toBe(sourceDiscovery));
    expect(discovery).toHaveBeenCalledTimes(2);
  });

  it('does not request or expose the Chinook catalog for a schema-qualified Invoice source', async () => {
    component = await createTugQLAuthor(`from other.Invoice as i
join Customer as c
  on i.CustomerId = c.CustomerId
select i.InvoiceId
`);
    const discovery = vi.spyOn(
      TestBed.inject(PublicSqliteQueryService),
      'discoverInvoiceCustomerSources',
    );
    expect(component.authorSourceMetadata()).toBeUndefined();
    expect(component.authorRelatedSourceCount()).toBeUndefined();

    component.authorSourcesToggled(true);

    await runFixture.whenStable();
    expect(discovery).not.toHaveBeenCalled();
    expect(component.authorSourceMetadata()).toBeUndefined();
  });

  it('does not claim catalog admission for an unsupported qualified Customer join', async () => {
    component = await createTugQLAuthor(`from Invoice as i
join other.Customer as c
  on i.CustomerId = c.CustomerId
select i.InvoiceId
`);
    const discovery = vi.spyOn(
      TestBed.inject(PublicSqliteQueryService),
      'discoverInvoiceCustomerSources',
    );
    component.authorContextTabChanged('sources');

    component.authorSourcesToggled(true);

    await runFixture.whenStable();
    expect(discovery).not.toHaveBeenCalled();
    expect(component.authorSourceMetadata()).toBeUndefined();
    expect(component.authorSourceMessage()).toContain(
      'only main.Invoice and the declared Invoice–Customer relationship',
    );
  });

  it('keeps Current row bound to the exact related recordset snapshot across context-tab changes', async () => {
    component = await createTugQLAuthor(authorSource);
    const mainRow = [{ type: 'integer', value: '1' }] as const;
    const relatedRow = [{ type: 'string', value: 'related-value' }] as const;
    const result = {
      ...historyResultFor(queryDef),
      recordset: {
        columns: [{ name: 'InvoiceId', type: 'integer' }],
        rows: [mainRow],
      },
      relatedRecordsets: [
        {
          id: 'locations',
          label: 'Related locations',
          parentSet: 'affiliations',
          parentField: 'InvoiceId',
          totalRows: 1,
          recordset: {
            columns: [{ name: 'Location', type: 'string' }],
            rows: [relatedRow],
          },
        },
      ],
    } as unknown as FederatedQueryResult;
    component.runResult.set(result);
    await component.changeRelatedResultSet('locations');
    const relatedSnapshotKey = component.authorResultSnapshotKey();

    expect(
      component.resultGridColumnDefs().map((column) => column.headerName),
    ).toEqual(['Location']);
    const gridRow = component.resultGridRows()[0];
    expect(gridRow).toEqual({ result_0: 'related-value' });
    component.authorResultRowClicked({ data: gridRow } as never);
    expect(component.authorResultSnapshotKey()).toBe(relatedSnapshotKey);
    expect(component.currentAuthorResultRow()?.recordset).toBe(
      component.displayedRecordset(),
    );
    expect(component.currentAuthorResultRow()?.row).toBe(relatedRow);

    component.authorContextTabChanged('related');
    expect(component.currentAuthorResultRow()?.row).toBe(relatedRow);
    expect(component.authorResultSnapshotKey()).toBe(relatedSnapshotKey);

    const replacement = {
      ...result,
      relatedRecordsets: [
        {
          ...result.relatedRecordsets?.[0],
          recordset: {
            columns: [{ name: 'Location', type: 'string' }],
            rows: [[{ type: 'string', value: 'replacement' }]],
          },
        },
      ],
    } as FederatedQueryResult;
    component.runResult.set(replacement);
    expect(component.authorResultSnapshotKey()).not.toBe(relatedSnapshotKey);
    expect(component.currentAuthorResultRow()).toBeUndefined();
    await runFixture.whenStable();
    expect(component.selectedAuthorResultRow()).toBeUndefined();
  });

  it('edits only a verified current InvoiceId into the draft, supports Undo, and refuses stale lineage', async () => {
    const joinedSource = authorSource.replace(
      'where i.CustomerId = @CustomerId',
      'join Customer as c\n  on i.CustomerId = c.CustomerId\nwhere i.CustomerId = @CustomerId',
    );
    component = await createTugQLAuthor(joinedSource);
    component.authorCustomerId.set('1');
    component.authorPlan.set(
      comparisonPreview(component.authorDraftRevision()),
    );
    const row = [{ type: 'integer', value: '143' }] as const;
    const result = {
      ...historyResultFor(queryDef),
      recordset: {
        columns: [{ name: 'InvoiceId', type: 'integer' }],
        rows: [row],
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
        draftRevision: component.authorDraftRevision(),
        outputColumns: [
          {
            name: 'InvoiceId',
            type: 'integer',
            lineage: [{ source: 'i', field: 'InvoiceId' }],
          },
        ],
        relationship: { fromSource: 'i' },
      },
    } as unknown as FederatedQueryResult;
    component.runResult.set(result);
    await component.changeRelatedResultSet('affiliations');
    const gridRow = component.resultGridRows()[0];
    component.authorResultRowClicked({ data: gridRow } as never);
    const selection = component.currentAuthorResultRow();
    expect(selection?.row).toBe(row);
    const editor = TestBed.inject(QueryEditorStateService);
    const save = vi.spyOn(editor, 'saveQuery');
    const run = vi.spyOn(TestBed.inject(PublicSqliteQueryService), 'runTugQL');
    const action = {
      index: 0,
      row,
      snapshotKey: component.authorResultSnapshotKey(),
    };

    component.useAuthorResultValueAsFilter(action);
    expect(component.queryBodyText()).toContain(
      'where i.CustomerId = @CustomerId and i.InvoiceId = 143',
    );
    expect(component.authorMode()).toBe('code');
    expect(component.authorRowFilterStatus()).toContain('Undo available');
    expect(run).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(component.runResult()).toBe(result);

    component.undoAuthorTugQLFormat();
    expect(component.queryBodyText()).toBe(joinedSource);
    expect(component.runResult()).toBe(result);
    expect(component.authorRowFilterStatus()).toBe('');
    component.useAuthorResultValueAsFilter(action);
    expect(component.queryBodyText()).toBe(joinedSource);
    expect(component.authorRowFilterStatus()).toContain('previous draft');
    component.queryTextChanged(
      new CustomEvent('ionInput', {
        detail: { value: joinedSource.replace('limit 100', 'limit 99') },
      }),
      false,
    );
    expect(component.authorRowFilterStatus()).toBe('');
  });

  it('uses the latest grid interaction and fetched-page raw row for Current row', async () => {
    component = await createTugQLAuthor(authorSource);
    const firstRaw = [{ type: 'integer', value: '1' }] as const;
    const secondRaw = [{ type: 'integer', value: '2' }] as const;
    const pageRaw = [{ type: 'integer', value: '101' }] as const;
    component.runResult.set({
      ...historyResultFor(queryDef),
      recordset: {
        columns: [{ name: 'InvoiceId', type: 'integer' }],
        rows: [firstRaw, secondRaw],
      },
      totalRows: 200,
      hasMore: true,
    } as FederatedQueryResult);
    await component.changeRelatedResultSet('affiliations');
    expect(component.resultTotalRowsKnown()).toBe(true);

    const rows = component.resultGridRows();
    component.authorResultRowClicked({ data: rows[0] } as never);
    expect(component.currentAuthorResultRow()?.row).toBe(firstRaw);

    component.authorResultCellFocused({
      rowIndex: 1,
      api: { getDisplayedRowAtIndex: () => ({ data: rows[1] }) },
    } as never);
    expect(component.currentAuthorResultRow()?.row).toBe(secondRaw);

    component.authorResultRowClicked({ data: rows[0] } as never);
    expect(component.currentAuthorResultRow()?.row).toBe(firstRaw);

    fx.dispatchPageResponse.mockResolvedValue([pageRaw as never]);
    await component.changeResultPage(1);
    expect(component.currentAuthorResultRow()).toBeUndefined();
    expect(component.resultPageLoading()).toBe(false);
    const pageRow = component.resultGridRows()[0];
    component.authorResultCellFocused({
      rowIndex: 0,
      api: { getDisplayedRowAtIndex: () => ({ data: pageRow }) },
    } as never);
    expect(component.currentAuthorResultRow()?.row).toBe(pageRaw);
    expect(component.currentAuthorResultRow()?.position).toBe(101);

    component.runResult.update(
      (current) =>
        ({
          ...current,
          totalRows: undefined,
          hasMore: true,
        }) as FederatedQueryResult,
    );
    expect(component.resultTotalRowsKnown()).toBe(false);
  });

  it('hands the focused result cell to the project cards pane by column name', async () => {
    component = await createTugQLAuthor(authorSource);
    component.runResult.set({
      ...historyResultFor(queryDef),
      recordset: {
        columns: [
          { name: 'InvoiceId', type: 'integer' },
          { name: 'CustomerID', type: 'string' },
        ],
        rows: [
          [
            { type: 'integer', value: '7' },
            { type: 'string', value: 'ALFKI' },
          ],
          [
            { type: 'integer', value: '8' },
            { type: 'null' },
          ],
        ],
      },
    } as unknown as FederatedQueryResult);
    await component.changeRelatedResultSet('affiliations');
    const rows = component.resultGridRows();
    const cards = { focusCell: vi.fn(), clear: vi.fn() };
    Object.defineProperty(component, 'resultCellCards', { value: () => cards });
    const api = { getDisplayedRowAtIndex: (i: number) => ({ data: rows[i] }) };
    try {
      component.authorResultCellFocused({
        rowIndex: 0,
        column: { getColId: () => 'result_1' },
        api,
      } as never);
      expect(cards.focusCell).toHaveBeenCalledWith(
        {
          identity: { column: 'CustomerID' },
          value: 'ALFKI',
          row: { InvoiceId: '7', CustomerID: 'ALFKI' },
        },
        expect.any(Function),
      );
      // the anchor is looked up inside this page's grid, not in the whole document
      const anchorOf = cards.focusCell.mock.calls[0][1] as () => Element | null;
      const host = (component as never as { pageHost: { nativeElement: HTMLElement } }).pageHost.nativeElement;
      const own = document.createElement('div');
      own.className = 'result-grid-viewport';
      own.innerHTML = '<div class="ag-cell-focus"></div>';
      host.appendChild(own);
      const foreign = document.createElement('div');
      foreign.className = 'result-grid-viewport';
      foreign.innerHTML = '<div class="ag-cell-focus" id="foreign"></div>';
      document.body.appendChild(foreign);
      expect(anchorOf()).toBe(own.firstElementChild);
      foreign.remove();
      own.remove();
      // a NULL cell is handed over as it is; the lookup itself skips it
      component.authorResultCellFocused({
        rowIndex: 1,
        column: 'result_1',
        api,
      } as never);
      expect(cards.focusCell).toHaveBeenLastCalledWith(
        expect.objectContaining({ identity: { column: 'CustomerID' }, value: null }),
        expect.any(Function),
      );
      // no row, a group row, or an unknown column clear the pane
      component.authorResultCellFocused({ rowIndex: null, column: 'result_0', api } as never);
      component.authorResultCellFocused({
        rowIndex: 0,
        column: 'result_0',
        api: { getDisplayedRowAtIndex: () => ({ group: true }) },
      } as never);
      component.authorResultCellFocused({ rowIndex: 0, column: 'ag-Grid-SelectionColumn', api } as never);
      expect(cards.clear).toHaveBeenCalledTimes(3);
    } finally {
      /* nothing to restore */
    }
  });

  it('clears the accepted page request after empty or short final pages update the result snapshot', async () => {
    component = await createTugQLAuthor(authorSource);
    const originalRow = [{ type: 'integer', value: '1' }] as const;
    component.runResult.set({
      ...historyResultFor(queryDef),
      recordset: {
        columns: [{ name: 'InvoiceId', type: 'integer' }],
        rows: [originalRow],
      },
      totalRows: undefined,
      hasMore: true,
    } as FederatedQueryResult);
    fx.dispatchPageResponse.mockResolvedValueOnce([]);

    await component.changeResultPage(1);

    expect(component.resultPageLoading()).toBe(false);
    expect(component.resultPageIndex()).toBe(0);
    expect(component.visibleResultRows()).toEqual([originalRow]);
    expect(component.resultTotalRows()).toBe(100);

    const currentResult = component.runResult();
    if (!currentResult)
      throw new Error('Expected the retained first-page result');
    component.runResult.set({
      ...currentResult,
      totalRows: 200,
      hasMore: true,
    });
    fx.dispatchPageResponse.mockResolvedValueOnce([originalRow] as never);
    await component.changeResultPage(1);
    expect(component.resultPageIndex()).toBe(1);
    expect(component.resultPageLoading()).toBe(false);
    expect(component.resultTotalRows()).toBe(101);
  });

  it.each(['new result', 'query scope invalidation'])(
    'retires an in-flight page request when the %s replaces its result',
    async (replacement) => {
      component = await createTugQLAuthor(authorSource);
      const firstResult = {
        ...historyResultFor(queryDef),
        totalRows: 200,
        hasMore: true,
      } as FederatedQueryResult;
      component.runResult.set(firstResult);
      let rejectPage!: (error: Error) => void;
      fx.dispatchPageResponse.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectPage = reject;
          }),
      );

      const pending = component.changeResultPage(1);
      expect(component.resultPageLoading()).toBe(true);

      let replacementResult: FederatedQueryResult | undefined;
      if (replacement === 'new result') {
        replacementResult = historyResultFor(queryDef);
        (
          component as unknown as {
            showAttemptResult(result: FederatedQueryResult): void;
          }
        ).showAttemptResult(replacementResult);
      } else {
        (
          component as unknown as { invalidateHistoryScope(): void }
        ).invalidateHistoryScope();
      }

      expect(component.resultPageLoading()).toBe(false);
      rejectPage(new Error('late page failure'));
      await pending;
      expect(component.resultPageLoading()).toBe(false);
      expect(component.runError()).toBeUndefined();
      if (replacementResult)
        expect(component.runResult()).toBe(replacementResult);
      else expect(component.runResult()).toBeUndefined();
    },
  );

  it('clears Current row when the same historical result id is reopened at a new generation', async () => {
    component = await createTugQLAuthor(authorSource);
    const service = TestBed.inject(FederatedQueryService);
    const firstRow = [{ type: 'integer', value: '1' }] as const;
    const replacementRow = [{ type: 'integer', value: '2' }] as const;
    const firstResult = {
      ...historyResultFor(queryDef),
      localResult: { id: 'same-result', generation: 1 },
      recordset: {
        columns: [{ name: 'InvoiceId', type: 'integer' }],
        rows: [firstRow],
      },
    } as FederatedQueryResult;
    const replacement = {
      ...firstResult,
      localResult: { id: 'same-result', generation: 2 },
      recordset: { ...firstResult.recordset, rows: [replacementRow] },
    } as FederatedQueryResult;
    vi.mocked(service.openLocalResult).mockResolvedValueOnce({
      result: firstResult,
      executedDefinition: queryDef,
      descriptor: {} as LocalResultDescriptor,
    } as Awaited<ReturnType<typeof service.openLocalResult>>);
    await component.openHistoricalResult('same-result');
    const firstGridRow = component.resultGridRows()[0];
    component.authorResultRowClicked({ data: firstGridRow } as never);
    expect(component.currentAuthorResultRow()?.row).toBe(firstRow);

    vi.mocked(service.openLocalResult).mockResolvedValueOnce({
      result: replacement,
      executedDefinition: queryDef,
      descriptor: {} as LocalResultDescriptor,
    } as Awaited<ReturnType<typeof service.openLocalResult>>);
    await component.openHistoricalResult('same-result');
    expect(component.selectedHistoricalResult()).toEqual(
      replacement.localResult,
    );
    expect(component.currentAuthorResultRow()).toBeUndefined();
    await runFixture.whenStable();
    expect(component.selectedAuthorResultRow()).toBeUndefined();
  });

  function comparisonPreview(
    draftRevision: number,
    overrides: Partial<PublicSqliteQueryPreview> = {},
  ): PublicSqliteQueryPreview {
    return {
      fixedBindings: [],
      bindingNames: ['CustomerId'],
      sql: 'SELECT i.InvoiceId, i.InvoiceDate FROM Invoice as i WHERE i.CustomerId = @CustomerId ORDER BY i.InvoiceId LIMIT 100',
      sourceId: 'chinook-sqlite',
      fixtureSha256: PUBLIC_CHINOOK_COMPARISON_TARGETS[0]?.sha256 ?? '',
      schemaVersion: 'schema-v1',
      draftRevision,
      authorProof: { profile: 'invoice-query', resolvedQuery: { limit: 100 } },
      outputColumns: [
        {
          name: 'InvoiceId',
          type: 'integer',
          lineage: [{ source: 'i', field: 'InvoiceId' }],
        },
        {
          name: 'InvoiceDate',
          type: 'string',
          lineage: [{ source: 'i', field: 'InvoiceDate' }],
        },
      ],
      relationship: {
        id: 'invoice-customer',
        version: 'schema-v1',
        fromSource: 'i',
        toSource: 'c',
        joinType: 'inner',
        pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
      },
      ...overrides,
    } as PublicSqliteQueryPreview;
  }

  function comparisonObservation(
    targetIndex: number,
  ): ComparisonWorkerObservation {
    const target = PUBLIC_CHINOOK_COMPARISON_TARGETS[targetIndex];
    if (!target) throw new Error('Expected a pinned comparison target.');
    return {
      kind: 'browser-session',
      targetId: target.id,
      fixtureSha256: target.sha256,
      schemaSha256: target.schemaSha256,
      schemaFingerprint: 'invoice-customer-schema-v1',
      columns: [
        { name: 'InvoiceId', type: 'integer' },
        { name: 'InvoiceDate', type: 'string' },
      ],
      executionId: `execution-${target.id}`,
      observedAt: '2026-10-11T12:00:00.000Z',
      rowCount: 1,
      rows: [[1001, '2022-03-11 00:00:00']],
      resultComplete: true,
    };
  }

  it('keeps cold open, Author/Compare view changes, and parameter-free Preview worker-free', async () => {
    component = await createTugQLAuthor(authorSource);
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    const preview = vi.spyOn(sqlite, 'prepareTugQL').mockResolvedValue({
      fixedBindings: [],
      bindingNames: ['CustomerId'],
      sourceId: 'chinook-sqlite',
      fixtureSha256: 'fixture-sha256',
      schemaVersion: 'schema-v1',
      draftRevision: component.authorDraftRevision(),
      authorProof: {
        profile: 'invoice-query',
        resolvedQuery: { limit: 100 },
      },
      relationship: {
        id: 'invoice-customer',
        version: 'schema-v1',
        fromSource: 'i',
        toSource: 'c',
        joinType: 'inner',
        pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
      },
    } as unknown as PublicSqliteQueryPreview);
    const compareSide = vi.spyOn(sqlite, 'runComparisonSide');
    const authorRun = vi.spyOn(sqlite, 'runTugQL');

    expect(component.comparisonSnapshot()).toBeUndefined();
    component.setQueryView('compare');
    component.setQueryView('author');
    const retainedPlan = comparisonPreview(component.authorDraftRevision());
    component.authorPlan.set(retainedPlan);
    component.authorCustomerId.set('7');
    component.setAuthorMode('preview');

    expect(component.authorMode()).toBe('preview');
    expect(component.authorPlan()).toBe(retainedPlan);
    expect(component.authorCustomerId()).toBe('7');
    expect(preview).not.toHaveBeenCalled();
    expect(authorRun).not.toHaveBeenCalled();

    component.authorPlan.set(undefined);
    await component.previewTugql();

    expect(preview).toHaveBeenCalledTimes(1);
    expect(compareSide).not.toHaveBeenCalled();
    expect(authorRun).not.toHaveBeenCalled();
  });

  it('shows the Customer ID panel for its declaration and keeps it during an incomplete edit', async () => {
    component = await createTugQLAuthor(authorSource);
    expect(component.authorHasCustomerIdParameter()).toBe(true);
    expect(component.authorParameterDeclarationCount()).toBe(1);

    const incompleteDraft = `${authorSource}and`;
    expect(parseTugQL(incompleteDraft).diagnostics.length).toBeGreaterThan(0);
    component.authorCodeChanged(incompleteDraft);
    expect(component.authorHasCustomerIdParameter()).toBe(true);
    expect(component.authorParameterDeclarationCount()).toBe(1);

    component.authorCodeChanged(
      'from Invoice as i\nlimit 10\nselect i.InvoiceId\n',
    );
    expect(component.authorHasCustomerIdParameter()).toBe(false);
    expect(component.authorParameterDeclarationCount()).toBe(0);
  });

  it('requires applying freshly proposed relationship completion before either comparison worker starts', async () => {
    component = await createTugQLAuthor(authorSource);
    await settleQueryPage();
    component.authorCustomerId.set('1');
    component.authorPlan.set(
      comparisonPreview(component.authorDraftRevision()),
    );
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    vi.spyOn(sqlite, 'prepareTugQL').mockResolvedValue(
      comparisonPreview(component.authorDraftRevision(), {
        expandedSource: `${authorSource}\njoin Customer as c on i.CustomerId = c.CustomerId`,
      }),
    );
    const compareSide = vi.spyOn(sqlite, 'runComparisonSide');

    expect(component.comparisonBlocker()).toContain('Ready');
    component.authorPlan.set(
      comparisonPreview(component.authorDraftRevision(), {
        expandedSource: `${authorSource}\njoin Customer as c on i.CustomerId = c.CustomerId`,
      }),
    );
    expect(component.comparisonBlocker()).toContain(
      'Review and apply the displayed relationship completion',
    );
    component.authorPlan.set(
      comparisonPreview(component.authorDraftRevision()),
    );
    await component.runComparisonBoth();

    expect(compareSide).not.toHaveBeenCalled();
    expect(component.comparisonSnapshot()).toBeUndefined();
    expect(component.comparisonMessage()).toContain(
      'Review and apply the displayed relationship completion',
    );
  });

  it('blocks the maintained integer-heavy projection before comparison workers start', async () => {
    component = await createTugQLAuthor(authorSource);
    await settleQueryPage();
    component.authorCustomerId.set('1');
    component.authorPlan.set(
      comparisonPreview(component.authorDraftRevision(), {
        outputColumns: [
          {
            name: 'InvoiceId',
            type: 'integer',
            lineage: [{ source: 'i', field: 'InvoiceId' }],
          },
          {
            name: 'CustomerId',
            type: 'integer',
            lineage: [{ source: 'i', field: 'CustomerId' }],
          },
          {
            name: 'FirstName',
            type: 'string',
            lineage: [{ source: 'c', field: 'FirstName' }],
          },
        ],
      }),
    );
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    const runSide = vi.spyOn(sqlite, 'runComparisonSide');

    expect(component.comparisonBlocker()).toContain(
      'Select InvoiceId plus supported text fields',
    );
    await component.runComparisonBoth();

    expect(runSide).not.toHaveBeenCalled();
    expect(component.comparisonSnapshot()).toBeUndefined();
  });

  it('allows an admitted public GitHub project without an agent context', async () => {
    component = await createTugQLAuthor(authorSource);
    agentContext.securityContextId.set(undefined);
    await settleQueryPage();
    component.authorCustomerId.set('1');
    component.authorPlan.set(
      comparisonPreview(component.authorDraftRevision()),
    );
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    vi.spyOn(sqlite, 'prepareTugQL').mockResolvedValue(
      comparisonPreview(component.authorDraftRevision()),
    );
    const runSide = vi
      .spyOn(sqlite, 'runComparisonSide')
      .mockImplementation(async (_project, _definition, _plan, target) =>
        comparisonObservation(target === 'chinook-baseline' ? 0 : 1),
      );

    expect(component.comparisonBlocker()).toContain('Ready');
    await component.runComparisonBoth();

    expect(runSide).toHaveBeenCalledTimes(2);
    expect(component.comparisonSnapshot()?.context).toMatchObject({
      accessClassification: 'public',
      pageMemoryScope: `public-github:${JSON.stringify(component.project?.ref)}`,
    });
    expect(component.comparisonSnapshot()?.context).not.toHaveProperty(
      'agentSecurityContextId',
    );
    expect(
      component.comparisonSnapshot()?.sides.map((side) => side.status),
    ).toEqual(['complete', 'complete']);
  });

  it.each(['private', 'protected', undefined] as const)(
    'blocks a %s or unknown project summary even when an agent context exists',
    async (access) => {
      component = await createTugQLAuthor(authorSource);
      await settleQueryPage();
      const project = component.project;
      if (!project) throw new Error('Test project should be available');
      component.project = {
        ...project,
        summary: access
          ? { id: 'demo@buyer@project', title: 'Demo project', access }
          : undefined,
      };
      (
        component as unknown as { comparisonAccessProjectRef?: IProjectRef }
      ).comparisonAccessProjectRef = project.ref;
      component.comparisonProjectAccess.set(access);
      (
        component as unknown as { syncScopeAndBindings(): void }
      ).syncScopeAndBindings();
      component.authorCustomerId.set('1');
      component.authorPlan.set(
        comparisonPreview(component.authorDraftRevision()),
      );
      const sqlite = TestBed.inject(PublicSqliteQueryService);
      const runSide = vi.spyOn(sqlite, 'runComparisonSide');

      expect(component.comparisonBlocker()).toContain(
        'Public project access is required',
      );
      await component.runComparisonBoth();
      await component.retryComparisonSide('chinook-baseline');
      await component.compareCompletedResults();

      expect(runSide).not.toHaveBeenCalled();
      expect(component.comparisonSnapshot()).toBeUndefined();
    },
  );

  it('invalidates active workers and blocks Retry and Compare on a public-to-private change', async () => {
    component = await createTugQLAuthor(authorSource);
    await settleQueryPage();
    component.authorCustomerId.set('1');
    component.authorPlan.set(
      comparisonPreview(component.authorDraftRevision()),
    );
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    const prepare = vi
      .spyOn(sqlite, 'prepareTugQL')
      .mockResolvedValue(comparisonPreview(component.authorDraftRevision()));
    const pending: {
      signal?: AbortSignal;
      resolve: (value: ComparisonWorkerObservation) => void;
    }[] = [];
    const runSide = vi
      .spyOn(sqlite, 'runComparisonSide')
      .mockImplementation(
        (_project, _definition, _plan, _target, signal) =>
          new Promise((resolve) => pending.push({ signal, resolve })),
      );
    const oldResult = {
      kind: 'session-comparison',
      diff: { summary: { changed: 1 } },
    } as never;

    const running = component.runComparisonBoth();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    component.comparisonResult.set(oldResult);
    const project = component.project;
    if (!project) throw new Error('Test project should be available');
    component.project = {
      ...project,
      summary: {
        id: 'demo@buyer@project',
        title: 'Demo project',
        access: 'private',
      },
    };
    (
      component as unknown as { comparisonAccessProjectRef?: IProjectRef }
    ).comparisonAccessProjectRef = project.ref;
    component.comparisonProjectAccess.set('private');
    (
      component as unknown as { syncScopeAndBindings(): void }
    ).syncScopeAndBindings();

    expect(pending.every((entry) => entry.signal?.aborted)).toBe(true);
    expect(component.comparisonSnapshot()?.invalidated).toBe(true);
    expect(component.comparisonBlocker()).toContain(
      'Public project access is required',
    );
    await component.retryComparisonSide('chinook-baseline');
    await component.compareCompletedResults();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(runSide).toHaveBeenCalledTimes(2);
    expect(component.comparisonResult()).toBe(oldResult);

    pending.forEach((entry, index) =>
      entry.resolve(comparisonObservation(index)),
    );
    await running;
    expect(
      component
        .comparisonSnapshot()
        ?.sides.some((side) => side.status === 'complete'),
    ).toBe(false);
    expect(component.comparisonResult()).toBe(oldResult);
  });

  it('clears public admission and fences active work when currentProject becomes undefined', async () => {
    const projectEvents = new Subject<IProjectContext | undefined>();
    component = await createTugQLAuthor(authorSource, projectEvents);
    await settleQueryPage();
    component.authorCustomerId.set('1');
    component.authorPlan.set(
      comparisonPreview(component.authorDraftRevision()),
    );
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    const prepare = vi
      .spyOn(sqlite, 'prepareTugQL')
      .mockResolvedValue(comparisonPreview(component.authorDraftRevision()));
    const pending: {
      signal?: AbortSignal;
      resolve: (value: ComparisonWorkerObservation) => void;
    }[] = [];
    const runSide = vi
      .spyOn(sqlite, 'runComparisonSide')
      .mockImplementation(
        (_project, _definition, _plan, _target, signal) =>
          new Promise((resolve) => pending.push({ signal, resolve })),
      );
    const previousResult = {
      kind: 'session-comparison',
      diff: { summary: { changed: 1 } },
    } as never;
    const sourceBeforeClear = component.queryBodyText();

    const running = component.runComparisonBoth();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    component.comparisonResult.set(previousResult);
    projectEvents.next(undefined);
    // Environment/query updates can sync bindings after navigation clears the
    // nav project. A retained page summary must not restore public admission.
    (
      component as unknown as { syncScopeAndBindings(): void }
    ).syncScopeAndBindings();

    expect(component.comparisonProjectAccess()).toBeUndefined();
    expect(component.comparisonSnapshot()?.invalidated).toBe(true);
    expect(pending.every((entry) => entry.signal?.aborted)).toBe(true);
    expect(component.comparisonBlocker()).toContain(
      'Public project access is required',
    );
    await component.retryComparisonSide('chinook-baseline');
    await component.compareCompletedResults();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(runSide).toHaveBeenCalledTimes(2);
    expect(component.queryBodyText()).toBe(sourceBeforeClear);
    expect(component.comparisonResult()).toBe(previousResult);

    pending.forEach((entry, index) =>
      entry.resolve(comparisonObservation(index)),
    );
    await running;
    expect(
      component
        .comparisonSnapshot()
        ?.sides.some((side) => side.status === 'complete'),
    ).toBe(false);
    expect(component.comparisonResult()).toBe(previousResult);
  });

  it('treats a route-only project reference as unknown until the matching public summary arrives', async () => {
    const projectEvents = new Subject<IProjectContext>();
    component = await createTugQLAuthor(authorSource, projectEvents);
    await settleQueryPage();
    component.authorCustomerId.set('1');
    component.authorPlan.set(
      comparisonPreview(component.authorDraftRevision()),
    );
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    const runSide = vi.spyOn(sqlite, 'runComparisonSide');
    const currentRef = component.project?.ref;
    if (!currentRef) throw new Error('Expected the maintained public project.');
    (
      component as unknown as { onProjRefChanged(ref: typeof currentRef): void }
    ).onProjRefChanged(currentRef);

    expect(component.comparisonProjectAccess()).toBe('public');
    expect(component.comparisonBlocker()).toContain('Ready');

    (
      component as unknown as {
        onProjRefChanged(ref: {
          storeId: string;
          projectId: string;
          branch: string;
        }): void;
      }
    ).onProjRefChanged({
      storeId: 'github.com',
      projectId: 'another/public/project',
      branch: 'main',
    });

    expect(component.comparisonProjectAccess()).toBeUndefined();
    expect(component.comparisonBlocker()).toContain(
      'Public project access is required',
    );
    await component.runComparisonBoth();
    expect(runSide).not.toHaveBeenCalled();

    projectEvents.next({
      ref: currentRef,
      summary: {
        id: 'demo@buyer@project',
        title: 'Old project',
        access: 'public',
      },
    });
    expect(component.project?.ref.projectId).toBe('another/public/project');
    expect(component.comparisonProjectAccess()).toBeUndefined();

    projectEvents.next({
      ref: {
        storeId: 'github.com',
        projectId: 'another/public/project',
        branch: 'main',
      },
      summary: {
        id: 'another/public/project',
        title: 'New project',
        access: 'public',
      },
    });
    expect(component.comparisonProjectAccess()).toBe('public');
  });

  it.each([
    ['schema metadata', { schemaVersion: 'schema-v2' }],
    ['compiled SQL', { sql: 'SELECT i.InvoiceId FROM Invoice as i LIMIT 99' }],
  ] as const)(
    'refuses fresh %s changes at the same draft revision and preserves the prior diff',
    async (_label, changed) => {
      component = await createTugQLAuthor(authorSource);
      await settleQueryPage();
      component.authorCustomerId.set('1');
      const reviewed = comparisonPreview(component.authorDraftRevision());
      component.authorPlan.set(reviewed);
      const sqlite = TestBed.inject(PublicSqliteQueryService);
      const prepare = vi
        .spyOn(sqlite, 'prepareTugQL')
        .mockResolvedValueOnce(reviewed)
        .mockResolvedValueOnce(
          comparisonPreview(component.authorDraftRevision(), changed),
        );
      const runSide = vi
        .spyOn(sqlite, 'runComparisonSide')
        .mockImplementation(async (_project, _definition, _plan, target) =>
          comparisonObservation(target === 'chinook-baseline' ? 0 : 1),
        );

      await component.runComparisonBoth();
      const previousSnapshot = component.comparisonSnapshot();
      const previousResult = {
        kind: 'session-comparison',
        diff: { summary: { changed: 0 } },
      } as never;
      component.comparisonResult.set(previousResult);
      expect(
        previousSnapshot?.sides.every((side) => side.status === 'complete'),
      ).toBe(true);
      const startsBeforeRecheck = runSide.mock.calls.length;

      await component.runComparisonBoth();

      expect(prepare).toHaveBeenCalledTimes(2);
      expect(runSide).toHaveBeenCalledTimes(startsBeforeRecheck);
      expect(component.comparisonSnapshot()).toBe(previousSnapshot);
      expect(component.comparisonResult()).toBe(previousResult);
      expect(component.comparisonMessage()).toContain('changed after Preview');
    },
  );

  it('retries only the failed side with the same frozen CustomerId binding', async () => {
    component = await createTugQLAuthor(authorSource);
    await settleQueryPage();
    component.authorCustomerId.set('1');
    component.authorPlan.set(
      comparisonPreview(component.authorDraftRevision()),
    );
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    vi.spyOn(sqlite, 'prepareTugQL').mockResolvedValue(
      comparisonPreview(component.authorDraftRevision()),
    );
    const calls: { target: string; bindings: readonly unknown[] }[] = [];
    let baselineAttempts = 0;
    vi.spyOn(sqlite, 'runComparisonSide').mockImplementation(
      async (_project, _definition, plan, target) => {
        calls.push({ target, bindings: plan.bindings });
        if (target === 'chinook-baseline' && baselineAttempts++ === 0)
          throw new Error('fixture network failure');
        return comparisonObservation(target === 'chinook-baseline' ? 0 : 1);
      },
    );

    await component.runComparisonBoth();
    expect(
      component.comparisonSnapshot(),
      component.comparisonMessage(),
    ).toBeDefined();
    expect(
      component.comparisonSnapshot()?.sides.map((side) => side.status),
    ).toEqual(['failed', 'complete']);
    expect(component.comparisonMessage()).toContain(
      'Baseline fixture query failed',
    );
    await component.retryComparisonSide('chinook-baseline');

    expect(calls.map((call) => call.target)).toEqual([
      'chinook-baseline',
      'chinook-candidate',
      'chinook-baseline',
    ]);
    expect(calls.map((call) => call.bindings)).toEqual([[1], [1], [1]]);
    expect(
      component.comparisonSnapshot()?.sides.map((side) => side.status),
    ).toEqual(['complete', 'complete']);
    expect(component.comparisonMessage()).toBe(
      'Both fixture queries completed with complete bounded results.',
    );
  });

  it('reports a cancelled side after the other fixture query completes', async () => {
    component = await createTugQLAuthor(authorSource);
    await settleQueryPage();
    component.authorCustomerId.set('1');
    component.authorPlan.set(
      comparisonPreview(component.authorDraftRevision()),
    );
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    vi.spyOn(sqlite, 'prepareTugQL').mockResolvedValue(
      comparisonPreview(component.authorDraftRevision()),
    );
    const pending: {
      target: string;
      signal?: AbortSignal;
      resolve: (value: ComparisonWorkerObservation) => void;
    }[] = [];
    vi.spyOn(sqlite, 'runComparisonSide').mockImplementation(
      (_project, _definition, _plan, target, signal) =>
        new Promise((resolve) =>
          pending.push({
            target,
            signal,
            resolve: (observation) => resolve(observation),
          }),
        ),
    );

    const running = component.runComparisonBoth();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    component.cancelComparisonSide('chinook-baseline');
    expect(component.comparisonMessage()).toContain(
      'Baseline fixture query was cancelled',
    );
    expect(component.comparisonMessage()).toContain(
      'Candidate fixture query is still running',
    );
    const baseline = pending.find(
      (entry) => entry.target === 'chinook-baseline',
    );
    const candidate = pending.find(
      (entry) => entry.target === 'chinook-candidate',
    );
    if (!baseline || !candidate)
      throw new Error('Expected both fixture queries to be running');
    baseline.resolve(comparisonObservation(0));
    candidate.resolve(comparisonObservation(1));
    await running;

    expect(
      pending.find((entry) => entry.target === 'chinook-baseline')?.signal
        ?.aborted,
    ).toBe(true);
    expect(
      component.comparisonSnapshot()?.sides.map((side) => side.status),
    ).toEqual(['cancelled', 'complete']);
    expect(component.comparisonMessage()).toContain(
      'Baseline fixture query was cancelled',
    );
  });

  it.each(['principal change', 'draft edit and byte-for-byte revert'] as const)(
    'fences a late fixture response after a %s',
    async (change) => {
      component = await createTugQLAuthor(authorSource);
      await settleQueryPage();
      component.authorCustomerId.set('1');
      component.authorPlan.set(
        comparisonPreview(component.authorDraftRevision()),
      );
      const sqlite = TestBed.inject(PublicSqliteQueryService);
      vi.spyOn(sqlite, 'prepareTugQL').mockResolvedValue(
        comparisonPreview(component.authorDraftRevision()),
      );
      const pending: {
        signal?: AbortSignal;
        resolve: (value: ComparisonWorkerObservation) => void;
      }[] = [];
      vi.spyOn(sqlite, 'runComparisonSide').mockImplementation(
        (_project, _definition, _plan, target, signal) =>
          new Promise((resolve) =>
            pending.push({
              signal,
              resolve: (observation) => resolve(observation),
            }),
          ),
      );

      const running = component.runComparisonBoth();
      await vi.waitFor(() => expect(pending).toHaveLength(2));
      if (change === 'principal change') {
        agentContext.securityContextId.set('sctx-next');
        await vi.waitFor(() =>
          expect(component.comparisonSnapshot()?.invalidated).toBe(true),
        );
      } else {
        component.queryTextChanged(
          new CustomEvent('ionInput', {
            detail: { value: authorSource.replace('limit 100', 'limit 99') },
          }),
          false,
        );
        component.queryTextChanged(
          new CustomEvent('ionInput', {
            detail: { value: authorSource },
          }),
          false,
        );
        expect(component.queryBodyText()).toBe(authorSource);
      }
      expect(pending.every((entry) => entry.signal?.aborted)).toBe(true);
      expect(component.comparisonSnapshot()?.invalidated).toBe(true);
      const invalidationMessage = component.comparisonMessage();
      pending.forEach((entry, index) =>
        entry.resolve(comparisonObservation(index)),
      );
      await running;

      expect(
        component
          .comparisonSnapshot()
          ?.sides.some((side) => side.status === 'complete'),
      ).toBe(false);
      expect(component.comparisonResult()).toBeUndefined();
      expect(component.comparisonMessage()).toBe(invalidationMessage);
    },
  );

  it('aborts in-flight fixture workers when the query page is destroyed', async () => {
    component = await createTugQLAuthor(authorSource);
    await settleQueryPage();
    component.authorCustomerId.set('1');
    component.authorPlan.set(
      comparisonPreview(component.authorDraftRevision()),
    );
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    vi.spyOn(sqlite, 'prepareTugQL').mockResolvedValue(
      comparisonPreview(component.authorDraftRevision()),
    );
    const pending: {
      signal?: AbortSignal;
      resolve: (value: ComparisonWorkerObservation) => void;
    }[] = [];
    vi.spyOn(sqlite, 'runComparisonSide').mockImplementation(
      (_project, _definition, _plan, _target, signal) =>
        new Promise((resolve) =>
          pending.push({
            signal,
            resolve: (observation) => resolve(observation),
          }),
        ),
    );

    const running = component.runComparisonBoth();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    component.ngOnDestroy();
    expect(pending.every((entry) => entry.signal?.aborted)).toBe(true);
    pending.forEach((entry, index) =>
      entry.resolve(comparisonObservation(index)),
    );
    await running;
    expect(component.comparisonSnapshot()).toBeUndefined();
    expect(component.comparisonResult()).toBeUndefined();
  });

  it('expires rows and retry eligibility when Ionic leaves the cached query page', async () => {
    component = await createTugQLAuthor(authorSource);
    await settleQueryPage();
    component.authorCustomerId.set('1');
    component.authorPlan.set(
      comparisonPreview(component.authorDraftRevision()),
    );
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    vi.spyOn(sqlite, 'prepareTugQL').mockResolvedValue(
      comparisonPreview(component.authorDraftRevision()),
    );
    const runSide = vi
      .spyOn(sqlite, 'runComparisonSide')
      .mockImplementation(async (_project, _definition, _plan, target) =>
        comparisonObservation(target === 'chinook-baseline' ? 0 : 1),
      );
    await component.runComparisonBoth();
    expect(
      component
        .comparisonSnapshot()
        ?.sides.every((side) => side.status === 'complete'),
    ).toBe(true);
    component.comparisonResult.set({ kind: 'session-comparison' } as never);

    component.ionViewWillLeave();
    await component.retryComparisonSide('chinook-baseline');

    expect(component.comparisonSnapshot()).toBeUndefined();
    expect(component.comparisonResult()).toBeUndefined();
    expect(component.comparisonCustomerBinding()).toBe(
      'No comparison pair has been run.',
    );
    expect(runSide).toHaveBeenCalledTimes(2);
  });

  it('aborts in-flight fixture workers and fences their late replies on Ionic leave', async () => {
    component = await createTugQLAuthor(authorSource);
    await settleQueryPage();
    component.authorCustomerId.set('1');
    component.authorPlan.set(
      comparisonPreview(component.authorDraftRevision()),
    );
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    vi.spyOn(sqlite, 'prepareTugQL').mockResolvedValue(
      comparisonPreview(component.authorDraftRevision()),
    );
    const pending: {
      signal?: AbortSignal;
      resolve: (value: ComparisonWorkerObservation) => void;
    }[] = [];
    vi.spyOn(sqlite, 'runComparisonSide').mockImplementation(
      (_project, _definition, _plan, _target, signal) =>
        new Promise((resolve) => pending.push({ signal, resolve })),
    );

    const running = component.runComparisonBoth();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    component.ionViewWillLeave();

    expect(pending.every((entry) => entry.signal?.aborted)).toBe(true);
    expect(component.comparisonSnapshot()).toBeUndefined();
    expect(component.comparisonResult()).toBeUndefined();
    pending.forEach((entry, index) =>
      entry.resolve(comparisonObservation(index)),
    );
    await running;
    expect(component.comparisonSnapshot()).toBeUndefined();
    expect(component.comparisonResult()).toBeUndefined();
  });

  it.each([
    ['principal', () => agentContext.securityContextId.set('sctx-changed')],
    [
      'environment',
      (target: QueryPageComponent) => {
        target.queryState = {
          ...target.queryState,
          activeEnv: { id: 'staging' } as never,
        };
      },
    ],
    [
      'review choices',
      (target: QueryPageComponent) => {
        target.authorSourceFieldChanged('FirstName', {
          currentTarget: { checked: false },
        } as unknown as Event);
      },
    ],
  ] as const)(
    'refuses an Apply whose %s changes while fresh source metadata is loading',
    async (_change, changeContext) => {
      component = await createTugQLAuthor(authorSource);
      let resolveApply!: (value: PublicSqliteSourceDiscovery) => void;
      const discovery = vi
        .spyOn(
          TestBed.inject(PublicSqliteQueryService),
          'discoverInvoiceCustomerSources',
        )
        .mockResolvedValueOnce(sourceDiscovery)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveApply = resolve;
            }),
        );
      const editor = TestBed.inject(QueryEditorStateService);
      const update = vi.spyOn(editor, 'updateQueryState');

      component.authorSourcesToggled(true);
      await vi.waitFor(() => expect(discovery).toHaveBeenCalledTimes(1));
      await vi.waitFor(() =>
        expect(component.authorSourceMetadata()).toBe(sourceDiscovery),
      );
      component.reviewAuthorRelationship();
      expect(component.authorSourceReview()).toBeDefined();

      const apply = component.applyAuthorRelationshipReview();
      await vi.waitFor(() => expect(discovery).toHaveBeenCalledTimes(2));
      changeContext(component);
      if (_change === 'principal')
        expect(component.authorSourceMetadata()).toBeUndefined();
      resolveApply(sourceDiscovery);
      await apply;

      expect(component.queryBodyText()).toBe(authorSource);
      expect(component.authorSourceReview()).toBeUndefined();
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('refuses a reviewed Apply after the draft is edited and restored byte-for-byte', async () => {
    component = await createTugQLAuthor(authorSource);
    const discovery = vi
      .spyOn(
        TestBed.inject(PublicSqliteQueryService),
        'discoverInvoiceCustomerSources',
      )
      .mockResolvedValue(sourceDiscovery);
    const update = vi.spyOn(
      TestBed.inject(QueryEditorStateService),
      'updateQueryState',
    );
    component.authorSourcesToggled(true);
    await vi.waitFor(() => expect(discovery).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(component.authorSourceMetadata()).toBe(sourceDiscovery),
    );
    component.reviewAuthorRelationship();
    const reviewedRevision = component.authorDraftRevision();

    component.queryTextChanged(
      new CustomEvent('ionInput', {
        detail: { value: authorSource.replace('limit 100', 'limit 99') },
      }),
      false,
    );
    component.queryTextChanged(
      new CustomEvent('ionInput', {
        detail: { value: authorSource },
      }),
      false,
    );
    expect(component.queryBodyText()).toBe(authorSource);
    expect(component.authorDraftRevision()).toBe(reviewedRevision + 2);

    await component.applyAuthorRelationshipReview();

    expect(discovery).toHaveBeenCalledTimes(1);
    expect(component.queryBodyText()).toBe(authorSource);
    expect(component.authorSourceReview()).toBeUndefined();
    expect(component.authorSourceMessage()).toContain('This review is stale');
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('applies the reviewed source and binding atomically while retaining the prior manual-binding result', async () => {
    component = await createTugQLAuthor(authorSource);
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    const discovery = vi
      .spyOn(sqlite, 'discoverInvoiceCustomerSources')
      .mockResolvedValue(sourceDiscovery);
    const execute = vi.spyOn(sqlite, 'runTugQL');
    const prepare = vi.spyOn(sqlite, 'prepareTugQL');
    const editor = TestBed.inject(QueryEditorStateService);
    const update = vi.spyOn(editor, 'updateQueryState');
    const priorResult = {
      bindingsApplied: [
        {
          parameterId: 'CustomerId',
          value: { type: 'integer', value: '1' },
          origin: 'manual',
          originEvidence: 'client-reported',
        },
      ],
      publicSqliteReceipt: {
        draftRevision: component.authorDraftRevision(),
        clientReportedBinding: { origin: 'manual', sourceColumn: 'CustomerId' },
      },
    };
    component.runResult.set(priorResult as never);
    expect(component.authorRelatedSourceCount()).toBeUndefined();
    component.authorContextTabChanged('sources');
    component.authorSourcesToggled(true);
    await vi.waitFor(() => expect(discovery).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(component.authorSourceMetadata()).toBe(sourceDiscovery),
    );
    expect(component.authorRelatedSourceCount()).toBe(1);
    component.reviewAuthorRelationship();
    expect(component.authorSourceSelectedFields()).toEqual(['FirstName']);
    component.authorSourceFieldSelectionChanged('FirstName', true);
    const reviewed = component.authorSourceReview();
    expect(reviewed?.after).toContain('join Customer as c');
    expect(reviewed?.after).toContain('c.FirstName');

    await component.applyAuthorRelationshipReview();
    expect(discovery).toHaveBeenCalledTimes(2);
    expect(component.workspaceTab()).toBe('tugql');
    expect(component.activeAuthorContextTab()).toBeUndefined();

    const definition = component.queryDef();
    expect((definition?.request as ITextQueryRequest | undefined)?.text).toBe(
      reviewed?.after,
    );
    expect(definition?.relationshipBindings).toEqual([
      sourceDiscovery.relationship,
    ]);
    expect(component.queryState.def).toBe(definition);
    expect(component.queryState.request).toBe(definition?.request);
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(component.queryState);
    expect(component.runResult()).toBe(priorResult);
    expect(component.publicSqliteRunIsStale(priorResult as never)).toBe(true);
    expect(component.authorCustomerIdOrigin()).toMatchObject({
      origin: 'manual',
      originEvidence: 'client-reported',
    });
    expect(component.authorSourceReview()).toBeUndefined();
    expect(component.authorFormatStatus()).toContain(
      'Applied the admitted join with FirstName outputs',
    );
    expect(component.authorSourceMessage()).toBe('');
    expect(execute).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('carries the save state on the Save button, announces progress outside it, and renames from the header', async () => {
    component = await createTugQLAuthor(authorSource);
    component.queryState = {
      ...component.queryState,
      title: component.queryDef()?.title,
      saveSupported: true,
    };
    expect(component.isChanged).toBe(false);
    expect(component.saveButtonLabel()).toBe(component.querySaveState());
    expect(component.saveButtonLabel()).not.toBe('Save');
    expect(component.canRenameQuery()).toBe(true);
    component.queryTitleChanged(
      new CustomEvent('ionChange', { detail: { value: 'Renamed query' } }),
    );
    expect(component.queryState.title).toBe('Renamed query');
    expect(component.isChanged).toBe(true);
    expect(component.saveButtonLabel()).toBe('Save');
    expect(component.saveAnnouncement()).toBe('');
    component.queryState = { ...component.queryState, isSaving: true };
    expect(component.saveButtonLabel()).toBe('Saving');
    expect(component.saveAnnouncement()).toBe('Saving');
  });

  it('applies the singleton admitted join immediately without outputs and undoes its source and binding together', async () => {
    component = await createTugQLAuthor(authorSource);
    component.queryState = {
      ...component.queryState,
      title: component.queryDef()?.title,
    };
    expect(component.isChanged).toBe(false);
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    vi.spyOn(sqlite, 'discoverInvoiceCustomerSources').mockResolvedValue(
      sourceDiscovery,
    );
    const execute = vi.spyOn(sqlite, 'runTugQL');
    const prepare = vi.spyOn(sqlite, 'prepareTugQL');
    const editor = TestBed.inject(QueryEditorStateService);
    const update = vi.spyOn(editor, 'updateQueryState');
    const priorResult = historyResultFor(queryDef);
    component.runResult.set(priorResult);
    component.authorContextTabChanged('sources');
    component.authorSourcesToggled(true);
    await vi.waitFor(() =>
      expect(component.authorSourceMetadata()).toBe(sourceDiscovery),
    );

    expect(component.authorCanJoinRelationship()).toBe(true);
    await component.joinAuthorRelationship();
    expect(sqlite.discoverInvoiceCustomerSources).toHaveBeenCalledTimes(2);
    expect(component.workspaceTab()).toBe('tugql');
    expect(component.activeAuthorContextTab()).toBeUndefined();

    expect(component.queryBodyText()).toContain('join Customer as c');
    expect(component.queryBodyText()).not.toContain('c.FirstName');
    expect(component.queryDef()?.relationshipBindings).toEqual([
      sourceDiscovery.relationship,
    ]);
    expect(component.isChanged).toBe(true);
    expect(component.querySaveState()).toContain('Unsaved');
    expect(component.authorSourceReview()).toBeUndefined();
    expect(component.runResult()).toBe(priorResult);
    expect(component.canUndoAuthorFormat()).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();

    component.undoAuthorTugQLFormat();
    expect(sqlite.discoverInvoiceCustomerSources).toHaveBeenCalledTimes(2);
    component.authorContextTabChanged('sources');
    component.authorSourcesToggled(true);
    await vi.waitFor(() =>
      expect(component.authorSourceMetadata()).toBe(sourceDiscovery),
    );
    expect(sqlite.discoverInvoiceCustomerSources).toHaveBeenCalledTimes(3);

    expect(component.queryBodyText()).toBe(authorSource);
    expect(component.queryDef()?.relationshipBindings).toBeUndefined();
    expect(component.isChanged).toBe(false);
    expect(component.runResult()).toBe(priorResult);
    expect(component.canUndoAuthorFormat()).toBe(false);
    expect(update).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('removes a reviewed Customer join and dependent outputs locally, then undoes source and binding together', async () => {
    component = await createTugQLAuthor(authorSource);
    component.queryState = {
      ...component.queryState,
      title: component.queryDef()?.title,
    };
    expect(component.isChanged).toBe(false);
    const sqlite = TestBed.inject(PublicSqliteQueryService);
    const discovery = vi
      .spyOn(sqlite, 'discoverInvoiceCustomerSources')
      .mockResolvedValue(sourceDiscovery);
    const execute = vi.spyOn(sqlite, 'runTugQL');
    const prepare = vi.spyOn(sqlite, 'prepareTugQL');
    const update = vi.spyOn(
      TestBed.inject(QueryEditorStateService),
      'updateQueryState',
    );
    const priorResult = historyResultFor(queryDef);
    component.runResult.set(priorResult);

    component.authorContextTabChanged('sources');
    component.authorSourcesToggled(true);
    await vi.waitFor(() =>
      expect(component.authorSourceMetadata()).toBe(sourceDiscovery),
    );
    component.reviewAuthorRelationship();
    await component.applyAuthorRelationshipReview();
    expect(component.queryBodyText()).toContain('c.FirstName');
    expect(component.queryDef()?.relationshipBindings).toEqual([
      sourceDiscovery.relationship,
    ]);
    expect(component.isChanged).toBe(true);

    expect(discovery).toHaveBeenCalledTimes(2);
    expect(component.workspaceTab()).toBe('tugql');
    component.authorContextTabChanged('sources');
    component.authorSourcesToggled(true);
    await vi.waitFor(() => expect(discovery).toHaveBeenCalledTimes(3));
    await vi.waitFor(() =>
      expect(component.authorSourceMetadata()).toBe(sourceDiscovery),
    );
    expect(component.authorCanRemoveCustomerJoin()).toBe(true);
    const joinedText = component.queryBodyText();
    component.requestAuthorCustomerJoinRemoval();
    expect(component.authorCustomerRemovalOpen()).toBe(true);
    expect(component.authorCustomerRemovalOutputs()).toEqual(['FirstName']);
    expect(component.queryBodyText()).toBe(joinedText);
    expect(execute).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();

    component.confirmAuthorCustomerJoinRemoval(true);
    await vi.waitFor(() =>
      expect(component.queryBodyText()).not.toContain('join Customer'),
    );
    expect(discovery).toHaveBeenCalledTimes(4);
    expect(component.workspaceTab()).toBe('tugql');
    expect(component.queryBodyText()).not.toContain('c.FirstName');
    expect(component.queryBodyText()).toContain('order by i.InvoiceId');
    expect(component.queryDef()?.relationshipBindings).toEqual([]);
    expect(component.isChanged).toBe(true);
    expect(component.runResult()).toBe(priorResult);
    expect(update).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(component.canUndoAuthorFormat()).toBe(true);

    component.undoAuthorTugQLFormat();
    expect(discovery).toHaveBeenCalledTimes(4);
    component.authorContextTabChanged('sources');
    component.authorSourcesToggled(true);
    await vi.waitFor(() =>
      expect(component.authorSourceMetadata()).toBe(sourceDiscovery),
    );
    expect(discovery).toHaveBeenCalledTimes(5);
    expect(component.queryBodyText()).toBe(joinedText);
    expect(component.queryDef()?.relationshipBindings).toEqual([
      sourceDiscovery.relationship,
    ]);
    expect(component.isChanged).toBe(true);
    expect(component.runResult()).toBe(priorResult);
    expect(component.canUndoAuthorFormat()).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('discloses the root LIMIT instead of a nested CTE LIMIT', async () => {
    const cteSource = `with Nested as (
  from Invoice as i
  limit 9
  select (
    i.InvoiceId
  )
)
from Nested as n
limit 17
select (
  n.InvoiceId
)
`;
    component = await createTugQLAuthor(cteSource);
    expect(component.authorCurrentLimit()).toBe('17');
  });

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
      request: {
        queryType: QueryType.SQL,
        text: 'SELECT 1',
      } as ISqlQueryRequest,
    });
    expect(component.canChoosePublicSqliteSource()).toBe(true);
  });

  it('shows the local-OVDB card, not the generic offline copy, when a local federation run fails with a real fetch TypeError', async () => {
    component = await createComponent();
    component.queryDef.set({
      ...queryDef,
      federation: {
        ovdbBaseUrl: 'http://127.0.0.1:50501',
        tables: [{ name: 'Invoice', database: 'orders', fields: ['id'] }],
      },
    } as IQueryDef);
    const scope = { project: 'p', environment: 'e', securityContextId: 's' };
    vi.spyOn(TestBed.inject(InvestigationContextService), 'isCurrentScope').mockReturnValue(true);
    (component as unknown as {
      handleRunError(err: unknown, request: unknown, scope: unknown): void;
    }).handleRunError(new TypeError('Failed to fetch'), { mode: 'live' }, scope);
    expect(component.runError()).not.toMatch(/failed to fetch/i);
    expect(component.localOvdbNeeded()).toMatchObject({ baseUrl: 'http://127.0.0.1:50501', databases: ['orders'] });
    // A later, unrelated error replaces the text: the card must go.
    component.runError.set('Save this query before running its hosted revision.');
    expect(component.localOvdbNeeded()).toBeUndefined();
  });

  describe('HTTP query bound from an Investigation Context selection', () => {
    const countryBinding = (
      origin: 'selection' | 'context' | 'default',
      blocked?: 'ambiguous' | 'missing-required',
    ) =>
      ({
        parameterId: 'name',
        meta: { entity: 'Country', field: 'Name' },
        ...(blocked === 'missing-required'
          ? {}
          : { value: { type: 'string', value: 'Canada' } }),
        origin,
        ...(blocked ? { blocked } : {}),
      }) as never;
    const asType = (queryType: QueryType): void =>
      component.queryDef.set({
        ...queryDef,
        request: { queryType, text: '' } as ISqlQueryRequest,
      });

    it('offers the resolved selection and context bindings to the HTTP editor, and a single semantic Run', async () => {
      component = await createComponent();
      asType(QueryType.HTTP);
      expect(component.httpSemanticRun()).toBe(false);
      component.bindings.set([countryBinding('selection')]);
      expect(component.httpBagEntries()).toEqual([
        { entity: 'Country', field: 'Name', kind: 'scalar', value: 'Canada' },
      ]);
      expect(component.httpSemanticRun()).toBe(true);
    });

    it('never offers a blocked or default-origin value, and a non-HTTP query keeps its own Run', async () => {
      component = await createComponent();
      asType(QueryType.HTTP);
      component.bindings.set([countryBinding('selection', 'ambiguous'), countryBinding('default')]);
      expect(component.httpBagEntries()).toEqual([]);
      component.bindings.set([countryBinding('default')]);
      expect(component.httpSemanticRun()).toBe(false);
      component.bindings.set([countryBinding('selection')]);
      asType(QueryType.SQL);
      expect(component.httpSemanticRun()).toBe(false);
    });

    it.each(['ambiguous', 'missing-required'] as const)(
      'keeps the semantic Run visible but off for a %s-only binding, with the reason shown by the binding row',
      async (blocked) => {
        component = await createComponent();
        asType(QueryType.HTTP);
        component.bindings.set([countryBinding('selection', blocked)]);
        expect(component.httpSemanticRun()).toBe(true);
        expect(component.hasBlockedBindings()).toBe(true);
        expect(component.nativeRunDisabled()).toBe(true);
        const html = readFileSync(
          resolve('libs/datatug/main/src/lib/queries/query/page/query-page.component.html'),
          'utf8',
        );
        expect(html).toContain("binding.blocked === 'ambiguous'");
        expect(html).toContain('required — no value supplied');
      },
    );
  });

  it('shows a Learn about TugQL link in the read-only note for TugQL queries only', async () => {
    // Render only the real template's read-only note block, so the test follows the shipped markup.
    const html = readFileSync(
      resolve('libs/datatug/main/src/lib/queries/query/page/query-page.component.html'),
      'utf8',
    );
    const start = html.indexOf('@if (isQueryReadOnly() && queryDef()) {');
    const end = html.indexOf('@if (demoDraftRecovery()', start);
    expect(start).toBeGreaterThan(-1);
    // A moved or renamed end marker must fail here, not slice an empty or truncated template.
    expect(end).toBeGreaterThan(start);
    component = await createComponent({}, queryDef, html.slice(start, end));
    component.project = {
      ref: { storeId: 'firestore', spaceID: 'space_1', projectId: 'project_1' },
    };
    component.queryState = { ...component.queryState, saveSupported: false };
    const link = () =>
      (runFixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="query-read-only-tugql-link"]',
      );
    component.queryDef.set({
      ...queryDef,
      request: { queryType: QueryType.TugQL, text: 'from: Artist' } as ITextQueryRequest,
    });
    runFixture.detectChanges();
    await runFixture.whenStable();
    expect(link()?.getAttribute('href')).toBe('https://tugql.org/');
    expect(link()?.getAttribute('target')).toBe('_blank');
    expect(link()?.getAttribute('rel')).toBe('noopener noreferrer');
    component.queryDef.set({
      ...queryDef,
      request: { queryType: QueryType.SQL, text: 'SELECT 1' } as ISqlQueryRequest,
    });
    runFixture.detectChanges();
    await runFixture.whenStable();
    expect(
      (runFixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="query-read-only-note"]',
      ),
    ).not.toBeNull();
    expect(link()).toBeNull();
  });

  it('keeps a Space query draft editable but refuses to execute unsaved SQL in the browser', async () => {
    component = await createComponent();
    component.project = {
      ref: { storeId: 'firestore', spaceID: 'space_1', projectId: 'project_1' },
    };
    component.queryState = { ...component.queryState, saveSupported: false };
    component.queryDef.set({
      ...queryDef,
      connectionId: 'chinook-sqlite',
      request: {
        queryType: QueryType.SQL,
        text: 'SELECT 1',
      } as ISqlQueryRequest,
    });
    const activity = TestBed.inject(
      GitHubProjectActivityService,
    ) as unknown as ReturnType<typeof githubProjectActivityStub>;
    const run = vi
      .spyOn(TestBed.inject(PublicSqliteQueryService), 'run')
      .mockImplementation(async (_ref, _definition, onDispatched) => {
        onDispatched?.();
        return {
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
        };
      });
    expect(component.canChoosePublicSqliteSource()).toBe(false); // Native project runtime never advertises a public SQLite connection.
    component.queryTextChanged(
      new CustomEvent('ionInput', { detail: { value: 'SELECT 2' } }),
    );
    expect(activity.reportForCurrentProject).toHaveBeenCalledWith(
      component.project.ref,
      'test-id',
      'query_edit',
    );
    activity.reportForCurrentProject.mockClear();
    component.runQuery();
    expect(run).not.toHaveBeenCalled();
    expect(component.runError()).toContain('Save this query');
    expect(activity.reportForCurrentProject).not.toHaveBeenCalledWith(
      component.project.ref,
      'test-id',
      'query_execution_dispatched',
    );
  });

  it('loads admitted hosted environments on a cold Space query route', async () => {
    const ref: IProjectRef = {
      storeId: 'firestore',
      spaceID: 'space_1',
      projectId: 'project_1',
    };
    const routeRef = { ...ref, spaceId: ref.spaceID };
    component = await createComponent({}, queryDef, '<p></p>', {
      project: of({ ref }),
      routeRef,
      routeId: queryDef.id,
      queries: { capabilities: vi.fn(() => of({ querySave: true })) },
    });
    const detective = TestBed.inject(DetectiveClientService);
    expect(detective.state).toHaveBeenCalledWith({
      kind: 'cloud',
      storage: 'firestore',
      spaceID: 'space_1',
      project: 'project_1',
    });
    expect(component.hostedDetectiveState()?.capabilities.canRead).toBe(true);
    expect(component.hostedEnvironment()).toBe('');
  });

  it('runs a saved hosted federation with an arbitrary server-admitted source through the real dispatcher', async () => {
    const ref: IProjectRef = { storeId: 'firestore', spaceID: 'paid-space', projectId: 'paid-project' };
    const definition: IQueryDef = { ...createHostedDemoDbQuery('reports/paid-customers'),
      connectionId: 'paid-source-outside-pinned-demo-catalog' };
    component = await createComponent({}, definition, '<p></p>', {
      project: of({ ref }), realDispatch: true,
      queries: { capabilities: vi.fn(() => of({ querySave: true })) },
    });
    component.project = { ref };
    component.queryDef.set(definition);
    component.queryState = { ...component.queryState, id: definition.id, def: definition,
      title: definition.title, request: definition.request, isNew: false };
    component.hostedDetectiveState.set({
      checks: [], validators: [], queryValidators: [], cases: [], runs: [], scenarios: [], runsHasMore: false,
      environments: ['production'], capabilities: { localOnly: false, canRead: true, canWrite: true,
        canRun: true, maxRows: 1000, maxFanout: 100 },
    });
    component.hostedEnvironment.set('production');
    const response = { result: {
      recordset: { columns: [{ name: 'CustomerId', type: 'integer' }], rows: [[{ type: 'integer', value: '42' }]] },
      limitations: [], bindingsApplied: [], truncated: false,
      provenance: { source: 'paid hosted source', queryId: definition.id, mode: 'snapshot', snapshotId: 'paid-snapshot',
        observedAt: '2026-10-16T00:00:00Z', executionProfile: 'protected' },
      execution: { storeId: 'firestore', projectId: 'paid-project', executionId: 'paid-exec-1' },
    }, queryRevision: 'paid-revision-1', resultFingerprint: 'a'.repeat(64) };
    const detective = TestBed.inject(DetectiveClientService);
    vi.mocked(detective.runHostedQuery).mockReturnValue(of(response as unknown as HostedQueryResponse));
    vi.mocked(detective.action).mockReturnValue(of({}));

    component.runQuery();
    await vi.waitFor(() =>
      expect(detective.runHostedQuery).toHaveBeenCalledExactlyOnceWith(
        { kind: 'cloud', storage: 'firestore', spaceID: 'paid-space', project: 'paid-project', principal: 'sarah' },
        definition.id, 'production', {}, expect.objectContaining({signal:expect.any(AbortSignal),operationId:expect.stringMatching(/^operation-/)}),
      ),
    );
    await vi.waitFor(()=>expect({error:component.runError(),cell:component.runResult()?.recordset.rows[0][0]}).toEqual({error:undefined,cell:{ type: 'integer', value: '42' }}));
    expect(TestBed.inject(ProjectQueryApiService).connectionCatalog).not.toHaveBeenCalled();
    expect(TestBed.inject(GithubProjectReaderService).getRawJson).not.toHaveBeenCalled();
    expect(TestBed.inject(BrowserSqliteQueryService).execute).not.toHaveBeenCalled();
    expect(TestBed.inject(HttpClient).post).not.toHaveBeenCalled();
  });

  it('loads a cold local Scenario target when the project-specific agent identity resolves', async () => {
    const ref = project.ref;
    const params = convertToParamMap({
      caseId: 'case-local',
      applicationId: 'application-local',
      scenarioStepId: 'step-local',
    });
    component = await createComponent({}, queryDef, '<p></p>', {
      project: of({ ref }),
      routeRef: ref,
      routeId: queryDef.id,
      queryParams: of(convertToParamMap({ id: queryDef.id })),
      securityContextId: null,
    });
    const route = TestBed.inject(ActivatedRoute);
    Object.defineProperty(route.snapshot, 'queryParamMap', {
      value: params,
      configurable: true,
    });
    const detective = TestBed.inject(DetectiveClientService);
    const caseItem = {
      id: 'case-local',
      title: 'Local investigation',
      status: 'active',
      version: 1,
      context: {},
      incidentRefs: [],
      scenarioRefs: [],
      runRefs: [],
      evidence: [],
      findings: [],
      timeline: [],
      scenarioApplications: [
        {
          id: 'application-local',
          scenarioId: 'scenario-local',
          scenarioVersion: 1,
          appliedAt: '2026-10-13T00:00:00Z',
          appliedBy: 'user',
          snapshot: {
            id: 'scenario-local',
            title: 'Cold route',
            version: 1,
            inputs: [],
            steps: [{ id: 'step-local', kind: 'query', ref: queryDef.id }],
          },
          steps: [{ stepId: 'step-local', status: 'pending' }],
        },
      ],
    };
    const state = {
      checks: [],
      validators: [],
      queryValidators: [],
      cases: [caseItem],
      runs: [],
      scenarios: [],
      runsHasMore: false,
      capabilities: {
        localOnly: true,
        canRead: true,
        canWrite: true,
        canRun: true,
        maxRows: 100,
        maxFanout: 10,
      },
    } as unknown as DetectiveState;
    vi.mocked(detective.state).mockReturnValue(of(state));

    expect(detective.state).not.toHaveBeenCalled();
    expect(component.hostedScenarioTarget()).toBeUndefined();
    agentContext.securityContextId.set('sctx-resolved');
    TestBed.tick();

    expect(detective.state).toHaveBeenCalledWith({
      kind: 'agent',
      agentStoreId: ref.storeId,
      project: ref.projectId,
      securityContextId: 'sctx-resolved',
      branch: undefined,
    });
    expect(component.hostedScenarioTarget()).toEqual({
      caseId: 'case-local',
      applicationId: 'application-local',
      stepId: 'step-local',
    });
    fx.localResultFixture.mockReturnValue(
      of({
        recordset: { columns: [], rows: [] },
        limitations: [],
        bindingsApplied: [],
        provenance: {
          source: 'sqlite',
          queryId: queryDef.id,
          mode: 'live',
          observedAt: '2026-10-13T00:00:00Z',
          executionProfile: 'protected',
        },
        truncated: false,
        execution: {
          storeId: ref.storeId,
          projectId: ref.projectId,
          executionId: 'local-execution-cold',
        },
      }),
    );
    component.runQuery();
    expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
      agentRequest: expect.objectContaining({ queryId: queryDef.id, record: true }),
    }));
  });

  it('cold-loads a folder-qualified hosted SQL route with its explicitly admitted env and project runtime instead of a public SQLite source', async () => {
    const ref:IProjectRef={storeId:'firestore',spaceID:'space',projectId:'training'};
    const definition:IQueryDef={id:'shipping/events',title:'Processing events',connectionId:'shipping-working-copy',request:{queryType:QueryType.SQL,text:'SELECT event_id FROM processing_events'} as ISqlQueryRequest};
    const nativeClient=detectiveClientStub();nativeClient.state.mockReturnValue(of({checks:[],validators:[],queryValidators:[],cases:[],runs:[],scenarios:[],runsHasMore:false,environments:['demo'],capabilities:{localOnly:false,canRead:true,canWrite:true,canRun:true,maxRows:1000,maxFanout:100}}));
    const nativeProject=new BehaviorSubject<IProjectContext|undefined>(undefined),routeRef={...ref,spaceId:ref.spaceID};
    component=await createComponent({},definition,'<p></p>',{project:nativeProject,routeId:definition.id,routeRef,urlParameters:{id:definition.id,env:'demo',runtime:'project',editor:'text'},detective:nativeClient,queries:{capabilities:vi.fn(()=>of({querySave:true}))}});
    nativeProject.next({ref});
    component.project={ref};component.queryDef.set(definition);component.queryState={...component.queryState,id:definition.id,def:definition,title:definition.title,request:definition.request,isNew:false};
    expect(component.canChoosePublicSqliteSource()).toBe(false);expect(component.selectedWorkingCopy()).toBe('project');
    await runFixture.whenStable();expect({environment:component.hostedEnvironment(),admitted:component.hostedDetectiveState()?.environments,calls:nativeClient.state.mock.calls.length}).toEqual({environment:'demo',admitted:['demo'],calls:expect.any(Number)});
    component.runQuery();await vi.waitFor(()=>expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({queryId:'shipping/events',environment:'demo',target:{kind:'hosted-cloud'},principal:'sarah'})));
  });

  it('correlates hosted Validator status only to the exact retained query execution', async () => {
    const savedDefinition: IQueryDef = {
      ...queryDef,
      request: { queryType: QueryType.DTQL, text: 'from:\n  name: Invoice\n' } as ITextQueryRequest,
      parameters: [],
    };
    component = await createComponent({}, savedDefinition, '<p></p>', {project:of({ref:{storeId:'firestore',spaceID:'space_1',projectId:'project_1'}}),queries:{capabilities:vi.fn(()=>of({querySave:true}))}});
    component.project = {
      ref: { storeId: 'firestore', spaceID: 'space_1', projectId: 'project_1' },
    };
    expect(component.isNativeDtqlWorkspace()).toBe(true);
    component.queryDef.set(savedDefinition);
    component.queryState = {
      ...component.queryState,
      def: savedDefinition,
      title: savedDefinition.title,
      request: savedDefinition.request,
      isNew: false,
    };
    component.hostedDetectiveState.set({
      checks: [],
      validators: [],
      queryValidators: [],
      cases: [],
      runs: [],
      scenarios: [],
      runsHasMore: false,
      environments: ['demo'],
      capabilities: {
        localOnly: false,
        canRead: true,
        canWrite: true,
        canRun: true,
        maxRows: 1000,
        maxFanout: 100,
      },
    });
    component.hostedEnvironment.set('demo');
    const detective = TestBed.inject(DetectiveClientService);
    const execution = {
      storeId: 'firestore',
      projectId: 'project_1',
      executionId: 'e1',
    };
    const result = {
      recordset: {
        columns: [{ name: 'InvoiceId', type: 'integer' }],
        rows: [
          [{ type: 'integer', value: '7' }],
          [{ type: 'integer', value: '9' }],
        ],
      },
      limitations: [],
      bindingsApplied: [],
      truncated: false,
      provenance: {
        source: 'hosted',
        queryId: queryDef.id,
        mode: 'snapshot',
        observedAt: '2026-10-13T00:00:00Z',
        executionProfile: 'protected',
      },
      execution,
    };
    fx.dispatchHostedResponse.mockReturnValue(
      {
        result: result as never,
        queryRevision: 'rev-1',
        resultFingerprint: 'sha256-1',
      },
    );
    const validate = vi.spyOn(detective, 'action').mockReturnValue(
      of({
        run: {
          id: 'run-1',
          kind: 'query-validators',
          queryId: queryDef.id,
          executionStatus: 'completed',
          outcome: 'fail',
          environment: 'demo',
          steps: [
            {
              stepId: 'query',
              kind: 'query',
              queryId: queryDef.id,
              execution,
              executionStatus: 'completed',
              outcome: 'fail',
              validators: [
                {
                  validatorId: 'invoice-check',
                  executionStatus: 'completed',
                  outcome: 'fail',
                  severity: 'error',
                  rowIndex: 1,
                  message: 'Invoice 9 failed',
                },
              ],
            },
          ],
        } as never,
      }),
    );
    expect(component.isChanged).toBe(false);
    component.runQuery();
    await runFixture.whenStable();
    await vi.waitFor(()=>expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'hosted-cloud' }, queryId: queryDef.id,
    })));
    await runFixture.whenStable();
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'project_1' }),
      {
        type: 'run-query-validators',
        queryId: queryDef.id,
        environment: 'demo',
        execution,
      },
      undefined, {signal:expect.any(AbortSignal)},
    );
    expect(component.runResult()).toBe(result);
    expect(
      component.resultGridRows().map((row) => row['validation_status']),
    ).toEqual(['unknown', 'fail']);
    component.hostedStatusFilter.set('fail');
    expect(component.resultGridAnalyticsScope()).toBe('Analytics use 1 loaded row on page 1; grouping and charts do not load other pages');
    expect(component.resultGridRows().map((row) => row['result_0'])).toEqual([
      '9',
    ]);
    component.selectHostedValidationRow({
      rowIndex: 1,
      queryId: queryDef.id,
      execution,
      nodePath: 'root/0/validator/0',
    });
    expect(component.hostedSelectedRowCells()?.[0].value).toBe('9');
    component.hostedSelectedRow.set(undefined);
    component.selectHostedValidationRow({
      rowIndex: 1,
      queryId: 'nested-child-query',
      execution: { ...execution, executionId: 'nested-receipt' },
      nodePath: 'root/0/validator/0/0/validator/0',
    });
    expect(component.hostedSelectedRowCells()).toBeUndefined();
    const caseItem = {
      id: 'case-1',
      title: 'Invoice mismatch',
      status: 'active',
      version: 2,
      context: {},
      incidentRefs: [],
      scenarioRefs: [],
      runRefs: [],
      evidence: [],
      findings: [],
      timeline: [],
      scenarioApplications: [
        {
          id: 'application-1',
          scenarioId: 'scenario-1',
          scenarioVersion: 1,
          appliedAt: '2026-10-13T00:00:00Z',
          appliedBy: 'user',
          snapshot: {
            id: 'scenario-1',
            title: 'Reconcile',
            version: 1,
            inputs: [],
            steps: [{ id: 'step-1', kind: 'query', ref: queryDef.id }],
          },
          steps: [{ stepId: 'step-1', status: 'pending' }],
        },
      ],
    };
    const priorState = component.hostedDetectiveState();
    if (!priorState)
      throw new Error('Hosted state was not seeded in this test.');
    const latest = { ...priorState, cases: [caseItem] };
    component.hostedDetectiveState.set(latest as never);
    const route = TestBed.inject(ActivatedRoute);
    Object.defineProperty(route.snapshot, 'queryParamMap', {
      value: convertToParamMap({
        caseId: 'case-1',
        applicationId: 'application-1',
        scenarioStepId: 'step-1',
      }),
      configurable: true,
    });
    vi.spyOn(detective, 'state').mockReturnValue(
      of(latest as unknown as DetectiveState),
    );
    validate.mockReturnValueOnce(
      of({ case: { ...caseItem, version: 3 } as never }),
    );
    await component.completeHostedScenarioStep();
    expect(validate).toHaveBeenLastCalledWith(
      expect.objectContaining({ project: 'project_1' }),
      {
        type: 'record-scenario-step',
        caseId: 'case-1',
        applicationId: 'application-1',
        stepId: 'step-1',
        stepStatus: 'completed',
        queryId: queryDef.id,
        environment: 'demo',
        execution,
      },
      2,
    );
    expect(component.hostedScenarioMessage()).toContain('recorded');
    expect(component.isHostedProject).toBe(true);
    expect(component.queryValidatorsHref).toContain('query=customer-invoices');
    const callsBeforePendingState = validate.mock.calls.length;
    const pendingState = new Subject<DetectiveState>();
    vi.spyOn(detective, 'state').mockReturnValue(pendingState);
    component.hostedDetectiveState.set({
      ...latest,
      cases: [caseItem],
    } as never);
    const originalQueryState = component.queryState;
    const statePending = component.completeHostedScenarioStep();
    component.queryState = { ...originalQueryState, id: 'another-query' };
    pendingState.next(latest as unknown as DetectiveState);
    await statePending;
    expect(validate).toHaveBeenCalledTimes(callsBeforePendingState);

    component.queryState = originalQueryState;
    component.hostedDetectiveState.set({
      ...latest,
      cases: [caseItem],
    } as never);
    const actionPending = new Subject<{ case: typeof caseItem }>();
    vi.spyOn(detective, 'state').mockReturnValue(
      of(latest as unknown as DetectiveState),
    );
    validate.mockReturnValueOnce(actionPending as never);
    const stateBeforeLateAction = component.hostedDetectiveState();
    const actionPendingCompletion = component.completeHostedScenarioStep();
    component.queryState = { ...originalQueryState, id: 'another-query' };
    actionPending.next({ case: { ...caseItem, version: 4 } });
    await actionPendingCompletion;
    expect(component.hostedDetectiveState()).toBe(stateBeforeLateAction);
    component.queryState = originalQueryState;
    component.hostedEnvironment.set('other');
    expect(component.activeHostedExecution()).toBeUndefined();
    expect(
      component.resultGridRows().map((row) => row['validation_status']),
    ).toEqual([undefined, undefined]);
    expect(
      vi.spyOn(TestBed.inject(PublicSqliteQueryService), 'run'),
    ).not.toHaveBeenCalled();

    component.hostedEnvironment.set('demo');
    expect(component.activeHostedExecution()).toBeDefined();
    const personal = {
      ...savedDefinition,
      id: 'device-personal-22222222-2222-2222-2222-222222222222',
    };
    const personalState = { ...originalQueryState, id: personal.id, def: personal };
    (component as unknown as {
      onQueryEditorStateChanged(state: IQueryEditorState): void;
    }).onQueryEditorStateChanged({
      currentQueryId: personal.id,
      activeQueries: [personalState],
    });
    expect(component.activeHostedExecution()).toBeUndefined();
    expect(component.isHostedProject).toBe(false);
    expect(component.queryValidatorsHref).toBeUndefined();
    const personalCase = {
      ...caseItem,
      scenarioApplications: caseItem.scenarioApplications.map(application => ({
        ...application,
        snapshot: { ...application.snapshot, steps: [{ id: 'step-1', kind: 'query', ref: personal.id }] },
      })),
    };
    component.hostedDetectiveState.set({ ...latest, cases: [personalCase] } as never);
    expect(component.hostedScenarioTarget()).toBeUndefined();
    const actionsBeforePersonal = validate.mock.calls.length;
    await component.completeHostedScenarioStep();
    expect(validate).toHaveBeenCalledTimes(actionsBeforePersonal);
  });

  it.each(['source rejected', 'dispatched', 'worker failed'])(
    'reports GitHub SQL only after worker dispatch: %s',
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
      component.queryDef.set({
        ...queryDef,
        connectionId: 'chinook-sqlite',
        parameters: [],
        request: {
          queryType: QueryType.SQL,
          text: 'SELECT 1',
        } as ISqlQueryRequest,
      });
      const activity = TestBed.inject(
        GitHubProjectActivityService,
      ) as unknown as ReturnType<typeof githubProjectActivityStub>;
      activity.reportForCurrentProject.mockClear();
      fx.dispatchBrowserResponse.mockImplementation(() => {
        expect(activity.reportForCurrentProject).not.toHaveBeenCalled();
        if (outcome === 'source rejected') throw new Error('Source refused');
        if (outcome === 'worker failed')
          return Promise.reject(new Error('Worker failed after dispatch'));
        return {
          recordset: { columns: [], rows: [] },
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
        };
      });
      component.runQuery();
      expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
        target: { kind: 'browser-sqlite' }, definition: expect.objectContaining({ connectionId: 'chinook-sqlite' }),
      }));
      await vi.waitFor(() => expect(component.running()).toBe(false));
      expect(activity.reportForCurrentProject).toHaveBeenCalledTimes(
        outcome === 'source rejected' ? 0 : 1,
      );
    },
  );

  it('keeps shared Save disabled for a query-use viewer and ignores stale project capabilities', async () => {
    const projects = new Subject<IProjectContext>();
    const first = new Subject<{ querySave: boolean }>();
    const second = new Subject<{ querySave: boolean }>();
    const capabilities = vi.fn((ref: IProjectRef) =>
      ref.projectId === 'project_1'
        ? first.asObservable()
        : second.asObservable(),
    );
    component = await createComponent({}, queryDef, '<p></p>', {
      project: projects,
      queries: { capabilities },
    });
    const firstRef: IProjectRef = {
      storeId: 'firestore',
      spaceID: 'space_1',
      projectId: 'project_1',
    };
    const secondRef: IProjectRef = {
      storeId: 'firestore',
      spaceID: 'space_1',
      projectId: 'project_2',
    };
    projects.next({ ref: firstRef });
    expect(component.canSaveQuery()).toBe(false);
    projects.next({ ref: secondRef });
    first.next({ querySave: true });
    expect(component.canSaveQuery()).toBe(false);
    second.next({ querySave: false });
    expect(component.canSaveQuery()).toBe(false);
    projects.next({ ref: firstRef });
    first.next({ querySave: true });
    expect(component.canSaveQuery()).toBe(true);
  });

  it('cold-loads a folder-qualified shared query from the route without a redundant ID parameter', async () => {
    const ref: IProjectRef = {
      storeId: 'firestore',
      spaceID: 'space_1',
      projectId: 'project_1',
    };
    const id = 'folder/genre-mix';
    const saved = toProjectQueryWire(
      {
        id: 'genre-mix',
        title: 'Genre mix',
        connectionId: 'chinook-sqlite',
        request: {
          queryType: QueryType.SQL,
          text: 'SELECT COUNT(*) FROM Track',
        } as ISqlQueryRequest,
      },
      id,
    );
    const getRevision = vi.fn(() =>
      of({
        query: saved,
        revision: 'revision-1',
        saveSupported: true,
      }),
    );
    component = await createComponent({}, queryDef, '<p></p>', {
      realEditor: true,
      project: of({ ref }),
      routeRef: ref,
      routeId: id,
      queries: {
        authentication: () =>
          of({ status: 'authenticated', user: { uid: 'actor_1' } }),
        authorityDenied: () => of(undefined),
        capabilities: () => of({ querySave: true }),
        getRevision,
      },
    });
    await vi.waitFor(() => expect(getRevision).toHaveBeenCalledWith(ref, id));
    expect(component.queryId).toBe(id);
    expect(component.queryDef()?.connectionId).toBe('chinook-sqlite');
    expect(component.queryBodyText()).toBe('SELECT COUNT(*) FROM Track');
  });

  it('does not read a shared query when path and explicit ID disagree', async () => {
    const ref: IProjectRef = {
      storeId: 'firestore',
      spaceID: 'space_1',
      projectId: 'project_1',
    };
    const getRevision = vi.fn();
    component = await createComponent({}, queryDef, '<p></p>', {
      realEditor: true,
      project: of({ ref }),
      routeRef: ref,
      routeId: 'genre-mix',
      urlQueryId: 'other-query',
      queries: {
        authentication: () =>
          of({ status: 'authenticated', user: { uid: 'actor_1' } }),
        authorityDenied: () => of(undefined),
        capabilities: () => of({ querySave: true }),
        getRevision,
      },
    });
    expect(getRevision).not.toHaveBeenCalled();
    expect(component.runError()).toContain('Query URL and query ID disagree');
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
    component.queryTextChanged(
      new CustomEvent('ionInput', { detail: { value: 'SELECT 2' } }),
    );
    component.queryTextChanged(
      new CustomEvent('ionInput', { detail: { value: 'SELECT 3' } }),
    );
    component.queryTextChanged(
      new CustomEvent('ionInput', { detail: { value: 'SELECT 3' } }),
      false,
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
      parameters: [],
      request: {
        queryType: QueryType.SQL,
        text: 'SELECT 1',
      } as ISqlQueryRequest,
    });
    const rows = Array.from({ length: 150 }, (_, index) => [
      { type: 'integer' as const, value: String(index) },
    ]);
    fx.dispatchBrowserResponse.mockImplementation(() => {
      return {
        recordset: { columns: [{ name: 'n', type: 'integer' }], rows },
        limitations: [],
        bindingsApplied: [],
        truncated: false,
        browserExecution: { runtime: 'sqlite-fixture', fixtureSha256: 'a'.repeat(64) },
        provenance: {
          source: 'Browser SQLite snapshot (Chinook)',
          queryId: queryDef.id,
          mode: 'snapshot',
          observedAt: '2026-10-09T00:00:00Z',
        },
      };
    });
    component.runQuery();
    expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'browser-sqlite' },
    }));
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
    expect(component.committedRun()?.scope.target).toBe('Browser SQLite snapshot (Chinook)');
    expect(fx.dispatchPageResponse).not.toHaveBeenCalled();
  });

  it('selects a registered working copy for an ordinary structured query and clears its result when switched', async () => {
    const definition: IQueryDef = {
      ...queryDef, id: 'folder/current-customers', connectionId: 'logical-ledger-v7', parameters: [],
      request: { queryType: QueryType.DTQL, text: 'from:\n  name: "customers"\nlimit: 10\n' } as ITextQueryRequest,
    };
    component = await createComponent({}, definition);
    component.project = { ref: { storeId: 'github.com', projectId: 'r@o@@main' } };
    const dispatcher = TestBed.inject(QueryDispatchService) as unknown as {
      availableWorkingCopies: ReturnType<typeof vi.fn>;
      advanceRevision(): void;
    };
    dispatcher.availableWorkingCopies.mockResolvedValue([{ selectionId: 'runtime-17', title: 'Edited copy' }]);
    await component.loadWorkingCopies();
    expect(component.workingCopyOptions()).toMatchObject([{ selectionId: 'runtime-17' }]);
    component.selectWorkingCopy('runtime-17');
    const result: FederatedQueryResult = {
      recordset: { columns: [{ name: 'Name', type: 'string' }], rows: [[{ type: 'string', value: 'edited' }]] },
      limitations: [], bindingsApplied: [], truncated: false,
      browserExecution: { runtime: 'ovdb-connection', connectionId: 'logical-ledger-v7', databaseId: 'copy-1', workingCopyModified: true },
      provenance: { source: 'Working copy Edited copy', queryId: definition.id, mode: 'live', observedAt: '2026-10-16T00:00:00Z' },
    };
    fx.dispatchOvdbResponse.mockResolvedValue(result);
    component.runQuery();
    expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
      projectRef: component.project.ref,
      runtimeSelectionId: 'runtime-17',
      definition,
    }));
    await runFixture.whenStable();
    expect(component.runResult()?.recordset.rows[0][0]).toEqual({ type: 'string', value: 'edited' });
    expect(component.committedRun()?.scope.target).toBe('Working copy Edited copy');
    component.selectWorkingCopy('project');
    expect(component.runResult()).toBeUndefined();
    dispatcher.availableWorkingCopies.mockResolvedValue([]);
    dispatcher.advanceRevision();
    runFixture.detectChanges();
    await runFixture.whenStable();
    expect(component.workingCopyOptions()).toEqual([]);

    dispatcher.availableWorkingCopies.mockResolvedValue([{ selectionId: 'runtime-18', title: 'Another edited copy' }]);
    await component.loadWorkingCopies();
    component.selectWorkingCopy('runtime-18');
    let complete!: (value: FederatedQueryResult) => void;
    fx.dispatchOvdbResponse.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    component.runQuery();
    expect(fx.dispatchStart).toHaveBeenLastCalledWith(expect.objectContaining({ runtimeSelectionId: 'runtime-18' }));
    dispatcher.availableWorkingCopies.mockResolvedValue([]);
    dispatcher.advanceRevision();
    runFixture.detectChanges();
    await Promise.resolve();
    runFixture.detectChanges();
    expect(component.selectedWorkingCopy()).toBe('runtime-18');
    expect(component.unavailableWorkingCopy()).toBe(true);
    complete(result);
    await runFixture.whenStable();
    expect(component.runResult()).toBeUndefined();
    expect(component.workingCopyOptions()).toEqual([]);
  });

  it('applies a Board runtime hint after live options load and keeps an unavailable hint fenced', async () => {
    const definition: IQueryDef = {
      ...queryDef, id: 'folder/current-customers', connectionId: 'logical-ledger-v7', parameters: [],
      request: { queryType: QueryType.DTQL, text: 'from:\n  name: "customers"\nlimit: 10\n' } as ITextQueryRequest,
    };
    const params = new BehaviorSubject(convertToParamMap({ id: definition.id, env: 'production', runtime: 'runtime-17' }));
    component = await createComponent({}, definition, undefined, { project: of(project), queryParams: params });
    const dispatcher = TestBed.inject(QueryDispatchService) as unknown as {
      availableWorkingCopies: ReturnType<typeof vi.fn>;
    };
    dispatcher.availableWorkingCopies.mockResolvedValue([{ selectionId: 'runtime-17', title: 'Edited copy' }]);
    runFixture.detectChanges();
    await runFixture.whenStable();
    expect(component.selectedWorkingCopy()).toBe('runtime-17');
    expect(component.unavailableWorkingCopy()).toBe(false);
    expect(dispatcher.availableWorkingCopies).toHaveBeenCalled();

    params.next(convertToParamMap({ id: definition.id, env: 'production', runtime: 'missing-runtime' }));
    dispatcher.availableWorkingCopies.mockResolvedValue([]);
    runFixture.detectChanges();
    await runFixture.whenStable();
    expect(component.selectedWorkingCopy()).toBe('missing-runtime');
    expect(component.unavailableWorkingCopy()).toBe(true);
    component.runQuery();
    expect(fx.dispatchStart).not.toHaveBeenCalled();
    component.selectWorkingCopy('project');
    expect(component.unavailableWorkingCopy()).toBe(false);
    params.next(convertToParamMap({ id: definition.id, env: 'production', runtime: 'project' }));
    expect(component.selectedWorkingCopy()).toBe('project');
    const editor = TestBed.inject(QueryEditorStateService);
    vi.mocked(editor.getQueryState).mockReturnValue({ id: definition.id, def: definition } as IQueryState);
    params.next(convertToParamMap({ id: definition.id, env: 'production', runtime: 'runtime-18' }));
    expect(editor.reloadQuery).toHaveBeenCalledWith(definition.id);
  });

  it('does not apply a late Board runtime lookup after the route explicitly chooses project runtime', async () => {
    const definition: IQueryDef = {
      ...queryDef, id: 'folder/current-customers', connectionId: 'logical-ledger-v7', parameters: [],
      request: { queryType: QueryType.DTQL, text: 'from:\n  name: "customers"\nlimit: 10\n' } as ITextQueryRequest,
    };
    const params = new BehaviorSubject(convertToParamMap({ id: definition.id, env: 'production', runtime: 'runtime-17' }));
    component = await createComponent({}, definition, undefined, { project: of(project), queryParams: params });
    const dispatcher = TestBed.inject(QueryDispatchService) as unknown as {
      availableWorkingCopies: ReturnType<typeof vi.fn>;
    };
    let finish!: (options: { selectionId: string; title: string }[]) => void;
    dispatcher.availableWorkingCopies.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    runFixture.detectChanges();
    await vi.waitFor(() => expect(dispatcher.availableWorkingCopies).toHaveBeenCalled());
    params.next(convertToParamMap({ id: definition.id, env: 'production', runtime: 'project' }));
    finish([{ selectionId: 'runtime-17', title: 'Old copy' }]);
    await runFixture.whenStable();
    expect(component.selectedWorkingCopy()).toBe('project');
    expect(component.workingCopyOptions()).toEqual([]);
  });

  it('cancels a pending project run when the same query route chooses a working copy', async () => {
    const definition: IQueryDef = { ...queryDef, parameters: [] };
    const params = new BehaviorSubject(convertToParamMap({ id: definition.id, env: 'production', runtime: 'project' }));
    component = await createComponent({}, definition, undefined, { project: of(project), queryParams: params });
    runFixture.detectChanges();
    await runFixture.whenStable();
    const pending = new Subject<RunQueryResponse>();
    fx.localResultFixture.mockReturnValue(pending);

    component.runQuery();
    expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({ kind: 'local-agent' }),
    }));
    expect(component.running()).toBe(true);

    params.next(convertToParamMap({ id: definition.id, env: 'production', runtime: 'runtime-17' }));
    expect(component.selectedWorkingCopy()).toBe('runtime-17');
    expect(component.running()).toBe(false);
    expect(fx.dispatchCancel).toHaveBeenCalled();

    pending.next({
      recordset: { columns: [{ name: 'Name', type: 'string' }], rows: [[{ type: 'string', value: 'stale' }]] },
      limitations: [], bindingsApplied: [], truncated: false,
      provenance: { source: 'Project agent', queryId: definition.id, mode: 'live',
        observedAt: '2026-10-16T00:00:00Z', executionProfile: 'protected' },
    });
    pending.complete();
    await runFixture.whenStable();
    expect(component.running()).toBe(false);
    expect(component.runResult()).toBeUndefined();
  });

  it('keeps a manual runtime and unsaved draft through normalized URL, environment and branch params', async () => {
    const definition: IQueryDef = {
      ...queryDef, id: 'folder/current-customers', connectionId: 'logical-ledger-v7', parameters: [],
      request: { queryType: QueryType.DTQL, text: 'from:\n  name: "customers"\n' } as ITextQueryRequest,
    };
    const params = new BehaviorSubject(convertToParamMap({ id: definition.id, env: 'production', runtime: 'runtime-17' }));
    component = await createComponent({}, definition, undefined, { project: of(project), queryParams: params });
    const dispatcher = TestBed.inject(QueryDispatchService) as unknown as {
      availableWorkingCopies: ReturnType<typeof vi.fn>;
    };
    dispatcher.availableWorkingCopies.mockResolvedValue([
      { selectionId: 'runtime-17', title: 'Old copy' }, { selectionId: 'runtime-18', title: 'New copy' },
    ]);
    runFixture.detectChanges();
    await runFixture.whenStable();
    component.selectWorkingCopy('runtime-18');
    const draft = { ...component.queryState, request: { queryType: QueryType.DTQL, text: 'edited draft' } as ITextQueryRequest };
    component.queryState = draft;
    const editor = TestBed.inject(QueryEditorStateService);
    vi.mocked(editor.getQueryState).mockReturnValue({ id: definition.id, def: definition } as IQueryState);
    params.next(convertToParamMap({ id: definition.id, env: 'production', runtime: 'runtime-17', editor: 'text' }));
    params.next(convertToParamMap({ id: definition.id, env: 'production', runtime: 'runtime-18', editor: 'text' }));
    params.next(convertToParamMap({ id: definition.id, env: 'production', runtime: 'runtime-18', branch: 'work' }));
    params.next(convertToParamMap({ id: definition.id, env: 'dev', runtime: 'runtime-18', branch: 'work' }));
    expect(component.selectedWorkingCopy()).toBe('runtime-18');
    expect(component.queryState).toBe(draft);
    expect(editor.reloadQuery).not.toHaveBeenCalled();
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
        parameters: [],
        request: {
          queryType: QueryType.SQL,
          text: 'SELECT 1',
        } as ISqlQueryRequest,
      };
      component.queryDef.set(definition);
      let resolveRun!: (
        result: Awaited<ReturnType<PublicSqliteQueryService['run']>>,
      ) => void;
      let rejectRun!: (error: Error) => void;
      fx.dispatchBrowserResponse.mockImplementation(
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
        request: {
          queryType: QueryType.SQL,
          text: 'SELECT 2',
        } as ISqlQueryRequest,
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

  it.each(['branch', 'environment'])(
    'fences a deferred browser result after the same query changes %s', async (change) => {
      component = await createComponent();
      const ref: IProjectRef = { storeId: 'github.com', projectId: 'demo@buyer@project', projectApi: 'cloud', branch: 'main' };
      component.project = { ref };
      component.envId = 'dev';
      component.queryDef.set({ ...queryDef, connectionId: 'chinook-sqlite', parameters: [],
        request: { queryType: QueryType.SQL, text: 'SELECT 1' } as ISqlQueryRequest });
      let resolveRun!: (value: FederatedQueryResult) => void;
      fx.dispatchBrowserResponse.mockImplementation(() => new Promise((resolve) => { resolveRun = resolve; }));
      component.runQuery();
      const captured = fx.dispatchStart.mock.lastCall?.[0] as QueryDispatchRequest;
      expect(captured.projectRef).toEqual(ref);
      expect(captured.environment).toBe('dev');
      if (change === 'branch') {
        (component as unknown as { onProjRefChanged(ref: IProjectRef): void }).onProjRefChanged({ ...ref, branch: 'release' });
        expect(fx.dispatchCancel).toHaveBeenCalled();
      } else {
        component.envId = 'prod';
      }
      resolveRun({ recordset: { columns: [{ name: 'n', type: 'integer' }], rows: [[{ type: 'integer', value: '1' }]] },
        limitations: [], bindingsApplied: [], truncated: false,
        provenance: { source: 'fixture', queryId: queryDef.id, mode: 'snapshot', observedAt: '2026-10-16T00:00:00Z' },
        browserExecution: { runtime: 'sqlite-fixture', fixtureSha256: 'a'.repeat(64) } });
      await runFixture.whenStable();
      expect(component.runResult()).toBeUndefined();
      expect(component.committedRun()).toBeUndefined();
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
      } as ITextQueryRequest,
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
      authorProof: testAuthorProof(),
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
      authorProof: testAuthorProof(),
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
      request: { queryType: QueryType.DTQL, text: source } as ITextQueryRequest,
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
      request: { queryType: QueryType.DTQL, text: source } as ITextQueryRequest,
    };
    component = await createComponent({}, definition);

    expect(component.authorMode()).toBe('code');
    component.setAuthorMode('compose');
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
      authorProof: testAuthorProof(),
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
      authorProof: testAuthorProof(),
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

  it('preflights Preview against the exact draft and exposes only a positioned parser error', async () => {
    const source = 'from Invoice as i\nselect\n  i.InvoiceId\n  i.InvoiceDate';
    component = await createTugQLAuthor(source);
    component.setAuthorMode('compose');
    const retainedResult = { recordset: { rows: [['prior']] } } as never;
    component.runResult.set(retainedResult);
    component.authorPlan.set({ sql: 'previous preview' } as never);
    const prepare = vi.spyOn(
      TestBed.inject(PublicSqliteQueryService),
      'prepareTugQL',
    );
    const run = vi.spyOn(TestBed.inject(PublicSqliteQueryService), 'runTugQL');

    await component.previewTugql();

    const exactDiagnostic = parseTugQL(source).diagnostics.find(
      (diagnostic) => diagnostic.span.start.line > 1,
    );
    expect(exactDiagnostic).toBeDefined();
    expect(component.queryBodyText()).toBe(source);
    expect(component.authorError()).toContain(exactDiagnostic?.message ?? '');
    expect(component.authorPreviewSyntaxDiagnostic()).toEqual(exactDiagnostic);
    expect(component.authorPlan()).toBeUndefined();
    expect(component.runResult()).toBe(retainedResult);
    expect(prepare).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();

    const definition = component.queryDef();
    if (!definition) throw new Error('Expected the current saved definition');
    component.queryDef.set({ ...definition });
    expect(component.authorPreviewSyntaxDiagnostic()).toBeUndefined();
  });

  it('does not expose a location for a parser sentinel and discards a Preview error after edit-and-revert', async () => {
    component = await createTugQLAuthor('select x');
    await component.previewTugql();
    expect(component.authorError()).toBeTruthy();
    expect(component.authorPreviewSyntaxDiagnostic()).toBeUndefined();

    const validSource = 'from Invoice as i\nlimit 10\nselect i.InvoiceId';
    component.authorCodeChanged(validSource);
    let rejectPreview!: (error: Error) => void;
    vi.spyOn(
      TestBed.inject(PublicSqliteQueryService),
      'prepareTugQL',
    ).mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectPreview = reject;
        }),
    );

    const pending = component.previewTugql();
    component.authorCodeChanged(`${validSource}\n`);
    component.authorCodeChanged(validSource);
    rejectPreview(new Error('obsolete preview failure'));
    await pending;

    expect(component.authorError()).toBeUndefined();
    expect(component.authorPreviewSyntaxDiagnostic()).toBeUndefined();
    expect(component.queryBodyText()).toBe(validSource);
  });

  it.each([
    { transition: 'Ionic leave', settlement: 'resolve' },
    { transition: 'Ionic leave', settlement: 'reject' },
    { transition: 'destroy', settlement: 'resolve' },
    { transition: 'destroy', settlement: 'reject' },
  ] as const)(
    'discards a deferred Preview $settlement after $transition',
    async ({ transition, settlement }) => {
      component = await createTugQLAuthor(
        'from Invoice as i\nlimit 10\nselect i.InvoiceId',
      );
      let resolvePreview!: (
        plan: Awaited<ReturnType<PublicSqliteQueryService['prepareTugQL']>>,
      ) => void;
      let rejectPreview!: (error: Error) => void;
      vi.spyOn(
        TestBed.inject(PublicSqliteQueryService),
        'prepareTugQL',
      ).mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            resolvePreview = resolve;
            rejectPreview = reject;
          }),
      );

      const pending = component.previewTugql();
      if (transition === 'Ionic leave') component.ionViewWillLeave();
      else runFixture.destroy();

      if (settlement === 'resolve') {
        resolvePreview({
          sql: 'SELECT "InvoiceId" FROM "Invoice" LIMIT 10',
          fixedBindings: Object.freeze([]),
          bindingNames: Object.freeze([]),
          sourceId: 'chinook-sqlite',
          fixtureSha256: 'fixture',
          schemaVersion: 'schema',
          draftRevision: 1,
          authorProof: testAuthorProof(),
        });
      } else {
        rejectPreview(new Error('stale Preview failure'));
      }
      await pending;

      expect(component.authorPlan()).toBeUndefined();
      expect(component.authorError()).toBeUndefined();
      expect(component.authorPreviewSyntaxDiagnostic()).toBeUndefined();
    },
  );

  it('does not attach a preview location to a later unrelated author error', async () => {
    component = await createTugQLAuthor(
      'from Invoice as i\nselect\n  i.InvoiceId\n  i.InvoiceDate',
    );
    await component.previewTugql();
    expect(component.authorPreviewSyntaxDiagnostic()).toBeDefined();

    const internals = component as unknown as {
      setAuthorError(message: string | undefined): void;
    };
    internals.setAuthorError('A later comparison failed.');

    expect(component.authorError()).toBe('A later comparison failed.');
    expect(component.authorPreviewSyntaxDiagnostic()).toBeUndefined();
  });

  it.each([
    'edit then revert',
    'same-content definition replacement',
    'query replacement',
    'project change',
    'environment change',
    'principal change',
    'leave Author',
    'leave route',
  ] as const)('invalidates the Preview location after %s', async (change) => {
    const source = 'from Invoice as i\nselect\n  i.InvoiceId\n  i.InvoiceDate';
    component = await createTugQLAuthor(source);
    await component.previewTugql();
    expect(component.authorPreviewSyntaxDiagnostic()).toBeDefined();
    const definition = component.queryDef();
    if (!definition) throw new Error('Expected the current definition');

    switch (change) {
      case 'edit then revert':
        component.authorCodeChanged(`${source}\n-- temporary edit`);
        component.authorCodeChanged(source);
        break;
      case 'same-content definition replacement':
        component.queryDef.set({ ...definition });
        break;
      case 'query replacement':
        component.queryState = { ...component.queryState, id: 'another-query' };
        break;
      case 'project change':
        component.project = {
          ref: { storeId: 'github.com', projectId: 'different-project' },
        };
        break;
      case 'environment change':
        component.envId = 'staging';
        break;
      case 'principal change':
        agentContext.securityContextId.set('different-principal');
        break;
      case 'leave Author':
        component.setQueryView('compare');
        break;
      case 'leave route':
        component.ionViewWillLeave();
        break;
    }

    expect(component.authorPreviewSyntaxDiagnostic()).toBeUndefined();
    expect(component.canNavigateToAuthorPreviewSyntaxDiagnostic()).toBe(false);
  });

  it('drops a pending Compose-to-Code location if the draft changes before the editor mounts', async () => {
    const source = 'from Invoice as i\nselect\n  i.InvoiceId\n  i.InvoiceDate';
    component = await createTugQLAuthor(source);
    component.setAuthorMode('compose');
    await component.previewTugql();
    expect(component.authorPreviewSyntaxDiagnostic()).toBeDefined();
    const navigate = vi.fn(() => true);
    Object.defineProperty(component, 'authorCodeEditor', {
      value: {
        isFormatDiagnosticNavigable: vi.fn(() => true),
        navigateToFormatDiagnostic: navigate,
      },
      configurable: true,
      writable: true,
    });

    component.navigateToAuthorPreviewSyntaxDiagnostic();
    expect(component.authorMode()).toBe('code');
    component.authorCodeChanged(`${source}\n-- changed before mount`);
    runFixture.detectChanges();
    await runFixture.whenStable();

    expect(component.authorPreviewSyntaxDiagnostic()).toBeUndefined();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reveals Code before navigating to an invalid-draft preview diagnostic', async () => {
    const source = 'from Invoice as i\nselect\n  i.InvoiceId\n  i.InvoiceDate';
    component = await createTugQLAuthor(source);
    component.setAuthorMode('preview');
    const execute = vi.spyOn(
      TestBed.inject(PublicSqliteQueryService),
      'runTugQL',
    );
    await component.previewTugql();
    expect(component.authorPreviewSyntaxDiagnostic()).toBeDefined();

    expect(component.canNavigateToAuthorPreviewSyntaxDiagnostic()).toBe(true);
    component.navigateToAuthorPreviewSyntaxDiagnostic();
    expect(component.authorMode()).toBe('code');
    runFixture.detectChanges();
    await runFixture.whenStable();

    expect(execute).not.toHaveBeenCalled();
  });

  it('uses exact displayed-source spans and retains the prior plan after a Format failure', async () => {
    const source = 'from Invoice as i\nselect i.InvoiceId\n    limit 4';
    component = await createTugQLAuthor(source);
    const retainedPlan = { sql: 'previous preview' } as never;
    component.authorPlan.set(retainedPlan);
    const prepare = vi.spyOn(
      TestBed.inject(PublicSqliteQueryService),
      'prepareTugQL',
    );
    const execute = vi.spyOn(
      TestBed.inject(PublicSqliteQueryService),
      'runTugQL',
    );
    const navigate = vi.fn(() => true);
    Object.defineProperty(component, 'authorCodeEditor', {
      value: { navigateToFormatDiagnostic: navigate },
      configurable: true,
      writable: true,
    });

    component.formatAuthorTugQL();

    const clauseOrder = component
      .authorFormatDiagnosticItems()
      .find((diagnostic) => diagnostic.code === 'clause_order');
    expect(clauseOrder?.span.start).toEqual({ line: 3, column: 5 });
    expect(component.queryBodyText()).toBe(source);
    expect(component.authorPlan()).toBe(retainedPlan);
    expect(component.authorFormatStatus()).toContain('was not changed');
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();

    if (!clauseOrder)
      throw new Error('Expected source-positioned clause diagnostic');
    component.navigateToAuthorFormatDiagnostic(clauseOrder);
    expect(navigate).toHaveBeenCalledWith(source, clauseOrder);
    expect(component.queryBodyText()).toBe(source);
    expect(component.authorPlan()).toBe(retainedPlan);
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('suppresses zero-width source sentinels, keeps real first-token spans, and caps navigation', async () => {
    component = await createTugQLAuthor('select x');
    component.formatAuthorTugQL();
    expect(component.authorFormatDiagnosticItems()).toEqual([]);

    component.authorCodeChanged('first bad statement');
    component.formatAuthorTugQL();
    expect(
      component
        .authorFormatDiagnosticItems()
        .some((diagnostic) => diagnostic.code === 'unsupported_statement'),
    ).toBe(true);

    const manyErrors = Array.from(
      { length: 8 },
      (_, index) => `bad${index}`,
    ).join('\n');
    component.authorCodeChanged(manyErrors);
    component.formatAuthorTugQL();
    expect(component.authorFormatDiagnosticItems()).toHaveLength(5);
    expect(component.authorFormatDiagnosticRemainder()).toBeGreaterThan(0);
    expect(component.authorFormatDiagnosticRemainder()).toBe(
      parseTugQL(manyErrors).diagnostics.filter(
        (diagnostic) => diagnostic.code !== 'expected_from',
      ).length - 5,
    );
  });

  it('invalidates format navigation on edits and equal-content definition replacement', async () => {
    const source = 'from Invoice as i\nselect i.InvoiceId\n    limit 4';
    component = await createTugQLAuthor(source);
    const navigate = vi.fn();
    Object.defineProperty(component, 'authorCodeEditor', {
      value: { navigateToFormatDiagnostic: navigate },
      configurable: true,
    });
    component.formatAuthorTugQL();
    const oldDiagnostic = component.authorFormatDiagnosticItems()[0];
    expect(oldDiagnostic).toBeDefined();
    expect(component.authorFormatDiagnosticItems().length).toBeGreaterThan(0);

    const sameDefinition = component.queryDef();
    if (!sameDefinition) throw new Error('Expected query definition');
    component.queryDef.set({ ...sameDefinition });
    expect(component.authorFormatDiagnosticItems()).toEqual([]);
    component.navigateToAuthorFormatDiagnostic(oldDiagnostic);
    expect(navigate).not.toHaveBeenCalled();

    component.queryDef.set(sameDefinition);
    component.formatAuthorTugQL();
    expect(component.authorFormatDiagnosticItems().length).toBeGreaterThan(0);
    component.authorCodeChanged(source);
    expect(component.authorFormatDiagnosticItems()).toEqual([]);
  });

  it('invalidates format locations when leaving and returning to Author or leaving the route', async () => {
    const source = 'from Invoice as i\nselect i.InvoiceId\n    limit 4';
    component = await createTugQLAuthor(source);
    const navigate = vi.fn();
    Object.defineProperty(component, 'authorCodeEditor', {
      value: { navigateToFormatDiagnostic: navigate },
      configurable: true,
      writable: true,
    });

    component.formatAuthorTugQL();
    const compareStaleDiagnostic = component.authorFormatDiagnosticItems()[0];
    expect(compareStaleDiagnostic).toBeDefined();

    component.setQueryView('compare');
    expect(component.authorFormatDiagnosticItems()).toEqual([]);
    component.navigateToAuthorFormatDiagnostic(compareStaleDiagnostic);
    expect(navigate).not.toHaveBeenCalled();

    component.setQueryView('author');
    expect(component.authorFormatDiagnosticItems()).toEqual([]);
    component.formatAuthorTugQL();
    const routeStaleDiagnostic = component.authorFormatDiagnosticItems()[0];
    expect(routeStaleDiagnostic).toBeDefined();
    component.ionViewWillLeave();
    expect(component.authorFormatDiagnosticItems()).toEqual([]);
    component.navigateToAuthorFormatDiagnostic(routeStaleDiagnostic);
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(['project', 'environment', 'principal'] as const)(
    'hides and rejects a format location after the live %s scope changes',
    async (scope) => {
      const source = 'from Invoice as i\nselect i.InvoiceId\n    limit 4';
      component = await createTugQLAuthor(source);
      const navigate = vi.fn();
      Object.defineProperty(component, 'authorCodeEditor', {
        value: { navigateToFormatDiagnostic: navigate },
        configurable: true,
      });
      component.formatAuthorTugQL();
      const oldDiagnostic = component.authorFormatDiagnosticItems()[0];
      expect(oldDiagnostic).toBeDefined();

      if (scope === 'project') {
        component.project = {
          ref: { storeId: 'github.com', projectId: 'different-project' },
        };
      } else if (scope === 'environment') {
        component.envId = 'staging';
      } else {
        agentContext.securityContextId.set('different-principal');
      }

      expect(component.authorFormatDiagnosticItems()).toEqual([]);
      component.navigateToAuthorFormatDiagnostic(oldDiagnostic);
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it('navigates only exact-source parse spans after formatting failure', async () => {
    const source = 'from Invoice as i\nselect i.InvoiceId\n    limit 4';
    component = await createTugQLAuthor(source);
    const retainedPlan = { sql: 'previous preview' } as never;
    component.authorPlan.set(retainedPlan);
    const prepare = vi.spyOn(
      TestBed.inject(PublicSqliteQueryService),
      'prepareTugQL',
    );
    const execute = vi.spyOn(
      TestBed.inject(PublicSqliteQueryService),
      'runTugQL',
    );
    const navigate = vi.fn(() => true);
    Object.defineProperty(component, 'authorCodeEditor', {
      value: { navigateToFormatDiagnostic: navigate },
      configurable: true,
    });

    component.formatAuthorTugQL();

    const clauseOrder = component
      .authorFormatDiagnosticItems()
      .find((diagnostic) => diagnostic.code === 'clause_order');
    expect(clauseOrder?.span.start).toEqual({ line: 3, column: 5 });
    expect(component.queryBodyText()).toBe(source);
    expect(component.authorPlan()).toBe(retainedPlan);
    expect(component.authorFormatStatus()).toContain('was not changed');
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();

    if (!clauseOrder)
      throw new Error('Expected source-positioned clause diagnostic');
    component.navigateToAuthorFormatDiagnostic(clauseOrder);
    expect(navigate).toHaveBeenCalledWith(source, clauseOrder);
    expect(component.queryBodyText()).toBe(source);
    expect(component.authorPlan()).toBe(retainedPlan);
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('suppresses only source-level zero-width navigation and caps the list at five', async () => {
    component = await createTugQLAuthor('select x');
    component.formatAuthorTugQL();
    expect(component.authorFormatDiagnosticItems()).toEqual([]);

    component.authorCodeChanged('first bad statement');
    component.formatAuthorTugQL();
    expect(
      component
        .authorFormatDiagnosticItems()
        .some((diagnostic) => diagnostic.code === 'unsupported_statement'),
    ).toBe(true);

    const manyErrors = Array.from(
      { length: 8 },
      (_, index) => `bad${index}`,
    ).join('\n');
    component.authorCodeChanged(manyErrors);
    component.formatAuthorTugQL();
    expect(component.authorFormatDiagnosticItems()).toHaveLength(5);
    expect(component.authorFormatDiagnosticRemainder()).toBeGreaterThan(0);
    expect(component.authorFormatDiagnosticRemainder()).toBe(
      parseTugQL(manyErrors).diagnostics.filter(
        (diagnostic) => diagnostic.code !== 'expected_from',
      ).length - 5,
    );
  });

  it('invalidates navigation on an edit or equal-content definition replacement', async () => {
    const source = 'from Invoice as i\nselect i.InvoiceId\n    limit 4';
    component = await createTugQLAuthor(source);
    const navigate = vi.fn();
    Object.defineProperty(component, 'authorCodeEditor', {
      value: { navigateToFormatDiagnostic: navigate },
      configurable: true,
    });
    component.formatAuthorTugQL();
    const oldDiagnostic = component.authorFormatDiagnosticItems()[0];
    expect(oldDiagnostic).toBeDefined();
    expect(component.authorFormatDiagnosticItems().length).toBeGreaterThan(0);

    const sameDefinition = component.queryDef();
    if (!sameDefinition) throw new Error('Expected query definition');
    component.queryDef.set({ ...sameDefinition });
    expect(component.authorFormatDiagnosticItems()).toEqual([]);
    component.navigateToAuthorFormatDiagnostic(oldDiagnostic);
    expect(navigate).not.toHaveBeenCalled();

    component.queryDef.set(sameDefinition);
    component.formatAuthorTugQL();
    expect(component.authorFormatDiagnosticItems().length).toBeGreaterThan(0);
    component.authorCodeChanged(source);
    expect(component.authorFormatDiagnosticItems()).toEqual([]);
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
      request: { queryType: QueryType.DTQL, text: source } as ITextQueryRequest,
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

    expect(component.authorMode()).toBe('code');
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
      request: { queryType: QueryType.DTQL, text: source } as ITextQueryRequest,
    };
    component = await createComponent({}, definition);
    component.setAuthorMode('compose');
    expect(component.authorMode()).toBe('compose');

    agentContext.securityContextId.set('sctx-2');
    await runFixture.whenStable();

    expect(component.authorMode()).toBe('code');
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
      request: {
        queryType: QueryType.DTQL,
        text: 'from Invoice as i',
      } as ITextQueryRequest,
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

  it('keeps both regions mounted and returns to the editor before focusing a lookup', async () => {
    const scenario = await createJoinedLookupScenario(
      '<sneat-query-workspace-layout><div query-workspace-editor><h2 #authorLookupHeading tabindex="-1">Invoice lookup</h2></div><div query-workspace-results>Results</div></sneat-query-workspace-layout>',
    );
    runFixture.detectChanges();
    await runFixture.whenStable();
    const layout = runFixture.debugElement.query(
      By.directive(QueryWorkspaceLayoutComponent),
    ).componentInstance as QueryWorkspaceLayoutComponent;
    const focusAuthorLookupAfterRender = vi.spyOn(
      component as unknown as { focusAuthorLookupAfterRender(): void },
      'focusAuthorLookupAfterRender',
    );
    const editorRegion = runFixture.nativeElement.querySelector(
      '#workspace-editor-pane',
    ) as HTMLElement;
    const resultsRegion = runFixture.nativeElement.querySelector(
      '#workspace-results-pane',
    ) as HTMLElement;
    const editorScroll = vi.fn();
    const resultsScroll = vi.fn();
    Object.defineProperty(editorRegion, 'scrollIntoView', {
      configurable: true,
      value: editorScroll,
    });
    Object.defineProperty(resultsRegion, 'scrollIntoView', {
      configurable: true,
      value: resultsScroll,
    });
    layout.showResults();
    expect(editorRegion.isConnected).toBe(true);
    expect(resultsRegion.isConnected).toBe(true);
    expect(resultsScroll).toHaveBeenCalledOnce();
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
    vi.mocked(scenario.router.navigate).mockImplementation(
      async (_commands, extras) => {
        const navigationInfo = extras?.info;
        setRouterNavigation(scenario.router, navigationInfo, 41);
        setRouteId(scenario.lookupDefinition.id);
        scenario.internals.setQueryId(scenario.lookupDefinition.id);
        runFixture.detectChanges();
        setRouterNavigation(scenario.router, navigationInfo, 41, true);
        return true;
      },
    );

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
    expect(editorScroll).toHaveBeenCalledOnce();
    expect(editorRegion.isConnected).toBe(true);
    expect(resultsRegion.isConnected).toBe(true);
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
    expect(fx.localResultFixture).not.toHaveBeenCalled();
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
              setRouterNavigation(scenario.router, extras?.info, 42, true);
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
    expect(
      TestBed.inject(ActivatedRoute).snapshot.queryParamMap.get('id'),
    ).toBe(scenario.definition.id);
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
    expect(vi.mocked(scenario.router.navigate).mock.calls[1][1]).toEqual(
      expect.objectContaining({ replaceUrl: true }),
    );
    expect(
      TestBed.inject(ActivatedRoute).snapshot.queryParamMap.get('id'),
    ).toBe(scenario.lookupDefinition.id);
    expect(scenario.editor.openQuery).toHaveBeenCalledWith(
      scenario.lookupDefinition.id,
    );
    expect(scenario.editor.openAuthorizedQuery).not.toHaveBeenCalled();
    expect(scenario.editor.updateQueryState).not.toHaveBeenCalled();
    expect(
      component.queryState.authorBindingProvenance?.['CustomerId']?.origin,
    ).toBe('manual');
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
    expect(
      component.queryState.authorBindingProvenance?.['CustomerId']?.origin,
    ).toBe('manual');
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
    await vi.waitFor(() => expect(emitLookupRoute).toBeTypeOf('function'));
    component.authorCustomerIdChanged(
      new CustomEvent('ionChange', { detail: { value: '2' } }),
    );
    emitLookupRoute();
    resolveLookupNavigation(true);
    await pending;

    expect(scenario.router.navigate).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(scenario.router.navigate).mock.calls[1][1]?.queryParams,
    ).toEqual(expect.objectContaining({ id: scenario.definition.id }));
    expect(vi.mocked(scenario.router.navigate).mock.calls[1][1]).toEqual(
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
                setRouterNavigation(scenario.router, extras?.info, 43, true);
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
      new CustomEvent('ionChange', {
        detail: { value: 'from Invoice as i -- keep local draft' },
      }),
    );
    resolveNavigation(true);
    await pending;

    expect(scenario.router.navigate).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(scenario.router.navigate).mock.calls[1][1]?.queryParams,
    ).toEqual(expect.objectContaining({ id: scenario.definition.id }));
    expect(scenario.editor.openAuthorizedQuery).not.toHaveBeenCalled();
    expect((component.queryState.request as ITextQueryRequest).text).toContain(
      'keep local draft',
    );
    expect(
      component.queryState.authorBindingProvenance?.['CustomerId']?.origin,
    ).toBe('manual');
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
    expect(fx.localResultFixture).not.toHaveBeenCalled();
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
    (
      component as unknown as { authorRunAbort?: AbortController }
    ).authorRunAbort = abortController;

    component.queryTextChanged(
      new CustomEvent('ionInput', {
        detail: { value: 'from Invoice as i limit 3' },
      }),
    );

    expect(abortController.signal.aborted).toBe(true);
    expect(component.running()).toBe(false);
    expect(component.authorDraftRevision()).toBe(1);
    expect((component.queryDef()?.request as ITextQueryRequest).text).toBe(
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
      request: {
        queryType: QueryType.DTQL,
        text: 'from Invoice as i',
      } as ITextQueryRequest,
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
    component = await createComponent({}, source, '<p></p>', {
      realEditor: true,
      queries,
      project: of(privateProject),
    });
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

    expect(getRevision).toHaveBeenCalledWith(privateProject.ref, target.id);
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

  it.each(['project-first', 'editor-first'])(
    'prefills only the admitted example after delayed %s rendering and preserves cleared state',
    async (order) => {
      const projects = new Subject<IProjectContext | undefined>();
      const editors = new Subject<IQueryEditorState>();
      const definition: IQueryDef = {
        ...queryDef,
        id: 'demodb/chinook-customer-invoice-join',
        connectionId: 'chinook-sqlite',
        request: {
          queryType: QueryType.DTQL,
          text: authorSource,
        } as ITextQueryRequest,
      };
      const created = await createComponent(
        {},
        definition,
        '<p>{{ customerInvoiceExample() }}:{{ authorCustomerId() }}</p>',
        { project: projects, editor: editors },
      );
      const route = TestBed.inject(ActivatedRoute);
      Object.defineProperty(route, 'snapshot', {
        configurable: true,
        value: {
          ...route.snapshot,
          queryParamMap: convertToParamMap({
            example: 'customer-invoices',
            id: definition.id,
          }),
        },
      });
      runFixture.detectChanges();
      const project = {
        ref: {
          storeId: 'github.com',
          projectId: 'datatug-demo-project@datatug@demo-project-1',
        },
        summary: {
          id: 'demo-project-1',
          title: 'Demo',
          access: 'public' as const,
        },
      };
      const state = {
        currentQueryId: definition.id,
        activeQueries: [
          {
            id: definition.id,
            queryType: QueryType.DTQL,
            request: definition.request,
            def: definition,
          },
        ],
      } as IQueryEditorState;
      if (order === 'project-first') {
        projects.next(project);
        editors.next(state);
      } else {
        editors.next(state);
        projects.next(project);
      }
      await runFixture.whenStable();
      expect(runFixture.nativeElement.textContent).toContain('true:1');
      expect(created.queryState.authorBindings?.['CustomerId']).toBe('1');
      expect(fx.localResultFixture).not.toHaveBeenCalled();
      created.authorCustomerIdChanged(
        new CustomEvent('ionInput', { detail: { value: '' } }),
      );
      editors.next({
        ...state,
        activeQueries: [
          { ...state.activeQueries[0], authorBindings: { CustomerId: '' } },
        ],
      });
      projects.next(project);
      await runFixture.whenStable();
      expect(created.authorCustomerId()).toBe('');
    },
  );

  it.each([
    [
      'wrong-token',
      'customer-invoices-2',
      'datatug-demo-project@datatug@demo-project-1',
      'public',
      undefined,
    ],
    [
      'private',
      'customer-invoices',
      'datatug-demo-project@datatug@demo-project-1',
      'private',
      undefined,
    ],
    [
      'other-ref',
      'customer-invoices',
      'datatug-demo-project@datatug@demo-project-1@main',
      'public',
      undefined,
    ],
    [
      'other-folder',
      'customer-invoices',
      'datatug-demo-project@datatug@demo-project-2',
      'public',
      undefined,
    ],
    [
      'existing-binding',
      'customer-invoices',
      'datatug-demo-project@datatug@demo-project-1',
      'public',
      '4',
    ],
    [
      'cleared-binding',
      'customer-invoices',
      'datatug-demo-project@datatug@demo-project-1',
      'public',
      '',
    ],
  ])(
    'keeps example binding bounded: %s',
    async (_name, token, projectId, access, binding) => {
      const created = await createTugQLAuthor(authorSource);
      const route = TestBed.inject(ActivatedRoute);
      Object.defineProperty(route, 'snapshot', {
        configurable: true,
        value: {
          ...route.snapshot,
          queryParamMap: convertToParamMap({
            example: token,
            id: 'demodb/chinook-customer-invoice-join',
          }),
        },
      });
      created.project = {
        ref: { storeId: 'github.com', projectId: projectId as string },
      };
      (
        created as unknown as { comparisonAccessProjectRef?: IProjectRef }
      ).comparisonAccessProjectRef = created.project.ref;
      created.comparisonProjectAccess.set(access as 'public' | 'private');
      created.queryState = {
        ...created.queryState,
        id: 'demodb/chinook-customer-invoice-join',
        ...(binding === undefined
          ? {}
          : { authorBindings: { CustomerId: binding } }),
      };
      const update = TestBed.inject(QueryEditorStateService).updateQueryState;
      vi.mocked(update).mockClear();
      (
        created as unknown as { initializeCustomerInvoiceExample(): void }
      ).initializeCustomerInvoiceExample();
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('handles marker-only route changes without prefilling the old query on navigation away or mismatched IDs', async () => {
    const params = new Subject<ReturnType<typeof convertToParamMap>>();
    const definition: IQueryDef = {
      ...queryDef,
      id: 'demodb/chinook-customer-invoice-join',
      connectionId: 'chinook-sqlite',
      request: {
        queryType: QueryType.DTQL,
        text: authorSource,
      } as ITextQueryRequest,
    };
    const created = await createComponent(
      {},
      definition,
      '<p>{{ customerInvoiceExample() }}</p>',
      { project: of(undefined), queryParams: params },
    );
    created.project = {
      ref: {
        storeId: 'github.com',
        projectId: 'datatug-demo-project@datatug@demo-project-1',
      },
    };
    (
      created as unknown as { comparisonAccessProjectRef?: IProjectRef }
    ).comparisonAccessProjectRef = created.project.ref;
    created.comparisonProjectAccess.set('public');
    const route = TestBed.inject(ActivatedRoute);
    const navigate = (id: string, marker?: string, routedId?: string) => {
      const queryParamMap = convertToParamMap({
        id,
        ...(marker ? { example: marker } : {}),
      });
      Object.defineProperty(route, 'snapshot', {
        configurable: true,
        value: {
          ...route.snapshot,
          queryParamMap,
          paramMap: convertToParamMap(routedId ? { queryId: routedId } : {}),
        },
      });
      params.next(queryParamMap);
    };
    navigate('other-query', 'customer-invoices');
    expect(created.authorCustomerId()).toBe('');
    navigate(definition.id, 'customer-invoices', 'other-query');
    expect(created.authorCustomerId()).toBe('');
    expect(created.customerInvoiceExample()).toBe(false);
    navigate(definition.id, 'customer-invoices');
    await runFixture.whenStable();
    expect(created.authorCustomerId()).toBe('1');
    expect(created.customerInvoiceExample()).toBe(true);
    navigate(definition.id);
    await runFixture.whenStable();
    expect(created.customerInvoiceExample()).toBe(false);
    expect(created.authorCustomerId()).toBe('1');
  });

  async function createComponent(
    historyState: Record<string, unknown> = {},
    definition: IQueryDef = queryDef,
    template = '<ul aria-label="Access blockers">@for (blocker of accessBlockers(); track $index) {<li>{{ blocker }}</li>}</ul>',
    navigation?: {
      queryParams?: Observable<ReturnType<typeof convertToParamMap>>;
      urlParameters?: Record<string,string>;
      paramMap?: Observable<ReturnType<typeof convertToParamMap>>;
      editor?: Observable<IQueryEditorState>;
      project: Observable<IProjectContext | undefined>;
      sessionId?: string;
      sessionWorkspace?: unknown;
      realEditor?: boolean;
      queries?: unknown;
      routeId?: string;
      urlQueryId?: string;
      routeRef?: IProjectRef;
      securityContextId?: string | null;
      realDispatch?: boolean;
      detective?: ReturnType<typeof detectiveClientStub>;
    },
  ): Promise<QueryPageComponent> {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: historyState },
      writable: true,
      configurable: true,
    });
    fx.localResultFixture = vi.fn();
    fx.federationResultFixture = vi.fn();
    fx.dispatchPageResponse = vi.fn();
    fx.dispatchBrowserResponse.mockReset();
    fx.dispatchOvdbResponse.mockReset();
    fx.dispatchHostedResponse.mockReset();
    fx.dispatchStart.mockReset();
    fx.dispatchCancel.mockReset().mockResolvedValue(undefined);
    agentContext = agentContextStub(navigation?.securityContextId);
    await TestBed.configureTestingModule({
      imports: [QueryPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: ProjectMeaningsService, useValue: {} },
        {provide:SneatAuthStateService,useValue:{authState:of({status:'authenticated',user:{uid:'sarah'}})}},
        {
          provide: GitHubProjectActivityService,
          useValue: githubProjectActivityStub(),
        },
        provideMockErrorLogger(),
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
            queryParamMap:
              navigation?.queryParams ??
              of(
                convertToParamMap(
                  navigation?.urlParameters ?? (navigation?.realEditor && !navigation.routeId
                    ? { id: 'q', projectApi: 'cloud', branch: 'work' }
                    : navigation?.urlQueryId
                      ? { id: navigation.urlQueryId }
                      : {}),
                ),
              ),
            paramMap: navigation?.paramMap ?? of(convertToParamMap({
              ...(navigation?.realEditor && !navigation.routeId ? { storeId: 'github.com', projectId: 'repo@owner@folder' } : {}),
              ...(navigation?.routeId ? { ...navigation.routeRef, queryId: navigation.routeId } : {}),
              ...(navigation?.sessionId ? { sessionId: navigation.sessionId } : {}),
            })),
            snapshot: {
              paramMap: convertToParamMap(
                {
                  ...(navigation?.routeId ? { ...navigation.routeRef, queryId: navigation.routeId } : {}),
                  ...(navigation?.sessionId ? { sessionId: navigation.sessionId } : {}),
                },
              ),
              queryParamMap: convertToParamMap(
                navigation?.urlParameters ?? (navigation?.realEditor && !navigation.routeId
                  ? { id: 'q', projectApi: 'cloud', branch: 'work' }
                  : navigation?.urlQueryId
                    ? { id: navigation.urlQueryId }
                    : {}),
              ),
              params: {},
            },
          },
        },
        ...(navigation?.sessionWorkspace ? [{ provide: SessionWorkspaceService, useValue: navigation.sessionWorkspace }] : []),
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
        { provide: QueriesService, useValue: { devicePersonal: { list: vi.fn(async () => []) }, ...(navigation?.queries as Record<string, unknown> | undefined) } },
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
                                title: definition.title,
                                queryType: QueryType.SQL,
                                request: definition.request,
                                def: definition,
                              },
                            ],
                          },
                    ),
                  updateQueryState: vi.fn(),
                  openQuery: vi.fn(),
                  reloadQuery: vi.fn(),
                  openAuthorizedQuery: vi.fn(),
                  newQuery: vi.fn(),
                  getQueryState: vi.fn(),
                  saveQuery: vi.fn(),
                },
              }),
        },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn() } },
        { provide: SemanticApiService, useValue: { runQuery: vi.fn() } },
        { provide: DetectiveClientService, useValue: navigation?.detective ?? detectiveClientStub() },
        ...(navigation?.realDispatch ? [
          { provide: HttpClient, useValue: { post: vi.fn() } },
          { provide: ProjectQueryApiService, useValue: { connectionCatalog: vi.fn() } },
          { provide: GithubProjectReaderService, useValue: { getRawJson: vi.fn() } },
          { provide: BrowserSqliteQueryService, useValue: { execute: vi.fn() } },
          { provide: QueryDispatchService, useClass: QueryDispatchService },
        ] : [{ provide: QueryDispatchService, useValue: queryDispatchTestStub(fx) }]),
        {
          provide: FederatedQueryService,
          useValue: {
            run: vi.fn(),
            getPage: fx.dispatchPageResponse,
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

  it('explains a missing agent environment and loads only project-authoritative choices', async () => {
    component = await createComponent();
    component.envId = undefined;
    vi.mocked(TestBed.inject(ProjectService).getFull).mockReturnValue(
      of({
        environments: [
          { id: 'local', title: 'Local' },
          { id: 'qa', title: 'QA' },
        ],
      } as unknown as IProjectFull),
    );
    component.runQuery();
    expect(component.runError()).toContain(
      'Select a logical project environment',
    );
    await vi.waitFor(() =>
      expect(component.agentRunEnvironments()).toHaveLength(2),
    );
    expect(fx.localResultFixture).not.toHaveBeenCalled();
    component.selectAgentRunEnvironment('not-admitted');
    expect(component.envId).toBeUndefined();
    component.selectAgentRunEnvironment('qa');
    expect(component.envId).toBe('qa');
    expect(component.runError()).toBeUndefined();
  });

  it('explains a missing agent security context instead of silently ignoring Run', async () => {
    component = await createComponent();
    agentContext.securityContextId.set('');
    component.runQuery();
    expect(component.runError()).toContain(
      'agent security context is unavailable',
    );
    expect(fx.localResultFixture).not.toHaveBeenCalled();
  });

  const selectionBinding = {
    parameterId: 'CustomerId',
    value: { type: 'integer' as const, value: '5' },
    origin: 'selection' as const,
    originEvidence: 'client-reported' as const,
    factId: 'selection-customer-5',
  };

  async function createJoinedLookupScenario(template = '<p></p>'): Promise<{
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
      request: {
        queryType: QueryType.DTQL,
        text: 'from Invoice as i',
      } as ITextQueryRequest,
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
    fx.dispatchStart.mockReset();
    fx.dispatchBrowserResponse.mockReset();
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
        asReadWire(
          toProjectQueryWire(
            withHostedDemoDbSource(createHostedDemoDbQuery('new-q'), source),
          ),
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
      fx.federationResultFixture.mockResolvedValue(historyResultFor(definition));
      component.runQuery();
      await runFixture.whenStable();
      expect(fx.dispatchStart.mock.calls[0][0].definition).toEqual(definition);
      expect(definition.federation?.ovdbBaseUrl).toBe(
        'https://ovdb.demodb.dev',
      );
      expect(definition.federation?.tables[0].name).toBe(
        source === 'chinook.Customer' ? 'Customer' : 'Person.Person',
      );
      expect(fx.localResultFixture).not.toHaveBeenCalled();
      expect(TestBed.inject(Coordinator).execute).not.toHaveBeenCalled();
      expect(component.runError()).toBeUndefined();
    },
  );

  it.each(['federation', 'sqlite'] as const)(
    'runs a device-personal %s copy in a shared project through its current browser definition',
    async (execution) => {
      const id = 'device-personal-11111111-1111-1111-1111-111111111111';
      const definition: IQueryDef = execution === 'federation'
        ? createHostedDemoDbQuery(id)
        : {
            ...queryDef, id, parameters: [], connectionId: 'chinook-sqlite',
            request: { queryType: QueryType.SQL, text: 'SELECT 2' } as ISqlQueryRequest,
          };
      if (execution === 'federation') {
        definition.request = {
          ...definition.request,
          text: (definition.request as ITextQueryRequest).text.replace('limit: 20', 'limit: 7'),
        } as ITextQueryRequest;
      }
      component = await createComponent({}, definition);
      component.project = {
        ref: { storeId: 'firestore', spaceID: 'space_1', projectId: 'project_1' },
      };
      component.envId = undefined;
      const result = historyResultFor(definition);
      fx.federationResultFixture.mockResolvedValue(result);
      fx.dispatchBrowserResponse.mockResolvedValue(result);
      const detective = TestBed.inject(DetectiveClientService);
      expect(component.isHostedProject).toBe(false);
      expect(component.queryValidatorsHref).toBeUndefined();
      component.runQuery();
      await vi.waitFor(() => expect(component.running()).toBe(false));
      if (execution === 'federation') {
        expect(fx.federationResultFixture).toHaveBeenCalledOnce();
        expect(fx.dispatchStart.mock.calls[0][0].definition).toEqual(definition);
        expect(fx.dispatchBrowserResponse).not.toHaveBeenCalled();
      } else {
        expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
          projectRef: component.project.ref,
          definition,
          target: { kind: 'browser-sqlite' },
        }));
        expect(fx.federationResultFixture).not.toHaveBeenCalled();
      }
      expect(detective.runHostedQuery).not.toHaveBeenCalled();
      expect(detective.action).not.toHaveBeenCalled();
      expect(fx.localResultFixture).not.toHaveBeenCalled();
      expect(component.runError()).toBeUndefined();
    },
  );

  it('updates the native Current row disclosure expanded state on every toggle', async () => {
    const template = readFileSync(
      resolve('libs/datatug/main/src/lib/queries/query/page/query-page.component.html'),
      'utf8',
    );
    const control = template.match(
      /<(?:ion-button|button)\b[^>]*data-testid="author-current-row-toggle"[\s\S]*?<\/(?:ion-button|button)\s*>/u,
    )?.[0];
    expect(control).toBeDefined();
    component = await createComponent({}, queryDef, control);
    runFixture.detectChanges();
    const button = runFixture.nativeElement.querySelector(
      'button[data-testid="author-current-row-toggle"]',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button?.type).toBe('button');
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    button?.click();
    await runFixture.whenStable();
    expect(component.currentRowPaneOpen()).toBe(false);
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.textContent).toContain('▸ Current row');
    button?.click();
    await runFixture.whenStable();
    expect(component.currentRowPaneOpen()).toBe(true);
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(button?.textContent).toContain('▾ Current row');
  });

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

  describe('opened from a stored query result (?result=)', () => {
    type ResultOpener = {
      openFromResult(id: string): void;
      onQueryEditorStateChanged(state: unknown): void;
    };
    const LOOPBACK = 'http-127.0.0.1:8989';
    const storedResult = vi.fn();

    async function openerWith(
      response: unknown,
      navigation?: Parameters<typeof createComponent>[3],
    ) {
      storedResult.mockReset();
      storedResult.mockImplementation(() =>
        response instanceof Error
          ? throwError(() => response)
          : of(decodeStoredResult(response)),
      );
      TestBed.overrideProvider(AgentLinkApiService, {
        useValue: { storedResult },
      });
      const created = await createComponent({}, queryDef, undefined, navigation);
      created.project = { ref: { storeId: LOOPBACK, projectId: 'demo' } };
      return { created, opener: created as unknown as ResultOpener };
    }

    it('reads the result from the loopback agent and fills a new draft with its query, database, environment and parameters', async () => {
      const { created, opener } = await openerWith(editorReadyResult());
      opener.openFromResult('rid-1');
      expect(storedResult).toHaveBeenCalledWith(LOOPBACK, 'rid-1');
      expect(TestBed.inject(QueryEditorStateService).newQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id',
          isNew: true,
          request: { queryType: QueryType.DTQL, text: DTQL_TEXT },
        }),
      );
      expect(created.selectedSource()).toBe('chinook');
      expect(TestBed.inject(DatatugNavContextService).setCurrentEnvironment).toHaveBeenCalledWith('local');
      // the saved rows are shown right away, as a snapshot, without a run
      expect(created.runResult()?.provenance).toMatchObject({ mode: 'snapshot', source: 'chinook' });
      expect(created.runResult()?.recordset.rows).toHaveLength(2);
      expect(created.running()).toBe(false);
      expect(created.savedResultBanner()).toMatchObject({
        kind: 'shown',
        mode: 'draft',
        rowsKept: 2,
        skippedParameters: ['Countries'],
        prompt: { text: PROMPT_TEXT, truncated: false },
      });
      expect(created.savedResultId()).toBe('rid-1');
      expect(created.savedResultStoreId()).toBe(LOOPBACK);
      // a second emission of the same address does not read it again; Check again does
      opener.openFromResult('rid-1');
      expect(storedResult).toHaveBeenCalledTimes(1);
      created.reloadSavedResult();
      expect(storedResult).toHaveBeenCalledTimes(2);
    });

    it('opens a saved query by its id, then shows the rows once it is loaded', async () => {
      const { created, opener } = await openerWith(
        editorReadyResult({ query: { kind: 'saved', savedQueryId: 'folder/q1', language: 'sql', text: 'select 1' } }),
      );
      opener.openFromResult('rid-2');
      expect(TestBed.inject(QueryEditorStateService).openQuery).toHaveBeenCalledWith('folder/q1');
      expect(TestBed.inject(QueryEditorStateService).newQuery).not.toHaveBeenCalled();
      expect(created.runResult()).toBeUndefined();
      const def = { ...queryDef, id: 'folder/q1', parameters: [{ id: 'CustomerId', type: 'integer' as const }] };
      const state = (isLoading: boolean) => ({
        currentQueryId: 'folder/q1',
        activeQueries: [{ id: 'folder/q1', queryType: QueryType.SQL, request: def.request, def, isLoading }],
      });
      opener.onQueryEditorStateChanged(state(true));
      expect(created.runResult()).toBeUndefined();
      opener.onQueryEditorStateChanged(state(false));
      expect(created.runResult()?.provenance.mode).toBe('snapshot');
      expect(created.savedResultBanner()).toMatchObject({ kind: 'shown', mode: 'saved' });
    });

    it.each([
      ['current', [{ selectionId: 'runtime-17', title: 'Edited copy' }], false],
      ['closed', [], true],
    ] as const)(
      'keeps saved rows historical while a %s Board runtime hint is validated',
      async (_state, options, unavailable) => {
        const params = new Subject<ReturnType<typeof convertToParamMap>>();
        const { created, opener } = await openerWith(
          editorReadyResult({ query: { kind: 'saved', savedQueryId: 'folder/q1' } }),
          { project: of(project), queryParams: params },
        );
        created.envId = 'local';
        const dispatcher = TestBed.inject(QueryDispatchService) as unknown as {
          availableWorkingCopies: ReturnType<typeof vi.fn>;
        };
        dispatcher.availableWorkingCopies.mockResolvedValue(options);
        params.next(convertToParamMap({ result: 'rid-runtime', env: 'local', runtime: 'runtime-17' }));
        const definition: IQueryDef = {
          ...queryDef, id: 'folder/q1', connectionId: 'logical-ledger-v7', parameters: [],
          request: { queryType: QueryType.DTQL, text: 'from:\n  name: "Artist"\nlimit: 10\n' } as ITextQueryRequest,
        };
        opener.onQueryEditorStateChanged({
          currentQueryId: definition.id,
          activeQueries: [{ id: definition.id, queryType: QueryType.DTQL,
            request: definition.request, def: definition, isLoading: false }],
        });
        runFixture.detectChanges();
        await runFixture.whenStable();
        expect(created.selectedWorkingCopy()).toBe('runtime-17');
        expect(created.unavailableWorkingCopy()).toBe(unavailable);
        expect(dispatcher.availableWorkingCopies).toHaveBeenCalledWith(expect.objectContaining({
          definition, environment: 'local',
        }));
        expect(created.runResult()?.provenance.mode).toBe('snapshot');
        expect(created.savedResultBanner()).toMatchObject({ kind: 'shown', mode: 'saved' });
        expect(fx.dispatchStart).not.toHaveBeenCalled();

        if (unavailable) {
          created.runQuery();
          expect(fx.dispatchStart).not.toHaveBeenCalled();
          expect(created.runResult()?.provenance.mode).toBe('snapshot');
          return;
        }
        const edited = {
          ...created.runResult(),
          provenance: { source: 'Edited copy', queryId: definition.id, mode: 'live' as const,
            observedAt: '2026-10-16T00:00:00Z' },
        } as FederatedQueryResult;
        fx.dispatchOvdbResponse.mockResolvedValue(edited);
        created.runQuery();
        expect(created.runError()).toBeUndefined();
        expect(created.queryId).toBe(definition.id);
        expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
          runtimeSelectionId: 'runtime-17', definition,
        }));
        await runFixture.whenStable();
        expect(created.runResult()?.provenance.mode).toBe('live');
      },
    );

    it('keeps a result draft and explicit runtime choice through same-route normalization', async () => {
      const params = new Subject<ReturnType<typeof convertToParamMap>>();
      const { created } = await openerWith(editorReadyResult(), { project: of(project), queryParams: params });
      params.next(convertToParamMap({ result: 'rid-draft', runtime: 'runtime-17', env: 'local' }));
      const editor = TestBed.inject(QueryEditorStateService);
      expect(editor.newQuery).toHaveBeenCalledOnce();
      const draft = { ...created.queryState, id: 'test-id', isNew: true,
        request: { queryType: QueryType.DTQL, text: 'unsaved edit' } as ITextQueryRequest };
      created.queryState = draft;
      created.selectWorkingCopy('project');
      params.next(convertToParamMap({ result: 'rid-draft', runtime: 'runtime-17', env: 'local', editor: 'text' }));
      params.next(convertToParamMap({ result: 'rid-draft', runtime: 'project', env: 'local', branch: 'work' }));
      expect(created.selectedWorkingCopy()).toBe('project');
      expect(created.queryState).toBe(draft);
      expect(editor.newQuery).toHaveBeenCalledOnce();
      expect(editor.openQuery).not.toHaveBeenCalledWith('test-id');
      expect(storedResult).toHaveBeenCalledTimes(1);
    });

    it('ignores a pending result read after its address is replaced', async () => {
      const params = new Subject<ReturnType<typeof convertToParamMap>>();
      const pending = new Subject<ReturnType<typeof decodeStoredResult>>();
      storedResult.mockReset().mockReturnValue(pending);
      TestBed.overrideProvider(AgentLinkApiService, { useValue: { storedResult } });
      const created = await createComponent({}, queryDef, undefined, { project: of(project), queryParams: params });
      created.project = { ref: { storeId: LOOPBACK, projectId: 'demo' } };
      params.next(convertToParamMap({ result: 'rid-late', runtime: 'runtime-17' }));
      params.next(convertToParamMap({ id: 'another-query', runtime: 'project' }));
      pending.next(decodeStoredResult(editorReadyResult()));
      expect(TestBed.inject(QueryEditorStateService).newQuery).not.toHaveBeenCalled();
      expect(created.savedResultBanner()).toBeUndefined();
      expect(created.savedResultId()).toBe('');
    });

    it('cancels a run when a different stored result opens the same query and runtime', async () => {
      const params = new Subject<ReturnType<typeof convertToParamMap>>();
      const { created, opener } = await openerWith(
        editorReadyResult({ query: { kind: 'saved', savedQueryId: 'folder/q1' } }),
        { project: of(project), queryParams: params },
      );
      const definition: IQueryDef = { ...queryDef, id: 'folder/q1', parameters: [] };
      const editorState = {
        currentQueryId: definition.id,
        activeQueries: [{ id: definition.id, title: definition.title,
          queryType: definition.request.queryType,
          request: definition.request, def: definition, isLoading: false }],
      };
      created.envId = 'local';
      params.next(convertToParamMap({ result: 'rid-a', runtime: 'project', env: 'local' }));
      opener.onQueryEditorStateChanged(editorState);
      expect(created.runResult()?.provenance.mode).toBe('snapshot');

      const pending = new Subject<RunQueryResponse>();
      fx.localResultFixture.mockReturnValue(pending);
      created.runQuery();
      expect(created.running()).toBe(true);
      expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
        target: expect.objectContaining({ kind: 'local-agent' }),
      }));

      params.next(convertToParamMap({ result: 'rid-b', runtime: 'project', env: 'local' }));
      opener.onQueryEditorStateChanged(editorState);
      expect(created.savedResultId()).toBe('rid-b');
      expect(created.runResult()?.provenance.mode).toBe('snapshot');
      expect(created.running()).toBe(false);
      expect(fx.dispatchCancel).toHaveBeenCalled();

      pending.next({
        recordset: { columns: [{ name: 'Name', type: 'string' }],
          rows: [[{ type: 'string', value: 'late A' }]] },
        limitations: [], bindingsApplied: [], truncated: false,
        provenance: { source: 'Project agent', queryId: definition.id, mode: 'live',
          observedAt: '2026-10-16T00:00:00Z', executionProfile: 'protected' },
      });
      pending.complete();
      await runFixture.whenStable();
      expect(created.savedResultId()).toBe('rid-b');
      expect(created.runResult()?.provenance.mode).toBe('snapshot');
      expect(created.committedRun()).toBeUndefined();
      expect(created.running()).toBe(false);
    });

    it('validates a deferred result-only runtime hint after the saved query identity resolves', async () => {
      const params = new Subject<ReturnType<typeof convertToParamMap>>();
      const pending = new Subject<ReturnType<typeof decodeStoredResult>>();
      storedResult.mockReset().mockReturnValue(pending);
      TestBed.overrideProvider(AgentLinkApiService, { useValue: { storedResult } });
      const created = await createComponent({}, queryDef, undefined,
        { project: of(project), queryParams: params });
      created.project = { ref: { storeId: LOOPBACK, projectId: 'demo' } };
      created.envId = 'local';
      const dispatcher = TestBed.inject(QueryDispatchService) as unknown as {
        availableWorkingCopies: ReturnType<typeof vi.fn>;
        runtimeRevision: () => number;
      };
      dispatcher.availableWorkingCopies.mockResolvedValue([
        { selectionId: 'runtime-17', title: 'Edited copy' },
      ]);
      const revision = dispatcher.runtimeRevision();
      params.next(convertToParamMap({ result: 'rid-deferred', env: 'local', runtime: 'runtime-17' }));
      runFixture.detectChanges();
      await runFixture.whenStable();
      expect(dispatcher.availableWorkingCopies).not.toHaveBeenCalled();
      expect(created.unavailableWorkingCopy()).toBe(true);

      pending.next(decodeStoredResult(editorReadyResult({
        query: { kind: 'saved', savedQueryId: 'folder/q1' },
      })));
      const definition: IQueryDef = { ...queryDef, id: 'folder/q1', connectionId: 'logical-ledger-v7', parameters: [] };
      (created as unknown as ResultOpener).onQueryEditorStateChanged({
        currentQueryId: definition.id,
        activeQueries: [{ id: definition.id, queryType: definition.request.queryType,
          request: definition.request, def: definition, isLoading: false }],
      });
      runFixture.detectChanges();
      await runFixture.whenStable();
      expect(dispatcher.runtimeRevision()).toBe(revision);
      expect(dispatcher.availableWorkingCopies).toHaveBeenCalledWith(expect.objectContaining({
        definition, environment: 'local',
      }));
      expect(created.selectedWorkingCopy()).toBe('runtime-17');
      expect(created.unavailableWorkingCopy()).toBe(false);
      expect(created.runResult()?.provenance.mode).toBe('snapshot');
    });

    it('leaves the editor empty with a named message for an older result, and still shows the rows', async () => {
      const { created, opener } = await openerWith(invoiceCustomerResult());
      opener.openFromResult('rid-3');
      expect(TestBed.inject(QueryEditorStateService).newQuery).not.toHaveBeenCalled();
      expect(TestBed.inject(QueryEditorStateService).openQuery).not.toHaveBeenCalled();
      expect(created.runResult()?.recordset.rows).toHaveLength(2);
      const banner = created.savedResultBanner();
      expect(banner).toMatchObject({ kind: 'shown', mode: 'rows-only' });
      expect(banner?.kind === 'shown' && banner.notice).toMatch(/older DataTug/);
      expect(banner?.kind === 'shown' && banner.prompt).toBeUndefined();
    });

    it('puts the saved rows back when the project scope settles after them, until another result is shown', async () => {
      const { created, opener } = await openerWith(editorReadyResult());
      opener.openFromResult('rid-11');
      const saved = created.runResult();
      expect(saved?.provenance.mode).toBe('snapshot');
      const invalidate = () => (created as unknown as { invalidateHistoryScope(): void }).invalidateHistoryScope();
      invalidate();
      expect(created.runResult()).toBe(saved);
      expect((created as unknown as { resultPageRows(): unknown[] }).resultPageRows()).toHaveLength(2);
      // a run's result supersedes them for good
      const runResult = { ...saved, provenance: { ...saved?.provenance, mode: 'live' } } as unknown as FederatedQueryResult;
      (created as unknown as { showAttemptResult(r: FederatedQueryResult): void }).showAttemptResult(runResult);
      invalidate();
      expect(created.runResult()).toBeUndefined();
      // and so does opening another query
      opener.openFromResult('rid-12');
      expect(created.runResult()?.provenance.mode).toBe('snapshot');
      (created as unknown as { closeSavedResult(): void }).closeSavedResult();
      invalidate();
      expect(created.runResult()).toBeUndefined();
    });

    it('does not fill the editor from a result saved for another project', async () => {
      const { created, opener } = await openerWith(editorReadyResult());
      created.project = { ref: { storeId: LOOPBACK, projectId: 'someone-elses' } };
      opener.openFromResult('rid-10');
      expect(TestBed.inject(QueryEditorStateService).newQuery).not.toHaveBeenCalled();
      expect(TestBed.inject(DatatugNavContextService).setCurrentEnvironment).not.toHaveBeenCalled();
      expect(created.runResult()?.recordset.rows).toHaveLength(2);
      const banner = created.savedResultBanner();
      expect(banner).toMatchObject({ kind: 'shown', mode: 'rows-only' });
      expect(banner?.kind === 'shown' && banner.notice).toMatch(/another project/);
    });

    it('shows the database that ran the query as the editor Target and names the page for the result', async () => {
      const { created, opener } = await openerWith(editorReadyResult());
      const title = TestBed.inject(Title);
      title.setTitle('DataTug.app');
      created.project = { ref: { storeId: LOOPBACK, projectId: 'demo' }, summary: { id: 'demo', title: 'Demo project' } } as typeof created.project;
      opener.openFromResult('rid-20');
      expect(created.availableTargets()).toEqual([{ source: 'chinook', label: 'chinook' }]);
      expect(created.savedResultBanner()).toMatchObject({ database: 'chinook · environment local' });
      expect(created.selectedSource()).toBe('chinook');
      expect(title.getTitle()).toBe('Query from result · Demo project');
      (created as unknown as { closeSavedResult(): void }).closeSavedResult();
      expect(created.availableTargets()).toEqual([]);
      expect(title.getTitle()).toBe('DataTug.app');
    });

    it('keeps the environment of the result selected when the address clears it, and not when the project has no such environment', async () => {
      const { created, opener } = await openerWith(editorReadyResult());
      const select = TestBed.inject(DatatugNavContextService).setCurrentEnvironment as ReturnType<typeof vi.fn>;
      opener.openFromResult('rid-21');
      select.mockClear();
      (created as unknown as { keepResultEnvironment(): void }).keepResultEnvironment();
      await Promise.resolve();
      expect(select).toHaveBeenCalledWith('local');
      // the person picks another environment: it is theirs, only a cleared one is put back
      (created as unknown as { closeSavedResult(): void }).closeSavedResult();
      select.mockClear();
      (created as unknown as { keepResultEnvironment(): void }).keepResultEnvironment();
      await Promise.resolve();
      expect(select).not.toHaveBeenCalled();
      created.project = {
        ref: { storeId: LOOPBACK, projectId: 'demo' },
        summary: { id: 'demo', environments: [{ id: 'prod' }] },
      } as typeof created.project;
      opener.openFromResult('rid-22');
      expect(select).not.toHaveBeenCalled();
      const banner = created.savedResultBanner();
      expect(banner?.kind === 'shown' && banner.notice).toContain(
        'Environment local of this result is not in this project',
      );
    });

    it('says when charts become available instead of a rights error for the saved rows', async () => {
      const { created, opener } = await openerWith(editorReadyResult());
      opener.openFromResult('rid-23');
      expect(created.resultChartUnavailableText()).toBe('Full-result chart preview is available after running the query.');
      (created as unknown as { closeSavedResult(): void }).closeSavedResult();
      expect(created.resultChartUnavailableText()).toMatch(/^Full-result chart preview unavailable: /);
    });

    it('starts the Current row pane closed for a wide result, one click to open', async () => {
      const { created, opener } = await openerWith(editorReadyResult());
      opener.openFromResult('rid-24');
      expect(created.displayedRecordset()?.columns.length).toBeLessThanOrEqual(created.currentRowOpenMaxColumns);
      expect(created.currentRowPaneOpen()).toBe(true);
      const wide = {
        ...created.runResult(),
        recordset: {
          columns: Array.from({ length: 8 }, (_, i) => ({ name: `c${i}`, type: 'string' })),
          rows: [],
        },
      } as unknown as FederatedQueryResult;
      (created as unknown as { setDisplayedResult(r: FederatedQueryResult): void }).setDisplayedResult(wide);
      expect(created.currentRowPaneOpen()).toBe(false);
      created.toggleCurrentRowPane();
      expect(created.currentRowPaneOpen()).toBe(true);
      created.toggleCurrentRowPane();
      expect(created.currentRowPaneOpen()).toBe(false);
    });

    it('asks no agent that is not a local one', async () => {
      const { created, opener } = await openerWith(editorReadyResult());
      created.project = { ref: { storeId: 'github.com', projectId: 'demo' } };
      opener.openFromResult('rid-4');
      expect(storedResult).not.toHaveBeenCalled();
      expect(created.savedResultBanner()).toEqual({ kind: 'problem', problem: 'agent-unreachable' });
    });

    it('names an id outside the grammar as not found, without a request', async () => {
      const { created, opener } = await openerWith(editorReadyResult());
      opener.openFromResult('../x');
      expect(storedResult).not.toHaveBeenCalled();
      expect(created.savedResultBanner()).toEqual({ kind: 'problem', problem: 'result-not-found' });
    });

    it('names a failed read, and keeps the editor as it was', async () => {
      const failed = await openerWith(new LinkProblemError('link-expired'));
      failed.opener.openFromResult('rid-5');
      expect(failed.created.savedResultBanner()).toEqual({ kind: 'problem', problem: 'link-expired' });
      expect(TestBed.inject(QueryEditorStateService).newQuery).not.toHaveBeenCalled();
      expect(failed.created.runResult()).toBeUndefined();
      TestBed.resetTestingModule();
      const other = await openerWith(new Error('boom'));
      other.opener.openFromResult('rid-6');
      expect(other.created.savedResultBanner()).toEqual({ kind: 'problem', problem: 'read-failed' });
    });

    it('is started by the result address parameter, and never logs it', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const { created } = await openerWith(
        editorReadyResult({ query: { dbRef: 'datatug://demo-project/chinook?env=local' } }),
        {
        project: of(project),
        queryParams: of(convertToParamMap({ result: 'rid-secret-7', env: 'local' })),
        },
      );
      // the store of the route's project is a local agent: the id of the address is read from it
      expect(storedResult).toHaveBeenCalledWith('localhost:8989', 'rid-secret-7');
      expect(created.savedResultBanner()).toMatchObject({ kind: 'shown', mode: 'draft' });
      expect(JSON.stringify(log.mock.calls)).not.toContain('rid-secret-7');
      log.mockRestore();
    });

    it('keeps an unsaved draft out of the address id, and drops the result parameter once it is saved', async () => {
      const { created, opener } = await openerWith(editorReadyResult());
      opener.openFromResult('rid-8');
      const navigate = vi.mocked(TestBed.inject(Router).navigate);
      navigate.mockClear();
      (created as unknown as { authorViewActive: boolean }).authorViewActive = true;
      vi.spyOn(created as unknown as { isCurrentRoute(): boolean }, 'isCurrentRoute').mockReturnValue(true);
      created.queryState = { id: 'test-id', isNew: true, queryType: QueryType.DTQL };
      created.updateUrl();
      expect(navigate.mock.calls.at(-1)?.[1]).toMatchObject({ queryParams: { id: undefined } });
      expect(navigate.mock.calls.at(-1)?.[1]?.queryParams).not.toHaveProperty('result');
      created.queryState = { id: 'test-id', isNew: false, queryType: QueryType.DTQL };
      created.updateUrl();
      expect(navigate.mock.calls.at(-1)?.[1]?.queryParams).toMatchObject({ id: 'test-id', result: undefined });
      expect(navigate.mock.calls.at(-1)?.[1]?.queryParams).toHaveProperty('result');
    });

    it('keeps the address id out too while the editor has no query to edit', async () => {
      const { created, opener } = await openerWith(invoiceCustomerResult());
      opener.openFromResult('rid-9');
      const navigate = vi.mocked(TestBed.inject(Router).navigate);
      navigate.mockClear();
      (created as unknown as { authorViewActive: boolean }).authorViewActive = true;
      vi.spyOn(created as unknown as { isCurrentRoute(): boolean }, 'isCurrentRoute').mockReturnValue(true);
      created.queryState = { id: 'some-blank-id', queryType: QueryType.SQL };
      created.updateUrl();
      expect(navigate.mock.calls.at(-1)?.[1]).toMatchObject({ queryParams: { id: undefined } });
    });
  });

  it('looks up the customer of the row the button shows, not of the row at its screen position', async () => {
    component = await createComponent();
    // The draft/binding currency of the run is not what is under test.
    vi.spyOn(component, 'publicSqliteRunIsStale').mockReturnValue(false);
    component.runResult.set({
      ...historyResultFor(queryDef),
      publicSqliteReceipt: {
        sql: 'SELECT 1',
        bindingNames: [],
        sourceId: 'chinook-sqlite',
        fixtureSha256: 'f',
        schemaVersion: 's',
        draftRevision: 1,
        executionId: 'execution',
        relationship: {
          id: PUBLIC_CHINOOK_CUSTOMER_FK,
          version: 'v',
          fromSource: 'i',
          toSource: 'c',
          joinType: 'inner',
          pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
        },
        outputColumns: [
          { name: 'CustomerId', type: 'integer', lineage: [{ source: 'c', field: 'CustomerId' }] },
        ],
      },
      recordset: {
        columns: [{ name: 'CustomerId', type: 'integer' }],
        rows: [[{ type: 'integer', value: '11' }], [{ type: 'integer', value: '22' }]],
      },
      totalRows: undefined,
    } as unknown as FederatedQueryResult);
    const rows = component.resultGridRows();
    const renderer = component.resultGridColumnDefs()[0].cellRenderer as (p: unknown) => HTMLElement;
    // Sorted descending: the second result row is on screen at position 0.
    const cell = renderer({
      data: rows[1],
      value: '22',
      valueFormatted: '22',
      node: { rowIndex: 0 },
      column: { getColId: () => 'result_0' },
      api: {},
    });
    const button = cell.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Look up invoices for Customer ID 22');
    // A row object the grid was not given is no row of the result: no button.
    expect(
      renderer({ data: { result_0: '11' }, value: '11', node: { rowIndex: 0 }, column: { getColId: () => 'result_0' }, api: {} })
        .querySelector('button'),
    ).toBeNull();
  });

  it('types the result grid columns like the shared results grid and keeps a NULL as null', async () => {
    component = await createComponent();
    component.runResult.set({
      ...historyResultFor(queryDef),
      recordset: {
        columns: [
          { name: 'n', type: 'integer' },
          { name: 'when', type: 'date' },
          { name: 'ok', type: 'boolean' },
          { name: 'note', type: 'string' },
        ],
        rows: [
          [
            { type: 'integer', value: '7' },
            { type: 'date', value: '2024-03-05' },
            { type: 'boolean', value: true },
            { type: 'null', value: null },
          ],
        ],
      },
      totalRows: undefined,
    });
    expect(component.resultGridColumnDefs().map((c) => [c.colId, c.type, c.sortable])).toEqual([
      ['result_0', 'dtNumber', true],
      ['result_1', 'dtDate', true],
      ['result_2', 'dtBoolean', true],
      ['result_3', 'dtText', true],
    ]);
    expect(component.resultGridRows()).toEqual([
      { result_0: '7', result_1: '2024-03-05', result_2: 'true', result_3: null },
    ]);
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
    const historical: FederatedQueryResult = {
      localResult: ref,
      recordset: {
        columns: [{ name: 'Affiliation', type: 'string' }],
        rows: [{ type: 'string' as const, value: 'original-affiliation' }].map(
          (cell) => [cell],
        ),
      },
      totalRows: 150,
      relatedRecordsets: [
        {
          id: 'locations',
          label: 'Locations',
          parentSet: 'affiliations',
          parentField: 'Affiliation',
          totalRows: 135,
          recordset: {
            columns: [{ name: 'Location', type: 'string' }],
            rows: [[{ type: 'string', value: 'original-location' }]],
          },
        },
        {
          id: 'aliases',
          label: 'Alternate names',
          parentSet: 'locations',
          parentField: 'Location',
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
    fx.dispatchPageResponse.mockResolvedValue([
      [{ type: 'string', value: 'alias-page-2' }],
    ]);
    await component.changeResultPage(1);
    await runFixture.whenStable();
    expect(fx.dispatchPageResponse).toHaveBeenCalledWith(1, 'aliases', ref);
    expect(runFixture.nativeElement.textContent).toContain('alias-page-2');
    expect(fx.federationResultFixture).not.toHaveBeenCalled();
    expect(fx.localResultFixture).not.toHaveBeenCalled();
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
    expect(fx.federationResultFixture).not.toHaveBeenCalled();
    const result: FederatedQueryResult = {
      localResult: { id: 'old', generation: 1 },
      recordset: { columns: [], rows: [] },
      totalRows: 150,
      limitations: [],
      bindingsApplied: [],
      truncated: false,
      provenance: {
        observedAt: 'old',
        queryId: 'old',
        source: 'fixture',
        mode: 'live',
        executionProfile: 'protected',
      },
    };
    component.runResult.set(result);
    component.selectedHistoricalResult.set(result.localResult);
    let release!: (rows: unknown) => void;
    fx.dispatchPageResponse.mockImplementation(
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
        rows: [[{ type: 'string' as const, value: 'new-row' }]],
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

    let rejectPage!: (error: Error) => void;
    fx.dispatchPageResponse.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectPage = reject;
        }),
    );
    component.runError.set(undefined);
    const rejectedPage = component.changeResultPage(1);
    const sameIdReplacement = {
      ...next,
      recordset: {
        columns: [],
        rows: [
          [{ type: 'string' as const, value: 'replacement-generation-row' }],
        ],
      },
    };
    component.runResult.set(sameIdReplacement);
    rejectPage(new Error('late page rejection'));
    await rejectedPage;
    expect(component.runError()).toBeUndefined();
    expect(component.runResult()).toBe(sameIdReplacement);
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
          title: definition.title,
          queryType: QueryType.DTQL,
          request: definition.request,
          def: definition,
        },
      ],
    }) as IQueryEditorState;
  const historyResultFor = (
    definition: IQueryDef,
    id = 'datatug-output-100000-abc',
  ): FederatedQueryResult => ({
    localResult: { id, generation: 1 },
    nativeGraph: {
      planIdentity: graphStableIdentity(definition.federation?.nativeGraph),
      stageActions: [],
      coverage: {},
      edges: {},
      ledger: {
        intermediate: 0,
        candidates: 0,
        outputRows: 0,
        networkBytes: 0,
      },
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
  });
  const historyResultTemplate = (): string => {
    const queryTemplate = readFileSync(
      resolve(
        'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
      ),
      'utf8',
    );
    const resultTemplate = queryTemplate.split(
      '  @if (runResult(); as result) {',
    )[1];
    const resultSectionBoundary = '\n  </section>\n  </ng-template>';
    if (!resultTemplate?.includes(resultSectionBoundary)) {
      throw new Error('Could not locate the full query results template.');
    }
    return `${'  @if (runResult(); as result) {'}${resultTemplate.split(resultSectionBoundary)[0]}`;
  };

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
    fx.federationResultFixture
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
    const firstRunOptions = fx.dispatchStart.mock.calls[0][0].federationRun?.extras as {
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
    fx.federationResultFixture.mockResolvedValue(historyResultFor(definition));

    component.runQuery();
    await runFixture.whenStable();
    const originalReceipt = component.committedRun();
    const onFinished = fx.dispatchStart.mock.calls.at(-1)?.[0].federationRun?.onFinished as
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
    fx.federationResultFixture.mockResolvedValue(result);

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
    fx.federationResultFixture
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
    expect(fx.dispatchStart.mock.calls.at(-1)?.[0].federationRun?.token).toBe('first-secret-token');
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
    expect(fx.dispatchStart.mock.calls.at(-1)?.[0].federationRun?.token).toBe(
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
    fx.federationResultFixture.mockResolvedValue(historyResultFor(definition));

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
    fx.localResultFixture.mockReturnValueOnce(of(response));

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
    fx.localResultFixture.mockReturnValueOnce(of(response));
    component.runQuery();
    await runFixture.whenStable();
    expect(component.committedRun()).toBeDefined();

    fx.localResultFixture.mockReturnValueOnce(
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
    fx.federationResultFixture.mockResolvedValueOnce(historyResultFor(definition));
    component.runQuery();
    await runFixture.whenStable();
    expect(component.committedRun()).toBeDefined();

    fx.federationResultFixture.mockRejectedValueOnce(
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
    fx.federationResultFixture.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );

    component.runQuery();
    const extras = fx.dispatchStart.mock.calls[0][0].federationRun?.extras as {
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
    fx.federationResultFixture.mockImplementation(
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
    fx.federationResultFixture.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );

    component.runQuery();
    const extras = fx.dispatchStart.mock.calls[0][0].federationRun?.extras as {
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
    fx.federationResultFixture.mockResolvedValue(historyResultFor(definition));

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
      fx.federationResultFixture.mockResolvedValue({
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
    fx.federationResultFixture.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    component.runQuery();
    const extras = fx.dispatchStart.mock.calls[0][0].federationRun?.extras as {
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
    fx.federationResultFixture
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
    const oldExtras = fx.dispatchStart.mock.calls[0][0].federationRun?.extras as {
      onFirstRecord?: (at: number) => void;
    };
    Object.assign(definition.federation?.nativeGraph ?? {}, { aliases: false });
    editor.next(historyStateFor(definition));
    now = 20;
    component.runQuery();
    const newExtras = fx.dispatchStart.mock.calls[1][0].federationRun?.extras as {
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
      expect(fx.federationResultFixture).not.toHaveBeenCalled();
      expect(fx.localResultFixture).not.toHaveBeenCalled();
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
      fx.federationResultFixture.mockResolvedValue(result);
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
      expect(fx.dispatchCancel).toHaveBeenCalled();
      expect(fx.federationResultFixture).toHaveBeenCalledOnce();
      expect(fx.localResultFixture).not.toHaveBeenCalled();
    },
  );

  it.each(['edit', 'history', 'Ionic leave', 'destroy'])(
    'invalidates an owned dispatch session before a pending result on %s',
    async (action) => {
      const definition = historyDefinition(),
        editor = new BehaviorSubject(historyStateFor(definition));
      component = await createComponent(
        {},
        definition,
        historyResultTemplate(),
        { editor, project: of(project) },
      );
      let release!: (result: FederatedQueryResult) => void;
      fx.federationResultFixture.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
      vi.mocked(TestBed.inject(FederatedQueryService).openLocalResult).mockRejectedValue(
        new Error('Fixture unavailable.'),
      );
      component.runQuery();
      expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'ovdb-federation' } }));
        if (action === 'edit') {
          Object.assign(definition.federation?.nativeGraph ?? {}, {
            aliases: false,
          });
          editor.next(historyStateFor(definition));
        }
        if (action === 'history')
          await component.openHistoricalResult('fixture');
        if (action === 'Ionic leave') component.ionViewWillLeave();
        if (action === 'destroy') component.ngOnDestroy();
        await runFixture.whenStable();
        expect(component.running()).toBe(false);
        expect(component.runResult()).toBeUndefined();
        release(historyResultFor(definition));
        await runFixture.whenStable();
        expect(fx.dispatchCancel).toHaveBeenCalled();
        expect(component.runResult()).toBeUndefined();
        expect(component.runError()).toBeUndefined();
    },
  );

  it('discards a historical result opened while Ionic leaves the cached query page', async () => {
    const definition = historyDefinition();
    component = await createComponent({}, definition, historyResultTemplate());
    const federation = TestBed.inject(FederatedQueryService);
    let release!: (value: Awaited<ReturnType<FederatedQueryService['openLocalResult']>>) => void;
    vi.mocked(federation.openLocalResult).mockImplementation(() =>
      new Promise((resolve) => { release = resolve; }));

    const pending = component.openHistoricalResult('datatug-output-100000-abc');
    await vi.waitFor(() => expect(federation.openLocalResult).toHaveBeenCalledOnce());
    component.ionViewWillLeave();
    release({
      descriptor: {} as LocalResultDescriptor,
      executedDefinition: definition,
      result: historyResultFor(definition),
    });
    await pending;

    expect(component.runResult()).toBeUndefined();
    expect(component.selectedHistoricalResult()).toBeUndefined();
    expect(component.historicalDefinition()).toBeUndefined();
    expect(component.localHistoryLoading()).toBe(false);
  });

  it('keeps a completed agent result on cached leave when no worker session remains', async () => {
    component = await createComponent();
    const result: RunQueryResponse = {
      recordset: { columns: [{ name: 'n', type: 'integer' }], rows: [[{ type: 'integer', value: '1' }]] },
      limitations: [], bindingsApplied: [], truncated: false,
      provenance: { source: 'agent', queryId: queryDef.id, mode: 'live', observedAt: '2026-10-16T00:00:00Z', executionProfile: 'protected' },
    };
    fx.localResultFixture.mockReturnValueOnce(of(result));
    component.runQuery();
    await runFixture.whenStable();
    expect(component.runResult()).toEqual(result);

    component.ionViewWillLeave();
    expect(component.runResult()).toEqual(result);
    expect(component.committedRun()).toBeDefined();
  });

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
      fx.federationResultFixture.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      component.runQuery();
      const oldCall = fx.dispatchStart.mock.calls.at(-1)?.[0] as QueryDispatchRequest | undefined;
      Object.assign(definition.federation?.nativeGraph ?? {}, {
        aliases: false,
      });
      if (action === 'edit') editor.next(historyStateFor(definition));
      const oldProgress: FederatedQueryProgress = {
        stage: 'processing',
        rowsLoaded: 0,
        rowsProcessed: 0,
        requestsCompleted: 0,
        requestsInFlight: 0,
        requestsPending: 0,
      };
      oldCall?.federationRun?.onProgress?.(oldProgress);
      oldCall?.federationRun?.onFinished?.(999);
      finish(historyResultFor(oldCall?.definition as IQueryDef));
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
      fx.federationResultFixture
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
      expect(fx.federationResultFixture).not.toHaveBeenCalled();
      expect(fx.localResultFixture).not.toHaveBeenCalled();
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
      fx.dispatchPageResponse.mockResolvedValue([
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
      federation: { ovdbBaseUrl: 'https://ovdb.demodb.dev', tables: [] },
      publicData: saved,
    };
    component = await createComponent({}, definition);
    expect(component.queryDef()?.publicData).toEqual(saved);
    expect(component.publicDataRevisionChanges()).toEqual(['directory']);
    expect(fx.federationResultFixture).not.toHaveBeenCalled();
    component.runQuery();
    expect(component.runError()).toMatch(/revisions changed/);
    component.publicDataRevisionAcknowledged.set(true);
    component.runQuery();
    expect(component.runError()).toBe(SAVED_SCENARIO_PUBLICATION_BLOCKER);
    expect(fx.federationResultFixture).not.toHaveBeenCalled();
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
            '  @if (!isTugqlAuthorJourney() && (queryState.isNew || !queryState.title)) {',
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
          expect(fx.federationResultFixture).not.toHaveBeenCalled();
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
        expect(fx.federationResultFixture).not.toHaveBeenCalled();
        await click('Acknowledge this metadata check');
        await click('Save separate pending plan');
        expect(create).toHaveBeenCalledOnce();
        expect(create.mock.calls[0][1].publicData.eligible).toBe(false);
        expect(component.queryDef()).toEqual(original);
        component.resultPageIndex.set(1);
        component.runQuery();
        expect(component.resultPageIndex()).toBe(1);
        expect(fx.federationResultFixture).not.toHaveBeenCalled();
        expect(fx.localResultFixture).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('runs a federated query in the browser and exposes its download and lookup progress', async () => {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'sales',
      request: {
        queryType: QueryType.DTQL,
        text: 'from: Invoice',
      } as ITextQueryRequest,
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
    fx.federationResultFixture.mockImplementation(
      (request: QueryDispatchRequest) => {
        request.federationRun?.onProgress?.({
          stage: 'processing',
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
    expect(fx.federationResultFixture).toHaveBeenCalledOnce();
    expect(fx.localResultFixture).not.toHaveBeenCalled();
    expect(component.federatedProgress()).toEqual(expect.objectContaining({
      rowsLoaded: 103,
      rowsProcessed: 100,
      requestsCompleted: 2,
      requestsInFlight: 0,
      requestsPending: 0,
    }));
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
      } as ITextQueryRequest,
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
    fx.federationResultFixture.mockResolvedValue({
      recordset: { columns: [], rows: [] },
      limitations: [],
      bindingsApplied: [],
      truncated: false,
    });
    component.federatedMode.set('full');
    component.runQuery();
    expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
      definition,
      target: { kind: 'ovdb-federation' },
      federationRun: expect.objectContaining({
        token: '', mode: 'full',
        onProgress: expect.any(Function), onFinished: expect.any(Function),
        extras: expect.objectContaining({ onFirstRecord: expect.any(Function) }),
      }),
    }));
  });

  it('shows only one result page at a time for a large federated recordset', async () => {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'many-sales',
      request: {
        queryType: QueryType.DTQL,
        text: 'from: Invoice',
      } as ITextQueryRequest,
      federation: { ovdbBaseUrl: 'http://127.0.0.1:50501', tables: [] },
      parameters: [],
    };
    component = await createComponent({}, definition);
    fx.federationResultFixture.mockResolvedValue({
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
      request: {
        queryType: QueryType.DTQL,
        text: 'from: Invoice',
      } as ITextQueryRequest,
      federation: { ovdbBaseUrl: 'http://127.0.0.1:50501', tables: [] },
      parameters: [],
    };
    component = await createComponent({}, definition);
    fx.federationResultFixture.mockResolvedValue({
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
    fx.dispatchPageResponse.mockResolvedValue([
      [{ type: 'integer', value: '101' }],
    ]);
    component.runQuery();
    await Promise.resolve();
    expect(component.resultTotalRows()).toBe(120_000);
    expect(component.visibleResultRows()).toHaveLength(1);
    await component.changeResultPage(1);
    expect(fx.dispatchPageResponse).toHaveBeenCalledWith(1, 'affiliations');
    expect(component.visibleResultRows()).toEqual([
      [{ type: 'integer', value: '101' }],
    ]);
    expect(component.resultPageEnd()).toBe(200);

    // A cached Ionic page keeps its dispatcher session for paging, then must
    // release that same owner when navigation leaves the route.
    expect(fx.dispatchCancel).not.toHaveBeenCalled();
    component.selectedHistoricalResult.set(historyResultFor(historyDefinition()).localResult);
    component.historicalDefinition.set(definition);
    component.ionViewWillLeave();
    await runFixture.whenStable();
    expect(fx.dispatchCancel).toHaveBeenCalledOnce();
    expect(component.runResult()).toBeUndefined();
    expect(component.visibleResultRows()).toEqual([]);
    expect(component.committedRun()).toBeUndefined();
    expect(component.selectedHistoricalResult()).toBeUndefined();
    expect(component.historicalDefinition()).toBeUndefined();
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

  it.each(['parameter', 'session'] as const)('rejects a deferred session pin when its %s changes, reporting only to the original pinned run', async (changed) => {
    const sessionParams = new BehaviorSubject(convertToParamMap({ sessionId: 'session-a' }));
    const scope = { environmentId: 'production', identityDomain: 'local-test-domain' };
    let resolvePin!: (value: Awaited<ReturnType<SessionWorkspaceService['pinInput']>>) => void;
    const pinResponse = new Promise<Awaited<ReturnType<SessionWorkspaceService['pinInput']>>>((resolve) => { resolvePin = resolve; });
    const pinInput = vi.fn<(...args: Parameters<SessionWorkspaceService['pinInput']>) => ReturnType<SessionWorkspaceService['pinInput']>>(() => pinResponse);
    const reportClientRun = vi.fn(async () => true);
    const workspace = {
      capabilities: () => ({ actorId: 'actor-a', databaseId: 'db-a', projectId: 'demo-project', environments: [scope] }),
      canExecuteFor: () => true,
      bindingScopeKey: (id: string) => JSON.stringify(['db-a', 'demo-project', id, 'production', 'context-a']),
      snapshotFor: (id: string) => id === 'session-a' ? { session: { id }, contextSet: { id: 'context-a' } } : { session: { id }, contextSet: { id: 'context-b' } },
      appliedFactsFor: () => [],
      pinInput,
      reportClientRun,
      error: () => '',
      deviceViewKey: vi.fn(),
    };
    component = await createComponent({}, queryDef, '<p></p>', {
      project: of(project), sessionId: 'session-a', paramMap: sessionParams,
      sessionWorkspace: workspace,
    });
    component.editBinding('CustomerId', { type: 'integer', value: '5' });
    const run = (component as unknown as { runSessionQuery(): Promise<void> }).runSessionQuery();
    await vi.waitFor(() => expect(pinInput).toHaveBeenCalledOnce());
    expect(pinInput.mock.calls[0][0]).toBe('session-a');
    expect(pinInput.mock.calls[0][6]).toEqual({ CustomerId: { type: 'integer', value: '5' } });

    if (changed === 'parameter') component.editBinding('CustomerId', { type: 'integer', value: '9' });
    else sessionParams.next(convertToParamMap({ sessionId: 'session-b' }));
    resolvePin({ runId: 'run_original', run: { executionAuthority: 'client' }, input: { id: 'input_original' } } as never);
    await run;

    expect(fx.localResultFixture).not.toHaveBeenCalled();
    expect(reportClientRun).toHaveBeenCalledWith('session-a', 'run_original', 'query', [
      { id: 'query', state: 'failed', errorCode: 'CLIENT_DISPATCH_REJECTED' },
    ]);
  });

  it.each([false, true])('does not settle a pending session run while restoring a semantic copy (incomplete=%s)', async (incomplete) => {
    const reportClientRun = vi.fn(async () => true);
    const workspace = {
      capabilities: () => ({ actorId: 'actor-a', databaseId: 'db-a', projectId: 'demo-project', environments: [] }),
      canExecuteFor: () => true,
      bindingScopeKey: () => 'scope-a',
      snapshotFor: (id: string) => ({ session: { id }, contextSet: { id: 'context-a' } }),
      appliedFactsFor: () => [],
      reportClientRun,
      error: () => '',
      deviceViewKey: vi.fn(),
    };
    component = await createComponent({}, queryDef, '<p></p>', {
      project: of(project), sessionId: 'session-a', sessionWorkspace: workspace,
    });
    const internal = component as unknown as {
      sessionRecordedRun: { (): string | undefined; set(value: string | undefined): void };
      sessionRecordedInput: { (): string; set(value: string): void };
      sessionRecordedSessionId: { (): string; set(value: string): void };
      running: { set(value: boolean): void };
      semanticExecutedDefinition: () => IQueryDef | undefined;
      committedRun: () => unknown;
      commitSuccessfulResult(result: FederatedQueryResult, definition: IQueryDef, timing?: undefined, recordSessionOutcome?: boolean): void;
    };
    internal.running.set(true);
    internal.sessionRecordedRun.set('run-still-pending');
    internal.sessionRecordedInput.set('input-original');
    internal.sessionRecordedSessionId.set('session-a');
    const restored = {
      ...historyResultFor(queryDef),
      ...(incomplete ? { hasMore: true } : {}),
    };

    internal.commitSuccessfulResult(restored, { ...queryDef, id: 'device-personal-copy' }, undefined, false);
    await runFixture.whenStable();

    expect(reportClientRun).not.toHaveBeenCalled();
    expect(internal.sessionRecordedRun()).toBe('run-still-pending');
    expect(internal.sessionRecordedInput()).toBe('input-original');
    expect(internal.sessionRecordedSessionId()).toBe('session-a');
    expect(internal.semanticExecutedDefinition()?.id).toBe(incomplete ? undefined : 'device-personal-copy');
    if (incomplete) expect(internal.committedRun()).toBeUndefined();
    else expect(internal.committedRun()).toBeDefined();
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
    expect(fx.localResultFixture).not.toHaveBeenCalled();
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
    expect(fx.localResultFixture).not.toHaveBeenCalled();

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
    fx.localResultFixture.mockReturnValue(of(response));
    component.project = project;

    component.runQuery();

    expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({ agentRequest: {
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
    } }));
    await runFixture.whenStable();
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

  it('keeps a loaded legacy YAML DTQL source on the admitted agent execution path', async () => {
    const yaml = 'from:\n  name: Invoice\n  alias: i\nwhere:\n  op: ==\n  left:\n    field: CustomerId\n  right:\n    param: CustomerId\n';
    const definition: IQueryDef = {
      ...queryDef,
      request: { queryType: QueryType.DTQL, text: yaml } as ITextQueryRequest,
    };
    component = await createComponent({}, definition);
    component.project = project;
    expect(component.isNativeDtqlWorkspace()).toBe(true);
    expect(component.isTugqlAuthorJourney()).toBe(false);
    expect(component.workspaceTab()).toBe('dtql');
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 7,
      label: 'Customer.ID = 7',
      source: 'grid',
    });
    TestBed.tick();
    const response = {
      recordset: { columns: [{ name: 'InvoiceId', type: 'integer' }], rows: [[{ type: 'integer', value: '1' }]] },
      limitations: [], bindingsApplied: [], truncated: false,
      provenance: { source: 'chinook', mode: 'live', observedAt: '2026-10-14T00:00:00Z', executionProfile: 'protected' },
    };
    fx.localResultFixture.mockReturnValue(of(response));
    component.runQuery();
    expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
      agentRequest: expect.objectContaining({
        queryId: definition.id,
        parameters: { CustomerId: { type: 'integer', value: '7' } },
      }),
    }));
    await runFixture.whenStable();
    expect(component.runResult()).toEqual(response);
    expect(component.queryBodyText()).toBe(yaml);
  });

  it('records a persisted local execution as the pending Scenario query step and fences a late route response', async () => {
    component = await createComponent({});
    component.project = project;
    component.queryDef.set(queryDef);
    component.queryState = {
      ...component.queryState,
      id: queryDef.id,
      def: queryDef,
      title: queryDef.title,
      request: queryDef.request,
      isNew: false,
      activeEnv: { id: 'production' } as never,
    };
    component.envId = 'production';
    const caseItem = {
      id: 'case-local',
      title: 'Local investigation',
      status: 'active',
      version: 2,
      context: {},
      incidentRefs: [],
      scenarioRefs: [],
      runRefs: [],
      evidence: [],
      findings: [],
      timeline: [],
      scenarioApplications: [
        {
          id: 'application-local',
          scenarioId: 'scenario-local',
          scenarioVersion: 1,
          appliedAt: '2026-10-13T00:00:00Z',
          appliedBy: 'user',
          snapshot: {
            id: 'scenario-local',
            title: 'Reconcile locally',
            version: 1,
            inputs: [],
            steps: [{ id: 'step-local', kind: 'query', ref: queryDef.id }],
          },
          steps: [{ stepId: 'step-local', status: 'pending' }],
        },
      ],
    };
    const latest = {
      checks: [],
      validators: [],
      queryValidators: [],
      cases: [caseItem],
      runs: [],
      scenarios: [],
      runsHasMore: false,
      capabilities: {
        localOnly: true,
        canRead: true,
        canWrite: true,
        canRun: true,
        maxRows: 100,
        maxFanout: 10,
      },
    } as unknown as DetectiveState;
    component.hostedDetectiveState.set(latest);
    const route = TestBed.inject(ActivatedRoute);
    Object.defineProperty(route.snapshot, 'queryParamMap', {
      value: convertToParamMap({
        caseId: caseItem.id,
        applicationId: 'application-local',
        scenarioStepId: 'step-local',
      }),
      configurable: true,
    });
    const execution = {
      storeId: 'sqlite',
      projectId: 'demo-project',
      executionId: 'local-execution-1',
    };
    fx.localResultFixture.mockReturnValue(
      of({
        recordset: { columns: [], rows: [] },
        limitations: [],
        bindingsApplied: [],
        provenance: {
          source: 'sqlite',
          queryId: queryDef.id,
          mode: 'live',
          observedAt: '2026-10-13T00:00:00Z',
          executionProfile: 'protected',
        },
        truncated: false,
        execution,
      }),
    );
    component.runQuery();
    expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
      agentRequest: expect.objectContaining({ queryId: queryDef.id, record: true }),
    }));
    await runFixture.whenStable();
    expect(component.activeLocalScenarioExecution()?.execution).toEqual(
      execution,
    );

    const detective = TestBed.inject(DetectiveClientService);
    vi.spyOn(detective, 'state').mockReturnValue(of(latest));
    const action = vi
      .spyOn(detective, 'action')
      .mockReturnValue(of({ case: { ...caseItem, version: 3 } as never }));
    await component.completeHostedScenarioStep();
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent', project: 'demo-project' }),
      {
        type: 'record-scenario-step',
        caseId: caseItem.id,
        applicationId: 'application-local',
        stepId: 'step-local',
        stepStatus: 'completed',
        queryId: queryDef.id,
        environment: 'production',
        execution,
      },
      2,
    );
    expect(component.hostedScenarioMessage()).toContain(
      'persisted local query execution',
    );

    component.hostedDetectiveState.set(latest);
    action.mockReturnValueOnce(
      throwError(() => new Error('execution receipt was rejected')),
    );
    const beforeRejectedReceipt = component.hostedDetectiveState();
    await component.completeHostedScenarioStep();
    expect(component.hostedDetectiveState()).toBe(beforeRejectedReceipt);
    expect(component.hostedScenarioError()).toContain(
      'execution receipt was rejected',
    );

    component.hostedDetectiveState.set(latest);
    const pending = new Subject<DetectiveState>();
    vi.mocked(detective.state).mockReturnValueOnce(pending);
    const callsBeforeLateState = action.mock.calls.length;
    const completion = component.completeHostedScenarioStep();
    component.queryState = { ...component.queryState, id: 'another-query' };
    pending.next(latest);
    await completion;
    expect(action).toHaveBeenCalledTimes(callsBeforeLateState);
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
    fx.localResultFixture.mockReturnValueOnce(earlier).mockReturnValueOnce(later);

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
    fx.localResultFixture.mockReturnValue(
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

    expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
      agentRequest: expect.objectContaining({ parameters: {}, bindingOrigins: [] }),
    }));
  });

  it('does not run a selected value when an old candidate omitted its fact provenance', async () => {
    component = await createComponent({
      bindings: [{ ...selectionBinding, factId: undefined }],
    });
    component.project = project;

    component.runQuery();

    expect(fx.localResultFixture).not.toHaveBeenCalled();
    expect(component.runError()).toContain('provenance');
  });

  it('runQuery reports the failure without hiding it', async () => {
    component = await createComponent({});
    fx.localResultFixture.mockReturnValue(
      throwError(() => ({ message: 'ACCESS_DENIED' })),
    );
    component.project = project;

    component.runQuery();

    await runFixture.whenStable();
    expect(component.runError()).toBe('ACCESS_DENIED');
    expect(component.running()).toBe(false);
    expect(component.runResult()).toBeUndefined();
  });

  it('receives multiple ACL blockers asynchronously and clears them on retry', async () => {
    component = await createComponent({});
    runFixture.detectChanges();
    await runFixture.whenStable();
    const pending = new Subject<never>();
    fx.localResultFixture.mockReturnValue(pending);
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
    fx.localResultFixture.mockReturnValue(new Subject<never>());
    component.runQuery();
    expect(component.accessBlockers()).toEqual([]);
  });

  it('runQuery does nothing without a project', async () => {
    component = await createComponent({});
    component.project = undefined;

    component.runQuery();

    expect(fx.localResultFixture).not.toHaveBeenCalled();
  });

  it('runQuery does nothing without an environment (envId unset)', async () => {
    component = await createComponent({});
    component.project = project;
    component.envId = undefined;

    component.runQuery();

    expect(fx.localResultFixture).not.toHaveBeenCalled();
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
    fx.localResultFixture.mockReturnValue(throwError(() => targetRequired));

    component.runQuery();

    await runFixture.whenStable();
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
    fx.localResultFixture.mockReturnValue(throwError(() => sourceUnavailable));

    component.runQuery();

    await runFixture.whenStable();
    expect(component.sourceUnavailable()).toBe(true);
    expect(component.availableSnapshot()).toEqual({
      snapshotId: 'exchange-rates-2026-09-01',
      recordedAt: '2026-09-01T00:00:00Z',
    });
    expect(fx.localResultFixture).toHaveBeenCalledTimes(1);
    expect(fx.dispatchStart.mock.calls[0][0].agentRequest).toMatchObject({ mode: 'live' });

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
    fx.localResultFixture.mockReturnValue(of(snapshotResponse));

    component.runSnapshot();

    await runFixture.whenStable();
    expect(fx.localResultFixture).toHaveBeenCalledTimes(2);
    expect(fx.dispatchStart.mock.calls[1][0].agentRequest).toMatchObject({
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
    fx.localResultFixture.mockReturnValue(throwError(() => sourceUnavailableNoFixture));

    component.runQuery();

    await runFixture.whenStable();
    expect(component.sourceUnavailable()).toBe(true);
    expect(component.availableSnapshot()).toBeUndefined();
    expect(fx.localResultFixture).toHaveBeenCalledTimes(1);

    component.runSnapshot();

    // Never sends a mode:snapshot request with a fabricated/empty snapshotId.
    expect(fx.localResultFixture).toHaveBeenCalledTimes(1);
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
    fx.localResultFixture.mockReturnValue(
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
    fx.localResultFixture.mockReturnValue(throwError(() => staleContext));

    component.runQuery();

    await runFixture.whenStable();
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
    fx.localResultFixture = vi.fn();
    await TestBed.configureTestingModule({
      imports: [QueryPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: ProjectMeaningsService, useValue: {} },
        {
          provide: GitHubProjectActivityService,
          useValue: githubProjectActivityStub(),
        },
        provideMockErrorLogger(),
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
        { provide: QueriesService, useValue: { devicePersonal: { list: vi.fn(async () => []) } } },
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
        { provide: SemanticApiService, useValue: { runQuery: vi.fn() } },
        { provide: DetectiveClientService, useValue: detectiveClientStub() },
        { provide: QueryDispatchService, useValue: queryDispatchTestStub(fx) },
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
    expect(fx.localResultFixture).not.toHaveBeenCalled();
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
    expect(fx.localResultFixture).not.toHaveBeenCalled();
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
        { provide: ProjectMeaningsService, useValue: {} },
        {
          provide: GitHubProjectActivityService,
          useValue: githubProjectActivityStub(),
        },
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
        { provide: ProjectMeaningsService, useValue: {} },
        {
          provide: GitHubProjectActivityService,
          useValue: githubProjectActivityStub(),
        },
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
    editorImports: Array<Type<unknown>> = [],
    editorState$?: BehaviorSubject<IQueryEditorState>,
    projectContext: IProjectContext = project,
    route?: {
      readonly queryId?: string;
      readonly queryParams?: ReturnType<typeof convertToParamMap>;
    },
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
    const editor = editorState$ ?? new BehaviorSubject(editorState);
    const routeQueryParams = route?.queryParams ?? convertToParamMap({});
    const routeParams = convertToParamMap(
      route?.queryId ? { queryId: route.queryId } : {},
    );

    await TestBed.configureTestingModule({
      imports: [QueryPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: ProjectMeaningsService, useValue: {} },
        {
          provide: GitHubProjectActivityService,
          useValue: githubProjectActivityStub(),
        },
        provideMockErrorLogger(),
        {
          provide: RandomIdService,
          useValue: { newRandomId: vi.fn(() => 'test-id') },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(projectContext),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of(routeQueryParams),
            paramMap: of(routeParams),
            snapshot: {
              paramMap: routeParams,
              queryParamMap: routeQueryParams,
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
        { provide: QueriesService, useValue: { devicePersonal: { list: vi.fn(async () => []) } } },
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
            openQuery: vi.fn((queryId: string) => {
              if (editor.value.activeQueries.some((query) => query.id === queryId))
                editor.next({ ...editor.value, currentQueryId: queryId });
            }),
            newQuery: vi.fn(),
            getQueryState: vi.fn((queryId: string) =>
              editor.value.activeQueries.find((query) => query.id === queryId),
            ),
            saveQuery: vi.fn(),
          },
        },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn() } },
        { provide: SemanticApiService, useValue: { runQuery: vi.fn() } },
        { provide: DetectiveClientService, useValue: detectiveClientStub() },
        { provide: QueryDispatchService, useValue: queryDispatchTestStub(fx) },
        { provide: AgentContextService, useValue: agentContextStub() },
      ],
    })
      .overrideComponent(QueryPageComponent, {
        set: {
          imports: editorImports,
          template,
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(QueryPageComponent);
    return fixture.componentInstance;
  }

  function queryTextEditorTemplate(): string {
    const template = readFileSync(
      resolve(
        'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
      ),
      'utf8',
    );
    const card = template.indexOf('data-testid="unified-text-workspace"');
    const start = template.indexOf('@if (isNativeSqlWorkspace()) {', card);
    const end = template.indexOf('@if (!isNativeSqlWorkspace() && !isNativeDtqlWorkspace()) {', start);
    if (card < 0 || start < 0 || end < 0) {
      throw new Error(
        'Could not locate the maintained query text editor fragment.',
      );
    }
    return `<ion-card-content>${template.slice(start, end)}</ion-card-content>`;
  }
  beforeEach(() => {
    sessionStorage.clear();
    fx.dispatchStart.mockReset();
    fx.dispatchBrowserResponse.mockReset();
  });

  it('uses the shared CodeMirror editor for both native SQL and saved DTQL sources', () => {
    const template = readFileSync(
      resolve(
        'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
      ),
      'utf8',
    );
    const workspace = template.indexOf('data-testid="unified-text-workspace"');
    const sqlBranch = template.indexOf('@if (isNativeSqlWorkspace()) {', workspace);
    const sqlEditor = template.indexOf('<sneat-datatug-sql', sqlBranch);
    const dtqlBranch = template.indexOf('@if (isNativeDtqlWorkspace()) {', sqlEditor);
    const dtqlEditor = template.indexOf('<sneat-datatug-sql', dtqlBranch);

    expect(sqlBranch).toBeGreaterThanOrEqual(0);
    expect(sqlEditor).toBeGreaterThan(sqlBranch);
    expect(
      template.indexOf('(sqlChanged)="sqlTextChanged($event)"', sqlEditor),
    ).toBeGreaterThan(sqlEditor);
    expect(dtqlBranch).toBeGreaterThan(sqlEditor);
    expect(dtqlEditor).toBeGreaterThan(dtqlBranch);
    expect(
      template.indexOf('(sqlChanged)="sqlTextChanged($event)"', dtqlEditor),
    ).toBeGreaterThan(dtqlEditor);
    expect(template.slice(workspace, dtqlEditor + 600)).not.toContain(
      '<ion-textarea data-testid="query-body-text"',
    );
  });

  it('mounts SQL editor bindings and preserves the editable non-SQL textarea branch', async () => {
    component = await createComponent(legacySqlDef, queryTextEditorTemplate(), [
      SqlEditorHostStub,
    ]);
    fixture.detectChanges();

    const sqlEditor = fixture.debugElement.query(
      By.directive(SqlEditorHostStub),
    );
    expect(sqlEditor).not.toBeNull();
    expect(sqlEditor.componentInstance.sql()).toBe(legacySqlText);
    expect(sqlEditor.componentInstance.disabled()).toBe(false);
    expect(sqlEditor.componentInstance.readonly()).toBe(false);
    expect(sqlEditor.componentInstance.lineNumbers()).toBe(false);
    expect(sqlEditor.componentInstance.autoCloseBrackets()).toBe(false);
    sqlEditor.componentInstance.sqlChanged.emit('SELECT 2;');
    fixture.detectChanges();
    expect(component.queryBodyText()).toBe('SELECT 2;');
  });

  it('shows a saved DTQL source in the shared code editor, connected to the draft', async () => {
    component = await createComponent(dtqlDef, queryTextEditorTemplate(), [
      SqlEditorHostStub,
    ]);
    fixture.detectChanges();
    const editors = fixture.debugElement.queryAll(
      By.directive(SqlEditorHostStub),
    );
    const dtqlEditor = editors.find(
      (e) => e.componentInstance.ariaLabel() === 'DTQL source',
    );
    expect(dtqlEditor).toBeDefined();
    dtqlEditor?.componentInstance.sqlChanged.emit('from:\n  name: Artist\n');
    fixture.detectChanges();
    expect(component.queryBodyText()).toBe('from:\n  name: Artist\n');
  });

  it('keeps a loaded legacy DTQL query in its native source pane even while the draft changes', async () => {
    component = await createComponent(dtqlDef);
    expect(component.isTextQueryWorkspace()).toBe(true);
    expect(component.isNativeDtqlWorkspace()).toBe(true);
    expect(component.isTugqlAuthorJourney()).toBe(false);
    expect(component.workspaceTab()).toBe('dtql');
    component.queryTextChanged(new CustomEvent('ionInput', { detail: { value: 'FROM Invoice\nSELECT (InvoiceId)' } }));
    expect(component.isNativeDtqlWorkspace()).toBe(true);
    expect(component.isTugqlAuthorJourney()).toBe(false);
    expect(component.workspaceTab()).toBe('dtql');
  });

  it('keeps malformed saved TugQL in CodeMirror and its bounded execution guard', async () => {
    const malformed: IQueryDef = {
      ...dtqlDef,
      connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.DTQL, text: 'FROM Invoice\nSELECT ()' } as ITextQueryRequest,
    };
    component = await createComponent(malformed);
    expect(component.isNativeDtqlWorkspace()).toBe(false);
    expect(component.isTugqlAuthorJourney()).toBe(true);
    expect(component.workspaceTab()).toBe('tugql');
    component.queryTextChanged(new CustomEvent('ionInput', { detail: { value: 'from:\n  name: Invoice\n' } }));
    expect(component.isNativeDtqlWorkspace()).toBe(false);
    expect(component.isTugqlAuthorJourney()).toBe(true);
  });

  it.each([
    ['document marker', '---\nfrom:\n  name: Invoice\nlimit: 1\n'],
    ['leading offset', 'offset: 0\nfrom:\n  name: Invoice\nlimit: 1\n'],
    ['flow mapping', '{from: {name: Invoice}, limit: 1}'],
  ])('keeps valid %s YAML DTQL in its native source pane', async (_shape, yaml) => {
    expect(() => parseDTQL(yaml, { tables: [{ name: 'Invoice', fields: ['InvoiceId'] }] })).not.toThrow();
    const definition: IQueryDef = {
      ...dtqlDef,
      connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.DTQL, text: yaml } as ITextQueryRequest,
    };
    component = await createComponent(definition);
    expect(component.isNativeDtqlWorkspace()).toBe(true);
    expect(component.isTugqlAuthorJourney()).toBe(false);
    expect(component.workspaceTab()).toBe('dtql');
    expect(component.queryBodyText()).toBe(yaml);
  });

  it('reclassifies the same query ID only after a saved loading placeholder and new definition', async () => {
    const state = new BehaviorSubject({
      currentQueryId: dtqlDef.id,
      activeQueries: [{ id: dtqlDef.id, queryType: QueryType.DTQL, request: dtqlDef.request, def: dtqlDef }],
    } as IQueryEditorState);
    component = await createComponent(dtqlDef, '', [], state);
    expect(component.isNativeDtqlWorkspace()).toBe(true);
    const reloaded: IQueryDef = {
      ...dtqlDef,
      connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.DTQL, text: 'FROM Invoice\nSELECT ()' } as ITextQueryRequest,
    };
    state.next({ currentQueryId: dtqlDef.id, activeQueries: [{ id: dtqlDef.id, queryType: QueryType.SQL, request: { queryType: QueryType.SQL, text: '' } as ISqlQueryRequest, isLoading: true }] } as IQueryEditorState);
    state.next({ currentQueryId: dtqlDef.id, activeQueries: [{ id: dtqlDef.id, queryType: QueryType.DTQL, request: reloaded.request, def: reloaded }] } as IQueryEditorState);
    await fixture.whenStable();
    expect(component.isNativeDtqlWorkspace()).toBe(false);
    expect(component.isTugqlAuthorJourney()).toBe(true);
    expect(component.workspaceTab()).toBe('tugql');
  });

  it('resolves explicitly edited optional SQL declarations without inventing metadata or changing source', async () => {
    const albumId: IParameterDef = { id: 'AlbumId', type: 'integer' };
    const sqlWithParameters: IQueryDef = {
      ...legacySqlDef,
      parameters: [
        albumId,
        { id: 'ArtistId', type: 'integer' },
      ],
    };
    component = await createComponent(sqlWithParameters);
    expect(component.authorParameterDeclarationCount()).toBe(2);
    expect(component.bindings().map((item) => item.parameterId)).toEqual(['AlbumId', 'ArtistId']);
    expect(component.effectiveBindings()).toEqual([]);
    component.setNativeParameterInput(albumId, '12');
    expect(component.effectiveBindings()).toMatchObject([{ parameterId: 'AlbumId', value: { type: 'integer', value: '12' }, origin: 'user' }]);
    expect(component.queryBodyText()).toBe(legacySqlText);
    component.setNativeParameterInput(albumId, '012');
    expect(component.nativeParameterError('AlbumId')).toContain('valid integer');
    expect(component.hasBlockedBindings()).toBe(true);
    expect(component.effectiveBindings()).toEqual([]);
    component.clearNativeParameter('AlbumId');
    expect(component.nativeParameterError('AlbumId')).toBeUndefined();
    expect(component.effectiveBindings()).toEqual([]);
  });

  it('fills a native parameter from the lookup as an ordinary manual binding labelled "from lookup" (parameter-lookup AC pick-returns-typed-key)', async () => {
    const customer: IParameterDef = { id: 'AlbumId', type: 'integer', isRequired: true, meta: { entity: 'Album', field: 'ID' } };
    component = await createComponent({ ...legacySqlDef, parameters: [customer] });
    const context = component.parameterLookupContext();
    expect(component.parameterLookupContext()).toBe(context);
    expect(context.hostConnectionId).toBe(legacySqlDef.connectionId);
    component.onNativeParameterPicked(customer, { value: 7, key: { type: 'integer', value: '7' } });
    expect(component.nativeParameterValue('AlbumId')).toBe('7');
    expect(component.nativeParameterHint(customer)).toBe('integer · Required · from lookup');
    expect(component.effectiveBindings()).toMatchObject([{ parameterId: 'AlbumId', value: { type: 'integer', value: '7' }, origin: 'user' }]);
    component.setNativeParameterInput(customer, '8');
    expect(component.nativeParameterHint(customer)).not.toContain('from lookup');
    component.onNativeParameterPicked(customer, { value: 9, key: { type: 'integer', value: '9' } });
    component.clearNativeParameter('AlbumId');
    expect(component.nativeParameterHint(customer)).not.toContain('from lookup');
    component.onNativeParameterPicked(customer, { value: '012', key: { type: 'string', value: '012' } });
    expect(component.nativeParameterHint(customer)).not.toContain('from lookup');
  });

  it('blocks direct Run for invalid optional SQL input before agent dispatch and accepts lossless signed integers', async () => {
    const albumId: IParameterDef = { id: 'AlbumId', type: 'integer' };
    const definition: IQueryDef = {
      ...legacySqlDef,
      parameters: [albumId],
    };
    const agentProject: IProjectContext = {
      ref: { storeId: 'http://localhost:8080', projectId: 'album-test' },
    };
    component = await createComponent(definition, '', [], undefined, agentProject);
    component.project = agentProject;
    component.envId = 'local';
    const run = TestBed.inject(SemanticApiService).runQuery as ReturnType<typeof vi.fn>;

    for (const invalid of ['abc', '9007199254740992', '-9007199254740992']) {
      component.setNativeParameterInput(albumId, invalid);
      expect(component.nativeParameterError('AlbumId')).toContain('valid integer');
      expect(component.hasBlockedBindings()).toBe(true);
      component.runQuery();
      expect(component.runError()).toContain('Correct or clear invalid parameter');
      expect(run).not.toHaveBeenCalled();
    }

    for (const valid of ['0', '-5', '9007199254740991']) {
      component.setNativeParameterInput(albumId, valid);
      expect(component.nativeParameterError('AlbumId')).toBeUndefined();
      expect(component.effectiveBindings()).toMatchObject([
        { parameterId: 'AlbumId', value: { type: 'integer', value: valid } },
      ]);
    }
    component.clearNativeParameter('AlbumId');
    expect(component.hasBlockedBindings()).toBe(false);
    expect(component.effectiveBindings()).toEqual([]);
    expect(run).not.toHaveBeenCalled();
    expect(component.queryBodyText()).toBe(legacySqlText);
  });

  it('uses the existing admitted browser SQLite executor only for the complete declared SQL bindings', async () => {
    const albumId: IParameterDef = { id: 'AlbumId', type: 'integer' };
    const artistId: IParameterDef = { id: 'ArtistId', type: 'integer' };
    const definition: IQueryDef = {
      ...legacySqlDef,
      connectionId: 'chinook-sqlite',
      parameters: [albumId, artistId],
    };
    component = await createComponent(definition);
    component.project = project;
    fx.dispatchBrowserResponse.mockImplementation(() => new Promise<FederatedQueryResult>(() => undefined));

    component.setNativeParameterInput(albumId, '0');
    component.runQuery();
    expect(component.runError()).toContain('needs values for its required declared parameters');
    expect(fx.dispatchStart).not.toHaveBeenCalled();

    component.setNativeParameterInput(artistId, '9007199254740992');
    component.runQuery();
    expect(component.nativeParameterError('ArtistId')).toContain('valid integer');
    expect(fx.dispatchStart).not.toHaveBeenCalled();

    component.setNativeParameterInput(artistId, '-5');
    component.runQuery();
    expect(fx.dispatchStart).toHaveBeenCalledOnce();
    expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
      projectRef: project.ref,
      definition,
      target: { kind: 'browser-sqlite' },
      parameters: {
        AlbumId: { type: 'integer', value: '0' },
        ArtistId: { type: 'integer', value: '-5' },
      },
    }));
    expect(component.queryBodyText()).toBe(legacySqlText);
    expect(component.queryDef()).toEqual(definition);
  });

  it('preserves an omitted environment from a saved SQL query route through browser SQLite dispatch', async () => {
    const queryId = 'demodb/northwind-orders-browser-sqlite';
    const definition: IQueryDef = {
      id: queryId,
      title: 'Northwind orders',
      connectionId: 'northwind-sqlite',
      request: { queryType: QueryType.SQL, text: 'select 1' } as ISqlQueryRequest,
    };
    const loadingState: IQueryState = {
      id: queryId,
      queryType: QueryType.SQL,
      isLoading: true,
      environments: [{ id: 'local' }],
    };
    const browserProject: IProjectContext = {
      ref: {
        storeId: 'github.com',
        projectId: 'datatug-demo-project@datatug@demo-project-1',
      },
    };
    const editorState = new BehaviorSubject<IQueryEditorState>({
      activeQueries: [loadingState],
    });
    component = await createComponent(
      definition,
      '',
      [],
      editorState,
      browserProject,
      {
        queryId,
        queryParams: convertToParamMap({
          id: queryId,
          runtime: 'project',
        }),
      },
    );

    expect(component.envId).toBeUndefined();
    editorState.next({
      ...editorState.value,
      activeQueries: [
        {
          ...editorState.value.activeQueries[0],
          isLoading: false,
          request: definition.request,
          def: definition,
        },
      ],
    });
    expect(component.envId).toBeUndefined();
    component.runQuery();

    expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
      projectRef: browserProject.ref,
      definition,
      environment: undefined,
      target: { kind: 'browser-sqlite' },
    }));
  });

  it('keeps exact browser SQL inputs and client origins with the prior result after a draft binding edit', async () => {
    const albumId: IParameterDef = { id: 'AlbumId', type: 'integer' };
    const artistId: IParameterDef = { id: 'ArtistId', type: 'integer' };
    const definition: IQueryDef = {
      ...legacySqlDef,
      connectionId: 'chinook-sqlite',
      parameters: [albumId, artistId],
    };
    component = await createComponent(definition);
    component.project = project;
    const result = {
      recordset: { columns: [{ name: 'AlbumId', type: 'unknown' }], rows: [[{ type: 'integer', value: '0' }]] },
      limitations: [], bindingsApplied: [], truncated: false,
      provenance: { source: 'Pinned public Chinook SQLite fixture', queryId: definition.id, mode: 'snapshot', observedAt: '2026-10-14T00:00:00Z', executionProfile: 'protected' },
    } as FederatedQueryResult;
    fx.dispatchBrowserResponse.mockResolvedValue(result);

    component.setNativeParameterInput(albumId, '0');
    component.setNativeParameterInput(artistId, '-5');
    component.runQuery();
    await vi.waitFor(() => expect(component.runResult()).toBeDefined());
    expect(fx.dispatchStart).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'browser-sqlite' },
      parameters: {
        AlbumId: { type: 'integer', value: '0' },
        ArtistId: { type: 'integer', value: '-5' },
      },
    }));
    expect(component.runResult()?.bindingsApplied).toEqual([
      { parameterId: 'AlbumId', value: { type: 'integer', value: '0' }, origin: 'manual', originEvidence: 'client-reported' },
      { parameterId: 'ArtistId', value: { type: 'integer', value: '-5' }, origin: 'manual', originEvidence: 'client-reported' },
    ]);
    expect(component.displayedResultIsPreviousRun()).toBe(false);
    component.setNativeParameterInput(albumId, '7');
    expect(component.displayedResultIsPreviousRun()).toBe(true);
    expect(component.runResult()?.bindingsApplied.map((binding) => binding.value)).toEqual([
      { type: 'integer', value: '0' }, { type: 'integer', value: '-5' },
    ]);
    expect(component.queryBodyText()).toBe(legacySqlText);
    expect(component.queryDef()).toEqual(definition);
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
      } as IHttpQueryRequest,
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
    component = await createComponent(blankSql, queryTextEditorTemplate(), [
      SqlEditorHostStub,
    ]);
    fixture.detectChanges();
    const getEditor = () =>
      fixture.debugElement.query(By.directive(SqlEditorHostStub));
    expect(getEditor()).not.toBeNull();
    expect(getEditor().componentInstance.sql()).toBe('');

    const edit = async (value: string) => {
      const editor = getEditor();
      expect(editor).not.toBeNull();
      editor.componentInstance.sqlChanged.emit(value);
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await edit('select 1');
    expect(component.queryBodyText()).toBe('select 1');
    expect(getEditor().componentInstance.sql()).toBe('select 1');
    await edit('');
    expect(component.queryBodyText()).toBe('');
    expect(getEditor().componentInstance.sql()).toBe('');
    await edit('select 2');
    expect(component.queryBodyText()).toBe('select 2');
    expect(getEditor().componentInstance.sql()).toBe('select 2');
  });

  it('updates the mounted header from the selected query state and never reuses a stale title', async () => {
    const queryId = 'query-header-a';
    const definition: IQueryDef = {
      ...legacySqlDef,
      id: queryId,
      title: 'Definition title',
    };
    const loading: IQueryState = {
      id: queryId,
      queryType: QueryType.SQL,
      request: definition.request,
      isLoading: true,
    };
    const editor = new BehaviorSubject<IQueryEditorState>({
      currentQueryId: queryId,
      activeQueries: [loading],
    });
    const longProjectTitle =
      'データベース・デモ用プロジェクト — DemoDB datasets 🌍';
    const template = `
      <sneat-datatug-page-title [pageTitle]="queryPageTitle()" />
      <ion-input data-testid="query-title" (ionChange)="queryTitleChanged($event)" />
    `;
    component = await createComponent(
      definition,
      template,
      [SneatDatatugPageTitleComponent],
      editor,
      { ...project, brief: { title: longProjectTitle } },
    );
    fixture.detectChanges();

    const header = () =>
      fixture.nativeElement
        .querySelector('sneat-datatug-page-title strong')
        ?.textContent?.trim();
    const completeHeader = () =>
      fixture.nativeElement
        .querySelector('sneat-datatug-page-title ion-title')
        ?.textContent?.replace(/\s+/gu, ' ')
        .trim();
    expect(header()).toBe('Query');

    // The title arrives after the first render, with no explicit detectChanges.
    editor.next({
      currentQueryId: queryId,
      activeQueries: [{ ...loading, def: definition, title: undefined }],
    });
    await fixture.whenStable();
    expect(header()).toBe('Definition title');

    const logError = vi.spyOn(TestBed.inject(ErrorLogger), 'logError');
    const loadedQuery: IQueryDef = {
      ...definition,
      request: {
        queryType: QueryType.SQL,
        text: 'select 88',
      } as ISqlQueryRequest,
    };
    const invalidStateTitle = 17 as unknown as string;
    editor.next({
      currentQueryId: queryId,
      activeQueries: [
        {
          ...loading,
          def: loadedQuery,
          request: loadedQuery.request,
          title: invalidStateTitle,
        },
      ],
    });
    await fixture.whenStable();
    expect(header()).toBe('Query');
    expect(component.queryState.id).toBe(queryId);
    expect(component.queryState.title).toBe(invalidStateTitle);
    expect(component.queryBodyText()).toBe('select 88');
    expect(logError).not.toHaveBeenCalled();

    const invalidDefinitionTitle = {
      unexpected: 'object title',
    } as unknown as string;
    const invalidTitleDefinition: IQueryDef = {
      ...loadedQuery,
      request: {
        queryType: QueryType.SQL,
        text: 'select 89',
      } as ISqlQueryRequest,
      title: invalidDefinitionTitle,
    };
    editor.next({
      currentQueryId: queryId,
      activeQueries: [
        {
          ...loading,
          def: invalidTitleDefinition,
          request: invalidTitleDefinition.request,
        },
      ],
    });
    await fixture.whenStable();
    expect(header()).toBe('Query');
    expect(component.queryState.id).toBe(queryId);
    expect(component.queryState.def?.title).toBe(invalidDefinitionTitle);
    expect(component.queryBodyText()).toBe('select 89');
    expect(logError).not.toHaveBeenCalled();

    editor.next({
      currentQueryId: queryId,
      activeQueries: [{ ...loading, def: definition, title: undefined }],
    });
    await fixture.whenStable();
    expect(header()).toBe('Definition title');

    // A title-only draft is authoritative even with no definition. Explicit
    // blank is retained in state but rendered as the fallback.
    editor.next({
      currentQueryId: queryId,
      activeQueries: [{ ...loading, title: '  Draft Ω  ' }],
    });
    await fixture.whenStable();
    expect(header()).toBe('Draft Ω');
    editor.next({
      currentQueryId: queryId,
      activeQueries: [{ ...loading, def: definition, title: '' }],
    });
    await fixture.whenStable();
    expect(header()).toBe('Query');
    expect(component.queryState.title).toBe('');
    editor.next({
      currentQueryId: queryId,
      activeQueries: [{ ...loading, title: 'Next title only' }],
    });
    await fixture.whenStable();
    expect(header()).toBe('Next title only');

    // The real mounted title input handler stores the emitted bytes unchanged;
    // only the header trims for display.
    const titleInput = fixture.nativeElement.querySelector(
      '[data-testid="query-title"]',
    ) as HTMLElement;
    titleInput.dispatchEvent(
      new CustomEvent('ionChange', {
        detail: {
          value: '  Edited Unicode — 東京 — Ångström account summary  ',
        },
        bubbles: true,
      }),
    );
    await fixture.whenStable();
    expect(component.queryState.title).toBe(
      '  Edited Unicode — 東京 — Ångström account summary  ',
    );
    expect(header()).toBe('Edited Unicode — 東京 — Ångström account summary');
    expect(completeHeader()).toContain(
      `Edited Unicode — 東京 — Ångström account summary @ ${longProjectTitle}`,
    );
    titleInput.dispatchEvent(
      new CustomEvent('ionChange', {
        detail: { value: '   ' },
        bubbles: true,
      }),
    );
    await fixture.whenStable();
    expect(component.queryState.title).toBe('   ');
    expect(header()).toBe('Query');

    editor.next({
      currentQueryId: queryId,
      activeQueries: [
        {
          ...loading,
          def: definition,
          title: 'Known while loading',
          isLoading: true,
        },
      ],
    });
    await fixture.whenStable();
    expect(header()).toBe('Known while loading');
    editor.next({
      currentQueryId: queryId,
      activeQueries: [
        {
          ...loading,
          def: definition,
          title: 'Known after error',
          activeEnv: { id: 'local', error: new Error('offline') },
        },
      ],
    });
    await fixture.whenStable();
    expect(header()).toBe('Known after error');

    const nextId = 'query-header-b';
    editor.next({
      currentQueryId: queryId,
      activeQueries: [{ ...loading, def: definition, title: 'Previous query' }],
    });
    await fixture.whenStable();
    expect(header()).toBe('Previous query');
    editor.next({
      currentQueryId: nextId,
      activeQueries: [
        { id: nextId, queryType: QueryType.SQL, request: definition.request },
      ],
    });
    await fixture.whenStable();
    expect(header()).toBe('Query');
    editor.next({
      currentQueryId: nextId,
      activeQueries: [
        { id: nextId, queryType: QueryType.SQL, title: 'Next query' },
      ],
    });
    await fixture.whenStable();
    expect(header()).toBe('Next query');
    editor.next({ currentQueryId: nextId, activeQueries: [] });
    await fixture.whenStable();
    expect(header()).toBe('Query');
    editor.next({
      currentQueryId: nextId,
      activeQueries: [
        { id: nextId, queryType: QueryType.SQL, title: 'Title before close' },
      ],
    });
    await fixture.whenStable();
    expect(header()).toBe('Title before close');
    editor.next({ activeQueries: [] });
    await fixture.whenStable();
    expect(header()).toBe('Query');
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
      } as IHttpQueryRequest,
    };

    expect(extractLinkedEntityNames(def)).toEqual([]);
  });
});
