import {
  decodeTypedValue,
  evidenceObject,
  evidenceText,
  type HeldEvidenceIdentity,
  type Result,
  type RowEvidenceSelector,
  type TypedValue,
} from '@sneat/datatug-semantic';
import {
  decodeQueryComparison,
  validateQueryComparison,
  type QueryComparison,
} from '../queries/query-comparison';
import type { IQueryDef } from '../models/definition/query-def';

export interface RetainedComparison {
  readonly version: 1;
  readonly declaration: QueryComparison;
  readonly inputs: Readonly<Record<string, TypedValue>>;
  readonly queryId: string;
  readonly queryRevision: string;
  readonly manifestRef: string;
}
export const sameComparisonValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  ) ===
  JSON.stringify(b, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
export function comparisonInputs(
  value: unknown,
  declaration: QueryComparison,
): Readonly<Record<string, TypedValue>> {
  const names = [declaration.primaryInput, declaration.controlInput];
  const wire = evidenceObject(value, names);
  if (Object.keys(wire).length !== 2)
    throw new Error('Choose both explicit comparison inputs.');
  const inputs: Record<string, TypedValue> = Object.create(null);
  for (const name of names) {
    const cell = decodeTypedValue(wire[name]);
    if (
      cell.type !== 'integer' ||
      cell.value.length > 19 ||
      !/^[1-9][0-9]*$/.test(cell.value) ||
      BigInt(cell.value) > 9223372036854775807n
    )
      throw new Error(
        'Comparison requires positive signed64-bit scalar integers.',
      );
    inputs[name] = cell;
  }
  if (sameComparisonValue(inputs[names[0]], inputs[names[1]]))
    throw new Error('Choose two distinct comparison inputs.');
  return inputs;
}
export function frozenComparison(
  query: IQueryDef,
  inputs: unknown,
): QueryComparison | undefined {
  if (!Object.hasOwn(query, 'comparison')) return undefined;
  validateQueryComparison(query);
  const declaration = decodeQueryComparison(query.comparison);
  if (query.parameters?.length !== 2)
    throw new Error('Comparison requires exactly two declared inputs.');
  comparisonInputs(inputs, declaration);
  return declaration;
}
export function readRetainedComparison(
  value: unknown,
  expected: {
    queryId: string;
    queryRevision: string;
    manifestRef: string;
    result: Result;
    declaration?: QueryComparison;
    inputs?: unknown;
    primary?: TypedValue;
  },
): RetainedComparison | undefined {
  if (value === undefined) {
    if (expected.declaration)
      throw new Error('The server did not admit this comparison.');
    return undefined;
  }
  const wire = evidenceObject(value, [
    'version',
    'declaration',
    'inputs',
    'queryId',
    'queryRevision',
    'manifestRef',
  ]);
  if (Object.keys(wire).length !== 6 || wire['version'] !== 1)
    throw new Error('Unsupported retained comparison admission.');
  const declaration = decodeQueryComparison(wire['declaration']);
  // Version1 is the owning retained protocol, not a generic renderer/source grant.
  if (declaration.primaryInput !== 'order_id')
    throw new Error('Unsupported comparison primary binding.');
  const inputs = comparisonInputs(wire['inputs'], declaration);
  if (
    wire['queryId'] !== expected.queryId ||
    wire['queryRevision'] !== expected.queryRevision ||
    wire['manifestRef'] !== expected.manifestRef ||
    !expected.manifestRef ||
    (expected.declaration &&
      !sameComparisonValue(declaration, expected.declaration)) ||
    (expected.inputs &&
      !sameComparisonValue(
        inputs,
        comparisonInputs(expected.inputs, declaration),
      )) ||
    (expected.primary &&
      !sameComparisonValue(inputs[declaration.primaryInput], expected.primary))
  )
    throw new Error('Retained comparison does not match the frozen execution.');
  const result = expected.result,
    names = result.recordset.columns.map((c) => c.name),
    projection = declaration.projection;
  validateQueryComparison({
    comparison: declaration,
    parameters: [declaration.primaryInput, declaration.controlInput].map(
      (id) => ({ id, type: 'integer', isRequired: true }),
    ),
    recordsets: [{ columns: result.recordset.columns }],
  } as IQueryDef);
  if (
    !result.rowEvidence ||
    result.rowEvidence.rowKeyColumn !== projection.observationColumn
  )
    throw new Error('Retained comparison observation proof is unavailable.');
  const observations = new Set<string>(),
    lanes = new Map<string, TypedValue>();
  for (const row of result.recordset.rows) {
    const member = row[names.indexOf(projection.memberColumn)],
      observation = row[names.indexOf(projection.observationColumn)],
      lane = row[names.indexOf(projection.laneColumn)];
    if (
      !Object.values(inputs).some((input) =>
        sameComparisonValue(input, member),
      ) ||
      observation.type !== 'string' ||
      !observation.value ||
      lane.type !== 'string' ||
      !lane.value ||
      observations.has(observation.value) ||
      (lanes.has(lane.value) &&
        !sameComparisonValue(lanes.get(lane.value), member))
    )
      throw new Error('Retained comparison row identity is inconsistent.');
    observations.add(observation.value);
    lanes.set(lane.value, member);
  }
  return structuredClone({
    version: 1,
    declaration,
    inputs,
    queryId: evidenceText(wire['queryId']),
    queryRevision: evidenceText(wire['queryRevision']),
    manifestRef: evidenceText(wire['manifestRef']),
  });
}
export function comparisonEvidenceIdentity(
  admission: RetainedComparison,
): NonNullable<HeldEvidenceIdentity['comparison']> {
  return {
    members: [
      admission.inputs[admission.declaration.primaryInput],
      admission.inputs[admission.declaration.controlInput],
    ],
    projection: structuredClone(admission.declaration.projection),
  };
}
export function comparisonSelectedMember(
  admission: RetainedComparison,
  result: Result,
  selection: RowEvidenceSelector,
): TypedValue {
  const names = result.recordset.columns.map((c) => c.name),
    p = admission.declaration.projection;
  if (selection.rowKeyColumn !== p.observationColumn)
    throw new Error('Comparison observation selector mismatch.');
  const rows = result.recordset.rows.filter((row) =>
    sameComparisonValue(
      row[names.indexOf(p.observationColumn)],
      selection.rowKey,
    ),
  );
  if (rows.length !== 1)
    throw new Error('Comparison selected row is unavailable.');
  const member = rows[0][names.indexOf(p.memberColumn)];
  if (
    !Object.values(admission.inputs).some((input) =>
      sameComparisonValue(input, member),
    )
  )
    throw new Error('Comparison member is not admitted.');
  return member;
}
