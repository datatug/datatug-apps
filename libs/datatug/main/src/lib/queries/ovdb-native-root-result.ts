import type { TypedValue } from '@sneat/datatug-semantic';
import type { IQueryDef } from '../models/definition/query-def';
import type { OvdbOrdinaryResult } from './ovdb-ordinary-result';
import { ovdbStreamRow, type OvdbResultColumn } from './ovdb-stream-values';

export interface NativeRootSource {
  readonly database: string;
  readonly name: string;
}

/** Root execution is admitted as one whole result, before any sink sees rows. */
export function validateNativeRootResult(
  result: OvdbOrdinaryResult,
  definition: IQueryDef,
  planned: readonly NativeRootSource[],
): { readonly columns: OvdbResultColumn[]; readonly rows: TypedValue[][] } {
  const execution = result.evidence['execution'] as Record<string, unknown>;
  const sources = execution['sources'];
  if (
    result.evidence['complete'] !== true ||
    result.evidence['nextCursor'] != null ||
    result.evidence['nextPageToken'] != null ||
    execution['route'] !== 'in-memory' ||
    !Number.isSafeInteger(execution['rowsReturned']) ||
    execution['rowsReturned'] !== result.records.length ||
    !Array.isArray(sources)
  )
    throw new Error(
      'OVDB cross-database result has invalid completion or execution evidence.',
    );
  const sourceKeys = sources.map((source: unknown) => {
    if (!source || typeof source !== 'object' || Array.isArray(source))
      throw new Error(
        'OVDB cross-database result has invalid physical sources.',
      );
    const entry = source as Record<string, unknown>;
    if (
      typeof entry['database'] !== 'string' ||
      !entry['database'] ||
      typeof entry['collection'] !== 'string' ||
      !entry['collection']
    )
      throw new Error(
        'OVDB cross-database result has invalid physical sources.',
      );
    return JSON.stringify([entry['database'], entry['collection']]);
  });
  const expected = [
    ...new Set(
      planned.map((source) => JSON.stringify([source.database, source.name])),
    ),
  ].sort();
  if (
    new Set(sourceKeys).size !== sourceKeys.length ||
    JSON.stringify(sourceKeys.sort()) !== JSON.stringify(expected)
  )
    throw new Error(
      'OVDB cross-database physical sources differ from the saved plan.',
    );
  const declared = definition.recordsets?.[0]?.columns;
  if (
    declared &&
    JSON.stringify(declared.map((column) => column.name)) !==
      JSON.stringify(result.columns)
  )
    throw new Error(
      'OVDB cross-database columns differ from the saved projection.',
    );
  const columns = result.columns.map((name): OvdbResultColumn => {
    const declaredType = declared?.find((column) => column.name === name)?.type;
    const types = new Set<string>();
    for (const record of result.records) {
      if (!Object.hasOwn(record.data, name))
        throw new Error(
          'OVDB cross-database record is missing a projected column.',
        );
      const value = record.data[name];
      if (value === null) continue;
      if (!['string', 'number', 'boolean'].includes(typeof value))
        throw new Error(
          'OVDB cross-database record has an unsupported scalar value.',
        );
      types.add(typeof value);
    }
    if (
      types.size > 1 &&
      (declaredType === undefined || declaredType === 'unknown')
    )
      throw new Error(
        'OVDB cross-database column has inconsistent value types.',
      );
    return {
      name,
      type: declaredType ?? [...types][0] ?? 'unknown',
    };
  });
  const rows = result.records.map((record) => {
    const row = ovdbStreamRow(record.data, columns);
    for (const [index, value] of row.entries()) {
      const declaredType = columns[index].type;
      if (
        value.type !== 'null' &&
        declaredType !== 'unknown' &&
        value.type !== declaredType
      )
        throw new Error(
          'OVDB cross-database value differs from its declared column type.',
        );
    }
    return row;
  });
  return { columns, rows };
}
