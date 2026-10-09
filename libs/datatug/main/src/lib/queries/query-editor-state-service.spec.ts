import { TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { defer, EMPTY, firstValueFrom, from, of, Subject } from 'rxjs';

import { QueryEditorStateService } from './query-editor-state-service';
import { QueriesService } from './queries.service';
import { ProjectService } from '../services/project/project.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { QueryType } from '../models/definition/query-def';
import {
  createHostedDemoDbQuery,
  withHostedDemoDbSource,
} from './hosted-demo-db-query';

describe('QueryEditorStateService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        QueryEditorStateService,
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: QueriesService,
          useValue: { getQuery: vi.fn(), updateQuery: vi.fn() },
        },
        {
          provide: ProjectService,
          useValue: { getFull: vi.fn() },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(undefined),
            currentEnv: of(undefined),
          },
        },
      ],
    });
  });

  it('should be created', () => {
    expect(TestBed.inject(QueryEditorStateService)).toBeTruthy();
  });
});

describe('QueryEditorStateService — hosted DemoDB query creation and save', () => {
  it('creates a query with the complete selected DTQL/federation definition and marks it persisted', async () => {
    const project = {
      ref: { storeId: 'github.com', projectId: 'owner/repo' },
      summary: {
        id: 'owner/repo',
        title: 'Test project',
        access: 'private' as const,
      },
    };
    const draft = withHostedDemoDbSource(
      createHostedDemoDbQuery('hosted-demodb-save-test'),
      'adventureworks.Person.Person',
    );
    const pendingCreate = new Subject<
      ReturnType<typeof createHostedDemoDbQuery>
    >();
    const createQuery = vi.fn(() => pendingCreate);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        QueryEditorStateService,
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: QueriesService,
          useValue: { getQuery: vi.fn(), createQuery, updateQuery: vi.fn() },
        },
        { provide: ProjectService, useValue: { getFull: vi.fn() } },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: of(project), currentEnv: of(undefined) },
        },
      ],
    });

    const service = TestBed.inject(QueryEditorStateService);
    const state = service.newQuery({
      id: draft.id,
      title: draft.title,
      isNew: true,
      queryType: QueryType.DTQL,
      def: draft,
      request: draft.request,
      federation: draft.federation,
    });

    const save = firstValueFrom(service.saveQuery(state, project.ref));
    const savingState = service.getQueryState(draft.id);
    if (!savingState)
      throw new Error('Expected query draft while save is pending');
    const newerRequest = {
      queryType: QueryType.DTQL,
      text: 'from:\n  database: adventureworks\n  schema: Person\n  name: Person\n  alias: p\nlimit: 5\n',
    };
    service.updateQueryState({
      ...savingState,
      title: 'Edited while saving',
      request: newerRequest,
    });
    pendingCreate.next(draft);
    pendingCreate.complete();
    await save;

    expect(createQuery).toHaveBeenCalledOnce();
    expect(createQuery.mock.calls[0][1]).toMatchObject({
      id: 'hosted-demodb-save-test',
      request: draft.request,
      federation: {
        ovdbBaseUrl: 'https://demodb.dev/ovdb',
        tables: [{ database: 'adventureworks', name: 'Person.Person' }],
      },
    });
    expect(service.getQueryState(draft.id)).toMatchObject({
      isNew: false,
      title: 'Edited while saving',
      request: newerRequest,
      federation: draft.federation,
    });
  });
});

describe('QueryEditorStateService — GitHub public SQLite save', () => {
  it('saves an authored SQL query with its explicit source in a cloned project', async () => {
    const project = {
      ref: {
        storeId: 'github.com',
        projectId: 'demo@buyer@project',
        projectApi: 'cloud' as const,
        branch: 'main',
      },
      summary: {
        id: 'demo@buyer@project',
        title: 'Shared demo',
        access: 'protected' as const,
      },
    };
    const saveRevision = vi.fn((_ref, request) =>
      of({
        query: request.query,
        revision: 'saved-revision',
        branchHead: 'saved-head',
      }),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        QueryEditorStateService,
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: QueriesService,
          useValue: {
            capabilities: () => of({ querySave: true }),
            saveRevision,
            authorityDenied: () => EMPTY,
            authentication: () => of({ status: 'authenticated' }),
          },
        },
        { provide: ProjectService, useValue: { getFull: vi.fn() } },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: of(project), currentEnv: of(undefined) },
        },
      ],
    });
    const service = TestBed.inject(QueryEditorStateService);
    const definition = {
      id: 'genre-mix',
      title: 'Genre mix',
      request: { queryType: QueryType.SQL, text: 'SELECT 1 AS GenreId' },
    };
    const state = service.newQuery({
      id: definition.id,
      title: definition.title,
      queryType: QueryType.SQL,
      request: definition.request,
      def: definition,
      connectionId: 'chinook-sqlite',
      branchHead: 'initial-head',
      isNew: true,
    });
    await firstValueFrom(service.saveQuery(state, project.ref));
    expect(saveRevision).toHaveBeenCalledOnce();
    expect(saveRevision.mock.calls[0][1]).toMatchObject({
      branch: 'main',
      expectedBranchHead: 'initial-head',
      query: {
        id: 'genre-mix',
        type: QueryType.SQL,
        text: 'SELECT 1 AS GenreId',
        connectionId: 'chinook-sqlite',
      },
    });
    expect(service.getQueryState('genre-mix')?.def?.connectionId).toBe(
      'chinook-sqlite',
    );
  });
});

