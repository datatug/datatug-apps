import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { QueriesService } from './queries.service';
import { QUERY_PROJ_ITEM_SERVICE } from './queries.service.token';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { IProjectRef } from '../core/project-context';

describe('QueriesService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        QueriesService,
        {
          provide: QUERY_PROJ_ITEM_SERVICE,
          useValue: {
            getFolder: vi.fn(),
            getProjItem: vi.fn(),
            createProjItem: vi.fn(),
            updateProjItem: vi.fn(),
            deleteProjItem: vi.fn(),
          },
        },
      ],
    });
  });

  it('should be created', () => {
    expect(TestBed.inject(QueriesService)).toBeTruthy();
  });
});

/**
 * S155 — founder ruling 2026-09-10: "Query page does not show query text and
 * linked entities/collections". These pin down that `QueriesService.getQuery()`'s
 * GitHub-store branch (`isGithubStoreId`, PR #112) already carries both all the
 * way through to `IQueryDef` — the query BODY (`request.text`, from
 * `GithubProjectReaderService.getQuery()`'s own raw-file read, mocked here rather
 * than HTTP directly since that method's own contract is exercised end to end by
 * `github-project-reader.service.spec.ts`) and the linked-entity metadata
 * (`parameters[].meta.entity` / `recordsets[].columns[].meta.entity`) a query's
 * `.query.json` definition file carries. Both were ALREADY correct before this
 * task (confirmed live against the real demo project, and by
 * `github-project-reader.service.spec.ts`'s own pre-existing `getQuery` coverage)
 * — the actual gap this task fixes is downstream, in the query PAGE's own
 * template never rendering either (see `query-page.component.spec.ts`'s own
 * S155 describe blocks). Kept here anyway as the GitHub-store data-layer
 * regression lock the task brief asked for.
 */
describe('QueriesService — GitHub-store getQuery (S155)', () => {
  const projRef: IProjectRef = {
    storeId: 'github.com',
    projectId: 'datatug-demo-projects@datatug@demo-project-1',
  };

  function createService(getQuery: (projectId: string, id: string) => unknown) {
    TestBed.configureTestingModule({
      providers: [
        QueriesService,
        {
          provide: QUERY_PROJ_ITEM_SERVICE,
          useValue: { getFolder: vi.fn(), getProjItem: vi.fn() },
        },
        { provide: GithubProjectReaderService, useValue: { getQuery } },
      ],
    });
    return TestBed.inject(QueriesService);
  }

  it('the legacy ".sql.json" shape (no parameters/recordsets at all, e.g. real demo-project-1 artists_with_albums) — text comes through, no linked entities to report', () => {
    const service = createService(() =>
      of({
        id: 'artists_with_albums',
        title: 'Artists with albums',
        type: 'SQL',
        text: 'SELECT ar.* FROM Artist as ar',
      }),
    );

    let result: import('../models/definition/query-def').IQueryDef | undefined;
    service
      .getQuery(projRef, 'artists/artists_with_albums')
      .subscribe((def) => (result = def));

    expect(result?.request).toEqual({ queryType: 'SQL', text: 'SELECT ar.* FROM Artist as ar' });
    expect(result?.parameters).toBeUndefined();
    expect(result?.recordsets).toBeUndefined();
  });

  it('a DTQL query (real demo-project-1 customer-invoices shape) — text AND linked-entity metadata both come through', () => {
    const service = createService(() =>
      of({
        id: 'customer-invoices',
        title: 'Customer invoices',
        type: 'DTQL',
        text: 'from:\n  name: Invoice\n',
        parameters: [
          { id: 'CustomerId', type: 'integer', meta: { entity: 'Customer', field: 'ID' } },
        ],
        recordsets: [
          {
            columns: [
              { name: 'InvoiceId', type: 'integer', meta: { entity: 'Invoice', field: 'ID' } },
            ],
          },
        ],
      }),
    );

    let result: import('../models/definition/query-def').IQueryDef | undefined;
    service
      .getQuery(projRef, 'customers/customer-invoices')
      .subscribe((def) => (result = def));

    expect(result?.request).toEqual({ queryType: 'DTQL', text: 'from:\n  name: Invoice\n' });
    expect(result?.parameters?.[0].meta).toEqual({ entity: 'Customer', field: 'ID' });
    expect(result?.recordsets?.[0].columns[0].meta).toEqual({ entity: 'Invoice', field: 'ID' });
  });
});
