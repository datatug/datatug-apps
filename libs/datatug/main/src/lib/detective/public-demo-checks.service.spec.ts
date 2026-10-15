import { TestBed } from '@angular/core/testing';
import { DEMO_PROJECT_REF } from '@datatug/project-address';
import { of } from 'rxjs';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { QueriesService } from '../queries/queries.service';
import { PublicSqliteQueryService } from '../queries/public-sqlite-query.service';
import { CheckDefinition, ValidatorDefinition } from './models';
import {
  PublicDemoChecksService,
  isPublicChecksProject,
  publicCheckUnsupported,
  publicRowCountResult,
} from './public-demo-checks.service';

const validator = (value = '59'): ValidatorDefinition => ({
  id: 'count',
  scope: 'set',
  kind: 'row-count',
  severity: 'error',
  expected: { type: 'integer', value },
});
const check = (): CheckDefinition => ({
  id: 'customers',
  title: 'Customer coverage',
  version: 1,
  inputs: [],
  steps: [
    {
      id: 'inventory',
      kind: 'query',
      queryId: 'demodb/customers',
      validators: [validator()],
    },
  ],
});

describe('public demo Check admission and Core row-count semantics', () => {
  it('admits only the exact default public demo', () => {
    expect(isPublicChecksProject(DEMO_PROJECT_REF)).toBe(true);
    for (const patch of [
      { branch: 'main' },
      { projectApi: 'local' as const },
      { spaceID: 'private' },
      { storeId: 'github' },
      { projectId: 'other' },
    ])
      expect(isPublicChecksProject({ ...DEMO_PROJECT_REF, ...patch })).toBe(
        false,
      );
  });
  it.each([
    [59, false, 'pass'],
    [58, false, 'fail'],
    [60, false, 'fail'],
    [59, true, 'unknown'],
    [58, true, 'unknown'],
    [60, true, 'fail'],
  ] as const)(
    'evaluates observed %i incomplete %s as %s',
    (rows, incomplete, outcome) => {
      expect(publicRowCountResult(validator(), rows, incomplete).outcome).toBe(
        outcome,
      );
      expect(
        publicRowCountResult(validator(), rows, incomplete).message,
      ).toContain(`Expected 59 rows; observed ${rows}`);
    },
  );
  it('rejects inputs, nesting, published Validators and invalid expectations', () => {
    expect(publicCheckUnsupported(check())).toBe('');
    const input = check();
    input.inputs = [{ name: 'id', type: 'integer', cardinality: 'scalar' }];
    const nested = check();
    nested.steps[0].kind = 'check';
    const published = check();
    const publishedValidator = published.steps[0].validators?.[0];
    if (!publishedValidator) throw new Error('Expected fixture Validator');
    publishedValidator.validatorId = 'shared';
    for (const value of [input, nested, published])
      expect(publicCheckUnsupported(value)).not.toBe('');
    for (const expected of ['-1', '01', '9007199254740992', 'x']) {
      const value = check();
      value.steps[0].validators = [validator(expected)];
      expect(publicCheckUnsupported(value)).not.toBe('');
      expect(publicRowCountResult(validator(expected), 59, false).outcome).toBe(
        'unknown',
      );
    }
  });
});

describe('PublicDemoChecksService', () => {
  const reader = { listDirectory: vi.fn(), getRawJson: vi.fn() };
  const queries = { getQuery: vi.fn() };
  const sqlite = { run: vi.fn() };
  let service: PublicDemoChecksService;
  beforeEach(() => {
    vi.resetAllMocks();
    TestBed.configureTestingModule({
      providers: [
        PublicDemoChecksService,
        { provide: GithubProjectReaderService, useValue: reader },
        { provide: QueriesService, useValue: queries },
        { provide: PublicSqliteQueryService, useValue: sqlite },
      ],
    });
    service = TestBed.inject(PublicDemoChecksService);
    reader.listDirectory.mockReturnValue(
      of([{ type: 'file', name: 'customers.json' }]),
    );
    reader.getRawJson.mockReturnValue(of(check()));
    queries.getQuery.mockReturnValue(of({ id: 'customers' }));
    sqlite.run.mockResolvedValue({
      recordset: { columns: [], rows: Array.from({ length: 59 }, () => []) },
      truncated: false,
      limitations: [],
      provenance: {
        source: 'Pinned public Chinook SQLite fixture',
        observedAt: 'now',
      },
    });
  });
  it('loads canonical checks/<id>.json definitions with a bounded catalog', async () => {
    expect(await service.load(DEMO_PROJECT_REF)).toEqual([check()]);
    expect(reader.getRawJson).toHaveBeenCalledWith(
      DEMO_PROJECT_REF.projectId,
      'checks/customers.json',
    );
    reader.listDirectory.mockReturnValue(
      of(
        Array.from({ length: 13 }, (_, i) => ({
          type: 'file',
          name: `check-${i}.json`,
        })),
      ),
    );
    await expect(service.load(DEMO_PROJECT_REF)).rejects.toThrow('limit');
  });
  it('returns real passing/failing run snapshots without writing history', async () => {
    const original = check();
    const passed = await service.run(DEMO_PROJECT_REF, original);
    expect(passed.outcome).toBe('pass');
    expect(passed.steps[0].rowCount).toBe(59);
    original.steps[0].validators = [validator('60')];
    expect(passed.definition.steps[0].validators?.[0].expected).toEqual({
      type: 'integer',
      value: '59',
    });
    const failed = await service.run(DEMO_PROJECT_REF, original);
    expect(failed.outcome).toBe('fail');
    expect(failed.severity).toBe('error');
    expect(failed.steps[0].validators?.[0].message).toBe(
      'Expected 60 rows; observed 59.',
    );
  });
  it('rejects unsupported execution before querying and surfaces source failures', async () => {
    await expect(
      service.run({ ...DEMO_PROJECT_REF, branch: 'other' }, check()),
    ).rejects.toThrow('not admitted');
    expect(sqlite.run).not.toHaveBeenCalled();
    sqlite.run.mockRejectedValue(new Error('Source not admitted'));
    await expect(service.run(DEMO_PROJECT_REF, check())).rejects.toThrow(
      'Source not admitted',
    );
  });
});
