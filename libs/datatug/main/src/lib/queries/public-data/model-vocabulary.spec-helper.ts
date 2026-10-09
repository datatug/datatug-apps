import type { MetadataObject } from './canonical-metadata';

const mapValues = (
  value: unknown,
  change: (v: MetadataObject) => MetadataObject,
): MetadataObject =>
  Object.fromEntries(
    Object.entries(value as MetadataObject).map(([k, v]) => [
      k,
      change(v as MetadataObject),
    ]),
  );
const rename = (
  value: MetadataObject,
  from: string,
  to: string,
): MetadataObject =>
  Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k === from ? to : k, v]),
  );
/** Applies `change` to every record type, then to every member of it, under the vocabulary's keys. */
const mapModel = (
  model: MetadataObject,
  [records, fields]: readonly [string, string],
  changeType: (type: MetadataObject) => MetadataObject,
  changeMember: (member: MetadataObject) => MetadataObject,
): MetadataObject => ({
  ...model,
  [records]: mapValues(model[records], (type) => {
    const changed = changeType(type);
    return { ...changed, [fields]: mapValues(changed[fields], changeMember) };
  }),
});
const same = <T>(value: T) => value;

/** What `modelspec rewrite --write` does to a `1.0-draft` JSON model. */
export function toCurrentSpelling(model: MetadataObject): MetadataObject {
  const { entities, modelspec, ...rest } = model;
  void modelspec;
  return mapModel(
    { ...rest, modelspec: '1.0-draft-2', records: entities },
    ['records', 'fields'],
    (type) => rename(type, 'properties', 'fields'),
    (member) => rename(member, 'entity', 'record'),
  );
}

type Edit = readonly [string, (model: MetadataObject) => MetadataObject];

/** Edits that turn a `1.0-draft` model into a `1.0-draft-2` one that mixes the vocabularies: refused. */
export const mixedUnderCurrent: readonly Edit[] = [
  [
    'the earlier keys under the current identifier',
    (m) => ({ ...m, modelspec: '1.0-draft-2' }),
  ],
  [
    'properties inside a current record type',
    (m) =>
      mapModel(
        toCurrentSpelling(m),
        ['records', 'fields'],
        (t) => ({ ...t, properties: {} }),
        same,
      ),
  ],
  [
    'entity on a current member',
    (m) =>
      mapModel(toCurrentSpelling(m), ['records', 'fields'], same, (f) => ({
        ...f,
        entity: 'X',
      })),
  ],
];

/** Edits that add a current-vocabulary key to a `1.0-draft` model: read exactly as before. */
export const currentKeysUnderEarlier: readonly Edit[] = [
  ['records beside entities', (m) => ({ ...m, records: {} })],
  [
    'fields in an earlier record type',
    (m) =>
      mapModel(
        m,
        ['entities', 'properties'],
        (t) => ({ ...t, fields: {} }),
        same,
      ),
  ],
  [
    'record on an earlier member',
    (m) =>
      mapModel(m, ['entities', 'properties'], same, (f) => ({
        ...f,
        record: 'X',
      })),
  ],
];

/** Every object in a value, however deep, that has a prototype. */
export function withPrototype(value: unknown, path = '$'): string[] {
  if (!value || typeof value !== 'object') return [];
  const own =
    Array.isArray(value) || Object.getPrototypeOf(value) === null ? [] : [path];
  return Object.entries(value).reduce(
    (found, [key, v]) => [...found, ...withPrototype(v, `${path}.${key}`)],
    own,
  );
}
