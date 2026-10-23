import {
  decodeEvidenceArtifactRef,
  decodeTypedValue,
  type ArtifactRef,
} from '@sneat/datatug-semantic';
import type { IncidentResolutionCriterion, IncidentResolution } from './models';
import {
  criterionObject,
  criterionVersion,
  isIncidentResolutionScope,
} from './resolution-criterion';

export const sameResolutionValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameResolutionValue(item, b[index]))
    );
  if (!criterionObject(a) || !criterionObject(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) => Object.hasOwn(b, key) && sameResolutionValue(a[key], b[key]),
    )
  );
};
function exact(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    criterionObject(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function resolutionInstant(value: unknown): bigint | undefined {
  try {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value) ||
      value.startsWith('0001-')
    )
      return undefined;
    decodeTypedValue({ type: 'datetime', value });
    const [whole, fraction = ''] = value.slice(0, -1).split('.');
    return (
      BigInt(Date.parse(whole + 'Z')) * 1000000n +
      BigInt(fraction.padEnd(9, '0'))
    );
  } catch {
    return undefined;
  }
}
export function isIncidentResolution(
  value: unknown,
): value is IncidentResolution {
  try {
    if (
      !exact(value, ['humanNote', 'proof']) ||
      typeof value['humanNote'] !== 'string' ||
      !value['humanNote'].trim() ||
      new TextEncoder().encode(value['humanNote']).length > 4000 ||
      JSON.stringify(value).length > 131072
    )
      return false;
    const proof = value['proof'];
    if (
      !exact(proof, [
        'definitionDigest',
        'criterionVersion',
        'scope',
        'run',
        'evaluatedAt',
        'outcome',
        'observationRefs',
        'recoveryRefs',
      ]) ||
      typeof proof['definitionDigest'] !== 'string' ||
      !/^[a-f0-9]{64}$/.test(proof['definitionDigest']) ||
      !criterionVersion(proof['criterionVersion']) ||
      !isIncidentResolutionScope(proof['scope']) ||
      proof['outcome'] !== 'pass' ||
      resolutionInstant(proof['evaluatedAt']) === undefined
    )
      return false;
    decodeEvidenceArtifactRef({ kind: 'check-run', checkRun: proof['run'] });
    for (const key of ['observationRefs', 'recoveryRefs']) {
      const refs = proof[key];
      if (!Array.isArray(refs) || !refs.length || refs.length > 1024)
        return false;
      for (const ref of refs) decodeEvidenceArtifactRef(ref);
    }
    return true;
  } catch {
    return false;
  }
}
/** Checks a server-admitted historical proof against its immutable criterion, never against today's clock. */
export function resolutionMatchesCriterion(
  value: IncidentResolution,
  criterion: IncidentResolutionCriterion,
): boolean {
  const proof = value.proof;
  return (
    criterion.finalized &&
    proof.criterionVersion === criterion.version &&
    proof.definitionDigest === criterion.definitionDigest &&
    sameResolutionValue(proof.scope, criterion.scope) &&
    proof.run.storeId === criterion.scope.project.storeId &&
    proof.run.projectId === criterion.scope.project.projectId &&
    proof.run.environment === criterion.scope.project.environment &&
    proof.run.checkId === criterion.checkID &&
    proof.run.checkVersion === criterion.checkVersion &&
    (resolutionInstant(proof.evaluatedAt) ?? -1n) >=
      (resolutionInstant(criterion.finalizedAt) ?? 0n)
  );
}
export function resolutionRefs(
  value: IncidentResolution,
): readonly ArtifactRef[] {
  return [
    { kind: 'check-run', checkRun: value.proof.run },
    ...value.proof.observationRefs,
    ...value.proof.recoveryRefs,
  ];
}
