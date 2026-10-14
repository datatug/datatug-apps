import type { MetadataObject } from './canonical-metadata';

/**
 * ModelSpec spells a model's JSON form in two vocabularies. `1.0-draft` has the
 * top-level key `entities`, `properties` on a record type and `entity` on a
 * member that refers to another record type; `1.0-draft-2` has `records`,
 * `fields` and `record`.
 *
 * Every reader in this route reads the `1.0-draft` shape. `normalizeModel`
 * hands back, untouched and unexamined, any document whose identifier is not
 * `1.0-draft-2` (so every document read before this vocabulary existed behaves
 * exactly as it did, and the readers' own identifier checks still apply). A
 * `1.0-draft-2` document that carries the earlier vocabulary's key at the top
 * level, on a record type or on a member is refused, as the reference CLI
 * refuses it; any other is rebuilt in the `1.0-draft` shape.
 *
 * The rebuilt objects have no prototype, like the objects `strictJson`
 * parses: a lookup of a name the model does not declare (`constructor`,
 * `toString`, ...) must find nothing.
 */
const CURRENT = '1.0-draft-2';

const isObject = (value: unknown): value is MetadataObject =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function bare(entries: [string, unknown][]): MetadataObject {
  const result: MetadataObject = Object.create(null);
  for (const [key, value] of entries) result[key] = value;
  return result;
}
function refuse(holder: MetadataObject, key: string): void {
  if (Object.hasOwn(holder, key))
    throw new Error(
      `A ModelSpec ${CURRENT} model must not carry "${key}", a key of the earlier vocabulary.`,
    );
}
function renamed(value: unknown, from: string, to: string): unknown {
  if (!isObject(value) || !Object.hasOwn(value, from)) return value;
  return bare(
    Object.entries(value).map(([key, v]) => [key === from ? to : key, v]),
  );
}
function mapValues(value: unknown, change: (v: unknown) => unknown): unknown {
  return isObject(value)
    ? bare(Object.entries(value).map(([k, v]) => [k, change(v)]))
    : value;
}

/** The model in the `1.0-draft` shape every reader of this route reads. */
export function normalizeModel(model: MetadataObject): MetadataObject {
  if (model['modelspec'] !== CURRENT) return model;
  refuse(model, 'entities');
  const recordTypes = model['records'];
  if (isObject(recordTypes))
    for (const record of Object.values(recordTypes)) {
      if (!isObject(record)) continue;
      refuse(record, 'properties');
      const members = record['fields'];
      if (isObject(members))
        for (const member of Object.values(members))
          if (isObject(member)) refuse(member, 'entity');
    }
  const converted = renamed(model, 'records', 'entities') as MetadataObject;
  return bare([
    ...Object.entries(converted),
    ['modelspec', '1.0-draft'],
    [
      'entities',
      mapValues(converted['entities'], (record) => {
        const type = renamed(record, 'fields', 'properties');
        if (!isObject(type)) return type;
        return bare([
          ...Object.entries(type),
          [
            'properties',
            mapValues(type['properties'], (member) =>
              renamed(member, 'record', 'entity'),
            ),
          ],
        ]);
      }),
    ],
  ]);
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