/**
 * Regression (lane S92, journey J2/J3): `GET /datatug/queries/get_query`
 * used to 500 for every query in this demo project when given only a
 * *bare* id — datatug-core's `fsQueriesStore.LoadQuery` splits the `id`
 * param on `/` to derive both the folder and the item
 * ("customers/customer-invoices" → folder "customers", item
 * "customer-invoices"), and a bare id like "customer-invoices" resolves to
 * no folder. Confirmed live: `{"error":{"message":"failed to load
 * *datatug.QueryDef[customer-invoices] from project: open
 * .../queries/customer-invoices.query.json: no such file or
 * directory", ...}}`. With no `def.parameters` ever loaded,
 * `QueryPageComponent.updateBindings()` has nothing to resolve against, so
 * the Parameters card always said "No parameters bound from selection or
 * context" — the exact AC:bound-from-selection / AC:context-carries
 * failure the brief names. `GET /datatug/projects/project_full`'s response
 * embeds each query's full definition (parameters included) under
 * `queries.folders[].items[]`, keyed by that same bare id under its
 * folder's own id, so falling back to it (only when `get_query` errors)
 * fixed this without a server change.
 *
 * datatug-cli#219 makes `get_query` itself accept the folder-qualified id
 * (`queries/applicable`'s `Candidate.queryId` now returns that shape — see
 * the sibling "loadQuery succeeds via the primary get_query call for a
 * folder-qualified id" describe block below), so a bare id landing here is
 * now the *unusual* case (a server not yet on #219, or a genuine
 * `get_query` failure for another reason) rather than the everyday one —
 * this fallback, and this regression test, still hold.
 */
describe('QueryEditorStateService — loadQuery falls back to project_full when get_query 500s on a folder-nested id', () => {
  const projectFullFixture = {
    id: 'datatug-demo-project',
    title: 'DataTug Demo Project 1',
    access: 'public',
    queries: {
      folders: [
        {
          id: 'customers',
          items: [
            {
              id: 'customer-invoices',
              title: 'Customer invoices',
              type: 'DTQL',
              text: 'from:\n  name: Invoice\n  alias: i\n',
              parameters: [
                {
                  id: 'CustomerId',
                  type: 'integer',
                  isRequired: true,
                  meta: { entity: 'Customer', field: 'ID' },
                },
              ],
            },
          ],
        },
      ],
    },
  };

  it('populates def.parameters from project_full after the real (bare-id, folder-nested) get_query 500', async () => {
    const project = {
      ref: { storeId: 'localhost:8989', projectId: 'datatug-demo-project' },
      summary: {
        id: 'datatug-demo-project',
        title: 'x',
        access: 'public' as const,
      },
    };
    // Real HTTP responses always resolve asynchronously — never in the same
    // synchronous call stack as the request. `openQuery()` calls
    // `loadQuery()` (which fires these) *before* it publishes the stub
    // query state to `$state`, so a synchronous mock here (`of(...)`)
    // would race `onCompleted`'s own `$state.value` lookup and lose, purely
    // a test-mock-timing artifact this repo's real HTTP client never hits.
    const getQueryMock = vi.fn(() =>
      throwErrorLike(
        'failed to load *datatug.QueryDef[customer-invoices] from project: open .../queries/customer-invoices.query.json: no such file or directory',
      ),
    );
    const getFullMock = vi.fn(() => from(Promise.resolve(projectFullFixture)));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        QueryEditorStateService,
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: QueriesService, useValue: { getQuery: getQueryMock } },
        { provide: ProjectService, useValue: { getFull: getFullMock } },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(project),
            currentEnv: of(undefined),
          },
        },
      ],
    });

    const service = TestBed.inject(QueryEditorStateService);
    service.openQuery('customer-invoices');
    // Let the microtask-deferred getFull() mock (and its downstream
    // onCompleted()) actually run before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(getQueryMock).toHaveBeenCalledWith(project.ref, 'customer-invoices');
    expect(getFullMock).toHaveBeenCalledWith(project.ref);
    const queryState = service.getQueryState('customer-invoices');
    expect(queryState?.def?.parameters).toEqual([
      {
        id: 'CustomerId',
        type: 'integer',
        isRequired: true,
        meta: { entity: 'Customer', field: 'ID' },
      },
    ]);
  });
});

/**
 * datatug-cli#219: `get_query` now accepts a folder-qualified id directly
 * (see `ProjectItemService`'s own test confirming the literal `/` reaches
 * the server unmangled). So `loadQuery()`'s primary call must succeed for
 * one — the `project_full` fallback above must NOT be needed here.
 */
