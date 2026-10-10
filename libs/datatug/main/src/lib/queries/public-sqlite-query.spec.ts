import initSqlJs from 'sql.js';
import { readFile } from 'node:fs/promises';
import { TestBed } from '@angular/core/testing';
import { NEVER, of, type Observable } from 'rxjs';
import { QueryType } from '../models/definition/query-def';
import type {
  IQueryDef,
  ISqlQueryRequest,
  ITextQueryRequest,
} from '../models/definition/query-def';
import type { IProjectRef } from '../core/project-context';
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
import type {
  PublicSqliteClientReportedBinding,
  PublicSqlitePreparedPlan,
} from './public-sqlite-tugql';

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
  await expect(executePinnedSql(groupedSql, fixture, [2, 2])).resolves.toEqual({
    columns: ['CustomerId', 'InvoiceCount'],
    rows: [[2, 2]],
  });
  await expect(executePinnedSql(groupedSql, fixture, [2, 3])).resolves.toEqual({
    columns: ['CustomerId', 'InvoiceCount'],
    rows: [],
  });
});

it('checks the pinned relationship schema and returns deterministically ordered typed join columns', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(
    'CREATE TABLE Customer (CustomerId INTEGER PRIMARY KEY, FirstName NVARCHAR(40) NOT NULL, LastName NVARCHAR(20) NOT NULL, Email NVARCHAR(60) NOT NULL)',
  );
  db.run(
    'CREATE TABLE Invoice (InvoiceId INTEGER PRIMARY KEY, CustomerId INTEGER NOT NULL REFERENCES Customer(CustomerId), InvoiceDate DATETIME NOT NULL)',
  );
  db.run(
    "INSERT INTO Customer VALUES (1, 'Luis', 'Gonzaga', 'luisg@embraer.com.br')",
  );
  db.run(
    "INSERT INTO Invoice VALUES (382, 1, '2009-01-01'), (98, 1, '2009-01-01'), (327, 1, '2009-01-01'), (121, 1, '2009-01-01'), (316, 1, '2009-01-01'), (143, 1, '2009-01-01'), (195, 1, '2009-01-01')",
  );
  const fixture = db.export();
  db.close();
  const sql =
    'SELECT i.InvoiceId AS InvoiceId, i.CustomerId AS CustomerId, c.FirstName AS FirstName, c.LastName AS LastName, c.Email AS Email FROM Invoice AS i INNER JOIN Customer AS c ON i.CustomerId = c.CustomerId WHERE i.CustomerId = ? ORDER BY i.InvoiceId ASC LIMIT 100';
  const result = await executePinnedSql(sql, fixture, [1], false, true);
  expect(result.columns).toEqual([
    'InvoiceId',
    'CustomerId',
    'FirstName',
    'LastName',
    'Email',
  ]);
  expect(result.rows.map((row) => row[0])).toEqual([
    98, 121, 143, 195, 316, 327, 382,
  ]);
  expect(result.rows[0]).toEqual([
    98,
    1,
    'Luis',
    'Gonzaga',
    'luisg@embraer.com.br',
  ]);
  await expect(
    executePinnedSql(sql, fixture, [1], false, true, [
      'CustomerId',
      'InvoiceId',
    ]),
  ).rejects.toThrow('result columns differ from the prepared output lineage');
});

const pinnedFixturePath = process.env['DATATUG_CHINOOK_FIXTURE_PATH'];

it('cancels a started Author worker and terminates it promptly', async () => {
  const workerInstances: Array<{
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: (() => void) | null;
    posted: boolean;
    terminated: boolean;
  }> = [];
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
      workerInstances.push(this);
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
      authorProof: {
        profile: 'invoice-query' as const,
        resolvedQuery: {} as PublicSqlitePreparedPlan['authorProof']['resolvedQuery'],
      },
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
        request: { queryType: QueryType.DTQL, text: '' } as ITextQueryRequest,
      },
      plan,
      controller.signal,
    );
    await vi.waitFor(() => expect(workerInstances.at(-1)?.posted).toBe(true));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(workerInstances.at(-1)?.terminated).toBe(true);
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
        request: {
          queryType: QueryType.SQL,
          text: 'SELECT 1',
        } as ISqlQueryRequest,
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

