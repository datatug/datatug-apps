import { describe, expect, it } from 'vitest';
import {
  directoryRecordType,
  indexedFields,
  indexedRecordTypes,
  normalizeModel,
} from './model-vocabulary';
import {
  mixedVocabularies,
  toCurrentSpelling,
} from './model-vocabulary.spec-helper';

const earlier = () => ({
  modelspec: '1.0-draft',
  module: { name: 'sample', id: 'sample-id' },
  entities: {
    Customer: {
      key: ['id'],
      properties: {
        id: { type: 'string', required: true },
        country: { entity: 'Country' },
      },
    },
    Country: {
      key: ['iso'],
      properties: { iso: { type: 'string', required: true } },
    },
  },
});

describe('normalizeModel', () => {
  it('hands a 1.0-draft model back untouched', () => {
    const model = earlier();
    const before = structuredClone(model);
    expect(normalizeModel(model)).toBe(model);
    expect(model).toEqual(before);
  });

  it('reads a 1.0-draft-2 model as the same thing as its 1.0-draft form', () => {
    const current = toCurrentSpelling(earlier());
    expect(current).toMatchObject({
      modelspec: '1.0-draft-2',
      records: { Customer: { fields: { country: { record: 'Country' } } } },
    });
    expect(current).not.toHaveProperty('entities');
    const before = structuredClone(current);
    expect(normalizeModel(current)).toEqual(earlier());
    expect(current).toEqual(before);
  });

  it('hands any other identifier, or none, back untouched for the reader to refuse', () => {
    for (const model of [
      { ...earlier(), modelspec: '2.0' },
      { ...earlier(), modelspec: 1 },
      { entities: {}, records: {} },
    ])
      expect(normalizeModel(model)).toBe(model);
  });

  it.each(mixedVocabularies)('refuses %s', (_, mix) => {
    expect(() => normalizeModel(mix(earlier()))).toThrow(/other vocabulary/);
  });

  it('refuses an earlier-spelling document under the current identifier', () => {
    expect(() =>
      normalizeModel({ ...earlier(), modelspec: '1.0-draft-2' }),
    ).toThrow(/"entities"/);
  });
  it('refuses a current-spelling document under the earlier identifier', () => {
    expect(() =>
      normalizeModel({
        ...toCurrentSpelling(earlier()),
        modelspec: '1.0-draft',
      }),
    ).toThrow(/"records"/);
  });

  it('leaves malformed shapes for the readers to refuse with their own messages', () => {
    const base = { modelspec: '1.0-draft-2', module: {} };
    expect(normalizeModel(base)['entities']).toBeUndefined();
    expect(normalizeModel({ ...base, records: 'x' })['entities']).toBe('x');
    expect(
      normalizeModel({
        ...base,
        records: { A: 'x', B: { fields: 'y' }, C: {} },
      })['entities'],
    ).toEqual({
      A: 'x',
      B: { properties: 'y' },
      C: { properties: undefined },
    });
    expect(
      normalizeModel({ ...base, records: { A: { fields: { m: 1 } } } })[
        'entities'
      ],
    ).toEqual({ A: { properties: { m: 1 } } });
    expect(
      normalizeModel({
        modelspec: '1.0-draft',
        entities: {
          A: 'x',
          B: { properties: 'y' },
          C: { properties: { m: 1 } },
        },
      }),
    ).toMatchObject({ entities: { A: 'x' } });
    expect(
      normalizeModel({ modelspec: '1.0-draft', entities: 'x' })['entities'],
    ).toBe('x');
  });
});

describe('generated-index keys', () => {
  it('reads records and fields where present, else entities and properties, the newer key winning', () => {
    expect(indexedRecordTypes({ entities: ['a'] })).toEqual(['a']);
    expect(indexedRecordTypes({ records: ['b'] })).toEqual(['b']);
    expect(indexedRecordTypes({ records: ['b'], entities: ['a'] })).toEqual([
      'b',
    ]);
    expect(indexedRecordTypes({})).toBeUndefined();
    expect(indexedFields({ properties: ['a'] })).toEqual(['a']);
    expect(indexedFields({ fields: ['b'] })).toEqual(['b']);
    expect(indexedFields({ fields: ['b'], properties: ['a'] })).toEqual(['b']);
    expect(indexedFields({})).toBeUndefined();
  });
  it('reads modelRecordType where present, else modelEntity, the newer key winning', () => {
    expect(directoryRecordType({ modelEntity: 'A' })).toBe('A');
    expect(directoryRecordType({ modelRecordType: 'B' })).toBe('B');
    expect(
      directoryRecordType({ modelRecordType: 'B', modelEntity: 'A' }),
    ).toBe('B');
    expect(
      directoryRecordType({ modelRecordType: null, modelEntity: 'A' }),
    ).toBeNull();
    expect(directoryRecordType({})).toBeUndefined();
  });
});
