import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { githubProjectMatcher } from '../../routes/github-project-routes';
import { datatugProjectRoutes } from '../../routes/datatug-routing-proj';
import { ErrorLogger } from '@sneat/core';
import { NEVER, Subject, of } from 'rxjs';
import { parseDatatugStoreRef } from '../../nav/nav-models';

import { DatatugNavContextService } from './datatug-nav-context.service';
import { AppContextService } from '../../core/services/app-context.service';
import { ProjectContextService } from '../project/project-context.service';
import { ProjectService } from '../project/project.service';
import { EnvironmentService } from '../unsorted/environment.service';

describe('project Incident routes with the real router and navigation context', () => {
  @Component({ selector: 'sneat-incident-route-test', template: '' })
  class RoutePage {}

  async function boot(initialUrl?: string) {
    window.history.replaceState({}, '', '/');
    const incidents = datatugProjectRoutes.find((r) => r.path === 'incidents');
    if (!incidents?.children)
      throw new Error('Missing project Incident routes');
    // Keep the production matcher and Incident route tree; replace only page
    // rendering so network-backed page providers cannot mask context behavior.
    const children = [
      {
        ...incidents,
        children: incidents.children.map((route) => {
          const page = { ...route, component: RoutePage };
          delete page.loadComponent;
          return page;
        }),
      },
    ];
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { matcher: githubProjectMatcher, children },
          { path: 'store/:storeId/project/:projectId', children },
          { path: '**', component: RoutePage },
        ]),
        DatatugNavContextService,
        {
          provide: AppContextService,
          useValue: { currentApp: of({ appCode: 'datatug' }) },
        },
        {
          provide: ProjectContextService,
          useValue: {
            current: undefined,
            current$: of(undefined),
            setCurrent: vi.fn(),
          },
        },
        {
          provide: ProjectService,
          useValue: {
            watchProjectSummary: vi.fn(() => NEVER),
            getFull: vi.fn(() => NEVER),
          },
        },
        {
          provide: EnvironmentService,
          useValue: { getEnvSummary: vi.fn(() => NEVER) },
        },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
      ],
    });
    const service = TestBed.inject(DatatugNavContextService);
    let project: unknown;
    let store: string | undefined;
    service.currentProject.subscribe((value) => (project = value));
    service.currentStoreId.subscribe((value) => (store = value));
    const harness = await RouterTestingHarness.create(initialUrl);
    return {
      harness,
      router: TestBed.inject(Router),
      project: () => project,
      store: () => store,
    };
  }

  beforeEach(() => sessionStorage.clear());

  it.each([
    ['/project/github.com/owner/repo', 'github.com', 'repo@owner@'],
    [
      '/project/github.com/owner/repo/tree/feature/folder/-',
      'github.com',
      'repo@owner@folder@feature',
    ],
    ['/store/http-localhost:8989/project/demo', 'http-localhost:8989', 'demo'],
  ])(
    'keeps the owning project through the Incident journey at %s',
    async (base, storeId, projectId) => {
      const app = await boot();
      for (const page of ['', '/new', '/ops/INC-1', '/ops/INC-1/record']) {
        await app.harness.navigateByUrl(
          `${base}/incidents${page}?projectApi=cloud&branch=develop`,
        );
        expect(app.project()).toMatchObject({
          ref: { storeId, projectId, projectApi: 'cloud', branch: 'develop' },
        });
        expect(app.store()).toBe(storeId);
      }
      let leaf = app.router.routerState.snapshot.root;
      while (leaf.firstChild) leaf = leaf.firstChild;
      expect(leaf.paramMap.get('storeId')).toBe('ops');
    },
  );

  it('selects the project on a cold detail load after routing has resolved', async () => {
    const app = await boot(
      '/project/github.com/owner/repo/incidents/ops/INC-1',
    );
    expect(app.project()).toMatchObject({
      ref: { storeId: 'github.com', projectId: 'repo@owner@' },
    });
  });

  it('clears the project for an unresolved handoff rather than borrowing an earlier project', async () => {
    const app = await boot();
    await app.harness.navigateByUrl('/project/github.com/owner/repo/incidents');
    expect(app.project()).toBeDefined();
    await app.harness.navigateByUrl('/project/github.com/owner/repo/chat');
    expect(app.project()).toBeUndefined();
    expect(app.store()).toBeUndefined();
  });
});

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
        {
          provide: AppContextService,
          useValue: { currentApp: of({ appCode: 'datatug' }) },
        },
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
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
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

  it('forgets the persisted environment when the user clears it', () => {
    window.history.replaceState(
      {},
      '',
      `/store/${storeId}/project/${projectId}/env/local`,
    );
    const service = configureAndCreate();
    const key = `datatug:lastEnv:${storeId}:${projectId}`;
    expect(sessionStorage.getItem(key)).toBe('local');

    service.clearCurrentEnvironment();

    expect(sessionStorage.getItem(key)).toBeNull();
    let clearedEnvId: string | undefined = 'local';
    service.currentEnv.subscribe((env) => (clearedEnvId = env?.id));
    expect(clearedEnvId).toBeUndefined();

    TestBed.resetTestingModule();
    window.history.replaceState(
      {},
      '',
      `/store/${storeId}/project/${projectId}/query/customer-purchases-by-genre?id=customer-purchases-by-genre`,
    );
    const reloaded = configureAndCreate();
    let reloadedEnvId: string | undefined = 'local';
    reloaded.currentEnv.subscribe((env) => (reloadedEnvId = env?.id));
    expect(reloadedEnvId).toBeUndefined();
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
        {
          provide: AppContextService,
          useValue: { currentApp: of({ appCode: 'datatug' }) },
        },
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
          useValue: {
            watchProjectSummary: vi.fn(() => of(undefined)),
            getFull,
          },
        },
        {
          provide: EnvironmentService,
          useValue: { getEnvSummary: vi.fn(() => of(undefined)) },
        },
        {
          provide: ErrorLogger,
          useValue: { logError, logErrorHandler: vi.fn(() => vi.fn()) },
        },
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
    const { logError, seen } = at(
      '/project/github.com/datatug/chinook-demo/chat',
    );
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
  ])(
    '%s names no store, project, environment or table, and logs no error',
    (url) => {
      const { logError, getFull, seen } = at(url);
      expect(logError).not.toHaveBeenCalled();
      expect(getFull).not.toHaveBeenCalled();
      expect(seen['store']).toBeUndefined();
      expect(seen['project']).toBeUndefined();
      expect(seen['env']).toBeUndefined();
      expect(seen['table']).toBeUndefined();
    },
  );

  it('still reads a real store and project address as before', () => {
    const { seen } = at('/store/localhost:8989/project/p1/env/local');
    expect(seen['store']).toBe('localhost:8989');
    expect(seen['project']).toMatchObject({
      ref: { projectId: 'p1', storeId: 'localhost:8989' },
    });
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
          firstChild: {
            paramMap: { get: (name: string) => params[name] ?? null },
          },
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
        {
          provide: AppContextService,
          useValue: { currentApp: of({ appCode: 'datatug' }) },
        },
        {
          provide: ProjectContextService,
          useValue: {
            current: undefined,
            setCurrent: vi.fn(),
            current$: of(undefined),
          },
        },
        {
          provide: Router,
          useValue: {
            events: of(),
            navigate: vi.fn(),
            ...(params ? { routerState: stateWith(params) } : {}),
          },
        },
        {
          provide: ProjectService,
          useValue: { watchProjectSummary, getFull: vi.fn() },
        },
        {
          provide: EnvironmentService,
          useValue: { getEnvSummary: vi.fn(() => of(undefined)) },
        },
        {
          provide: ErrorLogger,
          useValue: { logError, logErrorHandler: vi.fn(() => vi.fn()) },
        },
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
    [
      '/project/github.com/o/r/tree/HEAD/demo-project-1/-/queries?tab=shared',
      'r@o@demo-project-1',
    ],
    ['/project/github.com/o/r/tree/v1.0.0/-/chat', 'r@o@@v1.0.0'],
    ['http://localhost:3000/project/github.com/o/r/tree/HEAD/datatug', 'r@o'],
  ])('%s is the project %s of the GitHub store', (url, projectId) => {
    const { logError, watchProjectSummary, seen } = at(url, {
      storeId: 'github.com',
      projectId,
    });
    expect(logError).not.toHaveBeenCalled();
    expect(seen['store']).toBe('github.com');
    expect(seen['project']).toMatchObject({
      ref: { storeId: 'github.com', projectId },
    });
    expect(watchProjectSummary).toHaveBeenCalledWith({
      storeId: 'github.com',
      projectId,
    });
  });

  it('reads an environment of the project from the page, as at the old address', () => {
    const { seen } = at('/project/github.com/o/r/env/local', {
      storeId: 'github.com',
      projectId: 'r@o@',
    });
    expect(seen['store']).toBe('github.com');
    expect(seen['env']).toMatchObject({ id: 'local' });
  });

  it('reads the same project as the old address of it', () => {
    const projectId = 'chinook-demo@datatug@';
    const short = at('/project/github.com/datatug/chinook-demo/chat', {
      storeId: 'github.com',
      projectId,
    });
    const shortProject = short.seen['project'];
    TestBed.resetTestingModule();
    const old = at('/store/github.com/project/chinook-demo@datatug@/chat');
    expect(shortProject).toEqual(old.seen['project']);
    expect(short.seen['store']).toEqual(old.seen['store']);
  });

  it.each([
    [
      'no route has opened it (the holding page answers this address)',
      undefined,
    ],
    [
      'the route that opened it is for another project',
      { storeId: 'github.com', projectId: 'other@o@' },
    ],
    [
      'the route that opened it is for another store',
      { storeId: 'localhost:8989', projectId: 'r@o@' },
    ],
    ['the route that opened it has no project', {}],
  ])('names nothing when %s', (_name, params) => {
    const { logError, watchProjectSummary, seen } = at(
      '/project/github.com/o/r/chat',
      params,
    );
    expect(logError).not.toHaveBeenCalled();
    expect(watchProjectSummary).not.toHaveBeenCalled();
    expect(seen['store']).toBeUndefined();
    expect(seen['project']).toBeUndefined();
  });

  it('names nothing for a /project/ address that is not a project at all', () => {
    const { logError, seen } = at('/project/github.com/o', {
      storeId: 'github.com',
      projectId: 'o@',
    });
    expect(logError).not.toHaveBeenCalled();
    expect(seen['project']).toBeUndefined();
  });
});

