import initSqlJs from 'sql.js';
import { TestBed } from '@angular/core/testing';
import { NEVER } from 'rxjs';
import { QueryType } from '../models/definition/query-def';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import {
  admitPublicSqliteSource,
  PublicSqliteQueryService,
} from './public-sqlite-query.service';
import {
  executePinnedSql,
  readPinnedFixture,
} from './public-sqlite-query.worker';

const catalog = {
  format: 'datatug-demo-connections/v1',
  connections: [
    {
      id: 'chinook-sqlite',
      dataset: 'chinook',
      storage: 'sqlite',
      readiness: 'public-api',
      source: 'https://demodb.dev/ovdb/v1/databases/chinook',
      fixtureSha256:
        '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15',
      browserFixture: {
        url: 'https://chinook.demodb.dev/data/chinook.sqlite',
        bytes: 1007616,
      },
    },
  ],
};

describe('public browser SQLite admission', () => {
  it('admits only the unique declared pinned public source', () => {
    expect(() =>
      admitPublicSqliteSource(catalog, 'chinook-sqlite'),
    ).not.toThrow();
    expect(() => admitPublicSqliteSource(catalog, 'other')).toThrow();
    expect(() =>
      admitPublicSqliteSource(
        {
          ...catalog,
          connections: [...catalog.connections, catalog.connections[0]],
        },
        'chinook-sqlite',
      ),
    ).toThrow();
    expect(() =>
      admitPublicSqliteSource(
        {
          ...catalog,
          connections: [
            {
              ...catalog.connections[0],
              browserFixture: {
                ...catalog.connections[0].browserFixture,
                url: 'https://other.example/db',
              },
            },
          ],
        },
        'chinook-sqlite',
      ),
    ).toThrow();
    expect(() =>
      admitPublicSqliteSource(
        {
          ...catalog,
          connections: [{ ...catalog.connections[0], fixtureSha256: 'bad' }],
        },
        'chinook-sqlite',
      ),
    ).toThrow();
    expect(() =>
      admitPublicSqliteSource(
        {
          ...catalog,
          connections: [
            { ...catalog.connections[0], readiness: 'hosted-api-pending' },
          ],
        },
        'chinook-sqlite',
      ),
    ).toThrow();
  });
});

it('bounds a stalled authenticated catalogue read before launching a worker', async () => {
  TestBed.configureTestingModule({
    providers: [
      PublicSqliteQueryService,
      {
        provide: GithubProjectReaderService,
        useValue: { getRawJson: vi.fn() },
      },
      {
        provide: ProjectQueryApiService,
        useValue: { connectionCatalog: () => NEVER },
      },
    ],
  });
  vi.useFakeTimers();
  try {
    const result = TestBed.inject(PublicSqliteQueryService).run(
      {
        storeId: 'github.com',
        projectId: 'demo@buyer@project',
        projectApi: 'cloud',
        branch: 'main',
      },
      {
        id: 'q',
        connectionId: 'chinook-sqlite',
        request: { queryType: QueryType.SQL, text: 'SELECT 1' },
      },
    );
    const rejected = expect(result).rejects.toThrow(
      'source check exceeded 10 seconds',
    );
    await vi.advanceTimersByTimeAsync(10001);
    await rejected;
  } finally {
    vi.useRealTimers();
  }
});

describe('bounded SQLite worker', () => {
  let fixture: Uint8Array;
  beforeAll(async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(
      "CREATE TABLE Genre (GenreId INTEGER, Name TEXT); INSERT INTO Genre VALUES (1, 'Rock'), (2, 'Jazz')",
    );
    fixture = db.export();
    db.close();
  });
  it('returns a one-statement read with columns and rows', async () => {
    expect(
      await executePinnedSql(
        'SELECT GenreId, Name FROM Genre ORDER BY GenreId',
        fixture,
      ),
    ).toEqual({
      columns: ['GenreId', 'Name'],
      rows: [
        [1, 'Rock'],
        [2, 'Jazz'],
      ],
    });
  });
  it('rejects writes, multiple statements, blobs, and oversized result sets', async () => {
    await expect(
      executePinnedSql('DELETE FROM Genre', fixture),
    ).rejects.toThrow('read-only SELECT');
    await expect(
      executePinnedSql('SELECT 1; SELECT 2', fixture),
    ).rejects.toThrow('one read-only SELECT');
    await expect(executePinnedSql("SELECT X'00'", fixture)).rejects.toThrow(
      'Blob columns',
    );
    await expect(
      executePinnedSql('SELECT Name FROM Genre WHERE GenreId = ?', fixture),
    ).rejects.toThrow('unbound parameters');
    await expect(
      executePinnedSql(
        'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1001) SELECT x FROM n',
        fixture,
      ),
    ).rejects.toThrow('1,000-row');
  });
});

it('fetches only the pinned public fixture without credentials and refuses changed bytes', async () => {
  const fetchMock = vi.fn(async () => new Response(new Uint8Array(1007616)));
  vi.stubGlobal('fetch', fetchMock);
  try {
    await expect(readPinnedFixture()).rejects.toThrow('hash differs');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://chinook.demodb.dev/data/chinook.sqlite',
      {
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      },
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