describe('QueryEditorStateService — loadQuery succeeds via the primary get_query call for a folder-qualified id', () => {
  // A ($state is a module-level singleton, not reset by TestBed.resetTestingModule()
  // — see the sibling "findQueryInProjectFull matches both id forms" describe block's
  // own note) id, distinct from every other id used in this file, so this test's
  // result can't be a stale leftover from — or leak into — another test.
  const ID = 'reports/quarterly-summary';

  it('resolves the query from get_query without falling back to project_full', async () => {
    const project = {
      ref: { storeId: 'localhost:8989', projectId: 'datatug-demo-project' },
      summary: {
        id: 'datatug-demo-project',
        title: 'x',
        access: 'public' as const,
      },
    };
    const def = {
      id: 'quarterly-summary',
      title: 'Quarterly summary',
      request: { queryType: QueryType.SQL, text: 'select 1' },
    };
    const getQueryMock = vi.fn(() => from(Promise.resolve(def)));
    const getFullMock = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        QueryEditorStateService,
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: QueriesService, useValue: { getQuery: getQueryMock } },
        { provide: ProjectService, useValue: { getFull: getFullMock } },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(project),
            currentEnv: of(undefined),
          },
        },
      ],
    });

    const service = TestBed.inject(QueryEditorStateService);
    service.openQuery(ID);
    await Promise.resolve();
    await Promise.resolve();

    expect(getQueryMock).toHaveBeenCalledWith(project.ref, ID);
    expect(getFullMock).not.toHaveBeenCalled();
    const queryState = service.getQueryState(ID);
    expect(queryState?.def?.title).toBe('Quarterly summary');
  });
});

/**
 * `findQueryInProjectFull()` (the `project_full` fallback's own matcher) must
 * accept BOTH forms of a query's id: the bare id this app always sent before,
 * and the folder-qualified id `queries/applicable`'s `Candidate.queryId` now
 * returns (datatug-cli#219) — `project_full`'s response keys each item by its
 * own bare id, grouped under its folder's `id`, so the folder-qualified form
 * is matched by joining `folder.id + '/' + item.id`.
 */
describe('QueryEditorStateService — findQueryInProjectFull matches both id forms', () => {
  // `$state` (this file's own module, top of query-editor-state-service.ts) is a
  // module-level `BehaviorSubject` singleton, not a TestBed-scoped provider —
  // `TestBed.resetTestingModule()` gets a fresh `QueryEditorStateService` instance
  // each test, but every instance reads/writes the SAME `$state`. So a query id
  // any OTHER test in this file has already `openQuery()`'d stays resolved in
  // `activeQueries` for every test that runs afterwards, in this describe block or
  // any other — `getQueryState(id)` would then return that leftover entry
  // regardless of what this test's own mocks return, a false pass. Every id
  // below is therefore unique across the whole file, never reused between the
  // two `it`s here either.
  const BARE_ID = 'annual-report';
  const FOLDER_QUALIFIED_ID = 'archive/annual-report';
  const projectFullFixture = {
    id: 'datatug-demo-project',
    title: 'DataTug Demo Project 1',
    access: 'public',
    queries: {
      folders: [
        {
          id: 'archive',
          items: [
            {
              id: 'annual-report',
              title: 'Annual report',
              type: 'DTQL',
              text: 'from:\n  name: Invoice\n  alias: i\n',
            },
          ],
        },
      ],
    },
  };

  function setUp(getQueryMock: () => ReturnType<typeof throwErrorLike>) {
    const project = {
      ref: { storeId: 'localhost:8989', projectId: 'datatug-demo-project' },
      summary: {
        id: 'datatug-demo-project',
        title: 'x',
        access: 'public' as const,
      },
    };
    const getFullMock = vi.fn(() => from(Promise.resolve(projectFullFixture)));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        QueryEditorStateService,
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: QueriesService, useValue: { getQuery: getQueryMock } },
        { provide: ProjectService, useValue: { getFull: getFullMock } },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(project),
            currentEnv: of(undefined),
          },
        },
      ],
    });
    return { project, getFullMock };
  }

  it('matches the bare id', async () => {
    const getQueryMock = vi.fn(() => throwErrorLike('boom'));
    setUp(getQueryMock);
    const service = TestBed.inject(QueryEditorStateService);

    service.openQuery(BARE_ID);
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getQueryState(BARE_ID)?.def?.title).toBe('Annual report');
  });

  it('matches the folder-qualified id (folder.id + "/" + item.id)', async () => {
    const getQueryMock = vi.fn(() => throwErrorLike('boom'));
    setUp(getQueryMock);
    const service = TestBed.inject(QueryEditorStateService);

    service.openQuery(FOLDER_QUALIFIED_ID);
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getQueryState(FOLDER_QUALIFIED_ID)?.def?.title).toBe(
      'Annual report',
    );
  });
});

function throwErrorLike(message: string) {
  // Deferred (a rejected Promise, not a synchronous subscriber.error()) to
  // match real HTTP error timing — see this describe block's own test.
  return defer(() => Promise.reject(new Error(message)));
}
