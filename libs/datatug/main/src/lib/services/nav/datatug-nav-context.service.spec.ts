import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { of } from 'rxjs';

import { DatatugNavContextService } from './datatug-nav-context.service';
import { AppContextService } from '../../core/services/app-context.service';
import { ProjectContextService } from '../project/project-context.service';
import { ProjectService } from '../project/project.service';
import { EnvironmentService } from '../unsorted/environment.service';

describe('DatatugNavContextService', () => {
  let service: DatatugNavContextService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DatatugNavContextService,
        { provide: AppContextService, useValue: { currentApp: of(undefined) } },
        {
          provide: ProjectContextService,
          useValue: {
            current: undefined,
            setCurrent: vi.fn(),
            current$: of(undefined),
          },
        },
        { provide: Router, useValue: { events: of(), navigate: vi.fn() } },
        {
          provide: ProjectService,
          useValue: { watchProjectSummary: vi.fn(), getFull: vi.fn() },
        },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn() } },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
      ],
    });
    service = TestBed.inject(DatatugNavContextService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

/**
 * Regression (lane S92, journey J3): a query page reached without an
 * `/env/:id` path segment or `?env=` query param (the context panel's "open
 * a query" hand-off, or a direct/reloaded navigation to `/query/:id` — this
 * app never puts environment info in either place for that route) used to
 * unconditionally clear `currentEnv` to `undefined`. `InvestigationContextService`
 * scopes its basket by `{agentUrl, project, environment, securityContextId}`,
 * so an `undefined` environment opens an always-empty scope — a value added
 * to context on an `/env/local/...` page could never be found again from the
 * query page, even though the real basket was still sitting in
 * `sessionStorage` under `environment: 'local'`. Confirmed live: the query
 * page's Parameters card said "required — no value supplied" instead of
 * "Customer.ID · from context", for exactly this reason (traced with a
 * temporary debug log on `QueryPageComponent.syncScopeAndBindings()`:
 * `environment` was `undefined` on every call).
 */
describe('DatatugNavContextService — environment persists across a reload with no /env/ in the URL', () => {
  function configureAndCreate() {
    TestBed.configureTestingModule({
      providers: [
        DatatugNavContextService,
        { provide: AppContextService, useValue: { currentApp: of({ appCode: 'datatug' }) } },
        {
          provide: ProjectContextService,
          useValue: { current: undefined, setCurrent: vi.fn(), current$: of(undefined) },
        },
        { provide: Router, useValue: { events: of(), navigate: vi.fn() } },
        {
          provide: ProjectService,
          useValue: {
            watchProjectSummary: vi.fn(() => of(undefined)),
            getFull: vi.fn(),
          },
        },
        {
          provide: EnvironmentService,
          useValue: { getEnvSummary: vi.fn(() => of(undefined)) },
        },
        {
          provide: ErrorLogger,
          useValue: { logError: vi.fn(), logErrorHandler: vi.fn(() => vi.fn()) },
        },
      ],
    });
    return TestBed.inject(DatatugNavContextService);
  }

  const storeId = 'localhost:8989';
  const projectId = 'datatug-demo-project';

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('persists and then falls back to the last environment resolved for this store+project', () => {
    // "the user is on the Customer table, in env=local" — a URL that names
    // the environment explicitly.
    window.history.replaceState(
      {},
      '',
      `/store/${storeId}/project/${projectId}/env/local/db/chinook-local/table/main.Customer`,
    );
    const first = configureAndCreate();
    let firstEnvId: string | undefined;
    first.currentEnv.subscribe((env) => (firstEnvId = env?.id));
    expect(firstEnvId).toBe('local');

    // "a full reload straight onto the query page" — a *different* service
    // instance (a fresh app boot, matching a real reload), with a URL that
    // names neither an `/env/:id` segment nor a `?env=` query param.
    TestBed.resetTestingModule();
    window.history.replaceState(
      {},
      '',
      `/store/${storeId}/project/${projectId}/query/customer-purchases-by-genre?id=customer-purchases-by-genre`,
    );
    const second = configureAndCreate();
    let secondEnvId: string | undefined;
    second.currentEnv.subscribe((env) => (secondEnvId = env?.id));

    expect(secondEnvId).toBe('local');
  });

  it('still clears to undefined when nothing was ever persisted for this store+project', () => {
    window.history.replaceState(
      {},
      '',
      `/store/${storeId}/project/${projectId}/query/customer-purchases-by-genre?id=customer-purchases-by-genre`,
    );
    const service = configureAndCreate();
    let envId: string | undefined = 'not-yet-read';
    service.currentEnv.subscribe((env) => (envId = env?.id));

    expect(envId).toBeUndefined();
  });
});

/**
 * G-0: the hand-off address `/project/github.com/<owner>/<repo>/chat` has a `/project/` segment and no
 * `/store/` one. The nav context used to read `github.com` as a project id, fail to resolve any store for it
 * (`storeId is a required parameter`) and log that as an error, which the app showed as a red "Something went
 * wrong" toast (and reported to Sentry) on the holding page. An address with no store has no project.
 */
describe('DatatugNavContextService — a /project/ address with no /store/ segment', () => {
  /** The nav context of a page load at `url`, with every collaborator stubbed. */
  function at(url: string) {
    const logError = vi.fn();
    const getFull = vi.fn(() => of({ environments: [] }));
    window.history.replaceState({}, '', url);
    TestBed.configureTestingModule({
      providers: [
        DatatugNavContextService,
        { provide: AppContextService, useValue: { currentApp: of({ appCode: 'datatug' }) } },
        {
          provide: ProjectContextService,
          useValue: { current: undefined, setCurrent: vi.fn(), current$: of(undefined) },
        },
        { provide: Router, useValue: { events: of(), navigate: vi.fn() } },
        {
          provide: ProjectService,
          useValue: { watchProjectSummary: vi.fn(() => of(undefined)), getFull },
        },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn(() => of(undefined)) } },
        { provide: ErrorLogger, useValue: { logError, logErrorHandler: vi.fn(() => vi.fn()) } },
      ],
    });
    const service = TestBed.inject(DatatugNavContextService);
    const seen: Record<string, unknown> = {};
    service.currentProject.subscribe((p) => (seen['project'] = p));
    service.currentEnv.subscribe((e) => (seen['env'] = e));
    service.currentStoreId.subscribe((id) => (seen['store'] = id));
    service.currentEnvDbTable.subscribe((t) => (seen['table'] = t));
    return { logError, getFull, seen };
  }

  it('has no current project and logs no error', () => {
    const { logError, seen } = at('/project/github.com/datatug/chinook-demo/chat');
    expect(logError).not.toHaveBeenCalled();
    expect(seen['project']).toBeUndefined();
  });

  // A repository (or owner) whose name is the same as a path word the nav context looks for must not be read
  // as a store, an environment or a table: that raised the red "Something went wrong" toast on the holding page.
  it.each([
    '/project/github.com/store/x/chat',
    '/project/github.com/datatug/store/chat',
    '/project/github.com/o/r/tree/store/-/chat',
    '/project/github.com/env/x/chat',
    '/project/github.com/table/x/chat',
    '/project/github.com/o/r/tree/table/-/chat',
    '/Project/GitHub.com/Store/X/Chat',
    '/project/github.com/store/x/chat;a=1',
    '/%70roject/github.com/store/x/chat',
    'http://localhost:3000/project/github.com/store/x/chat',
  ])('%s names no store, project, environment or table, and logs no error', (url) => {
    const { logError, getFull, seen } = at(url);
    expect(logError).not.toHaveBeenCalled();
    expect(getFull).not.toHaveBeenCalled();
    expect(seen['store']).toBeUndefined();
    expect(seen['project']).toBeUndefined();
    expect(seen['env']).toBeUndefined();
    expect(seen['table']).toBeUndefined();
  });

  it('still reads a real store and project address as before', () => {
    const { seen } = at('/store/localhost:8989/project/p1/env/local');
    expect(seen['store']).toBe('localhost:8989');
    expect(seen['project']).toMatchObject({ ref: { projectId: 'p1', storeId: 'localhost:8989' } });
    expect(seen['env']).toMatchObject({ id: 'local' });
  });
});

