import type { IQueryDef } from '../models/definition/query-def';
import { validateNativeRootResult } from './ovdb-native-root-result';
import type { OvdbOrdinaryResult } from './ovdb-ordinary-result';

type Records = Record<string, unknown>[];

const planned = [
  { database: 'db1', name: 'users' },
  { database: 'db2', name: 'orders' },
];
const sources = [
  { database: 'db2', collection: 'orders' },
  { database: 'db1', collection: 'users' },
];

function result(
  records: Records,
  columns: string[],
  evidence: Record<string, unknown> = {},
  execution: Record<string, unknown> = {},
): OvdbOrdinaryResult {
  return {
    records: records.map((data) => ({ data })),
    columns,
    evidence: {
      complete: true,
      execution: {
        route: 'in-memory',
        rowsReturned: records.length,
        sources,
        ...execution,
      },
      ...evidence,
    },
  };
}

const definition = (
  columns?: { name: string; type: string }[],
): IQueryDef =>
  (columns ? { recordsets: [{ name: 'r', columns }] } : {}) as IQueryDef;

describe('validateNativeRootResult', () => {
  it('infers column types from scalar values and converts rows', () => {
    const out = validateNativeRootResult(
      result(
        [
          { s: 'a', n: 1, b: true, z: null },
          { s: null, n: 2.5, b: false, z: null },
        ],
        ['s', 'n', 'b', 'z'],
      ),
      definition(),
      [...planned, planned[0]],
    );
    expect(out.columns).toEqual([
      { name: 's', type: 'string' },
      { name: 'n', type: 'number' },
      { name: 'b', type: 'boolean' },
      { name: 'z', type: 'unknown' },
    ]);
    expect(out.rows).toEqual([
      [
        { type: 'string', value: 'a' },
        { type: 'number', value: 1 },
        { type: 'boolean', value: true },
        { type: 'null', value: null },
      ],
      [
        { type: 'null', value: null },
        { type: 'number', value: 2.5 },
        { type: 'boolean', value: false },
        { type: 'null', value: null },
      ],
    ]);
  });

  it('uses declared column types from the saved projection', () => {
    const out = validateNativeRootResult(
      result([{ id: 7, name: 'x' }], ['id', 'name']),
      definition([
        { name: 'id', type: 'integer' },
        { name: 'name', type: 'string' },
      ]),
      planned,
    );
    expect(out.columns).toEqual([
      { name: 'id', type: 'integer' },
      { name: 'name', type: 'string' },
    ]);
    expect(out.rows).toEqual([
      [
        { type: 'integer', value: '7' },
        { type: 'string', value: 'x' },
      ],
    ]);
  });

  it('accepts an empty result', () => {
    expect(
      validateNativeRootResult(result([], ['a']), definition(), planned),
    ).toEqual({ columns: [{ name: 'a', type: 'unknown' }], rows: [] });
  });

  const completion =
    'OVDB cross-database result has invalid completion or execution evidence.';
  const physical = 'OVDB cross-database result has invalid physical sources.';
  const plan = 'OVDB cross-database physical sources differ from the saved plan.';

  it.each<[string, Record<string, unknown>, Record<string, unknown>, string]>([
    ['incomplete', { complete: false }, {}, completion],
    ['nextCursor', { nextCursor: 'c' }, {}, completion],
    ['nextPageToken', { nextPageToken: 't' }, {}, completion],
    ['remote route', {}, { route: 'remote' }, completion],
    ['unsafe rowsReturned', {}, { rowsReturned: 1.5 }, completion],
    ['wrong rowsReturned', {}, { rowsReturned: 2 }, completion],
    ['non-array sources', {}, { sources: {} }, completion],
    ['null source', {}, { sources: [null] }, physical],
    ['array source', {}, { sources: [[]] }, physical],
    ['empty database', {}, { sources: [{ database: '', collection: 'c' }] }, physical],
    ['non-string collection', {}, { sources: [{ database: 'd', collection: 1 }] }, physical],
    ['missing source', {}, { sources: sources.slice(0, 1) }, plan],
    ['extra source', {}, { sources: [...sources, { database: 'x', collection: 'y' }] }, plan],
    ['duplicate source', {}, { sources: [...sources, sources[0]] }, plan],
  ])('rejects %s evidence', (_, evidence, execution, message) => {
    expect(() =>
      validateNativeRootResult(
        result([{ a: 'x' }], ['a'], evidence, execution),
        definition(),
        planned,
      ),
    ).toThrow(message);
  });

  it.each<[string, Records, string[], { name: string; type: string }[] | undefined, string]>([
    ['projection mismatch', [{ a: 'x' }], ['a'], [{ name: 'b', type: 'string' }], 'columns differ from the saved projection'],
    ['missing column', [{ a: 'x' }, {}], ['a'], undefined, 'missing a projected column'],
    ['object value', [{ a: { nested: 1 } }], ['a'], undefined, 'unsupported scalar value'],
    ['mixed undeclared types', [{ a: 'x' }, { a: 1 }], ['a'], undefined, 'inconsistent value types'],
    ['value differs from declared type', [{ a: 'x' }, { a: 1 }], ['a'], [{ name: 'a', type: 'string' }], 'differs from its declared column type'],
    ['boolean declared as number', [{ a: true }], ['a'], [{ name: 'a', type: 'number' }], 'differs from its declared column type'],
  ])('rejects records with %s', (_, records, columns, declared, message) => {
    expect(() =>
      validateNativeRootResult(
        result(records, columns),
        definition(declared),
        planned,
      ),
    ).toThrow(message);
  });
});
