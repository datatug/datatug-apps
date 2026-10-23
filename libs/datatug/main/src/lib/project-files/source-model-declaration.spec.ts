import { ProblemCollector } from './project-file-problems';
import { checkSourceModel } from './source-model-declaration';

const field = (
  name: string,
  property = name.toLowerCase(),
): Record<string, unknown> => ({
  name,
  property,
  datatype: 'string',
  nullable: false,
});

const table = (name: string, fields = [field('Id')], schema = 'dbo') => ({
  schema,
  name,
  entity: name,
  key: 'Id',
  fields,
});

const valid = (tables: unknown[] = [table('Users')]) => ({
  schema: {
    repository: 'https://github.com/acme/schemas',
    revision: 'a'.repeat(40),
    path: 'models/$records/schema.json',
    sha256: 'b'.repeat(64),
  },
  module: 'Crm',
  moduleId: 'crm-module',
  tables,
});

describe('checkSourceModel', () => {
  let problems: ProblemCollector;
  beforeEach(() => {
    problems = new ProblemCollector();
  });

  it('returns a valid declaration unchanged with no problems', () => {
    const raw = valid([
      table('Users', [field('Id'), { ...field('Ns'), namespace: 'urn:x', nullable: true }]),
      table('Users', [field('Id')], 'crm'),
      table('Orders', [field('Id')], ''),
    ]);
    expect(checkSourceModel(raw, problems)).toBe(raw);
    expect(problems.problems).toEqual([]);
  });

  it.each([
    ['not an object', 'x', ''],
    ['missing tables', { ...valid(), tables: undefined }, ''],
    ['unknown key', { ...valid(), extra: 1 }, ''],
    ['bad revision', { ...valid(), schema: { ...valid().schema, revision: 'abc' } }, '/schema/revision'],
    ['empty tables', valid([]), '/tables'],
    ['bad datatype', valid([table('T', [{ ...field('Id'), datatype: 'int' }])]), '/tables/0/fields/0/datatype'],
  ])('reports schema violations: %s', (_, raw, path) => {
    expect(checkSourceModel(raw, problems)).toBeUndefined();
    expect(problems.problems.length).toBeGreaterThan(0);
    expect(problems.problems.every((p) => p.code === 'type')).toBe(true);
    expect(problems.problems.map((p) => p.path)).toContain(`/sourceModel${path}`);
  });

  it('reports every schema error, not just the first', () => {
    checkSourceModel({ ...valid(), module: '1bad', moduleId: '' }, problems);
    expect(problems.problems.map((p) => p.path)).toEqual(
      expect.arrayContaining(['/sourceModel/module', '/sourceModel/moduleId']),
    );
  });

  it.each([
    ['physical table', valid([table('Users'), table('Users')]), 'Duplicate physical table mapping.'],
    ['field name', valid([table('T', [field('Id', 'a'), field('Id', 'b')])]), 'Duplicate field/property mapping.'],
    ['property', valid([table('T', [field('A', 'p'), field('B', 'p')])]), 'Duplicate field/property mapping.'],
  ])('flags a duplicate %s but still returns the declaration', (_, raw, message) => {
    expect(checkSourceModel(raw, problems)).toBe(raw);
    expect(problems.problems).toEqual([
      { path: '/sourceModel/tables', code: 'duplicate', message },
    ]);
  });

  it('allows the same field names in different tables', () => {
    checkSourceModel(valid([table('A'), table('B')]), problems);
    expect(problems.problems).toEqual([]);
  });
});