/**
 * The short address of a GitHub project (`/project/github.com/<owner>/<repo>…`, design `demo-as-github-project.md`
 * 3.4), once the short project route has opened it: the side menu and the pages that read the nav context see the
 * same store, project, environment and table as at the old address of the same project. An address that no project
 * route has opened (the hand-off holding page answers the same shape) still names nothing.
 */
describe('DatatugNavContextService — a short GitHub project address opened by the short project route', () => {
  /** The router state of a page whose deepest route has these parameters. */
  const stateWith = (params: Record<string, string>) => ({
    snapshot: {
      root: {
        firstChild: {
          firstChild: { paramMap: { get: (name: string) => params[name] ?? null } },
        },
      },
    },
  });

  function at(url: string, params?: Record<string, string>) {
    const logError = vi.fn();
    const watchProjectSummary = vi.fn(() => of(undefined));
    window.history.replaceState({}, '', url);
    TestBed.configureTestingModule({
      providers: [
        DatatugNavContextService,
        { provide: AppContextService, useValue: { currentApp: of({ appCode: 'datatug' }) } },
        {
          provide: ProjectContextService,
          useValue: { current: undefined, setCurrent: vi.fn(), current$: of(undefined) },
        },
        {
          provide: Router,
          useValue: {
            events: of(),
            navigate: vi.fn(),
            ...(params ? { routerState: stateWith(params) } : {}),
          },
        },
        { provide: ProjectService, useValue: { watchProjectSummary, getFull: vi.fn() } },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn(() => of(undefined)) } },
        { provide: ErrorLogger, useValue: { logError, logErrorHandler: vi.fn(() => vi.fn()) } },
      ],
    });
    const service = TestBed.inject(DatatugNavContextService);
    const seen: Record<string, unknown> = {};
    service.currentProject.subscribe((p) => (seen['project'] = p));
    service.currentEnv.subscribe((e) => (seen['env'] = e));
    service.currentStoreId.subscribe((id) => (seen['store'] = id));
    return { logError, watchProjectSummary, seen };
  }

  beforeEach(() => sessionStorage.clear());

  it.each([
    ['/project/github.com/datatug/chinook-demo', 'chinook-demo@datatug@'],
    ['/project/github.com/datatug/chinook-demo/chat', 'chinook-demo@datatug@'],
    ['/project/github.com/o/r/tree/HEAD/demo-project-1/-/queries?tab=shared', 'r@o@demo-project-1'],
    ['/project/github.com/o/r/tree/v1.0.0/-/chat', 'r@o@@v1.0.0'],
    ['http://localhost:3000/project/github.com/o/r/tree/HEAD/datatug', 'r@o'],
  ])('%s is the project %s of the GitHub store', (url, projectId) => {
    const { logError, watchProjectSummary, seen } = at(url, { storeId: 'github.com', projectId });
    expect(logError).not.toHaveBeenCalled();
    expect(seen['store']).toBe('github.com');
    expect(seen['project']).toMatchObject({ ref: { storeId: 'github.com', projectId } });
    expect(watchProjectSummary).toHaveBeenCalledWith({ storeId: 'github.com', projectId });
  });

  it('reads an environment of the project from the page, as at the old address', () => {
    const { seen } = at('/project/github.com/o/r/env/local', { storeId: 'github.com', projectId: 'r@o@' });
    expect(seen['store']).toBe('github.com');
    expect(seen['env']).toMatchObject({ id: 'local' });
  });

  it('reads the same project as the old address of it', () => {
    const projectId = 'chinook-demo@datatug@';
    const short = at('/project/github.com/datatug/chinook-demo/chat', { storeId: 'github.com', projectId });
    const shortProject = short.seen['project'];
    TestBed.resetTestingModule();
    const old = at('/store/github.com/project/chinook-demo@datatug@/chat');
    expect(shortProject).toEqual(old.seen['project']);
    expect(short.seen['store']).toEqual(old.seen['store']);
  });

  it.each([
    ['no route has opened it (the holding page answers this address)', undefined],
    ['the route that opened it is for another project', { storeId: 'github.com', projectId: 'other@o@' }],
    ['the route that opened it is for another store', { storeId: 'localhost:8989', projectId: 'r@o@' }],
    ['the route that opened it has no project', {}],
  ])('names nothing when %s', (_name, params) => {
    const { logError, watchProjectSummary, seen } = at('/project/github.com/o/r/chat', params);
    expect(logError).not.toHaveBeenCalled();
    expect(watchProjectSummary).not.toHaveBeenCalled();
    expect(seen['store']).toBeUndefined();
    expect(seen['project']).toBeUndefined();
  });

  it('names nothing for a /project/ address that is not a project at all', () => {
    const { logError, seen } = at('/project/github.com/o', { storeId: 'github.com', projectId: 'o@' });
    expect(logError).not.toHaveBeenCalled();
    expect(seen['project']).toBeUndefined();
  });
});
