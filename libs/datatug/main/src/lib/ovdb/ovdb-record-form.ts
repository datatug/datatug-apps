// Type-aware editing of one OVDB record: which input a field gets, how its value
// is shown, and how the typed text becomes the value sent in an update.
//
// - primary key fields and blobs are never editable;
// - decimals (NUMERIC/DECIMAL/MONEY) are edited as text and sent as text, so
//   `0.99` is not shown as `0.9899999…`; SQLite applies the column's affinity;
// - integers must be safe integers; REAL columns take any finite number;
// - a nullable field can be set to NULL; a NOT NULL one cannot.
import type { OvdbCollectionSchema, OvdbFieldSchema } from './ovdb-connection';

export type OvdbFieldKind = 'integer' | 'decimal' | 'number' | 'boolean' | 'text' | 'blob';

export interface OvdbFormField {
  readonly name: string;
  readonly kind: OvdbFieldKind;
  readonly declaredType: string;
  readonly nullable: boolean;
  readonly key: boolean;
  readonly editable: boolean;
  /** Why the field cannot be edited. */
  readonly lockedReason?: string;
  /** Digits after the point for a decimal declared like NUMERIC(10,2). */
  readonly scale?: number;
}

export interface OvdbFieldInput {
  readonly text: string;
  readonly isNull: boolean;
}

function isBlobValue(value: unknown): boolean {
  return (
    value instanceof Uint8Array ||
    (typeof value === 'object' && value !== null && !Array.isArray(value) && (value as { $type?: unknown }).$type === 'blob') ||
    // A Uint8Array that crossed JSON as {"0":…,"1":…}.
    (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0 && Object.keys(value).every((key) => /^\d+$/.test(key)))
  );
}

function kindOf(field: OvdbFieldSchema | undefined, value: unknown): OvdbFieldKind {
  if (isBlobValue(value)) return 'blob';
  switch (field?.type) {
    case 'integer':
      return 'integer';
    case 'decimal':
      return 'decimal';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'blob':
    case 'bytes':
      return 'blob';
    case 'string':
      return 'text';
  }
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'text';
}

function scaleOf(declaredType: string): number | undefined {
  const match = /\(\s*\d+\s*,\s*(\d+)\s*\)/.exec(declaredType);
  return match ? Number(match[1]) : undefined;
}

/** The fields of a record in schema order (then any extra fields the record carries). */
export function ovdbFormFields(
  schema: OvdbCollectionSchema | undefined,
  record: Readonly<Record<string, unknown>>,
): readonly OvdbFormField[] {
  const declared = Object.keys(schema?.fields ?? {});
  const names = [...declared, ...Object.keys(record).filter((name) => !declared.includes(name))];
  const primaryKey = schema?.primaryKey ?? [];
  return names.map((name): OvdbFormField => {
    const field = schema?.fields?.[name];
    const kind = kindOf(field, record[name]);
    const key = primaryKey.includes(name) || (field?.primaryKeyPosition ?? 0) > 0;
    const declaredType = field?.declaredType ?? field?.type ?? '';
    const lockedReason = key ? 'Primary key fields cannot be edited.' : kind === 'blob' ? 'Binary values cannot be edited here.' : undefined;
    const scale = kind === 'decimal' ? scaleOf(declaredType) : undefined;
    return {
      name,
      kind,
      declaredType,
      nullable: field?.notNull !== true && !key,
      key,
      editable: !lockedReason,
      ...(lockedReason ? { lockedReason } : {}),
      ...(scale === undefined ? {} : { scale }),
    };
  });
}

/** How a value is shown (and pre-filled in an input). */
export function formatOvdbValue(field: Pick<OvdbFormField, 'kind' | 'scale'>, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (field.kind === 'blob') {
    const base64 = (value as { $type?: unknown; base64?: unknown }).base64;
    const size =
      value instanceof Uint8Array
        ? value.byteLength
        : typeof base64 === 'string'
          ? Math.floor((base64.replace(/=+$/, '').length * 3) / 4)
          : typeof value === 'object'
            ? Object.keys(value as object).length
            : 0;
    return size ? `(binary, ${size} bytes)` : '(binary)';
  }
  if (field.kind === 'decimal' && typeof value === 'number' && field.scale !== undefined) return value.toFixed(field.scale);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** A value as shown read-only: NULL and the empty string get their own labels, so they differ from each other and from text. */
export interface OvdbDisplayValue {
  readonly text: string;
  /** `null` for NULL, `empty` for the empty string, `value` for anything else. */
  readonly kind: 'null' | 'empty' | 'value';
}

export const OVDB_NULL_LABEL = 'NULL';
export const OVDB_EMPTY_LABEL = '(empty)';

export function displayOvdbValue(field: Pick<OvdbFormField, 'kind' | 'scale'>, value: unknown): OvdbDisplayValue {
  if (value === null || value === undefined) return { text: OVDB_NULL_LABEL, kind: 'null' };
  if (value === '') return { text: OVDB_EMPTY_LABEL, kind: 'empty' };
  return { text: formatOvdbValue(field, value), kind: 'value' };
}

export function initialOvdbInput(field: OvdbFormField, value: unknown): OvdbFieldInput {
  return { text: formatOvdbValue(field, value), isNull: value === null || value === undefined };
}

export type OvdbParsedValue = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string };

/** The value to send for a field's input, or why the input is invalid. */
export function parseOvdbInput(field: OvdbFormField, input: OvdbFieldInput): OvdbParsedValue {
  if (input.isNull) {
    return field.nullable ? { ok: true, value: null } : { ok: false, error: `${field.name} is required.` };
  }
  const text = input.text.trim();
  switch (field.kind) {
    case 'integer': {
      if (!/^[-+]?\d+$/.test(text)) return { ok: false, error: `${field.name} must be a whole number.` };
      const value = Number(text);
      return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false, error: `${field.name} is too large.` };
    }
    case 'decimal':
      return /^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(text)
        ? { ok: true, value: text }
        : { ok: false, error: `${field.name} must be a decimal number, such as 1.99.` };
    case 'number': {
      const value = Number(text);
      return text !== '' && Number.isFinite(value) ? { ok: true, value } : { ok: false, error: `${field.name} must be a number.` };
    }
    case 'boolean':
      if (/^(true|1)$/i.test(text)) return { ok: true, value: true };
      if (/^(false|0)$/i.test(text)) return { ok: true, value: false };
      return { ok: false, error: `${field.name} must be true or false.` };
    case 'blob':
      return { ok: false, error: `${field.name} cannot be edited.` };
    default:
      return { ok: true, value: input.text };
  }
}

/**
 * The changed fields of an edit, or the validation errors. Only editable fields
 * whose input differs from the original value's input are included.
 */
export function ovdbRecordChanges(
  fields: readonly OvdbFormField[],
  original: Readonly<Record<string, unknown>>,
  inputs: Readonly<Record<string, OvdbFieldInput>>,
): { readonly changes: Record<string, unknown>; readonly errors: Record<string, string> } {
  const changes: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const input = inputs[field.name];
    if (!field.editable || !input) continue;
    const before = initialOvdbInput(field, original[field.name]);
    if (before.isNull === input.isNull && (input.isNull || before.text === input.text)) continue;
    const parsed = parseOvdbInput(field, input);
    if (parsed.ok) changes[field.name] = parsed.value;
    else errors[field.name] = parsed.error;
  }
  return { changes, errors };
}
