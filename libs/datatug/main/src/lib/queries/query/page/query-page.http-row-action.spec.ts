import { ProjectMeaningsService } from '../../../meanings/project-meanings.service';
import { DemoTableDraftService } from '../../demo-table-draft.service';
import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { RandomIdService } from '@sneat/random';
import { AgentContextService, SemanticApiService } from '@sneat/datatug-semantic';
import { BehaviorSubject, of } from 'rxjs';
import { QueryPageComponent } from './query-page.component';
import { IProjectContext } from '../../../nav/nav-models';
import type { IProjectRef } from '../../../core/project-context';
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


describe('HTTP row action: which row is offered', () => {
  const originalHistory = Object.getOwnPropertyDescriptor(window, 'history');
  beforeEach(() => {
    Object.defineProperty(window, 'history', { value: { ...window.history, state: {} }, writable: true, configurable: true });
  });
  afterEach(() => {
    // The shared suite reuses one window per worker: put the real history back.
    if (originalHistory) Object.defineProperty(window, 'history', originalHistory);
  });

  async function create() {
    const ref: IProjectRef = { storeId: 'github.com', projectId: 'repo@owner@folder', projectApi: 'cloud', branch: 'main' };
    const project = new BehaviorSubject<IProjectContext | undefined>({ ref } as IProjectContext);
    const routeIds = convertToParamMap({ storeId: ref.storeId, projectId: ref.projectId });
    const route = { queryParamMap: new BehaviorSubject(convertToParamMap({})), paramMap: of(routeIds),
      snapshot: { paramMap: routeIds, queryParamMap: convertToParamMap({}), params: {} } };
    const router = { navigate: vi.fn(async () => true), events: of(), currentNavigation: vi.fn(() => null),
      lastSuccessfulNavigation: vi.fn(() => null), routerState: { root: route } };
    const logger = { logError: vi.fn(), logErrorHandler: vi.fn(() => vi.fn()) };
    // Never `imports: [QueryPageComponent]`: TestBed would then walk the ORIGINAL standalone component's dependency
    // graph and JIT-compile its 2,000-line template and every child component (editors, grid, charts) that the
    // override below discards. That once-per-worker compile is what pushed this file past the 5s test timeout
    // under a loaded machine. createComponent() compiles only the overridden definition.
    await TestBed.configureTestingModule({ providers: [
      { provide: ProjectMeaningsService, useValue: {} },
      { provide: ErrorLogger, useValue: logger },
      { provide: RandomIdService, useValue: { newRandomId: vi.fn(() => 'q') } },
      { provide: ActivatedRoute, useValue: route }, { provide: Router, useValue: router },
      { provide: DatatugNavContextService, useValue: { currentProject: project, currentEnv: of(undefined), setCurrentEnvironment: vi.fn() } },
      { provide: QueriesService, useValue: { authentication: () => of({ status: 'authenticated', user: { uid: 'actor' } }), devicePersonal: { list: vi.fn(async () => []) } } },
      { provide: ProjectService, useValue: { getFull: vi.fn() } },
      { provide: QueryEditorStateService, useClass: QueryEditorStateService },
      { provide: QueryContextSqlService, useValue: { setSql: vi.fn(), setTarget: vi.fn() } },
      { provide: DemoTableDraftService, useValue: { read: vi.fn(), consume: vi.fn() } },
      { provide: GitHubProjectActivityService, useValue: githubProjectActivityStub() },
      { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn(() => of({ id: 'demo' })) } },
      { provide: Coordinator, useValue: { execute: vi.fn() } },
      { provide: SemanticApiService, useValue: { runQuery: vi.fn() } },
      { provide: DetectiveClientService, useValue: detectiveClientStub() },
      { provide: QueryDispatchService, useValue: queryDispatchTestStub(fx) },
      { provide: AgentContextService, useValue: agentContextStub() },
    ] }).overrideComponent(QueryPageComponent, { set: { imports: [], providers: [], template: '' } }).compileComponents();
    const fixture = TestBed.createComponent(QueryPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  const columns = [{ name: 'request_id' }, { name: 'status' }];
  const node = (id: string, rowIndex: number) => ({ rowIndex, data: { result_0: id, result_1: 'ok' } });
  const api = (nodes: unknown[]) => ({ getSelectedNodes: () => nodes }) as never;

  interface Internals {
    httpFocusedRow?: unknown;
    syncHttpCheckedRow(api: never): void;
    runResult: { set(v: unknown): void };
  }

  function show(component: QueryPageComponent) {
    (component as unknown as Internals).runResult.set({
      recordset: { columns, rows: [] },
    });
  }

  it('offers the single checked row over the focused one, and clears when nothing is left', async () => {
    const fixture = await create();
    const component = fixture.componentInstance;
    const internals = component as unknown as Internals;
    show(component);
    TestBed.tick();
    internals.httpFocusedRow = { values: ['focused', 'ok'], position: 5 };

    internals.syncHttpCheckedRow(api([node('checked', 1)]));
    expect(component.httpActionRow()?.values).toEqual(['checked', 'ok']);
    expect(component.httpActionRow()?.label).toContain('row 2');
    expect(component.httpCheckedRows()).toBe(1);

    internals.syncHttpCheckedRow(api([node('a', 0), node('b', 1)]));
    expect(component.httpCheckedRows()).toBe(2);

    internals.syncHttpCheckedRow(api([]));
    expect(component.httpActionRow()?.values).toEqual(['focused', 'ok']);

    internals.httpFocusedRow = undefined;
    internals.syncHttpCheckedRow(api([node('x', 0)]));
    internals.syncHttpCheckedRow(api([]));
    expect(component.httpActionRow()).toBeUndefined();
  });

  it('forgets every remembered row when the result changes', async () => {
    const fixture = await create();
    const component = fixture.componentInstance;
    const internals = component as unknown as Internals;
    show(component);
    TestBed.tick();
    internals.syncHttpCheckedRow(api([node('old', 0)]));
    expect(component.httpActionRow()).toBeDefined();
    (internals.runResult as { set(v: unknown): void }).set({ recordset: { columns, rows: [] } });
    TestBed.tick();
    expect(component.httpActionRow()).toBeUndefined();
    expect(component.httpCheckedRows()).toBe(0);
    internals.syncHttpCheckedRow(api([]));
    expect(component.httpActionRow()).toBeUndefined();
  });
});
