import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { NavController } from '@ionic/angular';
import { ErrorLogger, type IErrorLogger } from '@sneat/core';
import { DatatugNavService, IDbObjectNavParams } from './datatug-nav.service';
import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { DEMO_PROJECT_REF } from '../../nav/github-project-address';
import { IDatatugStoreContext, IProjectContext } from '../../nav/nav-models';
import { IProjectRef } from '../../core/project-context';
import { IProjBoard, IProjEntity, IProjEnv } from '../../models/definition/project';
import { IQueryDef, ITextQueryRequest, QueryType } from '../../models/definition/query-def';

describe('DatatugNavService', () => {
  let service: DatatugNavService;
  let router: { url: string };
  let navMock: Partial<Record<keyof NavController, Mock>>;
  let errorLoggerMock: Partial<Record<keyof IErrorLogger, Mock>>;

  beforeEach(() => {
    router = { url: '/' };
    navMock = {
      navigateRoot: vi.fn().mockResolvedValue(true),
      navigateForward: vi.fn().mockResolvedValue(true),
    };
    errorLoggerMock = {
      logError: vi.fn(),
      logErrorHandler: vi.fn().mockReturnValue(() => {
        /* noop */
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        DatatugNavService,
        { provide: Router, useValue: router },
        { provide: NavController, useValue: navMock },
        { provide: ErrorLogger, useValue: errorLoggerMock },
      ],
    });
    service = TestBed.inject(DatatugNavService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('navigates a shared reference to its scoped overview and queries while refusing chat and table pages', () => {
    const project: IProjectContext = {
      ref: { storeId: 'firestore', spaceID: 'S1', projectId: 'same' },
    };
    service.goProject(project, 'overview');
    expect(navMock.navigateRoot).toHaveBeenCalledWith(
      '/space/S1/store/firestore/project/same/overview',
      undefined,
    );
    navMock.navigateRoot?.mockClear();
    service.goProject(project, 'queries');
    expect(navMock.navigateRoot).toHaveBeenCalledWith(
      '/space/S1/store/firestore/project/same/queries',
      undefined,
    );
    navMock.navigateRoot?.mockClear();
    service.goProject(project, 'chat');
    service.goTable({
      project,
      env: 'local',
      db: 'db',
      schema: 'main',
      name: 'table',
    });
    expect(navMock.navigateRoot).not.toHaveBeenCalled();
    expect(navMock.navigateForward).not.toHaveBeenCalled();
  });

  it.each([
    [{ storeId: 'localhost:8989', projectId: 'p1' }, '/store/localhost:8989/project/p1'],
    [{ storeId: 'firestore', spaceID: 'S1', projectId: 'p1' }, '/space/S1/store/firestore/project/p1'],
  ])('keeps admitted session links and project-scoped Detective navigation for %j', (ref, base) => {
    const project = { ref } as IProjectContext;
    router.url = `${base}/sessions/session-a/overview`;
    for (const page of ['queries', 'overview']) {
      const expected = `${base}/sessions/session-a/${page}`;
      expect(service.projectPageUrl(project.ref, page)).toBe(expected);
      service.goProjPage(page, project);
      expect(navMock.navigateForward).toHaveBeenLastCalledWith(expected, { state: { project } });
    }
    for (const page of ['checks', 'detective', 'sessions']) {
      const expected = `${base}/${page}`;
      expect(service.projectPageUrl(project.ref, page)).toBe(expected);
      service.goProjPage(page, project);
      expect(navMock.navigateForward).toHaveBeenLastCalledWith(expected, { state: { project } });
    }
    expect(errorLoggerMock.logError).not.toHaveBeenCalled();
  });

  describe('goStore', () => {
    it('should navigate to store page', () => {
      const store = {
        ref: { type: 'firestore' },
      } as unknown as IDatatugStoreContext;
      service.goStore(store);
      expect(navMock.navigateRoot).toHaveBeenCalledWith(
        ['store', 'firestore'],
        undefined,
      );
    });

    it('should throw error if ref is missing', () => {
      expect(() =>
        service.goStore({} as unknown as IDatatugStoreContext),
      ).toThrow('store.ref is a required parameter');
    });

    // Regression: `storeRefToId()` (`@sneat/core`) returns an `'agent'`
    // ref's `.url` verbatim, and `parseDatatugStoreRef` now correctly
    // turns an `http-`/`https-` prefixed id into a real `scheme://` URL
    // (see nav-models.spec.ts). Without converting back via `getStoreId()`
    // in `goStore()`, this navigated to `['store', 'http://localhost:8989']`
    // — a broken multi-segment route.
    it('converts an agent store ref URL back to its dash-form store id when navigating', () => {
      const store = {
        ref: { type: 'agent', url: 'http://localhost:8989' },
      } as unknown as IDatatugStoreContext;
      service.goStore(store);
      expect(navMock.navigateRoot).toHaveBeenCalledWith(
        ['store', 'http-localhost:8989'],
        undefined,
      );
    });

    it('leaves a bare host:port agent store ref unchanged when navigating', () => {
      const store = {
        ref: { type: 'agent', url: 'localhost:8989' },
      } as unknown as IDatatugStoreContext;
      service.goStore(store);
      expect(navMock.navigateRoot).toHaveBeenCalledWith(
        ['store', 'localhost:8989'],
        undefined,
      );
    });
  });

  describe('goTable', () => {
    it('navigates within the store route (store, project, env, db, table segments)', () => {
      const to: IDbObjectNavParams = {
        project: {
          ref: { storeId: 'localhost:8989', projectId: 'p1' },
        } as IProjectContext,
        env: 'local',
        db: 'chinook-local',
        schema: 'main',
        name: 'Album',
      };
      service.goTable(to);
      expect(navMock.navigateRoot).toHaveBeenCalledWith(
        '/store/localhost:8989/project/p1/env/local/db/chinook-local/table/main.Album',
        undefined,
      );
    });
  });

  describe('goQuery', () => {
    const project = {
      ref: { storeId: 'localhost:8989', projectId: 'demo-project' },
    } as IProjectContext;

    function queryDef(id: string): IQueryDef {
      return {
        id,
        request: { queryType: QueryType.SQL, text: 'select 1' } as ITextQueryRequest,
      };
    }

    it('navigates to the query page route with the id as a single path segment', () => {
      service.goQuery(project, queryDef('customer-invoices'));

      expect(navMock.navigateForward).toHaveBeenCalledWith(
        '/store/localhost:8989/project/demo-project/query/customer-invoices',
        {
          state: {
            project,
            query: queryDef('customer-invoices'),
            action: undefined,
          },
          queryParams: { id: 'customer-invoices' },
        },
      );
    });

    // Regression: before this fix, `goQuery()` built the URL without any id
    // path segment at all (`.../query`), which never matched the registered
    // `query/:queryId` route (`datatug-routing-proj.ts`) — every navigation
    // through this method 404'd, not only a folder-qualified one.
    it('encodes a folder-qualified id (datatug-cli#219) as a single routable path segment', () => {
      const query = queryDef('customers/customer-invoices');
      service.goQuery(project, query);

      expect(navMock.navigateForward).toHaveBeenCalledWith(
        '/store/localhost:8989/project/demo-project/query/customers%2Fcustomer-invoices',
        {
          state: { project, query, action: undefined },
          queryParams: { id: 'customers/customer-invoices' },
        },
      );
    });
  });

  describe('projectPageUrl', () => {
    const projectRef = { storeId: 's1', projectId: 'p1' } as IProjectRef;

    it('should return correct project page url', () => {
      const url = service.projectPageUrl(projectRef, 'overview');
      expect(url).toBe('/store/s1/project/p1/overview');
    });

    it('should include encoded id if provided', () => {
      const url = service.projectPageUrl(projectRef, 'env', 'prod/env');
      expect(url).toBe('/store/s1/project/p1/env/prod%2Fenv');
    });

    it('writes the short address of a GitHub project', () => {
      expect(
        service.projectPageUrl(
          { storeId: 'github.com', projectId: 'chinook-demo@datatug@' },
          'entity',
          'Country',
        ),
      ).toBe('/project/github.com/datatug/chinook-demo/entity/Country');
    });

    it('links to the root when the project has no exact address', () => {
      expect(
        service.projectPageUrl(
          { storeId: 's1', projectId: '50%' },
          'entity',
          'x',
        ),
      ).toBe('/');
    });
  });

  // G-A1c (design `demo-as-github-project.md` 3.4): every navigation of the service writes the address
  // `projectUrl()` writes: a GitHub project at its short address, any other store as it always was.
  describe('every navigation writes the address projectUrl() writes (G-A1c)', () => {
    const agent: IProjectContext = {
      ref: { storeId: 'localhost:8989', projectId: 'datatug-demo-project' },
    };
    const github: IProjectContext = {
      ref: { storeId: 'github.com', projectId: 'chinook-demo@datatug@' },
    };
    const githubFolder: IProjectContext = {
      ref: {
        storeId: 'github.com',
        projectId: 'datatug-demo-projects@datatug@demo-project-1',
      },
    };
    const githubBare: IProjectContext = {
      ref: { storeId: 'github', projectId: 'r@o' },
    };

    type Go = (service: DatatugNavService, project: IProjectContext) => void;
    const goProject: Go = (s, p) => s.goProject(p);
    const goProjectPage: Go = (s, p) => s.goProject(p, 'queries');
    const goProjPage: Go = (s, p) => s.goProjPage('new-entity', p);
    const goEnvironment: Go = (s, p) => s.goEnvironment(p, undefined, 'local');
    const goCatalog: Go = (s, p) => s.goCatalog(p, 'local', 'chinook');
    const goEntity: Go = (s, p) =>
      s.goEntity(p, { id: 'Country' } as IProjEntity);
    const goBoard: Go = (s, p) => s.goBoard(p, { id: 'sales' } as IProjBoard);

    it.each<[string, Go, 'navigateRoot' | 'navigateForward', string]>([
      ['goProject', goProject, 'navigateRoot', ''],
      ['goProject with a page', goProjectPage, 'navigateRoot', '/queries'],
      ['goProjPage', goProjPage, 'navigateForward', '/new-entity'],
      ['goEnvironment', goEnvironment, 'navigateForward', '/env/local'],
      ['goCatalog', goCatalog, 'navigateForward', '/env/local/db/chinook'],
      ['goEntity', goEntity, 'navigateForward', '/entity/Country'],
      ['goBoard', goBoard, 'navigateForward', '/board/sales'],
    ])('%s', (_name, go, method, page) => {
      const bases: [IProjectContext, string, boolean][] = [
        [agent, '/store/localhost:8989/project/datatug-demo-project', false],
        [github, '/project/github.com/datatug/chinook-demo', false],
        [
          githubFolder,
          '/project/github.com/datatug/datatug-demo-projects/demo-project-1',
          true,
        ],
        [githubBare, '/project/github.com/o/r/datatug', true],
      ];
      for (const [project, base, folder] of bases) {
        navMock[method]?.mockClear();
        go(service, project);
        // Under a folder, the page follows `/-`.
        const tail = folder && page ? '/-' + page : page;
        expect(navMock[method]).toHaveBeenCalledTimes(1);
        expect(navMock[method]?.mock.calls[0][0]).toBe(base + tail);
      }
      expect(errorLoggerMock['logError']).not.toHaveBeenCalled();
    });

    // The item is named by its own id, or by the id passed beside it; with neither the page itself is the target.
    it.each<[string, Go, 'navigateRoot' | 'navigateForward', string]>([
      [
        'goEnvironment with the environment of the brief',
        (s, p) => s.goEnvironment(p, { id: 'prod' } as IProjEnv, 'other'),
        'navigateForward',
        '/env/prod',
      ],
      [
        'goEnvironment with no id at all',
        (s, p) => s.goEnvironment(p),
        'navigateForward',
        '/env',
      ],
      [
        'goEntity with the id passed beside the entity',
        (s, p) => s.goEntity(p, {} as IProjEntity, 'Country'),
        'navigateForward',
        '/entity/Country',
      ],
      [
        'goEntity with no id at all',
        (s, p) => s.goEntity(p, {} as IProjEntity),
        'navigateForward',
        '/entity',
      ],
      [
        'goBoard with the id passed beside the board',
        (s, p) => s.goBoard(p, {} as IProjBoard, 'sales'),
        'navigateForward',
        '/board/sales',
      ],
      [
        'goBoard with no id at all',
        (s, p) => s.goBoard(p, {} as IProjBoard),
        'navigateForward',
        '/board',
      ],
      [
        'goQuery with no id',
        (s, p) =>
          s.goQuery(p, {
            id: '',
            request: { queryType: QueryType.SQL, text: 'select 1' } as ITextQueryRequest,
          } as IQueryDef),
        'navigateForward',
        '/query',
      ],
    ])('%s', (_name, go, method, page) => {
      go(service, agent);
      expect(navMock[method]?.mock.calls[0][0]).toBe(
        '/store/localhost:8989/project/datatug-demo-project' + page,
      );
      go(service, github);
      expect(navMock[method]?.mock.calls[1][0]).toBe(
        '/project/github.com/datatug/chinook-demo' + page,
      );
    });

    it('keeps the router state and query parameters it always passed', () => {
      service.goProject({ ...github, brief: { title: 'T', access: 'public' } });
      expect(navMock.navigateRoot).toHaveBeenCalledWith(
        '/project/github.com/datatug/chinook-demo',
        { state: { project: expect.objectContaining({ ref: github.ref }) } },
      );
      service.goEntity(github, { id: 'Country' } as IProjEntity);
      expect(navMock.navigateForward).toHaveBeenCalledWith(
        '/project/github.com/datatug/chinook-demo/entity/Country',
        { state: { project: github, projEntity: { id: 'Country' } } },
      );
    });

    it('opens the shared demo project of the home page at its nested GitHub path', () => {
      service.goProject({
        ref: { projectId: DEMO_PROJECT_REF.projectId, storeId: 'github' },
      });
      expect(navMock.navigateRoot).toHaveBeenCalledWith(
        '/project/github.com/datatug/datatug-demo-project/demo-project-1',
        undefined,
      );
    });

    it('uses the store of the store context for goProject, as it always did', () => {
      service.goProject({
        ref: { storeId: '', projectId: 'r@o@' },
        store: { ref: { type: 'github', id: 'github.com' } },
      } as IProjectContext);
      expect(navMock.navigateRoot).toHaveBeenCalledWith(
        '/project/github.com/o/r',
        undefined,
      );
    });

    it('goTable and goQuery of a GitHub project', () => {
      service.goTable({
        project: githubFolder,
        env: 'local',
        db: 'chinook',
        schema: 'main',
        name: 'Album',
      });
      expect(navMock.navigateRoot).toHaveBeenCalledWith(
        '/project/github.com/datatug/datatug-demo-projects/demo-project-1/-/env/local/db/chinook/table/main.Album',
        undefined,
      );
      service.goQuery(github, {
        id: 'customers/customer-invoices',
        request: { queryType: QueryType.SQL, text: 'select 1' } as ITextQueryRequest,
      });
      expect(navMock.navigateForward).toHaveBeenCalledWith(
        '/project/github.com/datatug/chinook-demo/query/customers%2Fcustomer-invoices',
        expect.objectContaining({
          queryParams: { id: 'customers/customer-invoices' },
        }),
      );
    });

    it('goProject does nothing for a project with no id', () => {
      service.goProject({ ref: { storeId: 'github.com', projectId: '' } });
      expect(navMock.navigateRoot).not.toHaveBeenCalled();
    });

    // A project the app has no exact address for is not navigated to a guess: the failure is logged.
    it.each<[string, Go]>([
      ['goProject', goProject],
      ['goProjPage', goProjPage],
      ['goEnvironment', goEnvironment],
      ['goCatalog', goCatalog],
      ['goEntity', goEntity],
      ['goBoard', goBoard],
      [
        'goTable',
        (s, p) =>
          s.goTable({ project: p, env: 'e', db: 'd', schema: 's', name: 'n' }),
      ],
      [
        'goQuery',
        (s, p) =>
          s.goQuery(p, {
            id: 'q',
            request: { queryType: QueryType.SQL, text: 'select 1' } as ITextQueryRequest,
          }),
      ],
    ])(
      '%s with a project that has no exact address logs the failure and navigates nowhere',
      (_name, go) => {
        go(service, { ref: { storeId: 'localhost:8989', projectId: '50%' } });
        expect(navMock.navigateRoot).not.toHaveBeenCalled();
        expect(navMock.navigateForward).not.toHaveBeenCalled();
        expect(errorLoggerMock['logError']).toHaveBeenCalledTimes(1);
        expect(errorLoggerMock['logError']).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('no exact address'),
          }),
          expect.stringContaining('Failed to navigate'),
        );
      },
    );
  });
});
