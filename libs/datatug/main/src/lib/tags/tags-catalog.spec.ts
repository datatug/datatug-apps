import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { ErrorLogger } from '@sneat/core';
import { ModalController, NavController } from '@ionic/angular';
import { ProjectTagsCloudComponent } from './project-tags-cloud.component';
import { HostedBoardScope } from '../board/core/hosted-board-scope';
import { ProjectAssetsReadService } from '../services/project/project-assets-read.service';
import { QueriesService } from '../queries/queries.service';
import { DbServerService } from '../services/unsorted/db-server.service';
import { ProjectContextService } from '../services/project/project-context.service';
import { ProjectService } from '../services/project/project.service';
import { EnvironmentService } from '../services/unsorted/environment.service';
import { ServersPageComponent } from '../pages/signed-in/servers/servers-page.component';
import { HttpClient } from '@angular/common/http';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
const ref = { storeId: 'local', projectId: 'demo' };
it('counts nested items, updates asynchronously without manual detection, and keeps failed kinds visibly partial', async () => {
  const boards = new Subject<{ id: string; tags: string[] }[]>();
  const scope = {
    environment: signal(''),
    admitted: signal(false),
    refresh: vi.fn(),
  };
  const assets = { boards: vi.fn(() => boards) };
  TestBed.configureTestingModule({
    imports: [ProjectTagsCloudComponent],
    providers: [
      { provide: HostedBoardScope, useValue: scope },
      { provide: ProjectAssetsReadService, useValue: assets },
      {
        provide: QueriesService,
        useValue: {
          getQueriesFolder: () =>
            of({
              id: '~',
              folders: [
                {
                  id: 'nested',
                  folders: [
                    { id: 'deep', items: [{ id: 'q', tags: ['ops', 'ops'] }] },
                  ],
                },
              ],
            }),
        },
      },
      {
        provide: DbServerService,
        useValue: { getDbServers: () => throwError(() => new Error('denied')) },
      },
    ],
  });
  TestBed.overrideComponent(ProjectTagsCloudComponent, {
    set: {
      providers: [],
      imports: [],
      template:
        '@for (entry of entries(); track entry.tag) { <p>{{ entry.tag }} {{ entry.counts.boards }} {{ entry.counts.queries }}</p> }',
    },
  });
  const fixture = TestBed.createComponent(ProjectTagsCloudComponent);
  fixture.componentRef.setInput('projectRef', ref);
  fixture.detectChanges();
  boards.next([{ id: 'b', tags: ['ops'] }]);
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('ops 1 1');
  const component = fixture.componentInstance;
  expect(component.catalog().servers.error).toBeTruthy();
  expect(component.catalog().servers.items).toBeUndefined();
  expect(component.complete()).toBe(false);
  expect(component.params('queries', 'ops')).toMatchObject({
    tag: 'ops',
    tab: 'shared',
    folder: null,
  });
  component.reload();
  await fixture.whenStable();
  expect(assets.boards).toHaveBeenCalledTimes(2);
});
it('cancels old server reads on project changes and clears stale rows when the next read fails', async () => {
  const current = new BehaviorSubject(ref),
    a = new Subject<unknown[]>(),
    b = new Subject<unknown[]>();
  const getDbServers = vi.fn((target) => (target.projectId === 'demo' ? a : b));
  TestBed.configureTestingModule({
    imports: [ServersPageComponent],
    providers: [
      {
        provide: ActivatedRoute,
        useValue: { queryParamMap: of(convertToParamMap({})) },
      },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: ProjectContextService, useValue: { current$: current } },
      { provide: DbServerService, useValue: { getDbServers } },
      {
        provide: ProjectService,
        useValue: { getFull: () => of({ environments: [] }) },
      },
      { provide: EnvironmentService, useValue: {} },
      { provide: ErrorLogger, useValue: { logError: vi.fn() } },
      { provide: ModalController, useValue: {} },
      { provide: NavController, useValue: {} },
    ],
  });
  TestBed.overrideComponent(ServersPageComponent, {
    set: {
      imports: [],
      template:
        '{{ loadError() }} @for (server of filteredDbServers() || []; track server.dbServer.host) { <p>{{ server.dbServer.host }}</p> }',
    },
  });
  const fixture = TestBed.createComponent(ServersPageComponent);
  fixture.detectChanges();
  a.next([
    {
      dbServer: { driver: 'postgres', host: 'a' },
      tags: ['private'],
      databasesCount: 0,
    },
  ]);
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('a');
  current.next({ ...ref, projectId: 'other' });
  a.next([
    { dbServer: { driver: 'postgres', host: 'stale' }, databasesCount: 0 },
  ]);
  b.error(new Error('denied'));
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).not.toContain('stale');
  expect(fixture.nativeElement.textContent).toContain('could not be loaded');
});
it('joins exact hostless Core server tags with environment usage without duplicating server counts', async () => {
  TestBed.configureTestingModule({
    providers: [
      DbServerService,
      { provide: HttpClient, useValue: {} },
      { provide: ProjectQueryApiService, useValue: {} },
      { provide: ProjectContextService, useValue: {} },
      { provide: ProjectService, useValue: {} },
      {
        provide: GithubProjectReaderService,
        useValue: {
          listEnvironmentIds: () => of(['local', 'dev']),
          getEnvironmentSummary: (id: string, env: string) =>
            of({
              id: env,
              dbServers: [{ driver: 'sqlite3', catalogs: ['Chinook'] }],
            }),
          getDbServerDefinitions: () =>
            of([
              {
                id: 'sqlite3:',
                tags: ['chinook'],
                server: { driver: 'sqlite3' },
              },
            ]),
        },
      },
    ],
  });
  const service = TestBed.inject(DbServerService);
  const result = await import('rxjs').then(({ firstValueFrom }) =>
    firstValueFrom(
      service.getDbServers({
        storeId: 'github.com',
        projectId: 'repo@owner@folder',
      }),
    ),
  );
  expect(result).toHaveLength(1);
  expect(result[0].tags).toEqual(['chinook']);
  expect(result[0].environments).toHaveLength(2);
});
it('reports a missing legacy catalog as unavailable while accepting a real empty catalog', async () => {
  const getFull = vi.fn(() => of({}));
  TestBed.configureTestingModule({
    providers: [
      DbServerService,
      { provide: HttpClient, useValue: {} },
      { provide: ProjectQueryApiService, useValue: {} },
      { provide: ProjectContextService, useValue: {} },
      { provide: ProjectService, useValue: { getFull } },
      { provide: GithubProjectReaderService, useValue: {} },
    ],
  });
  const { firstValueFrom } = await import('rxjs');
  const service = TestBed.inject(DbServerService);
  await expect(firstValueFrom(service.getDbServers(ref))).rejects.toThrow(
    'catalog is unavailable',
  );
  getFull.mockReturnValue(of({ dbServers: [] }));
  await expect(firstValueFrom(service.getDbServers(ref))).resolves.toEqual([]);
});
