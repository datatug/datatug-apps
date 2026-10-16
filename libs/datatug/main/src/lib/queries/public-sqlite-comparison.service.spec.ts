import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { PublicSqliteQueryService } from './public-sqlite-query.service';
import {
  PUBLIC_CHINOOK_COMPARISON_TARGETS,
  type ComparisonFixtureTarget,
} from './public-sqlite-comparison';
import type { IQueryDef } from '../models/definition/query-def';
import type { IProjectRef } from '../core/project-context';
import type {
  PublicSqlitePreparedPlan,
  PublicSqliteQueryPreview,
} from './public-sqlite-tugql';

const BASELINE_SHA =
  '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15';
const schemaVersion = JSON.stringify({
  fixtureSha256: BASELINE_SHA,
  invoice: [
    { name: 'CustomerId', dbType: 'INTEGER', isNullable: false },
    { name: 'InvoiceId', dbType: 'INTEGER', isNullable: false, pkPosition: 1 },
    { name: 'InvoiceDate', dbType: 'DATETIME', isNullable: false },
  ],
  customer: [
    { name: 'CustomerId', dbType: 'INTEGER', isNullable: false, pkPosition: 1 },
    { name: 'FirstName', dbType: 'NVARCHAR(40)', isNullable: false },
    { name: 'LastName', dbType: 'NVARCHAR(20)', isNullable: false },
    { name: 'Email', dbType: 'NVARCHAR(60)', isNullable: false },
  ],
  foreignKeysVersion: 1,
  foreignKey: {
    name: 'FK_Invoice_Customer_CustomerId',
    table: { schema: 'main', name: 'Invoice' },
    columns: ['CustomerId'],
    refTable: { schema: 'main', name: 'Customer' },
    refColumns: ['CustomerId'],
  },
});
const FINGERPRINT =
  'CustomerId:INTEGER|InvoiceId:INTEGER|InvoiceDate:DATETIME|CustomerId:INTEGER:PK|FirstName:STRING|LastName:STRING|Email:STRING|FK_Invoice_Customer_CustomerId:Invoice.CustomerId->Customer.CustomerId';
const relationship = {
  id: 'FK_Invoice_Customer_CustomerId',
  version: `${BASELINE_SHA}:main.Invoice.CustomerId:INTEGER->main.Customer.CustomerId:INTEGER:PRIMARY_KEY:v1`,
  fromSource: 'i',
  toSource: 'c',
  joinType: 'inner' as const,
  pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
};
const outputColumns = [
  {
    name: 'InvoiceId',
    type: 'integer' as const,
    lineage: [{ source: 'i', field: 'InvoiceId' }],
  },
  {
    name: 'InvoiceDate',
    type: 'string' as const,
    lineage: [{ source: 'i', field: 'InvoiceDate' }],
  },
  {
    name: 'Email',
    type: 'string' as const,
    lineage: [{ source: 'c', field: 'Email' }],
  },
];
const plan = Object.freeze({
  sql: 'SELECT "i"."InvoiceId", "i"."InvoiceDate", "c"."Email" FROM "Invoice" AS "i" INNER JOIN "Customer" AS "c" ON "i"."CustomerId" = "c"."CustomerId" WHERE "i"."CustomerId" = ? ORDER BY "i"."InvoiceId" LIMIT 100',
  bindings: Object.freeze([1]),
  bindingNames: Object.freeze(['CustomerId']),
  sourceId: 'chinook-sqlite' as const,
  fixtureSha256: BASELINE_SHA,
  schemaVersion,
  draftRevision: 7,
  relationship,
  outputColumns,
  authorProof: {
    profile: 'invoice-query' as const,
    resolvedQuery: {
      kind: 'recursive-dtql' as const,
      from: { kind: 'table' as const, name: 'Invoice', alias: 'i', joins: [] },
      limit: 100,
      columns: [],
    },
    relationship,
    rawInvoiceDateTextRule: 'chinook-invoice-datetime-text/v1' as const,
  },
}) satisfies PublicSqlitePreparedPlan;
const { bindings: _planBindings, ...previewPlan } = plan;
const preview = Object.freeze({
  ...previewPlan,
  fixedBindings: Object.freeze([]),
}) satisfies PublicSqliteQueryPreview;
const definition = {
  id: 'saved-chinook-query',
  connectionId: 'chinook-sqlite',
} as IQueryDef;
const project: IProjectRef = {
  storeId: 'github.com',
  projectId: 'datatug/datatug-demo-project',
  branch: 'main',
};

