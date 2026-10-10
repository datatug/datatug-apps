import initSqlJs from 'sql.js';
import { TestBed } from '@angular/core/testing';
import { NEVER, of } from 'rxjs';
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

it('executes prepared integer bindings through the same SQLite worker path', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE Invoice (InvoiceId INTEGER, CustomerId INTEGER)');
  db.run('INSERT INTO Invoice VALUES (101, 1), (202, 2), (303, 2)');
  const fixture = db.export();
  db.close();

  await expect(
    executePinnedSql(
      'SELECT InvoiceId FROM Invoice WHERE CustomerId = ? LIMIT 100',
      fixture,
      [2],
    ),
  ).resolves.toEqual({ columns: ['InvoiceId'], rows: [[202], [303]] });
  await expect(
    executePinnedSql(
      'SELECT InvoiceId FROM Invoice WHERE CustomerId = ? LIMIT 100',
      fixture,
    ),
  ).rejects.toThrow('bindings are invalid');
  await expect(
    executePinnedSql(
      'SELECT InvoiceId FROM Invoice WHERE CustomerId = ? LIMIT 100',
      fixture,
      [2, 3],
    ),
  ).rejects.toThrow('bindings are invalid');

  const groupedSql =
    'SELECT CustomerId, COUNT(*) AS InvoiceCount FROM Invoice WHERE CustomerId = ? GROUP BY CustomerId HAVING COUNT(*) >= ? LIMIT 10';
  await expect(
    executePinnedSql(groupedSql, fixture, [2, 2]),
  ).resolves.toEqual({ columns: ['CustomerId', 'InvoiceCount'], rows: [[2, 2]] });
  await expect(
    executePinnedSql(groupedSql, fixture, [2, 3]),
  ).resolves.toEqual({ columns: ['CustomerId', 'InvoiceCount'], rows: [] });
});

it('cancels a started Author worker and terminates it promptly', async () => {
  let workerInstance:
    | {
        onmessage: ((event: MessageEvent) => void) | null;
        onerror: (() => void) | null;
        posted: boolean;
        terminated: boolean;
      }
    | undefined;
  class PendingWorker {
    public onmessage: ((event: MessageEvent) => void) | null = null;
    public onerror: (() => void) | null = null;
    public posted = false;
    public terminated = false;
    public postMessage(): void {
      this.posted = true;
    }
    public terminate(): void {
      this.terminated = true;
    }
    constructor() {
      workerInstance = this;
    }
  }
  TestBed.configureTestingModule({
    providers: [
      PublicSqliteQueryService,
      {
        provide: GithubProjectReaderService,
        useValue: { getRawJson: () => of(catalog) },
      },
      {
        provide: ProjectQueryApiService,
        useValue: { connectionCatalog: () => of(catalog) },
      },
    ],
  });
  vi.stubGlobal('Worker', PendingWorker);
  try {
    const controller = new AbortController();
    const service = TestBed.inject(PublicSqliteQueryService);
    const plan = Object.freeze({
      sql: 'SELECT "i"."InvoiceId" FROM "Invoice" AS "i" WHERE "i"."CustomerId" = ? LIMIT 10',
      bindings: Object.freeze([1]),
      bindingNames: Object.freeze(['CustomerId']),
      sourceId: 'chinook-sqlite' as const,
      fixtureSha256:
        '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15',
      schemaVersion: 'fixture:typed-invoice-v1',
      draftRevision: 1,
    });
    const pending = service['executePlan'](
      {
        storeId: 'github.com',
        projectId: 'demo@buyer@project',
        projectApi: 'cloud',
        branch: 'main',
      },
      {
        id: 'chinook-invoice-author',
        connectionId: 'chinook-sqlite',
        request: { queryType: QueryType.DTQL, text: '' },
      },
      plan,
      controller.signal,
    );
    await vi.waitFor(() => expect(workerInstance?.posted).toBe(true));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(workerInstance?.terminated).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
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
    ).rejects.toThrow('bindings are invalid');
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
