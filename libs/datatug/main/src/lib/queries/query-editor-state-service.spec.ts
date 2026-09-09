import { TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { defer, from, of } from 'rxjs';

import { QueryEditorStateService } from './query-editor-state-service';
import { QueriesService } from './queries.service';
import { ProjectService } from '../services/project/project.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';

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

/**
 * Regression (lane S92, journey J2/J3): `GET /datatug/queries/get_query`
 * 500s for every query in this demo project — datatug-core's
 * `fsQueriesStore.LoadQuery` splits the `id` param on `/` to derive both
 * the folder and the item ("customers/customer-invoices" → folder
 * "customers", item "customer-invoices"), but nothing in this app ever
 * learns or sends a folder-qualified id; every id that reaches `loadQuery`
 * (including `queries/applicable`'s own `Candidate.queryId`, the id the
 * context panel opens a query with) is bare ("customer-invoices").
 * Confirmed live: `{"error":{"message":"failed to load
 * *datatug.QueryDef[customer-invoices] from project: open
 * .../queries/customer-invoices.query.json: no such file or
 * directory", ...}}`. With no `def.parameters` ever loaded,
 * `QueryPageComponent.updateBindings()` has nothing to resolve against, so
 * the Parameters card always said "No parameters bound from selection or
 * context" — the exact AC:bound-from-selection / AC:context-carries
 * failure the brief names. `GET /datatug/projects/project_full`'s response
 * embeds each query's full definition (parameters included) under
 * `queries.folders[].items[]`, keyed by that same bare id, so falling back
 * to it (only when `get_query` errors) fixes this without a server change.
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
      summary: { id: 'datatug-demo-project', title: 'x', access: 'public' as const },
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

function throwErrorLike(message: string) {
  // Deferred (a rejected Promise, not a synchronous subscriber.error()) to
  // match real HTTP error timing — see this describe block's own test.
  return defer(() => Promise.reject(new Error(message)));
}