describe('public SQLite comparison side service', () => {
  let messages: Record<string, unknown>[];
  let workers: TestWorker[];
  const catalog = {
    format: 'datatug-demo-connections/v1',
    connections: [
      {
        id: 'chinook-sqlite',
        dataset: 'chinook',
        storage: 'sqlite',
        readiness: 'public-api',
        source: 'https://ovdb.demodb.dev/v1/databases/chinook',
        fixtureSha256: BASELINE_SHA,
        browserFixture: {
          url: 'https://chinook.demodb.dev/data/chinook.sqlite',
          bytes: 1007616,
        },
      },
    ],
    comparisonFixtures: PUBLIC_CHINOOK_COMPARISON_TARGETS,
  };

  class TestWorker {
    public onmessage: ((event: MessageEvent) => void) | null = null;
    public onerror: (() => void) | null = null;
    public terminated = false;

    constructor() {
      workers.push(this);
    }

    postMessage(message: Record<string, unknown>): void {
      messages.push(message);
      const target = message['comparisonTarget'] as ComparisonFixtureTarget;
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            ok: true,
            result: {
              columns: outputColumns.map((column) => column.name),
              rows: [[982, '2022-03-11 00:00:00', 'customer@example.test']],
            },
            receipt: {
              executionId: 'worker-execution-123',
              sql: plan.sql,
              bindings: plan.bindings,
              bindingNames: plan.bindingNames,
              fixtureSha256: target.sha256,
              targetId: target.id,
              schemaSha256: target.schemaSha256,
              schemaVersion: plan.schemaVersion,
              draftRevision: plan.draftRevision,
              schemaFingerprint: FINGERPRINT,
              relationship: plan.relationship,
              outputColumns: plan.outputColumns,
            },
          },
        } as MessageEvent);
      });
    }

    terminate(): void {
      this.terminated = true;
    }
  }

  beforeEach(() => {
    expect(_planBindings).toEqual([1]);
    messages = [];
    workers = [];
    TestBed.configureTestingModule({
      providers: [
        PublicSqliteQueryService,
        {
          provide: GithubProjectReaderService,
          useValue: {
            getRawJson: vi.fn((_projectId: string, path: string) => {
              if (path === 'connections/demo-db.json') return of(catalog);
              if (path.includes('Invoice.columns.json'))
                return of({ columns: [
                  { name: 'CustomerId', dbType: 'INTEGER', isNullable: false },
                  { name: 'InvoiceId', dbType: 'INTEGER', isNullable: false, pkPosition: 1 },
                  { name: 'InvoiceDate', dbType: 'DATETIME', isNullable: false },
                ] });
              if (path.includes('Customer.columns.json'))
                return of({ columns: [
                  { name: 'CustomerId', dbType: 'INTEGER', isNullable: false, pkPosition: 1 },
                  { name: 'FirstName', dbType: 'NVARCHAR(40)', isNullable: false },
                  { name: 'LastName', dbType: 'NVARCHAR(20)', isNullable: false },
                  { name: 'Email', dbType: 'NVARCHAR(60)', isNullable: false },
                ] });
              return of({
                version: 1,
                foreignKeys: [{
                  name: 'FK_Invoice_Customer_CustomerId',
                  table: { schema: 'main', name: 'Invoice' },
                  columns: ['CustomerId'],
                  refTable: { schema: 'main', name: 'Customer' },
                  refColumns: ['CustomerId'],
                }],
              });
            }),
          },
        },
        { provide: ProjectQueryApiService, useValue: { connectionCatalog: vi.fn() } },
      ],
    });
    vi.stubGlobal('Worker', TestWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('starts an independent target-bound worker and returns only its exact receipt', async () => {
    const service = TestBed.inject(PublicSqliteQueryService);
    const prepare = vi.spyOn(service, 'prepareTugQL').mockResolvedValue(preview);
    const result = await service.runComparisonSide(
      project,
      definition,
      plan,
      'chinook-candidate',
    );

    expect(prepare).toHaveBeenCalledWith(project, definition, plan.draftRevision, undefined, true);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      mode: 'comparison',
      comparisonTarget: { id: 'chinook-candidate', sha256: PUBLIC_CHINOOK_COMPARISON_TARGETS[1]?.sha256 },
      fixtureSha256: BASELINE_SHA,
      bindings: [1],
      authorProfile: true,
    });
    expect(result).toMatchObject({
      kind: 'browser-session',
      targetId: 'chinook-candidate',
      fixtureSha256: PUBLIC_CHINOOK_COMPARISON_TARGETS[1]?.sha256,
      rowCount: 1,
      resultComplete: true,
    });
    expect(workers[0]?.terminated).toBe(true);
  });

  it('refuses a proposed relationship completion before a worker starts', async () => {
    const service = TestBed.inject(PublicSqliteQueryService);
    const proposedCompletion = { ...preview, expandedSource: 'from Invoice as i join Customer as c on i.CustomerId = c.CustomerId' };
    const prepare = vi.spyOn(service, 'prepareTugQL').mockResolvedValue(proposedCompletion);

    await expect(
      service.runComparisonSide(
        project,
        definition,
        { ...plan, expandedSource: proposedCompletion.expandedSource } as unknown as PublicSqlitePreparedPlan,
        'chinook-candidate',
      ),
    ).rejects.toThrow('not eligible for fixture comparison');
    expect(prepare).not.toHaveBeenCalled();

    await expect(
      service.runComparisonSide(project, definition, plan, 'chinook-candidate'),
    ).rejects.toThrow('Apply the displayed relationship completion');
    expect(messages).toHaveLength(0);
    expect(workers).toHaveLength(0);
  });

  it('rejects Space-scoped and non-GitHub project references before a worker starts', async () => {
    const service = TestBed.inject(PublicSqliteQueryService);
    await expect(
      service.runComparisonSide(
        { ...project, storeId: 'firestore', spaceID: 'space-1' },
        definition,
        plan,
        'chinook-baseline',
      ),
    ).rejects.toThrow('directly authorized project');
    expect(workers).toHaveLength(0);
  });
});
