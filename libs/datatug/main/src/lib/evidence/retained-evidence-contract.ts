import {
  decodeResult,
  evidenceText,
  decodeTypedValue,
  verifyRowEvidence,
  type HeldEvidenceIdentity,
  type Result,
  type TypedValue,
} from '@sneat/datatug-semantic';
import {
  ShippingRevision,
  shippingPointer,
} from '../shipping/shipping-api.service';
import { IProjectRef, isSharedProjectRef } from '../core/project-context';

export interface RetainedEvidenceScope {
  readonly projectRef: IProjectRef;
  readonly environment: string;
  readonly actor: string;
}
export interface RetainedSourcePin {
  readonly spaceID: string;
  readonly projectId: string;
  readonly sourceId: 'shipping-working-copy';
  readonly environment: string;
  readonly bindingRevision: number;
  readonly revision: ShippingRevision;
}
export interface RetainedQueryResponse {
  readonly result: Result;
  readonly queryRevision: string;
  readonly resultFingerprint: string;
  readonly receipt?: string;
  readonly sourcePin?: RetainedSourcePin;
  readonly appliedManifestRef?: string;
  readonly attachedIncidentRef?: string;
}
function object(
  value: unknown,
  keys?: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Retained evidence requires an object.');
  const result = value as Record<string, unknown>;
  if (keys && Object.keys(result).some((key) => !keys.includes(key)))
    throw new Error('Unsupported retained evidence field.');
  return result;
}
function text(value: unknown): string {
  return evidenceText(value);
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error('Retained evidence revision is unavailable.');
  return value;
}
function digest(value: unknown): string {
  const result = text(value);
  if (!/^[a-f0-9]{64}$/.test(result))
    throw new Error('Retained evidence digest is unavailable.');
  return result;
}
export function readRetainedSourcePin(
  value: unknown,
  expected: RetainedEvidenceScope,
): RetainedSourcePin {
  const pin = object(value, [
    'spaceID',
    'projectId',
    'sourceId',
    'environment',
    'bindingRevision',
    'revision',
  ]);
  if (
    !isSharedProjectRef(expected.projectRef) ||
    pin['spaceID'] !== expected.projectRef.spaceID ||
    pin['projectId'] !== expected.projectRef.projectId ||
    pin['sourceId'] !== 'shipping-working-copy' ||
    pin['environment'] !== expected.environment
  )
    throw new Error('Retained evidence belongs to a different source scope.');
  positive(pin['bindingRevision']);
  const revision = object(pin['revision'], [
    'generation',
    'revision',
    'sha256',
    'fixtureCommit',
    'fixtureSHA256',
    'schemaSHA256',
    'configuration',
    'businessClock',
    'bytes',
    'artifacts',
    'actorId',
    'acceptedAt',
  ]);
  shippingPointer(revision as unknown as ShippingRevision);
  for (const name of ['fixtureSHA256', 'schemaSHA256']) digest(revision[name]);
  for (const name of [
    'fixtureCommit',
    'businessClock',
    'actorId',
    'acceptedAt',
  ])
    text(revision[name]);
  if (
    ![17, 18].includes(Number(revision['configuration'])) ||
    typeof revision['configuration'] !== 'number'
  )
    throw new Error('Unknown retained configuration.');
  positive(revision['bytes']);
  if (!Array.isArray(revision['artifacts']) || !revision['artifacts'].length)
    throw new Error('Retained artifacts are unavailable.');
  for (const item of revision['artifacts']) {
    const artifact = object(item, ['id', 'sha256', 'bytes']);
    text(artifact['id']);
    digest(artifact['sha256']);
    positive(artifact['bytes']);
  }
  return structuredClone(pin) as unknown as RetainedSourcePin;
}
export async function readRetainedQueryResponse(
  value: unknown,
  scope: RetainedEvidenceScope,
  queryId: string,
  sharing?: { incidentRef: string },
): Promise<RetainedQueryResponse> {
  const wire = object(value, [
    'result',
    'queryRevision',
    'resultFingerprint',
    'receipt',
    'sourcePin',
    'appliedManifestRef',
    'attachedIncidentRef',
  ]);
  const result = decodeResult(wire['result']);
  if (
    !result.execution ||
    result.execution.storeId !== scope.projectRef.storeId ||
    result.execution.projectId !== scope.projectRef.projectId ||
    result.provenance.queryId !== queryId
  )
    throw new Error(
      'The response does not identify this held query execution.',
    );
  const queryRevision = text(wire['queryRevision']),
    fingerprint = digest(wire['resultFingerprint']);
  // Backend resultFingerprint hashes the complete serialized Result. The Core
  // sidecar fingerprint separately binds recordset bytes; do not conflate them.
  if (result.rowEvidence) await verifyRowEvidence(result.rowEvidence, result);
  const receipt =
    wire['receipt'] === undefined ? undefined : text(wire['receipt']);
  const pin =
    wire['sourcePin'] === undefined
      ? undefined
      : readRetainedSourcePin(wire['sourcePin'], scope);
  const applied =
    wire['appliedManifestRef'] === undefined
      ? undefined
      : text(wire['appliedManifestRef']);
  const attached =
    wire['attachedIncidentRef'] === undefined
      ? undefined
      : text(wire['attachedIncidentRef']);
  if ((applied || attached) && (!pin || !applied || !attached))
    throw new Error('The retained evidence receipt is incomplete.');
  if (sharing && (!pin || !applied || !attached))
    throw new Error(
      'The server did not confirm evidence retention and attachment.',
    );
  const sidecar = result.rowEvidence;
  if (
    sidecar &&
    (!pin ||
      !applied ||
      !attached ||
      sidecar.scope.storeId !== scope.projectRef.storeId ||
      sidecar.scope.spaceID !== pin.spaceID ||
      sidecar.scope.projectId !== pin.projectId ||
      sidecar.scope.environment !== pin.environment ||
      sidecar.source.id !== pin.sourceId ||
      sidecar.source.generation !== pin.revision.generation)
  )
    throw new Error(
      'Row evidence does not match the authenticated retained source identity.',
    );
  if (sharing && attached !== sharing.incidentRef)
    throw new Error('The server attached this run to a different Incident.');
  return {
    result,
    queryRevision,
    resultFingerprint: fingerprint,
    ...(receipt ? { receipt } : {}),
    ...(pin
      ? {
          sourcePin: pin,
          appliedManifestRef: applied,
          attachedIncidentRef: attached,
        }
      : {}),
  };
}
/** Only authenticated provider metadata paired with this response supplies the
 * expected identity. Result sidecars and current form values cannot supply it. */
export function heldEvidenceIdentity(
  response: RetainedQueryResponse,
  scope: RetainedEvidenceScope,
): HeldEvidenceIdentity | undefined {
  if (
    !response.sourcePin ||
    !response.appliedManifestRef ||
    !response.attachedIncidentRef
  )
    return undefined;
  const pin = readRetainedSourcePin(response.sourcePin, scope);
  return {
    execution: response.result.execution,
    scope: {
      storeId: scope.projectRef.storeId,
      spaceID: pin.spaceID,
      projectId: pin.projectId,
      environment: pin.environment,
    },
    source: { id: pin.sourceId, generation: pin.revision.generation },
    complete: !response.result.truncated,
    hasMore: response.result.truncated,
  };
}
export function readRetainedInputs(
  value: unknown,
): Readonly<Record<string, TypedValue>> {
  const result: Record<string, TypedValue> = {};
  for (const [name, input] of Object.entries(object(value))) {
    text(name);
    result[name] = decodeTypedValue(input);
  }
  return result;
}
