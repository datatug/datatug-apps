import core from './testdata/core-v070-query-comparison.json';
import { decodeQueryComparison } from './query-comparison';
import {
  fromProjectQueryWire,
  toProjectQueryWire,
} from './project-query-contract';
import { QueryType } from '../models/definition/query-def';
const wire = () => ({
  ...structuredClone(core),
  type: QueryType.SQL,
  folderPath: '~',
});
describe('published Core70 comparison declaration', () => {
  it('round-trips the actual aliased Unicode Core fixture without dropping inputs or columns', () => {
    const query = fromProjectQueryWire(wire());
    expect(toProjectQueryWire(query)).toEqual(wire());
    expect(query.comparison?.projection.observationColumn).toBe('観測');
  });
  it.each([
    null,
    {},
    { ...core.comparison, kind: 'cohort' },
    { ...core.comparison, controlInput: core.comparison.primaryInput },
    { ...core.comparison, primaryInput: 'bad=id' },
    { ...core.comparison, future: true },
    {
      ...core.comparison,
      projection: { ...core.comparison.projection, extra: 'column' },
    },
    {
      ...core.comparison,
      projection: {
        ...core.comparison.projection,
        anchorColumn: core.comparison.projection.timeColumn,
      },
    },
    {
      ...core.comparison,
      projection: { ...core.comparison.projection, anchorColumn: null },
    },
  ])('rejects malformed/mixed/unknown declarations %j', (value) => {
    expect(() => decodeQueryComparison(value)).toThrow();
  });
  it('rejects lost, optional, set or wrong-type parameter/column roles on both reads and saves', () => {
    const valid = wire();
    for (const invalid of [
      { ...valid, parameters: [] },
      {
        ...valid,
        parameters: valid.parameters.map((p) => ({ ...p, isRequired: false })),
      },
      {
        ...valid,
        parameters: valid.parameters.map((p) => ({ ...p, isMultiValue: true })),
      },
      { ...valid, recordsets: [] },
      {
        ...valid,
        recordsets: [
          {
            columns: valid.recordsets[0].columns.map((c) => ({
              ...c,
              type: 'integer',
            })),
          },
        ],
      },
    ])
      expect(() => fromProjectQueryWire(invalid)).toThrow();
    const query = fromProjectQueryWire(valid);
    expect(() => toProjectQueryWire({ ...query, parameters: [] })).toThrow();
    const unsafeDefault = {
      ...wire(),
      parameters: wire().parameters.map((p) => ({
        ...p,
        defaultValue: Number('9223372036854775807'),
      })),
    };
    expect(() =>
      toProjectQueryWire(fromProjectQueryWire(unsafeDefault)),
    ).toThrow('cannot preserve');
    expect(() =>
      fromProjectQueryWire({
        ...wire(),
        parameters: wire().parameters.map((p) => ({
          ...p,
          isMultiValue: 'false',
        })),
      }),
    ).toThrow();
  });
});
