import { decodeEvidenceArtifactRef } from '@sneat/datatug-semantic';
import {
  criterionObject,
  criterionSegment,
  criterionNativeID,
  criterionVersion,
} from '../incidents/resolution-criterion';
import {
  isIncidentResolution,
  resolutionInstant,
  resolutionMatchesCriterion,
  resolutionRefs,
  sameResolutionValue,
} from '../incidents/resolution-proof';
import type { DetectiveRequestContext } from './detective-client.service';
import type {
  HostedIncidentResponse,
  HostedResolveAction,
} from './hosted-linkage.models';
import {
  validateHostedCriterionEvent,
  validateHostedCriterionView,
} from './hosted-criterion-contract';
type Cloud = Extract<DetectiveRequestContext, { kind: 'cloud' }>;
export function isHostedResolveAction(
  value: unknown,
): value is HostedResolveAction {
  try {
    const keys = [
      'type',
      'incidentRef',
      'environment',
      'expectedSeq',
      'criterionVersion',
      'run',
      'recovery',
      'humanNote',
    ];
    if (
      !criterionObject(value) ||
      Object.keys(value).length !== keys.length ||
      !keys.every((key) => Object.hasOwn(value, key)) ||
      value['type'] !== 'resolve' ||
      typeof value['incidentRef'] !== 'string' ||
      value['incidentRef'].split('/').length !== 2 ||
      !value['incidentRef'].split('/').every(criterionSegment) ||
      !criterionNativeID(value['environment']) ||
      !criterionVersion(value['expectedSeq']) ||
      !criterionVersion(value['criterionVersion']) ||
      typeof value['humanNote'] !== 'string' ||
      !value['humanNote'].trim() ||
      new TextEncoder().encode(value['humanNote']).length > 4000
    )
      return false;
    decodeEvidenceArtifactRef({ kind: 'check-run', checkRun: value['run'] });
    decodeEvidenceArtifactRef({
      kind: 'source-operation',
      sourceOperation: value['recovery'],
    });
    return JSON.stringify(value).length <= 65536;
  } catch {
    return false;
  }
}
export function validateHostedResolveScope(
  action: HostedResolveAction,
  context: Cloud,
): void {
  if (
    !isHostedResolveAction(action) ||
    action.run.storeId !== context.storage ||
    action.run.projectId !== context.project ||
    action.run.environment !== action.environment ||
    action.recovery.storeId !== context.storage ||
    action.recovery.spaceID !== context.spaceID ||
    action.recovery.projectId !== context.project ||
    action.recovery.receiptActorId !== context.principal
  )
    throw new Error(
      'The selected Resolve intent differs from the current account or project.',
    );
}
export function validateHostedResolveSuccess(
  result: HostedIncidentResponse,
  action: HostedResolveAction,
  context: Cloud,
  operationId: string,
): void {
  if (
    !criterionObject(result) ||
    Object.keys(result).some(
      (key) => !['event', 'incident', 'receipt', 'replayed'].includes(key),
    ) ||
    ('replayed' in result && typeof result.replayed !== 'boolean') ||
    JSON.stringify(result).length > 262144 ||
    result.receipt !== operationId
  )
    throw new Error(
      'The exact Resolve receipt is unavailable. Retry the original operation.',
    );
  validateHostedResolveScope(action, context);
  validateHostedCriterionView(
    result.incident,
    action.incidentRef,
    context,
    action.environment,
  );
  const event = result.event,
    criterion = result.incident.resolutionCriterion,
    resolution = result.incident.resolution;
  if (!event || event.type !== 'incident.resolved')
    throw new Error('Missing Resolve receipt event.');
  validateHostedCriterionEvent(
    event,
    action.incidentRef,
    context,
    action.environment,
  );
  if (
    !criterion ||
    !resolution ||
    !isIncidentResolution(event.payload) ||
    !resolutionMatchesCriterion(resolution, criterion) ||
    result.incident.status !== 'resolved' ||
    event.actor.kind !== 'human' ||
    event.actor.id !== context.principal ||
    event.actor.via !== 'web' ||
    event.assertion.kind !== 'claim' ||
    event.seq !== action.expectedSeq + 1 ||
    result.incident.lastSeq < event.seq ||
    resolution.humanNote !== action.humanNote ||
    resolution.proof.criterionVersion !== action.criterionVersion ||
    !sameResolutionValue(resolution.proof.run, action.run) ||
    !sameResolutionValue(resolution.proof.recoveryRefs, [
      { kind: 'source-operation', sourceOperation: action.recovery },
    ]) ||
    !sameResolutionValue(event.payload, resolution) ||
    !sameResolutionValue(event.refs, resolutionRefs(resolution))
  )
    throw new Error(
      'The server did not confirm the exact Resolve intent. Retry the original operation.',
    );
  const evaluated = resolutionInstant(resolution.proof.evaluatedAt),
    at = resolutionInstant(event.at);
  if (
    evaluated === undefined ||
    at === undefined ||
    evaluated > at ||
    at - evaluated > BigInt(criterion.maxAgeSeconds) * 1000000000n
  )
    throw new Error('The committed Resolve proof has invalid evaluation time.');
}
