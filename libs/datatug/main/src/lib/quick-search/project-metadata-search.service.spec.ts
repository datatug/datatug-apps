import { TestBed } from '@angular/core/testing';
import { firstValueFrom, filter, of, NEVER, throwError } from 'rxjs';
import {
  ProjectMetadataSearchService,
  mergeSources,
  queryItems,
  summaryItems,
} from './project-metadata-search.service';
import { ProjectService } from '../services/project/project.service';
import { QueriesService } from '../queries/queries.service';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { IProjectRef } from '../core/project-context';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject } from 'rxjs';

const authProvider = () => ({
  provide: SneatAuthStateService,
  useValue: { authState: new BehaviorSubject({ status: 'notAuthenticated' }) },
});

const ref: IProjectRef = {
  storeId: 'github.com',
  projectId: 'datatug-demo-project@datatug@demo-project-1',
};

describe('project metadata sources', () => {
  it('flattens query folders with their folder path, tags and closed query routes', () => {
    const items = queryItems(ref, {
      id: '~',
      items: [{ id: 'root', title: 'Root query' } as never],
      folders: [
        {
          id: 'customers',
          items: [
            { id: 'top', title: 'Top customers', tags: ['crm'] } as never,
          ],
        },
      ],
    });
    expect(items.map((i) => [i.id, i.context, i.tags])).toEqual([
      ['root', undefined, []],
      ['customers/top', 'customers', ['crm']],
    ]);
    expect(items[1].href).toContain(
      '/-/query/customers%2Ftop?id=customers%2Ftop',
    );
  });

  it('turns the summary into boards, entities, databases and sources', () => {
    const items = summaryItems(ref, {
      id: 'p',
      title: 'p',
      access: 'public',
      boards: [{ id: 'board1', title: 'Customer insights' }],
      entities: [{ id: 'Album' }],
      dbModels: [{ id: 'chinook', numberOf: { tables: 11 } }],
      environments: [{ id: 'dev', title: 'Dev' }],
    });
    expect(items.map((i) => [i.kind, i.title, i.context])).toEqual([
      ['board', 'Customer insights', undefined],
      ['entity', 'Album', undefined],
      ['database', 'chinook', '11 tables'],
      ['source', 'Dev', undefined],
    ]);
    expect(items[0].href).toContain('/-/board/board1');
    expect(items[2].href).toContain('/-/dbmodel/chinook');
  });

  it('adds one tag item per tag and reports loading and the first failure', () => {
    const state = mergeSources(ref, [
      {
        status: 'ready',
        items: [{ kind: 'query', id: 'a', title: 'a', tags: ['CRM', 'x'] }],
      },
      {
        status: 'ready',
        items: [{ kind: 'board', id: 'b', title: 'b', tags: ['crm'] }],
      },
      { status: 'error', items: [], error: 'boom' },
      { status: 'loading', items: [] },
    ]);
    expect(state.loading).toBe(true);
    expect(state.error).toBe('boom');
    expect(
      state.items
        .filter((i) => i.kind === 'tag')
        .map((i) => [i.title, i.context]),
    ).toEqual([
      ['CRM', '2 items'],
      ['x', '1 item'],
    ]);
  });
});

