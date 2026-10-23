import { ProjectMeaningsService } from '../../../meanings/project-meanings.service';
import { DemoTableDraftService } from '../../demo-table-draft.service';
import * as publicChartQueries from '../../public-data/public-chart-query';
import { QueryRuntimeRegistry } from '../../query-runtime-registry.service';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';
import { NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { RandomIdService } from '@sneat/random';
import { AgentContextService, SemanticApiService } from '@sneat/datatug-semantic';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { QueryPageComponent } from './query-page.component';
import { IProjectContext } from '../../../nav/nav-models';
import type { IProjectRef } from '../../../core/project-context';
import { IQueryDef, ITextQueryRequest, QueryType } from '../../../models/definition/query-def';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { QueryContextSqlService } from '../../query-context-sql.service';
import { QueriesService } from '../../queries.service';
import { Coordinator } from '../../../executor/coordinator';
import { ProjectService } from '../../../services/project/project.service';
import { QueryEditorStateService } from '../../query-editor-state-service';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { GitHubProjectActivityService } from '../../../services/project/github-project-activity.service';
import { DetectiveClientService } from '../../../detective/detective-client.service';
import { QueryDispatchService } from '../../query-dispatch.service';
import { ProjectQueryApiService } from '../../../services/project/project-query-api.service';
import { GithubProjectReaderService } from '../../../services/repo/github/github-project-reader.service';
import { BrowserSqliteQueryService } from '../../browser-sqlite-query.service';
import { provideMockErrorLogger } from '../../../testing/error-logger.spec-helper';
import { agentContextStub, detectiveClientStub, githubProjectActivityStub, resolve } from './query-page.spec-helper';

describe('QueryPage terminal handoff and public saved query integration', () => {
  const template = readFileSync(resolve('libs/datatug/main/src/lib/queries/query/page/query-page.component.html'), 'utf8');
  const cloudRef: IProjectRef = { storeId: 'github.com', projectId: 'repo@owner@folder', projectApi: 'cloud', branch: 'main' };
  const sha = 'a'.repeat(64);
  const declaration = { id: 'chinook-sqlite', dataset: 'chinook', fixtureSha256: sha, storage: 'sqlite', environments: ['dev'] };

  beforeEach(() => {
    // Ionic icons in the actual template request SVG assets; this suite has no network.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'Content-Type': 'image/svg+xml' } })));
  });

  async function setup(savedId?: string, queryType = QueryType.TugQL, options: {
    projectEnvironments?: boolean; environment?: string; contextEnvironment?: string;
  } = {}) {
    Object.defineProperty(window, 'history', { value: { ...window.history, state: {} }, configurable: true, writable: true });
    const ref = savedId ? { storeId: 'github.com', projectId: 'datatug-demo-project@datatug@demo-project-1' } : cloudRef;
    const project = new BehaviorSubject<IProjectContext | undefined>({ ref,
      ...(options.projectEnvironments ? { summary: { environments: [{ id: 'local' }, { id: 'dev' }, { id: 'prod' }] } } : {}),
    } as IProjectContext);
    const currentEnv = new BehaviorSubject(options.contextEnvironment ? { id: options.contextEnvironment } : undefined);
    const auth = new BehaviorSubject({ status: 'authenticated', user: { uid: 'actor' } });
    const denied = new Subject<IProjectRef>();
    const params = new BehaviorSubject(convertToParamMap({}));
    const routeIds = convertToParamMap({ storeId: ref.storeId, projectId: ref.projectId, ...(savedId ? { queryId: savedId } : {}) });
    const route = { queryParamMap: params, paramMap: of(routeIds), snapshot: { paramMap: routeIds, queryParamMap: params.value, params: {} } };
    const browser = vi.fn();
    const catalog = vi.fn(() => of({ connections: [declaration] }));
    let ids = 0;
    // Never `imports: [QueryPageComponent]`: TestBed would then walk the ORIGINAL standalone component's dependency
    // graph and JIT-compile its 2,000-line template and every child component (editors, grid, charts) that the
    // override below discards. That once-per-worker compile is what pushed this file past the 5s test timeout
    // under a loaded machine. createComponent() compiles only the overridden definition.
    await TestBed.configureTestingModule({ providers: [
        { provide: ProjectMeaningsService, useValue: {} },
      provideMockErrorLogger(),
      { provide: RandomIdService, useValue: { newRandomId: () => `handoff-${++ids}` } },
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: { navigate: vi.fn(async () => true), events: of(), currentNavigation: vi.fn(() => null), lastSuccessfulNavigation: vi.fn(() => null), routerState: { root: route } } },
      { provide: DatatugNavContextService, useValue: { currentProject: project, currentEnv, setCurrentEnvironment: vi.fn() } },
      { provide: QueriesService, useValue: { authentication: () => auth, authorityDenied: () => denied, getQuery: vi.fn(() => of(definition)), devicePersonal: { list: vi.fn(async () => []) } } },
      { provide: ProjectService, useValue: { getFull: vi.fn() } },
      { provide: QueryEditorStateService, useClass: QueryEditorStateService },
      { provide: QueryContextSqlService, useValue: { setSql: vi.fn(), setTarget: vi.fn() } },
      { provide: GitHubProjectActivityService, useValue: githubProjectActivityStub() },
      { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn(() => of({ id: 'dev' })) } },
      { provide: Coordinator, useValue: { execute: vi.fn() } },
      { provide: SemanticApiService, useValue: { runQuery: vi.fn() } },
      { provide: DetectiveClientService, useValue: detectiveClientStub() },
      { provide: AgentContextService, useValue: agentContextStub() },
      { provide: HttpClient, useValue: { post: vi.fn() } },
      { provide: ProjectQueryApiService, useValue: { connectionCatalog: catalog } },
      { provide: GithubProjectReaderService, useValue: { getRawJson: vi.fn() } },
      { provide: BrowserSqliteQueryService, useValue: { execute: browser } },
      { provide: QueryDispatchService, useClass: QueryDispatchService },
    ] }).overrideComponent(QueryPageComponent, { set: {
      imports: [NgTemplateOutlet], providers: [], schemas: [CUSTOM_ELEMENTS_SCHEMA], template,
    } }).compileComponents();
    const editor = TestBed.inject(QueryEditorStateService);
    const drafts = TestBed.inject(DemoTableDraftService);
    const registry = TestBed.inject(QueryRuntimeRegistry);
    const runtime = registry.register({ id: 'edited', title: 'Edited Chinook', databaseId: 'chinook', baseUrl: 'https://browser.local/v1', fetch: vi.fn(), descriptor: { id: 'chinook', canonical: { sha256: sha, bytes: 10, url: 'https://demo/file' }, capabilities: { tugql: true }, collections: ['Artist'] } } as never);
    const token = drafts.create({ actorID: 'actor', projectRef: ref, connection: declaration, table: 'Artist', runtimeSelectionId: runtime.selectionId, environment: 'dev' });
    const definition: IQueryDef | undefined = savedId ? { id: savedId.split('/').at(-1) ?? savedId, title: 'Saved public query', connectionId: 'northwind-sqlite', request: { queryType, text: 'changed text' } as ITextQueryRequest } : undefined;
    if (definition && savedId) editor.newQuery({ id: savedId, isNew: false, def: definition, request: definition.request, queryType });
    const queryParams = savedId ? { id: savedId, runtime: 'project', ...(options.environment ? { env: options.environment } : {}) } : { demoDraft: token, runtime: runtime.selectionId, env: 'dev', projectApi: 'cloud', branch: 'main' };
    route.snapshot.queryParamMap = convertToParamMap(queryParams);
    params.next(route.snapshot.queryParamMap);
    const create = async () => {
      const fixture = TestBed.createComponent(QueryPageComponent);
      fixture.detectChanges();
      fixture.componentInstance.ionViewDidEnter();
      await fixture.whenStable();
      await vi.waitFor(() => expect(fixture.componentInstance.querySaveState()).not.toBe('Loading'));
      return fixture;
    };
    return { fixture: await create(), create, editor, drafts, token, ref, route, params, auth, denied, catalog, browser, runtime, definition };
  }

  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('shows terminal recovery after recreating a consumed handoff without replacing existing edits', async () => {
    const h = await setup();
    const id = h.fixture.componentInstance.queryId;
    if (!id) throw new Error('Expected restored query identity');
    const old = h.editor.getQueryState(id);
    if (!old) throw new Error('Expected restored editor');
    h.editor.updateQueryState({ ...old, request: { queryType: QueryType.TugQL, text: 'from: Artist\nlimit: 25' } as ITextQueryRequest });
    const edited = h.editor.getQueryState(id);
    h.fixture.destroy();
    const recreated = await h.create();
    expect(h.editor.getQueryState(id)).toEqual(edited);
    expect(recreated.nativeElement.querySelector('[data-testid="query-save-state"]').textContent).toBe('Unavailable');
    expect(recreated.nativeElement.querySelector('[data-testid="browser-query-recovery"]').textContent).toContain('Query this table again');
    recreated.nativeElement.querySelector('[data-testid="browser-query-recovery"] ion-button').click();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/demo/sqlite']);
    expect(TestBed.inject(SemanticApiService).runQuery).not.toHaveBeenCalled();
    // Explicitly selecting the still-held original editor clears this URL's recovery state.
    h.route.snapshot.queryParamMap = convertToParamMap({ id, runtime: h.runtime.selectionId, env: 'dev', projectApi: 'cloud', branch: 'main' });
    h.params.next(h.route.snapshot.queryParamMap);
    await recreated.whenStable();
    expect(recreated.nativeElement.querySelector('[data-testid="browser-query-recovery"]')).toBeNull();
    expect(recreated.nativeElement.querySelector('[data-testid="query-save-state"]').textContent).toBe('Save');
    expect(recreated.componentInstance.queryBodyText()).toBe('from: Artist\nlimit: 25');
  });

  it.each(['account', 'denied'] as const)('shows terminal recovery after %s scope clearing without replaying the token', async (scope) => {
    const h = await setup();
    const read = vi.spyOn(h.drafts, 'read');
    if (scope === 'account') h.auth.next({ status: 'authenticated', user: { uid: 'another-actor' } });
    else h.denied.next(h.ref);
    await h.fixture.whenStable();
    expect(h.fixture.componentInstance.queryDef()).toBeUndefined();
    expect(h.fixture.nativeElement.querySelector('[data-testid="query-save-state"]').textContent).toBe('Unavailable');
    expect(h.fixture.nativeElement.querySelector('[data-testid="browser-query-recovery"]').textContent).toContain('Query this table again');
    h.params.next(h.route.snapshot.queryParamMap);
    await h.fixture.whenStable();
    expect(read).not.toHaveBeenCalled();
    expect(h.fixture.componentInstance.queryDef()).toBeUndefined();
  });

  it('bounds pending restoration and ignores a catalog completion after timeout', async () => {
    const h = await setup();
    const pending = new Subject<{ connections: typeof declaration[] }>();
    h.catalog.mockReturnValue(pending);
    const token = h.drafts.create({ actorID: 'actor', projectRef: h.ref, connection: declaration, table: 'Artist', runtimeSelectionId: h.runtime.selectionId, environment: 'dev' });
    vi.useFakeTimers();
    h.route.snapshot.queryParamMap = convertToParamMap({ demoDraft: token, runtime: h.runtime.selectionId, env: 'dev', projectApi: 'cloud', branch: 'main' });
    h.params.next(h.route.snapshot.queryParamMap);
    await vi.advanceTimersByTimeAsync(30_001);
    vi.useRealTimers();
    await h.fixture.whenStable();
    expect(h.fixture.nativeElement.querySelector('[data-testid="query-save-state"]').textContent).toBe('Unavailable');
    expect(h.fixture.nativeElement.querySelector('[data-testid="browser-query-recovery"]').textContent).toContain('Query this table again');
    pending.next({ connections: [declaration] });
    await h.fixture.whenStable();
    expect(h.fixture.componentInstance.queryDef()).toBeUndefined();
  });

  it.each([publicChartQueries.PUBLIC_ORDERS_QUERY_ID, publicChartQueries.PUBLIC_COUNTRY_COUNTS_QUERY_ID])('dispatches exact public saved query %s through shared admission from actual Run', async (id) => {
    const result = { recordset: { columns: [{ name: 'OrderID', type: 'integer' }], rows: [[{ type: 'integer', value: '10248' }]] }, limitations: [], bindingsApplied: [], truncated: false, totalRows: 1, hasMore: false, provenance: { source: 'northwind', mode: 'live', observedAt: '2026-10-20T00:00:00Z' } };
    const admission = vi.spyOn(publicChartQueries, 'executeSavedPublicChartQuery').mockResolvedValue(result as never);
    const h = await setup(id);
    const run = Array.from(h.fixture.nativeElement.querySelectorAll('ion-button') as NodeListOf<HTMLElement>).find(button => button.textContent?.trim() === 'Run');
    expect(run).toBeTruthy();
    if (!run) throw new Error('Expected Run button');
    run.click();
    await h.fixture.whenStable();
    expect(admission).toHaveBeenCalledWith(id, expect.objectContaining({ connectionId: 'northwind-sqlite' }), { signal: expect.any(AbortSignal) });
    expect(h.fixture.componentInstance.runResult()?.recordset.rows).toEqual(result.recordset.rows);
    expect(h.fixture.nativeElement.textContent).not.toContain('running a query needs a DataTug agent');
    expect(h.browser).not.toHaveBeenCalled();
  });

  it.each([QueryType.TugQL, QueryType.SQL])('retains real publisher admission for edited %s text/type without loading SQLite', async (type) => {
    const h = await setup(publicChartQueries.PUBLIC_ORDERS_QUERY_ID, type);
    h.fixture.componentInstance.runQuery();
    await vi.waitFor(() => expect(h.fixture.nativeElement.textContent).toMatch(/differs from the admitted definition|changed identity or execution scope/));
    expect(h.browser).not.toHaveBeenCalled();
  });

  it.each([publicChartQueries.PUBLIC_ORDERS_QUERY_ID, publicChartQueries.PUBLIC_COUNTRY_COUNTS_QUERY_ID])('keeps omitted project environment out of fixed public query %s through Run and URL normalization', async (id) => {
    const result = { recordset: { columns: [], rows: [] }, limitations: [], bindingsApplied: [], truncated: false, hasMore: false, provenance: { source: 'northwind', mode: 'live' } };
    const admission = vi.spyOn(publicChartQueries, 'executeSavedPublicChartQuery').mockResolvedValue(result as never);
    const h = await setup(id, QueryType.TugQL, { projectEnvironments: true });
    const page = h.fixture.componentInstance;
    expect(page.activeEnv).toBeUndefined();
    expect(TestBed.inject(DatatugNavContextService).setCurrentEnvironment).not.toHaveBeenCalledWith('local');
    expect(h.fixture.nativeElement.textContent).toContain('public Northwind OVDB API');
    expect(h.fixture.nativeElement.textContent).toContain('the project environment is not used');
    expect(h.fixture.nativeElement.textContent).not.toContain('before Run.');
    page.runQuery();
    await h.fixture.whenStable();
    page.updateUrl();
    expect(admission).toHaveBeenCalledOnce();
    const navigations = vi.mocked(TestBed.inject(Router).navigate).mock.calls;
    expect(navigations.some(([, extras]) => extras?.queryParams?.['id'] === id)).toBe(true);
    expect(navigations.every(([, extras]) => extras?.queryParams?.['env'] === undefined)).toBe(true);
    expect(page.activeEnv).toBeUndefined();
    expect(h.browser).not.toHaveBeenCalled();
  });

  it('retains working-copy admission and source copy when leaving the fixed public runtime', async () => {
    const admission = vi.spyOn(publicChartQueries, 'executeSavedPublicChartQuery');
    const h = await setup(publicChartQueries.PUBLIC_ORDERS_QUERY_ID, QueryType.TugQL, { projectEnvironments: true });
    h.fixture.componentInstance.selectWorkingCopy(h.runtime.selectionId);
    await h.fixture.whenStable();
    expect(h.fixture.nativeElement.textContent).toContain('before Run.');
    expect(h.fixture.nativeElement.textContent).not.toContain('public Northwind OVDB API');
    h.fixture.componentInstance.runQuery();
    await h.fixture.whenStable();
    expect(admission).not.toHaveBeenCalled();
    expect(h.fixture.componentInstance.runError()).toMatch(/unavailable|Refresh the open working copies/);
    expect(h.browser).not.toHaveBeenCalled();
  });

  it('retains first-environment defaults and ordinary source copy for other saved TugQL', async () => {
    const h = await setup('other/tugql', QueryType.TugQL, { projectEnvironments: true });
    expect(h.fixture.componentInstance.activeEnv?.id).toBe('local');
    h.fixture.componentInstance.updateUrl();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ env: 'local' }) }));
    expect(h.fixture.nativeElement.textContent).toContain('before Run.');
    expect(h.fixture.nativeElement.textContent).not.toContain('public Northwind OVDB API');
  });

  it.each(['url', 'context'] as const)('preserves explicit %s environment for a fixed public query', async (entry) => {
    const h = await setup(publicChartQueries.PUBLIC_COUNTRY_COUNTS_QUERY_ID, QueryType.TugQL, {
      projectEnvironments: true,
      ...(entry === 'url' ? { environment: 'prod', contextEnvironment: 'dev' } : { contextEnvironment: 'dev' }),
    });
    const expected = entry === 'url' ? 'prod' : 'dev';
    expect(h.fixture.componentInstance.activeEnv?.id).toBe(expected);
    h.fixture.componentInstance.updateUrl();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ env: expected }) }));
    expect(h.fixture.nativeElement.textContent).toContain('the project environment is not used');
  });

  it('retains the agent notice for arbitrary GitHub TugQL', async () => {
    const h = await setup('other/tugql');
    h.fixture.componentInstance.runQuery();
    await h.fixture.whenStable();
    expect(h.fixture.nativeElement.textContent).toContain('running a query needs a DataTug agent');
    expect(h.browser).not.toHaveBeenCalled();
  });
});
