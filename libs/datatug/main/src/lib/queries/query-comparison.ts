import type { IQueryDef } from '../models/definition/query-def';

/** Core70 declaration only; never retained comparison authority or physical lineage. */
export interface QueryComparison {
  readonly kind: 'pair';
  readonly primaryInput: string;
  readonly controlInput: string;
  readonly projection: Readonly<Record<ComparisonRole, string>>;
}
export const comparisonRoles = [
  'memberColumn',
  'observationColumn',
  'laneColumn',
  'eventColumn',
  'sequenceColumn',
  'timeColumn',
  'clockDomainColumn',
  'precisionColumn',
  'statusColumn',
  'anchorColumn',
] as const;
export type ComparisonRole = (typeof comparisonRoles)[number];
const object = (
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new Error('Invalid comparison declaration');
  return value as Record<string, unknown>;
};
const identifier = (value: unknown, input = false): string => {
  if (
    typeof value !== 'string' ||
    !value ||
    value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '') !== value ||
    new TextEncoder().encode(value).length > 200 ||
    /\p{Cc}|[\uD800-\uDFFF]/u.test(value) ||
    (input && /[:="]/u.test(value))
  )
    throw new Error('Invalid comparison role or input');
  return value;
};
export function decodeQueryComparison(value: unknown): QueryComparison {
  const o = object(value, [
    'kind',
    'primaryInput',
    'controlInput',
    'projection',
  ]);
  if (o['kind'] !== 'pair') throw new Error('Unsupported comparison kind');
  const primaryInput = identifier(o['primaryInput'], true),
    controlInput = identifier(o['controlInput'], true);
  if (primaryInput === controlInput)
    throw new Error('Comparison inputs must differ');
  const projection = object(o['projection'], comparisonRoles);
  const columns = comparisonRoles.map((role) => identifier(projection[role]));
  if (new Set(columns).size !== columns.length)
    throw new Error('Comparison roles must differ');
  return structuredClone({
    kind: 'pair',
    primaryInput,
    controlInput,
    projection,
  }) as QueryComparison;
}
export function validateQueryComparison(query: IQueryDef): void {
  if (!Object.hasOwn(query, 'comparison')) return;
  const declaration = decodeQueryComparison(query.comparison);
  const parameters = query.parameters;
  if (
    !Array.isArray(parameters) ||
    new Set(parameters.map((p) => p.id)).size !== parameters.length
  )
    throw new Error('Comparison requires distinct declared parameters');
  for (const id of [declaration.primaryInput, declaration.controlInput]) {
    const parameter = parameters.find((p) => p.id === id);
    if (
      !parameter ||
      parameter.type !== 'integer' ||
      parameter.isRequired !== true ||
      (parameter.isMultiValue !== undefined &&
        typeof parameter.isMultiValue !== 'boolean') ||
      parameter?.isMultiValue === true
    )
      throw new Error('Comparison inputs must be required scalar integers');
  }
  if (
    !Array.isArray(query.recordsets) ||
    query.recordsets.length !== 1 ||
    !Array.isArray(query.recordsets[0]?.columns)
  )
    throw new Error('Comparison requires one declared recordset');
  const columns = query.recordsets[0].columns;
  if (new Set(columns.map((c) => c.name)).size !== columns.length)
    throw new Error('Duplicate comparison result columns');
  for (const role of comparisonRoles) {
    const type = [
      'memberColumn',
      'sequenceColumn',
      'precisionColumn',
      'anchorColumn',
    ].includes(role)
      ? 'integer'
      : 'string';
    if (
      columns.find((c) => c.name === declaration.projection[role])?.type !==
      type
    )
      throw new Error(
        'Comparison role has missing or incompatible result column',
      );
  }
}
