/** JSON metadata supported by the common Core query save DTO, never execution authority. */
type JSONValue =
  | null
  | boolean
  | string
  | number
  | readonly JSONValue[]
  | { readonly [key: string]: JSONValue };
interface FieldMeta {
  readonly entity?: string | null;
  readonly field?: string | null;
}
interface ParameterLookup {
  readonly db?: string | null;
  readonly sql?: string | null;
  readonly keyFields?: readonly string[] | null;
}
export interface ProjectQueryParameterWire {
  readonly id: string;
  readonly type: string;
  readonly title?: string | null;
  readonly defaultValue?: JSONValue;
  readonly isRequired?: boolean | null;
  readonly isMultiValue?: boolean | null;
  readonly maxLength?: number | null;
  readonly minLength?: number | null;
  readonly meta?: FieldMeta | null;
  readonly lookup?: ParameterLookup | null;
}
interface ProjectQueryColumnWire {
  readonly name?: string | null;
  readonly type?: string | null;
  readonly required?: boolean | null;
  readonly meta?: FieldMeta | null;
  readonly hideIf?: { readonly parameters?: readonly string[] | null } | null;
}
/** QueryDef does not call standalone Recordset.Validate: ID/title/type are optional here. */
export interface ProjectQueryRecordsetWire {
  readonly id?: string | null;
  readonly title?: string | null;
  readonly folder?: string | null;
  readonly tags?: readonly string[] | null;
  readonly userIds?: readonly string[] | null;
  readonly access?: string | null;
  readonly type?: string | null;
  readonly columns?: readonly ProjectQueryColumnWire[] | null;
}
export interface ProjectQueryMetadataWire {
  readonly parameters?: readonly ProjectQueryParameterWire[] | null;
  readonly recordsets?: readonly ProjectQueryRecordsetWire[] | null;
}
function invalid(): never {
  throw new Error('Query metadata cannot be saved losslessly by this client.');
}
function object(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    invalid();
  return value as Record<string, unknown>;
}
function optional(
  value: unknown,
  type: 'string' | 'boolean' | 'integer',
): void {
  if (value === undefined || value === null) return;
  if (
    type === 'integer'
      ? typeof value !== 'number' || !Number.isSafeInteger(value)
      : typeof value !== type
  )
    invalid();
}
function dense(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    Object.keys(value).length === value.length &&
    Object.keys(value).every((key, index) => key === String(index))
  );
}
function strings(value: unknown): void {
  if (value === undefined || value === null) return;
  if (!dense(value) || value.some((item) => typeof item !== 'string'))
    invalid();
}
function fields(value: unknown): void {
  if (value === undefined || value === null) return;
  const o = object(value, ['entity', 'field']);
  optional(o['entity'], 'string');
  optional(o['field'], 'string');
}
function json(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid();
    return;
  }
  if (!value || typeof value !== 'object' || ancestors.has(value)) invalid();
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (!dense(value)) invalid();
    for (const child of value) json(child, ancestors);
  } else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      invalid();
    for (const child of Object.values(value)) json(child, ancestors);
  }
  ancestors.delete(value);
}
function parameters(
  value: unknown,
): asserts value is readonly ProjectQueryParameterWire[] | null | undefined {
  if (value === undefined || value === null) return;
  if (!dense(value)) invalid();
  for (const item of value) {
    const o = object(item, [
      'id',
      'type',
      'title',
      'defaultValue',
      'isRequired',
      'isMultiValue',
      'maxLength',
      'minLength',
      'meta',
      'lookup',
    ]);
    if (
      typeof o['id'] !== 'string' ||
      !o['id'] ||
      typeof o['type'] !== 'string' ||
      !o['type']
    )
      invalid();
    optional(o['title'], 'string');
    optional(o['isRequired'], 'boolean');
    optional(o['isMultiValue'], 'boolean');
    optional(o['maxLength'], 'integer');
    optional(o['minLength'], 'integer');
    fields(o['meta']);
    if (o['lookup'] !== undefined && o['lookup'] !== null) {
      const lookup = object(o['lookup'], ['db', 'sql', 'keyFields']);
      optional(lookup['db'], 'string');
      optional(lookup['sql'], 'string');
      strings(lookup['keyFields']);
    }
    if (Object.hasOwn(o, 'defaultValue')) {
      const defaultValue = o['defaultValue'];
      json(defaultValue);
      if (defaultValue !== null) {
        switch (o['type']) {
          case 'string':
            if (typeof defaultValue !== 'string') invalid();
            break;
          case 'integer':
          case 'bit':
            if (
              typeof defaultValue !== 'number' ||
              !Number.isSafeInteger(defaultValue)
            )
              invalid();
            break;
          case 'number':
            if (typeof defaultValue !== 'number') invalid();
            break;
          case 'boolean':
            if (typeof defaultValue !== 'boolean') invalid();
            break;
        }
      }
    }
  }
}
function recordsets(
  value: unknown,
): asserts value is readonly ProjectQueryRecordsetWire[] | null | undefined {
  if (value === undefined || value === null) return;
  if (!dense(value)) invalid();
  for (const item of value) {
    const o = object(item, [
      'id',
      'title',
      'folder',
      'tags',
      'userIds',
      'access',
      'type',
      'columns',
    ]);
    for (const field of ['id', 'title', 'folder', 'access', 'type'])
      optional(o[field], 'string');
    strings(o['tags']);
    strings(o['userIds']);
    if (o['columns'] !== undefined && o['columns'] !== null) {
      if (!dense(o['columns'])) invalid();
      for (const column of o['columns']) {
        const c = object(column, [
          'name',
          'type',
          'required',
          'meta',
          'hideIf',
        ]);
        optional(c['name'], 'string');
        optional(c['type'], 'string');
        optional(c['required'], 'boolean');
        fields(c['meta']);
        if (c['hideIf'] !== undefined && c['hideIf'] !== null)
          strings(object(c['hideIf'], ['parameters'])['parameters']);
      }
    }
  }
}
/** Validate the full supported nested shape, then clone it without dropping any fields. */
export function projectQueryMetadataForSave(
  query: object,
): ProjectQueryMetadataWire {
  const source = query as Record<string, unknown>;
  const p = source['parameters'],
    r = source['recordsets'];
  parameters(p);
  recordsets(r);
  return structuredClone({
    ...(Object.hasOwn(source, 'parameters') ? { parameters: p } : {}),
    ...(Object.hasOwn(source, 'recordsets') ? { recordsets: r } : {}),
  });
}