/**
 * G-A1c (design `demo-as-github-project.md` 3.4): the nav context reads the store, project and the page after it
 * from an address with `parseProjectUrl`, the one reader of both shapes, not with regular expressions over the whole
 * URL: a query string is no part of an environment or a table, and a name that is a path word is not that word.
 */
describe('DatatugNavContextService — reads the address with parseProjectUrl (G-A1c)', () => {
  function at(url: string, params?: Record<string, string>) {
    const logError = vi.fn();
    window.history.replaceState({}, '', url);
    TestBed.configureTestingModule({
      providers: [
        DatatugNavContextService,
        {
          provide: AppContextService,
          useValue: { currentApp: of({ appCode: 'datatug' }) },
        },
        {
          provide: ProjectContextService,
          useValue: {
            current: undefined,
            setCurrent: vi.fn(),
            current$: of(undefined),
          },
        },
        {
          provide: Router,
          useValue: {
            events: of(),
            navigate: vi.fn(),
            ...(params
              ? {
                  routerState: {
                    snapshot: {
                      root: {
                        firstChild: {
                          paramMap: {
                            get: (name: string) => params[name] ?? null,
                          },
                        },
                      },
                    },
                  },
                }
              : {}),
          },
        },
        {
          provide: ProjectService,
          // A table's project is never answered: the lookup of its metadata is no part of reading the address.
          useValue: {
            watchProjectSummary: vi.fn(() => of(undefined)),
            getFull: vi.fn(() => NEVER),
          },
        },
        // An environment's summary is never answered: reading it is no part of reading the address.
        {
          provide: EnvironmentService,
          useValue: { getEnvSummary: vi.fn(() => NEVER) },
        },
        {
          provide: ErrorLogger,
          useValue: { logError, logErrorHandler: vi.fn(() => vi.fn()) },
        },
      ],
    });
    const service = TestBed.inject(DatatugNavContextService);
    const seen: Record<string, unknown> = {};
    service.currentProject.subscribe((p) => (seen['project'] = p));
    service.currentEnv.subscribe((e) => (seen['env'] = e));
    service.currentStoreId.subscribe((id) => (seen['store'] = id));
    service.currentEnvDb.subscribe((db) => (seen['db'] = db));
    service.currentEnvDbTable.subscribe((t) => (seen['table'] = t));
    return { logError, seen };
  }

  beforeEach(() => sessionStorage.clear());

  it.each([
    // [address, store, project, environment, database, table]
    [
      '/store/localhost:8989/project/p1/env/local/db/chinook-local/table/main.Customer',
      'localhost:8989',
      'p1',
      'local',
      'chinook-local',
      { schema: 'main', name: 'Customer' },
    ],
    [
      // The query string and the fragment are no part of the table.
      '/store/localhost:8989/project/p1/env/local/db/chinook-local/table/main.Customer?tab=1#x',
      'localhost:8989',
      'p1',
      'local',
      'chinook-local',
      { schema: 'main', name: 'Customer' },
    ],
    [
      // The whole URL, as `location.href` has it.
      'http://localhost:3000/store/http-localhost:8989/project/p1/env/local?x=1',
      'http-localhost:8989',
      'p1',
      'local',
      '',
      undefined,
    ],
    [
      // The project, when its id needs percent-encoding, is the project the route carries.
      '/store/localhost:8989/project/my%20project/env/local',
      'localhost:8989',
      'my project',
      'local',
      '',
      undefined,
    ],
    [
      // An old-form GitHub address is the project at its one id.
      '/store/github.com/project/datatug-demo-projects@datatug@demo-project-1/env/local/db/chinook/table/main.Album',
      'github.com',
      'datatug-demo-projects@datatug@demo-project-1',
      'local',
      'chinook',
      { schema: 'main', name: 'Album' },
    ],
    [
      // REQ:table-identity (claude-mod-web-links): a card's link always carries `schema`, which is authoritative,
      // and its segment is the whole table name — a schemaless `Album`, and a SQLite table named `a.b`.
      '/store/http-127.0.0.1:8989/project/demo/env/local/db/chinook/table/Album?schema=#pk=%7B%7D',
      'http-127.0.0.1:8989',
      'demo',
      'local',
      'chinook',
      { schema: '', name: 'Album' },
    ],
    [
      '/store/http-127.0.0.1:8989/project/demo/env/local/db/chinook/table/a.b/records?limit=5&schema=',
      'http-127.0.0.1:8989',
      'demo',
      'local',
      'chinook',
      { schema: '', name: 'a.b' },
    ],
    [
      '/store/http-127.0.0.1:8989/project/demo/env/local/db/pg/table/My%20Orders?schema=sales',
      'http-127.0.0.1:8989',
      'demo',
      'local',
      'pg',
      { schema: 'sales', name: 'My Orders' },
    ],
    [
      '/store/github.com/project/Repo@Org@datatug/env/local',
      'github.com',
      'repo@org',
      'local',
      '',
      undefined,
    ],
  ])('%s', (url, storeId, projectId, envId, dbId, table) => {
    const { logError, seen } = at(url);
    expect(logError).not.toHaveBeenCalled();
    expect(seen['store']).toBe(storeId);
    expect(seen['project']).toMatchObject({ ref: { storeId, projectId } });
    expect(seen['env']).toMatchObject({ id: envId });
    expect(seen['db']).toEqual({ id: dbId });
    expect(seen['table']).toEqual(
      table ? expect.objectContaining(table) : undefined,
    );
  });

  it('reads the page of a short GitHub address, as at the old address of the project', () => {
    const { seen } = at(
      '/project/github.com/o/r/tree/HEAD/d/-/env/local/db/chinook/table/main.Album?x=1',
      { storeId: 'github.com', projectId: 'r@o@d' },
    );
    expect(seen['store']).toBe('github.com');
    expect(seen['project']).toMatchObject({
      ref: { storeId: 'github.com', projectId: 'r@o@d' },
    });
    expect(seen['env']).toMatchObject({ id: 'local' });
    expect(seen['db']).toEqual({ id: 'chinook' });
    expect(seen['table']).toMatchObject({ schema: 'main', name: 'Album' });
  });

  it.each([
    // A store page names its store and no project.
    ['/store/localhost:8989', 'localhost:8989'],
    ['/store/http-localhost:8989', 'http-localhost:8989'],
    ['/store/github.com?x=1', 'github.com'],
    ['/store/a%20b', 'a b'],
    // A project address that cannot be read still names its store.
    ['/store/localhost:8989/project/p1/%E0%A4%A', 'localhost:8989'],
    ['/store/%E0%A4%A/project/p', '%E0%A4%A'],
  ])('%s is the store %s and no project', (url, storeId) => {
    const { logError, seen } = at(url);
    expect(logError).not.toHaveBeenCalled();
    expect(seen['store']).toBe(storeId);
    expect(seen['project']).toBeUndefined();
  });

  it.each([
    '/',
    '/my',
    '/incidents',
    '/store',
    '/store/',
    '/storefront/x',
    '/chat',
  ])('%s names no store, project, environment or table', (url) => {
    const { logError, seen } = at(url);
    expect(logError).not.toHaveBeenCalled();
    expect(seen['store']).toBeUndefined();
    expect(seen['project']).toBeUndefined();
    expect(seen['table']).toBeUndefined();
  });
});

