import { decodeTypedValue } from '@sneat/datatug-semantic';
import type { IncidentResolutionCriterion } from './models';
import type { AppliedEvidenceRequest } from '../evidence/applied-evidence';

export const criterionObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));
export const criterionID = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 512 &&
  v.trim() === v &&
  !/[\s\p{Cc}]/u.test(v);
export const criterionSegment = (v: unknown): v is string =>
  criterionID(v) && v !== '.' && v !== '..' && !/[\\/]/.test(v);
export const criterionVersion = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
export function isIncidentResolutionCriterion(
  v: unknown,
): v is IncidentResolutionCriterion {
  if (
    !criterionObject(v) ||
    !keys(v, [
      'version',
      'finalized',
      'finalizedAt',
      'enforcement',
      'scope',
      'checkID',
      'checkVersion',
      'definitionDigest',
      'maxAgeSeconds',
    ]) ||
    !criterionVersion(v['version']) ||
    typeof v['finalized'] !== 'boolean' ||
    v['enforcement'] !== 'required' ||
    !criterionSegment(v['checkID']) ||
    !criterionVersion(v['checkVersion']) ||
    typeof v['definitionDigest'] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v['definitionDigest']) ||
    !criterionVersion(v['maxAgeSeconds']) ||
    v['maxAgeSeconds'] > 86400
  )
    return false;
  if (v['finalized'] !== Object.hasOwn(v, 'finalizedAt')) return false;
  if (
    v['finalized'] &&
    (typeof v['finalizedAt'] !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(
        v['finalizedAt'],
      ) ||
      !Number.isFinite(Date.parse(v['finalizedAt'])) ||
      new Date(v['finalizedAt']).toISOString().slice(0, 19) !==
        v['finalizedAt'].slice(0, 19) ||
      v['finalizedAt'].startsWith('0001-'))
  )
    return false;
  const scope = v['scope'];
  if (
    !criterionObject(scope) ||
    !keys(scope, [
      'project',
      'sourceID',
      'generation',
      'affectedInputs',
      'sessionRef',
      'bagID',
      'appliedManifestRef',
    ]) ||
    ![
      'sourceID',
      'generation',
      'sessionRef',
      'bagID',
      'appliedManifestRef',
    ].every((k) => criterionID(scope[k]))
  )
    return false;
  const project = scope['project'];
  if (
    !criterionObject(project) ||
    !keys(project, ['storeId', 'projectId', 'environment']) ||
    !['storeId', 'projectId', 'environment'].every((k) =>
      criterionSegment(project[k]),
    )
  )
    return false;
  const inputs = scope['affectedInputs'];
  if (
    !criterionObject(inputs) ||
    !Object.keys(inputs).length ||
    Object.keys(inputs).length > 32
  )
    return false;
  try {
    for (const [name, value] of Object.entries(inputs)) {
      if (!criterionID(name)) return false;
      decodeTypedValue(value);
    }
  } catch {
    return false;
  }
  return true;
}
export function isCriterionEvidence(
  v: unknown,
  incidentRef: string,
  environment: string,
): v is AppliedEvidenceRequest {
  if (
    !criterionObject(v) ||
    !keys(v, ['retention', 'incidentRef', 'caseId', 'context']) ||
    v['retention'] !== 'project-pinned' ||
    v['incidentRef'] !== incidentRef ||
    ('caseId' in v && !criterionID(v['caseId']))
  )
    return false;
  const c = v['context'];
  if (
    !criterionObject(c) ||
    !keys(c, [
      'sessionId',
      'expectedSessionVersion',
      'expectedContextSetId',
      'scope',
      'bindings',
    ]) ||
    !criterionID(c['sessionId']) ||
    !criterionVersion(c['expectedSessionVersion']) ||
    !criterionID(c['expectedContextSetId'])
  )
    return false;
  const s = c['scope'],
    b = c['bindings'];
  return (
    criterionObject(s) &&
    keys(s, ['environmentId', 'identityDomain']) &&
    s['environmentId'] === environment &&
    criterionID(s['identityDomain']) &&
    Array.isArray(b) &&
    b.length === 1 &&
    criterionObject(b[0]) &&
    keys(b[0], ['inputName', 'entryId', 'revisionId']) &&
    b[0]['inputName'] === 'order_id' &&
    criterionID(b[0]['entryId']) &&
    criterionID(b[0]['revisionId'])
  );
}
