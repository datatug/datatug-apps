import {
  criterionObject,
  criterionID,
  criterionNativeID,
  criterionVersion,
  isCriterionEvidence,
} from '../incidents/resolution-criterion';
import type { HostedCriterionAction } from './hosted-linkage.models';
import { decodeEvidenceArtifactRef } from '@sneat/datatug-semantic';
import type {
  IncidentCharacterID,
  IncidentNotePresentation,
} from '../incidents/models';
import type {
  HostedIncidentMessage,
  IncidentMessagePresentationCapability,
} from './hosted-linkage.models';

export const INCIDENT_CHARACTERS: readonly IncidentCharacterID[] = [
  'sarah',
  'maya',
  'daniel',
];
export type PendingCriterion = {
  operationId: string;
  expectedSeq: number;
  action: HostedCriterionAction;
  message?: never;
};
export type PendingIncidentOperation =
  | PendingIncidentMessage
  | PendingCriterion;
export type PendingIncidentMessage = {
  action?: never;
  operationId: string;
  expectedSeq: number;
  message: HostedIncidentMessage;
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

export function isIncidentNotePresentation(
  value: unknown,
): value is IncidentNotePresentation {
  return (
    object(value) &&
    keys(value, ['kind', 'characterId']) &&
    value['kind'] === 'demo-character' &&
    INCIDENT_CHARACTERS.some((id) => id === value['characterId'])
  );
}
export function incidentCharacterLabel(id: IncidentCharacterID): string {
  return id === 'sarah' ? 'Sarah' : id === 'maya' ? 'Maya' : 'Daniel';
}
export function admittedMessagePresentation(
  value: unknown,
): IncidentMessagePresentationCapability | undefined {
  if (!object(value)) return undefined;
  if (value['status'] === 'not-eligible' || value['status'] === 'unavailable')
    return keys(value, ['status']) ? { status: value['status'] } : undefined;
  const ids = value['characterIds'];
  if (
    !keys(value, ['status', 'kind', 'characterIds']) ||
    value['status'] !== 'available' ||
    value['kind'] !== 'demo-character' ||
    !Array.isArray(ids) ||
    ids.length !== 3 ||
    !INCIDENT_CHARACTERS.every((id, index) => ids[index] === id)
  )
    return undefined;
  return {
    status: 'available',
    kind: 'demo-character',
    characterIds: ['sarah', 'maya', 'daniel'],
  };
}
export function isPendingIncidentMessage(
  value: unknown,
): value is PendingIncidentMessage {
  if (
    !object(value) ||
    !keys(value, ['operationId', 'expectedSeq', 'message']) ||
    typeof value['operationId'] !== 'string' ||
    !value['operationId'].startsWith('operation-') ||
    value['operationId'].length > 128 ||
    /[^A-Za-z0-9_-]/.test(value['operationId']) ||
    !Number.isSafeInteger(value['expectedSeq']) ||
    (value['expectedSeq'] as number) < 1
  )
    return false;
  const message = value['message'];
  if (
    !object(message) ||
    !keys(message, ['body', 'assertion', 'refs', 'presentation']) ||
    typeof message['body'] !== 'string' ||
    !message['body'].trim() ||
    new TextEncoder().encode(message['body']).length > 4000
  )
    return false;
  if (
    'assertion' in message &&
    !['claim', 'question', 'hypothesis', 'observation', 'inference'].includes(
      message['assertion'] as string,
    )
  )
    return false;
  if (
    'presentation' in message &&
    !isIncidentNotePresentation(message['presentation'])
  )
    return false;
  if ('refs' in message) {
    if (!Array.isArray(message['refs']) || message['refs'].length > 20)
      return false;
    try {
      for (const ref of message['refs']) decodeEvidenceArtifactRef(ref);
    } catch {
      return false;
    }
  }
  // Validate the stored object without rebuilding/coercing its optional fields.
  return true;
}

export function isHostedCriterionAction(
  value: unknown,
): value is HostedCriterionAction {
  if (
    !criterionObject(value) ||
    !criterionID(value['incidentRef']) ||
    !criterionNativeID(value['environment']) ||
    !criterionVersion(value['expectedSeq'])
  )
    return false;
  if (value['type'] === 'criterion-finalize')
    return (
      keys(value, [
        'type',
        'incidentRef',
        'environment',
        'expectedSeq',
        'criterionVersion',
      ]) && criterionVersion(value['criterionVersion'])
    );
  const c = value['criterion'];
  return (
    value['type'] === 'criterion-draft' &&
    keys(value, [
      'type',
      'incidentRef',
      'environment',
      'expectedSeq',
      'criterion',
      'evidence',
    ]) &&
    criterionObject(c) &&
    keys(c, ['version', 'checkID', 'maxAgeSeconds']) &&
    criterionVersion(c['version']) &&
    criterionNativeID(c['checkID']) &&
    criterionVersion(c['maxAgeSeconds']) &&
    c['maxAgeSeconds'] <= 86400 &&
    isCriterionEvidence(
      value['evidence'],
      value['incidentRef'],
      value['environment'],
    )
  );
}
export function isPendingIncidentOperation(
  value: unknown,
): value is PendingIncidentOperation {
  if (isPendingIncidentMessage(value)) return true;
  return (
    criterionObject(value) &&
    keys(value, ['operationId', 'expectedSeq', 'action']) &&
    typeof value['operationId'] === 'string' &&
    /^operation-[A-Za-z0-9_-]+$/.test(value['operationId']) &&
    value['operationId'].length <= 128 &&
    criterionVersion(value['expectedSeq']) &&
    isHostedCriterionAction(value['action']) &&
    value['action'].expectedSeq === value['expectedSeq']
  );
}