describe('ProjectMetadataSearchService', () => {
  it('reads summary, queries and GitHub tables/columns without the hosted index', async () => {
    const tree: Record<string, { name: string; type: 'dir' | 'file' }[]> = {
      dbmodels: [{ name: 'chinook', type: 'dir' }],
      'dbmodels/chinook': [{ name: 'main', type: 'dir' }],
      'dbmodels/chinook/main/tables': [
        { name: 'Broken', type: 'dir' },
        { name: 'Customer', type: 'dir' },
      ],
      'dbmodels/chinook/main/views': [],
    };
    TestBed.configureTestingModule({
      providers: [
        authProvider(),
        {
          provide: ProjectService,
          useValue: {
            watchProjectSummary: () =>
              of(undefined, {
                id: 'p',
                title: 'p',
                access: 'public',
                boards: [{ id: 'b', title: 'Customers board' }],
              }),
          },
        },
        {
          provide: QueriesService,
          useValue: {
            getQueriesFolder: () =>
              of({
                id: '~',
                items: [{ id: 'top-customers', title: 'Top customers' }],
              }),
          },
        },
        {
          provide: GithubProjectReaderService,
          useValue: {
            listDirectory: (_: string, path: string) => of(tree[path] || []),
            getRawJson: vi.fn((_: string, path: string) =>
              path.includes('/Broken/')
                ? throwError(() => new Error('unreadable'))
                : of({
                    columns: [
                      { name: 'CustomerId' },
                      { name: 'Email', tags: ['pii'] },
                    ],
                  }),
            ),
          },
        },
      ],
    });
    const service = TestBed.inject(ProjectMetadataSearchService);
    const before = await firstValueFrom(
      service.metadata(ref).pipe(filter((s) => !s.loading)),
    );
    // Column files are read only once someone searches.
    expect(before.items.some((i) => i.kind === 'column')).toBe(false);
    const reader = TestBed.inject(GithubProjectReaderService) as unknown as {
      getRawJson: ReturnType<typeof vi.fn>;
    };
    expect(reader.getRawJson).not.toHaveBeenCalled();
    service.includeColumns(ref);
    const state = await firstValueFrom(
      service
        .metadata(ref)
        .pipe(
          filter((s) => !s.loading && s.items.some((i) => i.kind === 'column')),
        ),
    );
    // One unreadable columns file drops only that table's columns.
    expect(state.error).toBeUndefined();
    expect(state.items.map((i) => `${i.kind}:${i.title}`).sort()).toEqual([
      'board:Customers board',
      'column:CustomerId',
      'column:Email',
      'query:Top customers',
      'table:Broken',
      'table:Customer',
      'tag:pii',
    ]);
  });

  it('keeps answering from the sources that did read when one fails', async () => {
    TestBed.configureTestingModule({
      providers: [
        authProvider(),
        {
          provide: ProjectService,
          useValue: { watchProjectSummary: () => NEVER },
        },
        {
          provide: QueriesService,
          useValue: {
            getQueriesFolder: () =>
              of({ id: '~', items: [{ id: 'q', title: 'Customers' }] }),
          },
        },
        {
          provide: GithubProjectReaderService,
          useValue: {
            listDirectory: () => {
              throw Object.assign(new Error('API rate limit exceeded'), {
                status: 403,
              });
            },
            getRawJson: () => of(undefined),
          },
        },
      ],
    });
    const service = TestBed.inject(ProjectMetadataSearchService);
    const state = await firstValueFrom(
      service
        .metadata(ref)
        .pipe(filter((s) => s.items.length > 0 && s.error !== undefined)),
    );
    expect(state.items.map((i) => i.title)).toEqual(['Customers']);
  });

  it('drops what it read for one viewer when the viewer changes', async () => {
    const auth = new BehaviorSubject<{
      status: string;
      user?: { uid: string };
    }>({
      status: 'authenticated',
      user: { uid: 'a' },
    });
    const watch = vi.fn(() =>
      of({
        id: 'p',
        title: 'p',
        access: 'private',
        boards: [{ id: 'b', title: 'Private board' }],
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        { provide: ProjectService, useValue: { watchProjectSummary: watch } },
        {
          provide: QueriesService,
          useValue: { getQueriesFolder: () => of(null) },
        },
        { provide: GithubProjectReaderService, useValue: {} },
      ],
    });
    const cloud: IProjectRef = {
      storeId: 'firestore',
      spaceID: 's',
      projectId: 'p',
    };
    const service = TestBed.inject(ProjectMetadataSearchService);
    const seen: string[][] = [];
    const sub = service
      .metadata(cloud)
      .subscribe((s) => seen.push(s.items.map((i) => i.title)));
    await firstValueFrom(
      service.metadata(cloud).pipe(filter((s) => !s.loading)),
    );
    expect(watch).toHaveBeenCalledTimes(1);
    auth.next({ status: 'notAuthenticated' });
    await firstValueFrom(
      service.metadata(cloud).pipe(filter((s) => !s.loading)),
    );
    expect(watch).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });
});
