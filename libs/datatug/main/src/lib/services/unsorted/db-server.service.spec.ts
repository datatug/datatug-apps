import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, of } from 'rxjs';

import { DbServerService } from './db-server.service';
import { ProjectContextService } from '../project/project-context.service';
import { ProjectService } from '../project/project.service';
import { GithubProjectReaderService } from '../repo/github/github-project-reader.service';

describe('DbServerService', () => {
  let service: DbServerService;
  const getFull = vi.fn();
  const listEnvironmentIds = vi.fn();
  const getEnvironmentSummary = vi.fn();

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DbServerService,
        {
          provide: HttpClient,
          useValue: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
        },
        {
          provide: ProjectContextService,
          useValue: { current: undefined, setCurrent: vi.fn() },
        },
        { provide: ProjectService, useValue: { getFull } },
        {
          provide: GithubProjectReaderService,
          useValue: { listEnvironmentIds, getEnvironmentSummary },
        },
      ],
    });
    service = TestBed.inject(DbServerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('discovers servers from the current project_full dbDrivers wire shape', async () => {
    getFull.mockReturnValue(
      of({
        environments: [
          {
            id: 'dev',
            title: 'Development',
            dbServers: [
              {
                id: 'postgres:db.example:5432',
                driver: 'postgres',
                host: 'db.example',
                port: 5432,
                catalogs: ['orders', 'billing'],
              },
              {
                id: 'sqlite3:',
                driver: 'sqlite3',
                host: '',
                path: 'data/demo',
                catalogs: ['demo'],
              },
            ],
          },
        ],
        dbDrivers: [
          {
            id: 'postgres',
            servers: [
              {
                server: { driver: 'postgres', host: 'db.example', port: 5432 },
                catalogs: [{ id: 'orders' }, { id: 'billing' }],
              },
              {
                server: { driver: 'postgres', host: 'db.example', port: 5433 },
                catalogs: [{ id: 'archive' }],
              },
            ],
          },
          {
            id: 'sqlite3',
            servers: [
              {
                server: { driver: '', host: '', path: 'data/demo' },
                catalogs: [{ id: 'demo' }],
              },
            ],
          },
        ],
      }),
    );

    await expect(
      firstValueFrom(
        service.getDbServers({ storeId: 'http://agent', projectId: 'demo' }),
      ),
    ).resolves.toEqual([
      {
        dbServer: { driver: 'postgres', host: 'db.example', port: 5432 },
        databasesCount: 2,
        environments: [{ envId: 'dev', databasesCount: 2 }],
      },
      {
        dbServer: { driver: 'postgres', host: 'db.example', port: 5433 },
        databasesCount: 1,
      },
      {
        dbServer: { driver: 'sqlite3', host: '', path: 'data/demo' },
        databasesCount: 1,
        environments: [{ envId: 'dev', databasesCount: 1 }],
      },
    ]);
  });

  it('keeps the legacy dbServers response supported', async () => {
    getFull.mockReturnValue(
      of({
        dbServers: [
          {
            dbServer: { driver: 'mysql', host: 'legacy', port: 3306 },
            databases: [{ id: 'one' }],
          },
        ],
      }),
    );

    await expect(
      firstValueFrom(
        service.getDbServers({ storeId: 'http://agent', projectId: 'demo' }),
      ),
    ).resolves.toEqual([
      {
        dbServer: { driver: 'mysql', host: 'legacy', port: 3306 },
        databasesCount: 1,
      },
    ]);
  });

  it('preserves path and port when aggregating distinct GitHub environment endpoints', async () => {
    listEnvironmentIds.mockReturnValue(of(['dev']));
    getEnvironmentSummary.mockReturnValue(
      of({
        id: 'dev',
        title: 'Development',
        dbServers: [
          {
            id: 'sqlite-a',
            driver: 'sqlite3',
            host: '',
            path: 'data/a',
            catalogs: ['a'],
          },
          {
            id: 'sqlite-b',
            driver: 'sqlite3',
            host: '',
            path: 'data/b',
            catalogs: ['b'],
          },
          {
            id: 'postgres',
            driver: 'postgres',
            host: 'db.example',
            port: 5433,
            catalogs: ['orders'],
          },
        ],
      }),
    );

    await expect(
      firstValueFrom(
        service.getDbServers({ storeId: 'github.com', projectId: 'o@r' }),
      ),
    ).resolves.toEqual([
      {
        dbServer: { driver: 'sqlite3', host: '', path: 'data/a' },
        databasesCount: 1,
        environments: [{ envId: 'dev', databasesCount: 1 }],
      },
      {
        dbServer: { driver: 'sqlite3', host: '', path: 'data/b' },
        databasesCount: 1,
        environments: [{ envId: 'dev', databasesCount: 1 }],
      },
      {
        dbServer: { driver: 'postgres', host: 'db.example', port: 5433 },
        databasesCount: 1,
        environments: [{ envId: 'dev', databasesCount: 1 }],
      },
    ]);
  });

  it.each([{ dbDrivers: [] }, { dbServers: [] }, {}, { dbDrivers: null }])(
    'returns an empty list for an empty or omitted server declaration: %o',
    async (response) => {
      getFull.mockReturnValue(of(response));

      await expect(
        firstValueFrom(
          service.getDbServers({ storeId: 'http://agent', projectId: 'demo' }),
        ),
      ).resolves.toEqual([]);
    },
  );
});
