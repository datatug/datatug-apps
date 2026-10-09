import { describe, expect, it } from 'vitest';
import {
  directoryRecordType,
  indexedFields,
  indexedRecordTypes,
  normalizeModel,
} from './model-vocabulary';
import {
  currentKeysUnderEarlier,
  mixedUnderCurrent,
  toCurrentSpelling,
  withPrototype,
} from './model-vocabulary.spec-helper';
import { strictJson } from './strict-json';
import type { MetadataObject } from './canonical-metadata';

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

  it.each(mixedUnderCurrent)('refuses %s', (_, mix) => {
    expect(() => normalizeModel(mix(earlier()))).toThrow(/earlier vocabulary/);
  });
  it.each(currentKeysUnderEarlier)(
    'hands a 1.0-draft model with %s back untouched, as it was read before',
    (_, add) => {
      const model = add(earlier());
      expect(normalizeModel(model)).toBe(model);
    },
  );
  it('hands a 1.0-draft identifier over the current keys back untouched', () => {
    const model = { ...toCurrentSpelling(earlier()), modelspec: '1.0-draft' };
    expect(normalizeModel(model)).toBe(model);
  });

  it('builds a model with no prototype at any level, like a parsed one', () => {
    // As the reader gives it: parsed by strictJson, so prototype-less to begin with.
    const parsed = strictJson(
      JSON.stringify(toCurrentSpelling(earlier())),
    ) as MetadataObject;
    expect(withPrototype(parsed)).toEqual([]);
    const converted = normalizeModel(parsed);
    expect(withPrototype(converted)).toEqual([]);
    // The harness itself sees a prototype where there is one.
    expect(withPrototype(earlier())).toContain('$');
    for (const name of [
      'constructor',
      'toString',
      'hasOwnProperty',
      'valueOf',
    ]) {
      expect(converted['entities'] as MetadataObject).not.toHaveProperty(name);
      expect(
        (
          (converted['entities'] as MetadataObject)[
            'Customer'
          ] as MetadataObject
        )['properties'],
      ).not.toHaveProperty(name);
      expect((converted as MetadataObject)[name]).toBeUndefined();
    }
  });
  it('keeps a __proto__ key as an own key, whatever the compile target', () => {
    const parsed = strictJson(
      '{"modelspec":"1.0-draft-2","module":{},"__proto__":{"x":1},' +
        '"records":{"__proto__":{"__proto__":1,"fields":{"__proto__":{"type":"string","record":"R"}}}}}',
    ) as MetadataObject;
    const converted = normalizeModel(parsed);
    expect(Object.hasOwn(converted, '__proto__')).toBe(true);
    const entities = converted['entities'] as MetadataObject;
    expect(Object.hasOwn(entities, '__proto__')).toBe(true);
    const type = entities['__proto__'] as MetadataObject;
    expect(Object.hasOwn(type, '__proto__')).toBe(true);
    const members = type['properties'] as MetadataObject;
    expect(Object.getPrototypeOf(members)).toBeNull();
    expect(members['__proto__']).toEqual({ type: 'string', entity: 'R' });
    expect(withPrototype(converted)).toEqual([]);
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
