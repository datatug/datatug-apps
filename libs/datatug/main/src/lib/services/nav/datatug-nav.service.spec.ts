import { TestBed } from '@angular/core/testing';
import { NavController } from '@ionic/angular';
import { ErrorLogger } from '@sneat/core';
import { DatatugNavService, IDbObjectNavParams } from './datatug-nav.service';
import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { IDatatugStoreContext, IProjectContext } from '../../nav/nav-models';
import { IProjectRef } from '../../core/project-context';
import { IQueryDef, QueryType } from '../../models/definition/query-def';

describe('DatatugNavService', () => {
  let service: DatatugNavService;
  let navMock: Partial<Record<keyof NavController, Mock>>;
  let errorLoggerMock: Partial<Record<keyof ErrorLogger, Mock>>;

  beforeEach(() => {
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
        { provide: NavController, useValue: navMock },
        { provide: ErrorLogger, useValue: errorLoggerMock },
      ],
    });
    service = TestBed.inject(DatatugNavService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
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
        [
          'store',
          'localhost:8989',
          'project',
          'p1',
          'env',
          'local',
          'db',
          'chinook-local',
          'table',
          'main.Album',
        ],
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
        request: { queryType: QueryType.SQL, text: 'select 1' },
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
  });
});
