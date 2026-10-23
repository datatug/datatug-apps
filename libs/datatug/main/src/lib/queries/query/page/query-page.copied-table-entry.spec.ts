import { ProjectMeaningsService } from '../../../meanings/project-meanings.service';
import { DemoTableDraftService } from '../../demo-table-draft.service';
import 'fake-indexeddb/auto';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { RandomIdService } from '@sneat/random';
import { AgentContextService, SemanticApiService } from '@sneat/datatug-semantic';
import { BehaviorSubject, Subject, firstValueFrom, of, throwError } from 'rxjs';
import { QueryPageComponent } from './query-page.component';
import { IProjectContext } from '../../../nav/nav-models';
import type { IProjectRef } from '../../../core/project-context';
import { IQueryDef, ISqlQueryRequest, ITextQueryRequest, QueryType } from '../../../models/definition/query-def';
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
import { agentContextStub, createDispatchFixtures, detectiveClientStub, githubProjectActivityStub, queryDispatchTestStub } from './query-page.spec-helper';

const fx = createDispatchFixtures();

describe('copied browser table query entry', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'history', { value: { ...window.history, state: {} }, writable: true, configurable: true });
  });

  it.each([
    { priorDraft: false, pendingChange: undefined },
    { priorDraft: true, pendingChange: undefined },
    { priorDraft: false, pendingChange: 'runtime' },
    { priorDraft: false, pendingChange: 'env' },
    { priorDraft: false, pendingChange: 'id' },
  ] as const)('retains the table editor through delayed restoration and scope changes: %o', async ({ priorDraft, pendingChange }) => {
    const ref: IProjectRef = { storeId: 'github.com', projectId: 'repo@owner@folder', projectApi: 'cloud', branch: 'main' };
    const project = new BehaviorSubject<IProjectContext | undefined>({ ref } as IProjectContext);
    const original = { demoDraft: 'token', runtime: 'runtime-edited', env: 'demo', branch: 'main', projectApi: 'cloud' };
    const params = new BehaviorSubject(convertToParamMap(original));
    const routeIds = convertToParamMap({ storeId: ref.storeId, projectId: ref.projectId });
    const route = { queryParamMap: params, paramMap: of(routeIds),
      snapshot: { paramMap: routeIds, queryParamMap: convertToParamMap(original), params: {} } };
    const router = { navigate: vi.fn<Router['navigate']>(async () => true), events: of(), currentNavigation: vi.fn(() => null),
      lastSuccessfulNavigation: vi.fn(() => null), routerState: { root: route } };
    const auth = { status: 'authenticated', user: { uid: 'actor' } };
    const read = new Subject<IQueryDef>();
    const drafts = { read: vi.fn((_token: string, _ref: IProjectRef, runtime: string | null, environment: string | null, _actor: string) =>
      runtime === original.runtime && environment === original.env && _actor === auth.user.uid
        ? firstValueFrom(read) : Promise.reject(new Error('The table draft scope changed.'))), consume: vi.fn() };
    let generatedIds = 0;
    const newRandomId = vi.fn(() => ++generatedIds === 1 ? 'table-draft-query' : `another-query-${generatedIds}`);
    const activityError = new HttpErrorResponse({ status: 0 });
    const activity = { ...githubProjectActivityStub(), resolve: vi.fn(() => throwError(() => activityError)) };
    const logger = { logError: vi.fn(), logErrorHandler: vi.fn(() => vi.fn()) };
    const dispatch = queryDispatchTestStub(fx);
    fx.dispatchStart.mockClear();
    await TestBed.configureTestingModule({ imports: [QueryPageComponent], providers: [
        { provide: ProjectMeaningsService, useValue: {} },
      { provide: ErrorLogger, useValue: logger },
      { provide: RandomIdService, useValue: { newRandomId } },
      { provide: ActivatedRoute, useValue: route }, { provide: Router, useValue: router },
      { provide: DatatugNavContextService, useValue: { currentProject: project, currentEnv: of(undefined), setCurrentEnvironment: vi.fn() } },
      { provide: QueriesService, useValue: { authentication: () => of(auth), devicePersonal: { list: vi.fn(async () => []) } } },
      { provide: ProjectService, useValue: { getFull: vi.fn() } },
      { provide: QueryEditorStateService, useClass: QueryEditorStateService },
      { provide: QueryContextSqlService, useValue: { setSql: vi.fn(), setTarget: vi.fn() } },
      { provide: DemoTableDraftService, useValue: drafts },
      { provide: GitHubProjectActivityService, useValue: activity },
      { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn(() => of({ id: 'demo' })) } },
      { provide: Coordinator, useValue: { execute: vi.fn() } },
      { provide: SemanticApiService, useValue: { runQuery: vi.fn() } },
      { provide: DetectiveClientService, useValue: detectiveClientStub() },
      { provide: QueryDispatchService, useValue: dispatch },
      { provide: AgentContextService, useValue: agentContextStub() },
    ] }).overrideComponent(QueryPageComponent, { set: { imports: [], providers: [],
      template: '<output>{{ queryId }}|{{ queryState.activeEnv?.id }}|{{ queryDef()?.request?.queryType }}</output>',
    } }).compileComponents();
    const editor = TestBed.inject(QueryEditorStateService);
    const old = priorDraft ? editor.newQuery({ id: 'my-other-draft', isNew: true, queryType: QueryType.SQL,
      request: { queryType: QueryType.SQL, text: 'SELECT keep_my_edits' } as ISqlQueryRequest }) : undefined;
    const fixture = TestBed.createComponent(QueryPageComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    route.snapshot.queryParamMap = convertToParamMap(original);
    params.next(route.snapshot.queryParamMap);
    component.ionViewDidEnter();
    await fixture.whenStable();
    expect(component.queryId).toBe('table-draft-query');
    expect(component.queryState.isNew).toBe(true);
    expect(component.queryState.isLoading).not.toBe(true);
    expect(component.queryState.activeEnv?.id).toBe('demo');
    const navigation = router.navigate.mock.calls.at(-1)?.[1] as { queryParams: Record<string, unknown> } | undefined;
    expect(navigation?.queryParams['id']).toBeUndefined();
    expect(navigation?.queryParams['env']).toBe('demo');
    // Model Angular Router's merge and its real queryParamMap re-emission while authentication/catalog work is pending.
    const normalized = { ...original, ...navigation?.queryParams };
    route.snapshot.queryParamMap = convertToParamMap(Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined)));
    params.next(route.snapshot.queryParamMap);
    expect(component.queryId).toBe('table-draft-query');
    const definition: IQueryDef = { id: '', title: 'Artist (browser copy)', connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.DTQL, text: 'from:\n  name: "Artist"\nlimit: 100\n' } as ITextQueryRequest };
    if (pendingChange) {
      if (pendingChange === 'runtime') component.selectWorkingCopy('another-runtime');
      route.snapshot.queryParamMap = convertToParamMap({ ...original, [pendingChange]: pendingChange === 'runtime' ? 'another-runtime' : pendingChange === 'env' ? 'another-env' : 'table-draft-query' });
      params.next(route.snapshot.queryParamMap);
      await fixture.whenStable();
      expect(component.queryId).toBe('table-draft-query');
      expect(component.runError()).toContain(pendingChange === 'id' ? 'cannot replace an existing saved query' : 'table draft scope changed');
      expect(drafts.consume).not.toHaveBeenCalled();
      // Neither an old success nor an old failure can replace the current scope outcome.
      if (pendingChange === 'env') read.error(new Error('obsolete table read failed'));
      else read.next(definition);
      await fixture.whenStable();
      expect(component.queryDef()).toBeUndefined();
      expect(component.runError()).toContain(pendingChange === 'id' ? 'cannot replace an existing saved query' : 'table draft scope changed');
      expect(drafts.consume).not.toHaveBeenCalled();
      drafts.read.mockResolvedValueOnce(definition);
      route.snapshot.queryParamMap = convertToParamMap(original);
      params.next(route.snapshot.queryParamMap);
    } else read.next(definition);
    await fixture.whenStable();
    expect(drafts.read).toHaveBeenCalledWith('token', ref, 'runtime-edited', 'demo', 'actor');
    expect(drafts.read).toHaveBeenCalledTimes(pendingChange === 'id' ? 2 : pendingChange ? 3 : 1);
    expect(drafts.consume).toHaveBeenCalledExactlyOnceWith('token');
    if (priorDraft) expect(editor.getQueryState('my-other-draft')).toEqual(old);
    expect(component.queryDef()).toMatchObject({ id: 'table-draft-query', request: definition.request, connectionId: definition.connectionId });
    expect(component.selectedWorkingCopy()).toBe('runtime-edited');
    expect(component.runError()).toBeUndefined();
    expect(fixture.nativeElement.querySelector('output').textContent).toBe('table-draft-query|demo|DTQL');
    component.ionViewDidEnter();
    expect(router.navigate.mock.calls.at(-1)?.[1]).toMatchObject({ queryParams: { id: undefined, env: 'demo' } });
    const edited = { ...component.queryState.request, text: 'from: Artist\nlimit: 25' } as ITextQueryRequest;
    editor.updateQueryState({ ...component.queryState, request: edited });
    component.selectWorkingCopy('project');
    expect(router.navigate.mock.calls.at(-1)?.[1]).toMatchObject({ queryParams: { runtime: 'project' } });
    route.snapshot.queryParamMap = convertToParamMap({ ...original, runtime: 'project' });
    params.next(route.snapshot.queryParamMap);
    route.snapshot.queryParamMap = convertToParamMap({ ...original, runtime: 'project', env: 'another-env' });
    params.next(route.snapshot.queryParamMap);
    await fixture.whenStable();
    expect(component.queryId).toBe('table-draft-query');
    expect(component.queryState.request).toEqual(edited);
    expect(component.queryState.activeEnv?.id).toBe('another-env');
    expect(component.selectedWorkingCopy()).toBe('project');
    expect(drafts.read).toHaveBeenCalledTimes(pendingChange === 'id' ? 2 : pendingChange ? 3 : 1);
    expect(drafts.consume).toHaveBeenCalledExactlyOnceWith('token');
    expect(newRandomId).toHaveBeenCalledOnce();
    expect(activity.resolve).toHaveBeenCalledExactlyOnceWith(ref);
    expect(logger.logError).toHaveBeenCalledWith(activityError, 'Failed to resolve GitHub Business query activity context', { show: false, feedback: false });
    activity.reportForCurrentProject.mockReturnValue(throwError(() => activityError));
    component['reportGitHubQueryDispatch'](ref);
    component['reportGitHubQueryEdit'](ref);
    expect(activity.reportForCurrentProject).toHaveBeenCalledWith(ref, expect.any(String), 'query_execution_dispatched');
    expect(activity.reportForCurrentProject).toHaveBeenCalledWith(ref, expect.any(String), 'query_edit');
    expect(logger.logError).toHaveBeenCalledWith(activityError, 'Failed to record GitHub Business query activity', { show: false, feedback: false });
    expect(logger.logError).toHaveBeenCalledWith(activityError, 'Failed to record GitHub Business query edit activity', { show: false, feedback: false });
    expect(TestBed.inject(Coordinator).execute).not.toHaveBeenCalled();
    expect(TestBed.inject(SemanticApiService).runQuery).not.toHaveBeenCalled();
    expect(fx.dispatchStart).not.toHaveBeenCalled();
    const previousEditor = editor.getQueryState('table-draft-query');
    drafts.read.mockResolvedValueOnce(definition);
    route.snapshot.queryParamMap = convertToParamMap({ ...original, demoDraft: 'next-token' });
    params.next(route.snapshot.queryParamMap);
    await fixture.whenStable();
    expect(component.queryId).not.toBe('table-draft-query');
    expect(editor.getQueryState('table-draft-query')).toEqual(previousEditor);
    expect(drafts.read).toHaveBeenLastCalledWith('next-token', ref, 'runtime-edited', 'demo', 'actor');
    expect(drafts.consume).toHaveBeenLastCalledWith('next-token');
    expect(fx.dispatchStart).not.toHaveBeenCalled();
    fixture.destroy();
  });
});