describe('Space-scoped navigation metadata lifecycle', () => {
  it('cancels previous scope and clears missing/error metadata without reading environments', async () => {
    const { Subject } = await import('rxjs');
    const reads = [
      new Subject<{ id: string; title: string; access: string } | undefined>(),
      new Subject<{ id: string; title: string; access: string } | undefined>(),
      new Subject<{ id: string; title: string; access: string } | undefined>(),
    ];
    const watch = vi
      .fn()
      .mockReturnValueOnce(reads[0])
      .mockReturnValueOnce(reads[1])
      .mockReturnValueOnce(reads[2]);
    const env = { getEnvSummary: vi.fn() };
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
        { provide: Router, useValue: { events: NEVER } },
        { provide: ProjectService, useValue: { watchProjectSummary: watch } },
        { provide: EnvironmentService, useValue: env },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
      ],
    });
    const service = TestBed.inject(DatatugNavContextService);
    const values: unknown[] = [];
    service.currentProject.subscribe((v) => values.push(v));
    const p = { storeId: 'firestore', projectId: 'same' };
    service.setCurrentProject({ ref: p });
    reads[0].next({ id: 'same', title: 'Private', access: 'private' });
    service.setCurrentProject({ ref: { ...p, spaceID: 'S1' } });
    expect(reads[0].observed).toBe(false);
    reads[1].next({ id: 'same', title: 'S1', access: 'protected' });
    service.setCurrentProject({ ref: { ...p, spaceID: 'S2' } });
    reads[2].next({ id: 'same', title: 'S2', access: 'protected' });
    reads[1].next({ id: 'same', title: 'Late S1', access: 'protected' });
    expect(values.at(-1)).toMatchObject({
      ref: { spaceID: 'S2' },
      summary: { title: 'S2' },
    });
    reads[2].next(undefined);
    expect(values.at(-1)).toEqual({
      ref: { ...p, spaceID: 'S2' },
      store: undefined,
    });
    reads[2].next({ id: 'same', title: 'Restored S2', access: 'protected' });
    reads[2].error(new Error('permission-denied'));
    expect(values.at(-1)).toEqual({
      ref: { ...p, spaceID: 'S2' },
      store: undefined,
    });
    expect(env.getEnvSummary).not.toHaveBeenCalled();
  });
});