describe('Author TugQL structural preview and Run binding', () => {
  const columns = [
    { name: 'CustomerId', dbType: 'INTEGER', isNullable: false },
    { name: 'InvoiceId', dbType: 'INTEGER', isNullable: false },
    { name: 'InvoiceDate', dbType: 'DATETIME', isNullable: false },
  ];
  const customerColumns = [
    { name: 'CustomerId', dbType: 'INTEGER', isNullable: false, pkPosition: 1 },
    { name: 'FirstName', dbType: 'NVARCHAR(40)', isNullable: false },
    { name: 'LastName', dbType: 'NVARCHAR(20)', isNullable: false },
    { name: 'Email', dbType: 'NVARCHAR(60)', isNullable: false },
  ];
  const refs = {
    version: 1,
    foreignKeys: [{
      name: 'FK_Invoice_Customer_CustomerId',
      table: { schema: 'main', name: 'Invoice' },
      columns: ['CustomerId'],
      refTable: { schema: 'main', name: 'Customer' },
      refColumns: ['CustomerId'],
    }],
  };
  const project: IProjectRef = {
    storeId: 'github.com',
    projectId: 'demo@buyer@project',
    projectApi: 'cloud',
    branch: 'main',
  };
  const definition = (text: string): IQueryDef => ({
    id: 'chinook-invoice-author',
    connectionId: 'chinook-sqlite',
    request: { queryType: QueryType.DTQL, text } as ITextQueryRequest,
  });
  const joinedDefinition = (text: string): IQueryDef => ({
    ...definition(text),
    relationshipBindings: [
      {
        id: 'FK_Invoice_Customer_CustomerId',
        version:
          '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15:main.Invoice.CustomerId:INTEGER->main.Customer.CustomerId:INTEGER:PRIMARY_KEY:v1',
        from: { schema: 'main', table: 'Invoice' },
        to: { schema: 'main', table: 'Customer' },
        pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
      },
    ],
  });
  const groupedSource = [
    'parameters (',
    '  @CustomerId integer required',
    ')',
    'from Invoice as i',
    'where i.CustomerId = @CustomerId',
    'group by i.CustomerId',
    'having count(*) >= 7',
    'limit 10',
    'select i.CustomerId, count(*) as InvoiceCount',
    '',
  ].join('\n');
  const cteSource = [
    'parameters (',
    '  @CustomerId integer required',
    ')',
    'with CustomerCounts as (',
    '  from Invoice as i',
    '  where i.CustomerId = @CustomerId',
    '  group by i.CustomerId',
    '  having count(*) >= 7',
    '  limit 100',
    '  select (',
    '    i.CustomerId',
    '    count(*) as InvoiceCount',
    '  )',
    ')',
    'from CustomerCounts as totals',
    'join Customer as c',
    '  on totals.CustomerId = c.CustomerId',
    'order by totals.CustomerId asc',
    'limit 10',
    'select (',
    '  totals.CustomerId',
    '  totals.InvoiceCount',
    '  c.FirstName',
    '  c.LastName',
    '  c.Email',
    ')',
    '',
  ].join('\n');
  const reader = {
    getRawJson: vi.fn(
      (_projectId: string, path: string): Observable<unknown> =>
        of(path.endsWith('Customer/main.Customer.columns.json')
          ? { columns: customerColumns }
          : path.endsWith('chinook.refs.json')
            ? refs
            : path.endsWith('Invoice/main.Invoice.columns.json')
              ? { columns }
              : catalog),
    ),
  };
  const projectApi = { connectionCatalog: vi.fn(() => of(catalog)) };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PublicSqliteQueryService,
        { provide: GithubProjectReaderService, useValue: reader },
        { provide: ProjectQueryApiService, useValue: projectApi },
      ],
    });
    reader.getRawJson.mockReset();
    reader.getRawJson.mockImplementation((_projectId: string, path: string) =>
      of(path.endsWith('Customer/main.Customer.columns.json')
        ? { columns: customerColumns }
        : path.endsWith('chinook.refs.json')
          ? refs
          : path.endsWith('Invoice/main.Invoice.columns.json')
            ? { columns }
            : catalog),
    );
    projectApi.connectionCatalog.mockClear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it.skipIf(!pinnedFixturePath)(
    'executes the admitted compiled join SQL and bindings against the hash-pinned fixture',
    async () => {
      const fixture = new Uint8Array(
        await readFile(pinnedFixturePath as string),
      );
      expect(fixture.byteLength).toBe(1007616);
      const digest = await crypto.subtle.digest('SHA-256', fixture);
      expect(
        [...new Uint8Array(digest)]
          .map((part) => part.toString(16).padStart(2, '0'))
          .join(''),
      ).toBe(
        '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15',
      );
      const customerColumns = [
        {
          name: 'CustomerId',
          dbType: 'INTEGER',
          isNullable: false,
          pkPosition: 1,
        },
        { name: 'FirstName', dbType: 'NVARCHAR(40)', isNullable: false },
        { name: 'LastName', dbType: 'NVARCHAR(20)', isNullable: false },
        { name: 'Email', dbType: 'NVARCHAR(60)', isNullable: false },
      ];
      const refs = {
        version: 1,
        foreignKeys: [
          {
            name: 'FK_Invoice_Customer_CustomerId',
            table: { schema: 'main', name: 'Invoice' },
            columns: ['CustomerId'],
            refTable: { schema: 'main', name: 'Customer' },
            refColumns: ['CustomerId'],
          },
        ],
      };
      reader.getRawJson.mockImplementation((_projectId, path) =>
        of(
          path.endsWith('Customer/main.Customer.columns.json')
            ? { columns: customerColumns }
            : path.endsWith('chinook.refs.json')
              ? refs
              : path.endsWith('Invoice/main.Invoice.columns.json')
                ? { columns }
                : catalog,
        ),
      );
      const source = (limit: 3 | 100) =>
        [
          'parameters (',
          '  @CustomerId integer required',
          ')',
          'from Invoice as i',
          'join Customer as c',
          '  on i.CustomerId = c.CustomerId',
          'where i.CustomerId = @CustomerId',
          `limit ${limit}`,
          'select i.InvoiceId, i.CustomerId, c.FirstName, c.LastName, c.Email',
          '',
        ].join('\n');
      const service = TestBed.inject(PublicSqliteQueryService);
      const runCompiledPlan = async (limit: 3 | 100) => {
        const preview = await service.prepareTugQL(
          project,
          joinedDefinition(source(limit)),
          90 + limit,
        );
        expect(preview).not.toHaveProperty('expandedSource');
        expect(preview.relationship?.id).toBe(
          'FK_Invoice_Customer_CustomerId',
        );
        expect(preview.sql).toContain('INNER JOIN "Customer" AS "c"');
        expect(preview.sql).toContain('ORDER BY "i"."InvoiceId" ASC');
        const result = await executePinnedSql(
          preview.sql,
          fixture,
          [1, ...preview.fixedBindings],
          true,
          true,
          preview.outputColumns?.map((column) => column.name),
          preview.authorProof,
          preview.bindingNames,
          preview.schemaVersion,
          preview.draftRevision,
          preview.authorProof.profile,
          preview.fixtureSha256,
          preview.outputColumns,
          preview.relationship,
        );
        return result;
      };
      const result = await runCompiledPlan(100);
      expect(result.rows.map((row) => row[0])).toEqual([
        98, 121, 143, 195, 316, 327, 382,
      ]);
      expect(result.rows.map((row) => row[4])).toEqual(
        Array(7).fill('luisg@embraer.com.br'),
      );
      expect(result.schemaFingerprint).toContain(
        'FK_Invoice_Customer_CustomerId:Invoice.CustomerId->Customer.CustomerId',
      );
      const limited = await runCompiledPlan(3);
      expect(limited.rows.map((row) => row[0])).toEqual([98, 121, 143]);

      const compileAndRunCte = async (source: string, revision: number) => {
        const preview = await service.prepareTugQL(
          project,
          definition(source),
          revision,
        );
        return executePinnedSql(
          preview.sql,
          fixture,
          [1, ...preview.fixedBindings],
          true,
          true,
          preview.outputColumns?.map((column) => column.name),
          preview.authorProof,
          preview.bindingNames,
          preview.schemaVersion,
          preview.draftRevision,
          preview.authorProof?.profile,
          preview.fixtureSha256,
          preview.outputColumns,
          preview.relationship,
        );
      };
      const cteResult = await compileAndRunCte(cteSource, 101);
      expect(cteResult.columns).toEqual([
        'CustomerId', 'InvoiceCount', 'FirstName', 'LastName', 'Email',
      ]);
      expect(cteResult.rows).toEqual([
        [1, 7, 'Luís', 'Gonçalves', 'luisg@embraer.com.br'],
      ]);
      const cteOverSeven = await compileAndRunCte(
        cteSource.replace('having count(*) >= 7', 'having count(*) > 7'),
        102,
      );
      expect(cteOverSeven.rows).toEqual([]);
    },
  );

  it('previews SQL with the required binding unset and does not create a worker', async () => {
    const worker = vi.fn(() => {
      throw new Error('Preview must not create a Worker.');
    });
    vi.stubGlobal('Worker', worker);

    const preview = await TestBed.inject(PublicSqliteQueryService).prepareTugQL(
      project,
      definition(groupedSource),
      4,
    );

    expect(preview.sql).toContain('WHERE "i"."CustomerId" = ?');
    expect(preview.sql).toContain('HAVING COUNT(*) >= ?');
    expect(preview.sql).not.toContain('= 42');
    expect(preview.fixedBindings).toEqual([7]);
    expect(preview.bindingNames).toEqual([
      'CustomerId',
      'HAVING threshold (literal)',
    ]);
    expect(preview).not.toHaveProperty('bindings');
    expect(worker).not.toHaveBeenCalled();
    expect(reader.getRawJson).toHaveBeenCalledWith(
      'demo@buyer@project',
      'dbmodels/chinook/main/tables/Invoice/main.Invoice.columns.json',
    );
  });

  it('previews the bounded customer-count CTE without a physical relationship receipt', async () => {
    const worker = vi.fn(() => {
      throw new Error('Preview must not create a Worker.');
    });
    vi.stubGlobal('Worker', worker);
    const preview = await TestBed.inject(PublicSqliteQueryService).prepareTugQL(
      project,
      definition(cteSource),
      19,
    );

    expect(preview.sql).toContain('FROM (\nSELECT "i"."CustomerId" AS "CustomerId"');
    expect(preview.sql).toContain('INNER JOIN "Customer" AS "c"');
    expect(preview.sql).toContain('"totals"."CustomerId" = "c"."CustomerId"');
    expect(preview.sql).toContain('HAVING COUNT(*) >= ?');
    expect(preview.sql).not.toContain('= 1');
    expect(preview.sql).not.toContain('>= 7');
    expect(preview).not.toHaveProperty('relationship');
    expect(preview).not.toHaveProperty('bindings');
    expect(preview.fixedBindings).toEqual([7]);
    expect(preview.authorProof?.profile).toBe('customer-count-cte');
    expect(preview.outputColumns).toEqual([
      { name: 'CustomerId', type: 'integer', lineage: [{ source: 'i', field: 'CustomerId' }] },
      { name: 'InvoiceCount', type: 'integer', lineage: [] },
      { name: 'FirstName', type: 'string', lineage: [{ source: 'c', field: 'FirstName' }] },
      { name: 'LastName', type: 'string', lineage: [{ source: 'c', field: 'LastName' }] },
      { name: 'Email', type: 'string', lineage: [{ source: 'c', field: 'Email' }] },
    ]);
    expect(worker).not.toHaveBeenCalled();
  });

  it('rejects a CTE CustomerId predicate moved to the outer query before schema reads', async () => {
    const malformed = cteSource.replace(
      '  where i.CustomerId = @CustomerId\n',
      '',
    ).replace(
      'order by totals.CustomerId asc',
      'where totals.CustomerId = @CustomerId\norder by totals.CustomerId asc',
    );
    await expect(
      TestBed.inject(PublicSqliteQueryService).prepareTugQL(
        project,
        definition(malformed),
        20,
      ),
    ).rejects.toThrow('predicate must stay inside the referenced CTE');
    expect(reader.getRawJson).not.toHaveBeenCalled();
  });

  it('rejects a schema-qualified CTE source before resolution can erase the qualifier', async () => {
    const qualified = cteSource.replace(
      'from CustomerCounts as totals',
      'from forbidden.CustomerCounts as totals',
    );
    await expect(
      TestBed.inject(PublicSqliteQueryService).prepareTugQL(
        project,
        definition(qualified),
        20,
      ),
    ).rejects.toThrow('unqualified named CTE reference');
    expect(reader.getRawJson).not.toHaveBeenCalled();
  });

  it('rejects a CTE projection missing either required Customer string field', async () => {
    for (const source of [
      cteSource.replace('  c.LastName\n', ''),
      cteSource.replace('  c.Email\n', ''),
    ]) {
      await expect(
        TestBed.inject(PublicSqliteQueryService).prepareTugQL(
          project,
          definition(source),
          20,
        ),
      ).rejects.toThrow('all three Customer string fields');
    }
  });

  it('still verifies the physical Customer primary key for a derived CTE join', async () => {
    reader.getRawJson.mockImplementation((_projectId, path) =>
      of(path.endsWith('Customer/main.Customer.columns.json')
        ? {
            columns: customerColumns.map((column) =>
              column.name === 'CustomerId' ? { ...column, pkPosition: 0 } : column,
            ),
          }
        : path.endsWith('chinook.refs.json')
          ? refs
          : path.endsWith('Invoice/main.Invoice.columns.json')
            ? { columns }
            : catalog),
    );
    await expect(
      TestBed.inject(PublicSqliteQueryService).prepareTugQL(
        project,
        definition(cteSource),
        20,
      ),
    ).rejects.toThrow('Customer.CustomerId must be the non-null INTEGER primary key.');
  });

  it('keeps renamed CTE, key, and count aliases with a reversed explicit join', async () => {
    const renamed = [
      'parameters (',
      '  @CustomerId integer required',
      ')',
      'with InvoiceTotals as (',
      '  from Invoice as i',
      '  where i.CustomerId = @CustomerId',
      '  group by i.CustomerId',
      '  having count(*) >= 7',
      '  limit 100',
      '  select (',
      '    i.CustomerId as CustomerKey',
      '    count(*) as InvoiceTotal',
      '  )',
      ')',
      'from InvoiceTotals as counts',
      'join Customer as c',
      '  on c.CustomerId = counts.CustomerKey',
      'order by counts.CustomerKey asc',
      'limit 10',
      'select (',
      '  counts.CustomerKey',
      '  counts.InvoiceTotal',
      '  c.FirstName',
      '  c.LastName',
      '  c.Email',
      ')',
      '',
    ].join('\n');
    const preview = await TestBed.inject(PublicSqliteQueryService).prepareTugQL(
      project,
      definition(renamed),
      21,
    );
    expect(preview.sql).toContain('AS "CustomerKey"');
    expect(preview.sql).toContain('AS "InvoiceTotal"');
    expect(preview.sql).toContain('"counts"."CustomerKey" = "c"."CustomerId"');
    expect(preview.outputColumns?.slice(0, 2)).toEqual([
      { name: 'CustomerKey', type: 'integer', lineage: [{ source: 'i', field: 'CustomerId' }] },
      { name: 'InvoiceTotal', type: 'integer', lineage: [] },
    ]);
  });

  it('rejects a missing or tampered CTE proof at the worker boundary', async () => {
    const preview = await TestBed.inject(PublicSqliteQueryService).prepareTugQL(
      project,
      definition(cteSource),
      22,
    );
    const outputNames = preview.outputColumns?.map((column) => column.name);
    const invoke = (
      sql: string,
      bindings: readonly (string | number | null)[],
      columns: readonly string[] | undefined,
      proof: typeof preview.authorProof,
      profile: 'invoice-query' | 'customer-count-cte' | undefined,
      fullColumns: typeof preview.outputColumns = preview.outputColumns,
      relationship: typeof preview.relationship = preview.relationship,
    ) =>
      executePinnedSql(
        sql,
        undefined,
        bindings,
        true,
        true,
        columns,
        proof,
        preview.bindingNames,
        preview.schemaVersion,
        preview.draftRevision,
        profile,
        preview.fixtureSha256,
        fullColumns,
        relationship,
      );

    // Supplying each changed field explicitly exercises the immutable request
    // that the browser worker receives from Run.
    await expect(invoke(
      preview.sql,
      [1, ...preview.fixedBindings],
      outputNames,
      undefined,
      'customer-count-cte',
    )).rejects.toThrow('profile proof or execution metadata');
    const commentedSql = preview.sql.replace('FROM (\n', 'FROM /* disguised source */ (\n');
    await expect(invoke(
      commentedSql,
      [1, ...preview.fixedBindings],
      outputNames,
      undefined,
      undefined,
    )).rejects.toThrow('profile proof or execution metadata');
    const invoiceScan = {
      kind: 'recursive-dtql',
      from: { kind: 'table', name: 'Invoice', alias: 'i', joins: [] },
      limit: 10,
      columns: [{ expression: { kind: 'field', field: { source: 'i', field: 'InvoiceId' } } }],
    } as unknown as typeof preview.authorProof.resolvedQuery;
    await expect(invoke(
      preview.sql,
      [1, ...preview.fixedBindings],
      outputNames,
      { profile: 'customer-count-cte', resolvedQuery: invoiceScan },
      'customer-count-cte',
    )).rejects.toThrow('independently compiled profile');
    await expect(executePinnedSql(
      preview.sql,
      undefined,
      [1, ...preview.fixedBindings],
      true,
      true,
      outputNames,
      preview.authorProof,
      preview.bindingNames,
      undefined,
      undefined,
      'customer-count-cte',
      preview.fixtureSha256,
      preview.outputColumns,
    )).rejects.toThrow('profile proof or execution metadata');
    await expect(executePinnedSql(
      preview.sql,
      undefined,
      [1, ...preview.fixedBindings],
      true,
      true,
      outputNames,
      preview.authorProof,
      preview.bindingNames,
      preview.schemaVersion,
      -1,
      'customer-count-cte',
      preview.fixtureSha256,
      preview.outputColumns,
    )).rejects.toThrow('profile proof or execution metadata');
    await expect(executePinnedSql(
      preview.sql,
      undefined,
      [1, ...preview.fixedBindings],
      true,
      true,
      outputNames,
      preview.authorProof,
      preview.bindingNames,
      preview.schemaVersion,
      preview.draftRevision,
      preview.authorProof?.profile,
      'bad-fixture-hash',
    )).rejects.toThrow('profile proof or execution metadata');
    await expect(invoke(
      preview.sql,
      [1, ...preview.fixedBindings],
      outputNames,
      preview.authorProof
        ? { ...preview.authorProof, profile: 'wrong' as 'customer-count-cte' }
        : undefined,
      'customer-count-cte',
    )).rejects.toThrow('profile proof or execution metadata');
    await expect(invoke(
      `${preview.sql} `,
      [1, ...preview.fixedBindings],
      outputNames,
      preview.authorProof,
      'customer-count-cte',
    )).rejects.toThrow('independently compiled profile');
    const fabricatedRelationship = {
      id: 'FK_Invoice_Customer_CustomerId',
      version: '1',
      fromSource: 'Invoice',
      toSource: 'Customer',
      joinType: 'inner',
      pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
    } as const;
    await expect(invoke(
      preview.sql,
      [1, ...preview.fixedBindings],
      outputNames,
      preview.authorProof,
      'customer-count-cte',
      preview.outputColumns,
      fabricatedRelationship,
    )).rejects.toThrow('cannot carry a physical relationship receipt');
    await expect(invoke(
      preview.sql,
      [1, ...preview.fixedBindings],
      ['ChangedOutput'],
      preview.authorProof,
      'customer-count-cte',
    )).rejects.toThrow('independently compiled profile');
    const changedLineage = preview.outputColumns?.map((column, index) =>
      index === 0 ? { ...column, lineage: [] } : column,
    );
    await expect(invoke(
      preview.sql,
      [1, ...preview.fixedBindings],
      outputNames,
      preview.authorProof,
      'customer-count-cte',
      changedLineage,
    )).rejects.toThrow('independently compiled profile');
    await expect(invoke(
      preview.sql,
      [1, 8],
      outputNames,
      preview.authorProof,
      'customer-count-cte',
    )).rejects.toThrow('independently compiled profile');
    await expect(invoke(
      preview.sql,
      [1, ...preview.fixedBindings],
      outputNames,
      undefined,
      undefined,
    )).rejects.toThrow('profile proof or execution metadata');
  });

  it('previews a resolver-backed Invoice to Customer join and returns a source-preserving completion', async () => {
    const customerColumns = [
      {
        name: 'CustomerId',
        dbType: 'INTEGER',
        isNullable: false,
        pkPosition: 1,
      },
      { name: 'FirstName', dbType: 'NVARCHAR(40)', isNullable: false },
      { name: 'LastName', dbType: 'NVARCHAR(20)', isNullable: false },
      { name: 'Email', dbType: 'NVARCHAR(60)', isNullable: false },
    ];
    const refs = {
      version: 1,
      foreignKeys: [
        {
          name: 'FK_Invoice_Customer_CustomerId',
          table: { schema: 'main', name: 'Invoice' },
          columns: ['CustomerId'],
          refTable: { schema: 'main', name: 'Customer' },
          refColumns: ['CustomerId'],
        },
      ],
    };
    reader.getRawJson.mockImplementation((_projectId, path) =>
      of(
        path.endsWith('Customer/main.Customer.columns.json')
          ? { columns: customerColumns }
          : path.endsWith('chinook.refs.json')
            ? refs
            : path.endsWith('Invoice/main.Invoice.columns.json')
              ? { columns }
              : catalog,
      ),
    );
    const source = [
      'parameters (',
      '  @CustomerId integer required',
      ')',
      'from Invoice as i',
      'join Customer as c -- retained join note',
      '-- comment stays after the join',
      'where i.CustomerId = @CustomerId',
      'limit 100',
      'select i.InvoiceId, i.CustomerId, c.FirstName, c.LastName, c.Email',
      '',
    ].join('\n');
    const service = TestBed.inject(PublicSqliteQueryService);
    const query = joinedDefinition(source);
    const preview = await service.prepareTugQL(project, query, 12);
    expect(preview.sql).toContain(
      'INNER JOIN "Customer" AS "c" ON "i"."CustomerId" = "c"."CustomerId"',
    );
    expect(preview.sql).toContain('ORDER BY "i"."InvoiceId" ASC');
    expect(preview.sql).toContain('WHERE "i"."CustomerId" = ?');
    expect(preview.expandedSource).toContain(
      'join Customer as c -- retained join note\n  on i.CustomerId = c.CustomerId\n-- comment stays after the join',
    );
    expect(preview.relationship).toMatchObject({
      id: 'FK_Invoice_Customer_CustomerId',
      fromSource: 'i',
      toSource: 'c',
      pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
    });
    expect(
      preview.outputColumns?.find((column) => column.name === 'CustomerId'),
    ).toEqual({
      name: 'CustomerId',
      type: 'integer',
      lineage: [{ source: 'i', field: 'CustomerId' }],
    });
    expect(preview.fixedBindings).toEqual([]);
    expect(preview).not.toHaveProperty('bindings');
    await expect(service.runTugQL(project, query, 12, '1', preview)).rejects.toThrow(
      'Apply the displayed relationship completion',
    );

    let tamperReceipt: 'relationship' | 'lineage' | undefined;
    class JoinedReceiptWorker {
      public onmessage: ((event: MessageEvent) => void) | null = null;
      public onerror: (() => void) | null = null;
      public postMessage(message: Record<string, unknown>): void {
        const relationship = message['relationship'] as {
          readonly id: string;
          readonly version: string;
        };
        const outputColumns = message['outputColumns'] as {
          readonly name: string;
          readonly type: string;
          readonly lineage: readonly { readonly source: string; readonly field: string }[];
        }[];
        queueMicrotask(() =>
          this.onmessage?.({
            data: {
              ok: true,
              result: {
                columns: [
                  'InvoiceId',
                  'CustomerId',
                  'FirstName',
                  'LastName',
                  'Email',
                ],
                rows: [
                  [
                    98,
                    1,
                    'Luís',
                    'Gonçalves',
                    'luisg@embraer.com.br',
                  ],
                ],
              },
              receipt: {
                executionId: '00000000-0000-4000-8000-000000000002',
                sql: message['sql'],
                bindings: message['bindings'],
                bindingNames: message['bindingNames'],
                fixtureSha256: message['fixtureSha256'],
                schemaVersion: message['schemaVersion'],
                draftRevision: message['draftRevision'],
                schemaFingerprint:
                  'CustomerId:INTEGER|InvoiceId:INTEGER|InvoiceDate:DATETIME|CustomerId:INTEGER:PK|FirstName:STRING|LastName:STRING|Email:STRING|FK_Invoice_Customer_CustomerId:Invoice.CustomerId->Customer.CustomerId',
                relationship:
                  tamperReceipt === 'relationship'
                    ? { ...relationship, id: 'FK_changed' }
                    : relationship,
                outputColumns:
                  tamperReceipt === 'lineage'
                    ? [
                        {
                          ...outputColumns[0],
                          lineage: [{ source: 'c', field: 'InvoiceId' }],
                        },
                        ...outputColumns.slice(1),
                      ]
                    : outputColumns,
              },
            },
          } as MessageEvent),
        );
      }
      public terminate(): void {
        return;
      }
    }
    vi.stubGlobal('Worker', JoinedReceiptWorker);
    const completedQuery = joinedDefinition(preview.expandedSource ?? '');
    const completedPreview = await service.prepareTugQL(project, completedQuery, 13);
    expect(completedPreview).not.toHaveProperty('expandedSource');
    tamperReceipt = 'relationship';
    await expect(
      service.runTugQL(project, completedQuery, 13, '1', completedPreview),
    ).rejects.toThrow('worker receipt did not match');
    tamperReceipt = 'lineage';
    await expect(
      service.runTugQL(project, completedQuery, 13, '1', completedPreview),
    ).rejects.toThrow('worker receipt did not match');
    tamperReceipt = undefined;
    const result = await service.runTugQL(project, completedQuery, 13, '1', completedPreview);
    expect(
      result.recordset.columns.find((column) => column.name === 'CustomerId')
        ?.type,
    ).toBe('integer');
    expect(
      result.recordset.columns.find((column) => column.name === 'Email')?.type,
    ).toBe('string');
    expect(
      result.publicSqliteReceipt?.outputColumns?.find(
        (column) => column.name === 'CustomerId',
      ),
    ).toEqual({
      name: 'CustomerId',
      type: 'integer',
      lineage: [{ source: 'i', field: 'CustomerId' }],
    });
    expect(result.recordset.rows[0]?.[1]).toEqual({
      type: 'integer',
      value: '1',
    });

    const shorthandSource = source.replace(
      'join Customer as c -- retained join note\n-- comment stays after the join',
      'join Customer as c\n  on CustomerId\n-- comment stays after the join',
    );
    const shorthand = await TestBed.inject(
      PublicSqliteQueryService,
    ).prepareTugQL(project, joinedDefinition(shorthandSource), 13);
    await expect(
      service.runTugQL(project, joinedDefinition(shorthandSource), 13, '1', shorthand),
    ).rejects.toThrow('Apply the displayed relationship completion');
    expect(shorthand.expandedSource).toContain(
      'join Customer as c\n  on i.CustomerId = c.CustomerId\n-- comment stays after the join',
    );

    reader.getRawJson.mockImplementation((_projectId, path) =>
      of(
        path.endsWith('Customer/main.Customer.columns.json')
          ? { columns: customerColumns }
          : path.endsWith('chinook.refs.json')
            ? { version: 1, foreignKeys: [] }
            : path.endsWith('Invoice/main.Invoice.columns.json')
              ? { columns }
              : catalog,
      ),
    );
    await expect(
      TestBed.inject(PublicSqliteQueryService).prepareTugQL(
        project,
        joinedDefinition(source),
        12,
      ),
    ).rejects.toThrow('missing, changed, or ambiguous');

    reader.getRawJson.mockImplementation((_projectId, path) =>
      of(
        path.endsWith('Customer/main.Customer.columns.json')
          ? {
              columns: customerColumns.map((column) =>
                column.name === 'CustomerId'
                  ? { ...column, pkPosition: 0 }
                  : column,
              ),
            }
          : path.endsWith('chinook.refs.json')
            ? refs
            : path.endsWith('Invoice/main.Invoice.columns.json')
              ? { columns }
              : catalog,
      ),
    );
    await expect(
      TestBed.inject(PublicSqliteQueryService).prepareTugQL(
        project,
        joinedDefinition(source),
        12,
      ),
    ).rejects.toThrow('non-null INTEGER primary key');

    reader.getRawJson.mockImplementation((_projectId, path) =>
      of(
        path.endsWith('Customer/main.Customer.columns.json')
          ? { columns: customerColumns }
          : path.endsWith('chinook.refs.json')
            ? {
                version: 1,
                foreignKeys: [...refs.foreignKeys, ...refs.foreignKeys],
              }
            : path.endsWith('Invoice/main.Invoice.columns.json')
              ? { columns }
              : catalog,
      ),
    );
    await expect(
      TestBed.inject(PublicSqliteQueryService).prepareTugQL(
        project,
        joinedDefinition(source),
        12,
      ),
    ).rejects.toThrow('missing, changed, or ambiguous');

    reader.getRawJson.mockImplementation((_projectId, path) =>
      of(
        path.endsWith('Customer/main.Customer.columns.json')
          ? { columns: customerColumns }
          : path.endsWith('chinook.refs.json')
            ? {
                ...refs,
                foreignKeys: [
                  ...refs.foreignKeys,
                  {
                    name: 'FK_Invoice_Customer_CustomerId',
                    table: { schema: 'main', name: 'Playlist' },
                    columns: ['CustomerId'],
                    refTable: { schema: 'main', name: 'Track' },
                    refColumns: ['CustomerId'],
                  },
                ],
              }
            : path.endsWith('Invoice/main.Invoice.columns.json')
              ? { columns }
              : catalog,
      ),
    );
    await expect(
      service.prepareTugQL(project, joinedDefinition(source), 12),
    ).rejects.toThrow('missing, changed, or ambiguous');
  });

  it('rejects duplicate output aliases through the normal TugQL resolver', async () => {
    const duplicateAlias = [
      'parameters (',
      '  @CustomerId integer required',
      ')',
      'from Invoice as i',
      'where i.CustomerId = @CustomerId',
      'limit 10',
      'select i.InvoiceId as Value, i.InvoiceDate as Value',
      '',
    ].join('\n');

    await expect(
      TestBed.inject(PublicSqliteQueryService).prepareTugQL(
        project,
        definition(duplicateAlias),
        1,
      ),
    ).rejects.toThrow();
  });

  it('blocks an invalid Run and binds a valid value into the recompiled template', async () => {
    const workerMessages: Record<string, unknown>[] = [];
    let workerTerminated = false;
    class ReceiptWorker {
      public onmessage: ((event: MessageEvent) => void) | null = null;
      public onerror: (() => void) | null = null;
      public postMessage(message: Record<string, unknown>): void {
        workerMessages.push(message);
        queueMicrotask(() =>
          this.onmessage?.({
            data: {
              ok: true,
              result: {
                columns: ['CustomerId', 'InvoiceCount'],
                rows: [[2, 7]],
              },
              receipt: {
                executionId: '00000000-0000-4000-8000-000000000001',
                sql: message['sql'],
                bindings: message['bindings'],
                bindingNames: message['bindingNames'],
                fixtureSha256: message['fixtureSha256'],
                schemaVersion: message['schemaVersion'],
                draftRevision: message['draftRevision'],
                schemaFingerprint:
                  'CustomerId:INTEGER|InvoiceId:INTEGER|InvoiceDate:DATETIME',
              },
            },
          } as MessageEvent),
        );
      }
      public terminate(): void {
        workerTerminated = true;
      }
    }
    vi.stubGlobal('Worker', ReceiptWorker);

    const service = TestBed.inject(PublicSqliteQueryService);
    const query = definition(groupedSource);
    const preview = await service.prepareTugQL(project, query, 8);
    await expect(
      service.runTugQL(project, query, 8, '', preview),
    ).rejects.toThrow('whole-number CustomerId');
    expect(workerMessages).toHaveLength(0);

    const result = await service.runTugQL(project, query, 8, '42', preview);
    expect(workerMessages).toHaveLength(1);
    expect(workerMessages[0]['sql']).toBe(preview.sql);
    expect(workerMessages[0]['bindings']).toEqual([42, 7]);
    expect(workerMessages[0]['bindingNames']).toEqual([
      'CustomerId',
      'HAVING threshold (literal)',
    ]);
    expect(workerTerminated).toBe(true);
    expect(result.bindingsApplied).toEqual([
      {
        parameterId: 'CustomerId',
        value: { type: 'integer', value: '42' },
        origin: 'manual',
        originEvidence: 'client-reported',
      },
    ]);

    await expect(
      service.runTugQL(
        project,
        query,
        8,
        '42',
        preview,
        undefined,
        {
          origin: 'other',
          originEvidence: 'client-reported',
        } as unknown as PublicSqliteClientReportedBinding,
      ),
    ).rejects.toThrow('input origin is invalid');
    expect(workerMessages).toHaveLength(1);

    const inputOrigin = {
      origin: 'selection' as const,
      originEvidence: 'client-reported' as const,
      sourceQueryId: 'chinook-customer-invoice-join',
      sourceColumn: 'CustomerId',
    };
    const selectedPromise = service.runTugQL(
      project,
      query,
      8,
      '42',
      preview,
      undefined,
      inputOrigin,
    );
    inputOrigin.sourceQueryId = 'mutated-after-call';
    const selected = await selectedPromise;
    expect(selected.bindingsApplied[0]).toMatchObject({
      origin: 'selection',
      originEvidence: 'client-reported',
    });
    expect(selected.publicSqliteReceipt?.clientReportedBinding).toEqual({
      origin: 'selection',
      originEvidence: 'client-reported',
      sourceQueryId: 'chinook-customer-invoice-join',
      sourceColumn: 'CustomerId',
    });
  });
});
