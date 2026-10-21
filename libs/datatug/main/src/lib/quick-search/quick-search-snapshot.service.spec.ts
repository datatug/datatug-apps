import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ProjectService } from '../services/project/project.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { QueriesService } from '../queries/queries.service';
import {
  QuickSearchSnapshotService,
  queryDocuments,
} from './quick-search-snapshot.service';

describe('Quick Search actual metadata snapshot', () => {
  it('reads current folder schema columns wrapper and uploads only projected names', async () => {
    const directory = vi.fn((project: string, path: string) =>
      of(
        (
          {
            dbmodels: ['Chinook'],
            'dbmodels/Chinook': ['dbo'],
            'dbmodels/Chinook/dbo': ['tables'],
            'dbmodels/Chinook/dbo/tables': ['Customers'],
            'dbmodels/Chinook/dbo/views': [],
          } as Record<string, string[]>
        )[path]?.map((name) => ({ name, type: 'dir' })) || [],
      ),
    );
    const raw = vi.fn(() =>
      of({
        columns: [{ name: 'ID', dbType: 'secret-type' }],
        tags: ['customers'],
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProjectService,
          useValue: {
            watchProjectSummary: () =>
              of({
                id: 'demo',
                title: 'Demo',
                access: 'public',
                tags: { customers: 1 },
              }),
          },
        },
        {
          provide: QueriesService,
          useValue: { getQueriesFolder: () => of({ id: '~', items: [] }) },
        },
        { provide: ProjectQueryApiService, useValue: {} },
        {
          provide: GithubProjectReaderService,
          useValue: {
            readInfo: () => of({ commit: 'a'.repeat(40) }),
            visitEpoch: () => '0.0',
            listDirectory: directory,
            getRawJson: raw,
          },
        },
      ],
    });
    const snapshot = await TestBed.inject(QuickSearchSnapshotService).preview({
      storeId: 'github.com',
      projectId: 'repo@owner@',
      branch: 'main',
    });
    expect(snapshot.documents.map((item) => item.kind)).toEqual([
      'tag',
      'table',
      'column',
    ]);
    expect(
      snapshot.documents.find((item) => item.kind === 'column')?.name,
    ).toBe('ID');
    expect(JSON.stringify(snapshot)).not.toContain('secret-type');
    expect(
      directory.mock.calls.every((call) => call[0] === 'repo@owner@@main'),
    ).toBe(true);
    expect(
      snapshot.sourceCoverage.find((item) => item.kind === 'server')?.status,
    ).toBe('unavailable');
  });
  it('retains assigned tags and exact qualified query identity without SQL', () => {
    const documents = queryDocuments({
      id: '~',
      folders: [
        {
          id: 'customers',
          items: [
            {
              id: 'spend',
              title: 'Spend',
              request: { queryType: 'SQL', text: 'private SQL' },
              tags: [' customer ', 'customer'],
            } as never,
          ],
        },
      ],
    });
    expect(documents[0]).toEqual({
      kind: 'query',
      id: 'customers/spend',
      name: 'Spend',
      tags: ['customer'],
      reference: { objectId: 'spend', folder: 'customers' },
    });
    expect(JSON.stringify(documents)).not.toContain('private SQL');
  });
});