/**
 * The page of a stored query result (`/store/<store>/result/<id>`) names no project in its address: the page reads
 * it from the result and selects it (`selectResultProject`). The address changes of that page (its view and row are
 * query parameters) keep the selection; another address reads its own project again.
 */
describe('DatatugNavContextService — the stored-result page', () => {
  const store = 'http-127.0.0.1:8989';
  const resultUrl = `/store/${store}/result/r1`;

  function setup() {
    const events = new Subject<unknown>();
    window.history.replaceState({}, '', resultUrl);
    TestBed.configureTestingModule({
      providers: [
        DatatugNavContextService,
        {
          provide: AppContextService,
          useValue: { currentApp: of({ appCode: 'datatug' }) },
        },
        {
          provide: ProjectContextService,
          useValue: {
            current: undefined,
            setCurrent: vi.fn(),
            current$: of(undefined),
          },
        },
        { provide: Router, useValue: { events, navigate: vi.fn() } },
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
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
      ],
    });
    const service = TestBed.inject(DatatugNavContextService);
    const seen: Record<string, unknown> = {};
    service.currentProject.subscribe((p) => (seen['project'] = p));
    service.currentEnv.subscribe((e) => (seen['env'] = e));
    service.currentStoreId.subscribe((id) => (seen['store'] = id));
    const go = (url: string) => events.next(new NavigationEnd(1, url, url));
    const project = {
      ref: { projectId: 'demo', storeId: store },
      store: { ref: parseDatatugStoreRef(store) },
    };
    return { service, seen, go, project };
  }

  beforeEach(() => sessionStorage.clear());

  it('names the store of the address and no project', () => {
    const { seen } = setup();
    expect(seen['store']).toBe(store);
    expect(seen['project']).toBeUndefined();
  });

  it('selects the project of the result and its environment', () => {
    const { service, seen, project } = setup();
    service.selectResultProject(resultUrl, project, 'local');
    expect(seen['project']).toMatchObject({
      ref: { projectId: 'demo', storeId: store },
    });
    expect(seen['store']).toBe(store);
    expect(seen['env']).toMatchObject({ id: 'local' });
  });

  it('keeps the project when only the view or row of the page changes', () => {
    const { service, seen, go, project } = setup();
    service.selectResultProject(`${resultUrl}?view=table`, project, 'local');
    go(`${resultUrl}?view=record&row=2`);
    expect(seen['project']).toMatchObject({ ref: { projectId: 'demo' } });
    expect(seen['env']).toMatchObject({ id: 'local' });
  });

  it('clears the project when another result opens', () => {
    const { service, seen, go, project } = setup();
    service.selectResultProject(resultUrl, project, 'local');
    go(`/store/${store}/result/r2?view=table`);
    expect(seen['project']).toBeUndefined();
    expect(seen['env']).toBeUndefined();
    expect(seen['store']).toBe(store);
  });

  it('reads the project of any other address again', () => {
    const { service, seen, go, project } = setup();
    service.selectResultProject(resultUrl, project);
    go(`/store/${store}/project/p2/env/local`);
    expect(seen['project']).toMatchObject({ ref: { projectId: 'p2' } });
    // Back on the result page: nothing is selected until the page selects again.
    go(resultUrl);
    expect(seen['project']).toBeUndefined();
  });

  it('selecting no project clears it', () => {
    const { service, seen, project } = setup();
    service.selectResultProject(resultUrl, project, 'local');
    service.selectResultProject(resultUrl);
    expect(seen['project']).toBeUndefined();
    expect(seen['env']).toBeUndefined();
  });
});
