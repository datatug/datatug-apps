import { decodeTypedValue, type TypedValue } from '@sneat/datatug-semantic';
import type { IQueryDef } from '../models/definition/query-def';

export interface OvdbResultColumn {
  readonly name: string;
  readonly type: string;
}

/** The server owns column order. Saved projection metadata can describe known
 * types but may not invent columns or reinterpret unknown strings. */
export function ovdbResultColumns(names: readonly string[], definition: IQueryDef): OvdbResultColumn[] {
  const declared = new Map(definition.recordsets?.[0]?.columns.map((column) => [column.name, column.type] as const) ?? []);
  return names.map((name) => ({ name, type: declared.get(name) ?? 'unknown' }));
}

export function ovdbStreamCell(value: unknown, declaredType = 'unknown'): TypedValue {
  if (value === null || value === undefined) return { type: 'null', value: null };
  if (typeof value === 'boolean') return { type: 'boolean', value };
  if (typeof value === 'string') {
    if (['integer', 'decimal', 'date', 'datetime'].includes(declaredType))
      return decodeTypedValue({ type: declaredType, value });
    // BYTEA remains an opaque base64 string: this wire carries no binary type
    // marker, and guessing from a string would mislabel ordinary text.
    return { type: 'string', value };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (declaredType === 'decimal')
      throw new Error('OVDB returned an unquoted exact decimal.');
    if (declaredType === 'integer') {
      if (!Number.isSafeInteger(value)) throw new Error('OVDB returned an unsafe integer.');
      return { type: 'integer', value: String(value) };
    }
    return { type: 'number', value };
  }
  if (typeof value === 'object') return { type: 'string', value: JSON.stringify(value) };
  throw new Error('OVDB returned a value that cannot be shown in this result.');
}

export function ovdbStreamRow(data: Readonly<Record<string, unknown>>, columns: readonly OvdbResultColumn[]): TypedValue[] {
  return columns.map((column) => ovdbStreamCell(Object.hasOwn(data, column.name) ? data[column.name] : null, column.type));
}
