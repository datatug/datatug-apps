import type { MetadataObject } from './canonical-metadata';

/**
 * ModelSpec spells a model's JSON form in two vocabularies. `1.0-draft` has the
 * top-level key `entities`, `properties` on a record type and `entity` on a
 * member that refers to another record type; `1.0-draft-2` has `records`,
 * `fields` and `record`. The identifier decides which one a document is in, and
 * a document that carries the other vocabulary's key at any of the three levels
 * is refused, as the reference CLI refuses it.
 *
 * Every reader in this route reads the `1.0-draft` shape. `normalizeModel` hands
 * a `1.0-draft` document back untouched (after the refusal check), turns a
 * `1.0-draft-2` one into that shape, and hands any other identifier back
 * untouched for the reader's own identifier check.
 */
const EARLIER = {
  identifier: '1.0-draft',
  records: 'entities',
  fields: 'properties',
  reference: 'entity',
};
const CURRENT = {
  identifier: '1.0-draft-2',
  records: 'records',
  fields: 'fields',
  reference: 'record',
};

const isObject = (value: unknown): value is MetadataObject =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function refuse(holder: MetadataObject, key: string, identifier: string): void {
  if (Object.hasOwn(holder, key))
    throw new Error(
      `A ModelSpec ${identifier} model must not carry "${key}", a key of the other vocabulary.`,
    );
}

function renamed(value: unknown, from: string, to: string): unknown {
  if (!isObject(value) || !Object.hasOwn(value, from)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key === from ? to : key, v]),
  );
}
function mapValues(value: unknown, change: (v: unknown) => unknown): unknown {
  return isObject(value)
    ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, change(v)]))
    : value;
}

/** The model in the `1.0-draft` shape every reader of this route reads. */
export function normalizeModel(model: MetadataObject): MetadataObject {
  const own = [EARLIER, CURRENT].find(
    (v) => v.identifier === model['modelspec'],
  );
  if (!own) return model;
  const other = own === EARLIER ? CURRENT : EARLIER;
  refuse(model, other.records, own.identifier);
  const recordTypes = model[own.records];
  if (isObject(recordTypes))
    for (const record of Object.values(recordTypes)) {
      if (!isObject(record)) continue;
      refuse(record, other.fields, own.identifier);
      const members = record[own.fields];
      if (isObject(members))
        for (const member of Object.values(members))
          if (isObject(member)) refuse(member, other.reference, own.identifier);
    }
  if (own === EARLIER) return model;
  const converted = renamed(model, 'records', 'entities') as MetadataObject;
  return {
    ...converted,
    modelspec: EARLIER.identifier,
    entities: mapValues(converted['entities'], (record) => {
      const type = renamed(record, 'fields', 'properties');
      if (!isObject(type)) return type;
      return {
        ...type,
        properties: mapValues(type['properties'], (member) =>
          renamed(member, 'record', 'entity'),
        ),
      };
    }),
  };
}

/**
 * A generated index lists a model's record types as `records` (each with
 * `fields`) or, in the earlier spelling, as `entities` (each with `properties`).
 * The newer key wins where both are present.
 */
export function indexedRecordTypes(model: MetadataObject): unknown {
  return model['records'] !== undefined ? model['records'] : model['entities'];
}
export function indexedFields(record: MetadataObject): unknown {
  return record['fields'] !== undefined
    ? record['fields']
    : record['properties'];
}

/** The OpenVaultDB Directory key `modelRecordType`, or its earlier name `modelEntity`. */
export function directoryRecordType(recordset: MetadataObject): unknown {
  return recordset['modelRecordType'] !== undefined
    ? recordset['modelRecordType']
    : recordset['modelEntity'];
}
