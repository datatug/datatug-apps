import {
  decodeEvidenceArtifactRef,
  decodeTypedValue,
  type SourceOperationRef,
} from '@sneat/datatug-semantic';
import type {
  ShippingAction,
  ShippingAck,
  ShippingRevision,
} from '../shipping/shipping-api.service';
import type { RetainedEvidenceScope } from './retained-evidence-contract';
import {
  exact,
  nativeID,
  nativeToken,
} from '../shipping/native-semantic-contract';

export interface SourceOperationSummary {
  reference: SourceOperationRef;
  action: ShippingAction;
  outcome: 'applied' | 'already-applied';
  acceptedAt: string;
}
export interface RetainedSourceOperationView {
  reference: SourceOperationRef;
  receipt: ShippingAck['receipt'];
}
function unavailable(): never {
  throw new Error('Source operation evidence is unavailable.');
}
const integer = (v: unknown, max: number): number => {
  if (!Number.isSafeInteger(v) || Number(v) < 1 || Number(v) > max)
    unavailable();
  return v as number;
};
const digest = (v: unknown): string => {
  if (!nativeToken(v)) unavailable();
  return v;
};
const id = (v: unknown): string => {
  if (!nativeID(v)) unavailable();
  return v;
};
function wallTime(v: unknown): string {
  if (
    typeof v !== 'string' ||
    v.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(v) ||
    /^0001-01-01T00:00:00(?:\.0{1,9})?Z$/u.test(v)
  )
    unavailable();
  decodeTypedValue({ type: 'datetime', value: v });
  return v;
}
function instant(v: string): bigint {
  const [whole, fraction = ''] = v.slice(0, -1).split('.');
  return (
    BigInt(Date.parse(whole + 'Z')) * 1000000n + BigInt(fraction.padEnd(9, '0'))
  );
}
function action(v: unknown): ShippingAction {
  if (!['initialize', 'correct', 'replay', 'reset'].includes(String(v)))
    unavailable();
  return v as ShippingAction;
}
function outcome(v: unknown): 'applied' | 'already-applied' {
  if (v !== 'applied' && v !== 'already-applied') unavailable();
  return v;
}
export function sourceOperationReference(v: unknown): SourceOperationRef {
  const arm = decodeEvidenceArtifactRef({
    kind: 'source-operation',
    sourceOperation: v,
  });
  if (arm.kind !== 'source-operation') unavailable();
  return arm.sourceOperation;
}
export function validateSourceOperationScope(
  scope: RetainedEvidenceScope,
  reference?: SourceOperationRef,
): void {
  if (
    scope.projectRef.storeId !== 'firestore' ||
    !nativeID(scope.projectRef.spaceID) ||
    !nativeID(scope.projectRef.projectId) ||
    scope.projectRef.branch !== undefined ||
    scope.projectRef.projectApi !== undefined ||
    !nativeID(scope.environment) ||
    !scope.actor ||
    (reference &&
      (reference.storeId !== 'firestore' ||
        reference.spaceID !== scope.projectRef.spaceID ||
        reference.projectId !== scope.projectRef.projectId ||
        reference.sourceId !== 'shipping-working-copy' ||
        reference.receiptActorId !== scope.actor))
  )
    unavailable();
}
function bounded(v: unknown): void {
  if (new TextEncoder().encode(JSON.stringify(v)).length > 256 * 1024)
    unavailable();
}
export function readSourceOperationHistory(
  v: unknown,
  scope: RetainedEvidenceScope,
): SourceOperationSummary[] {
  validateSourceOperationScope(scope);
  bounded(v);
  const o = exact(v, ['operations']);
  if (!Array.isArray(o['operations']) || o['operations'].length > 128)
    unavailable();
  const seen = new Set<string>();
  return o['operations'].map((raw) => {
    const item = exact(raw, ['reference', 'action', 'outcome', 'acceptedAt']);
    const reference = sourceOperationReference(item['reference']);
    validateSourceOperationScope(scope, reference);
    if (seen.has(reference.operationId)) unavailable();
    seen.add(reference.operationId);
    return {
      reference,
      action: action(item['action']),
      outcome: outcome(item['outcome']),
      acceptedAt: wallTime(item['acceptedAt']),
    };
  });
}
function revision(v: unknown): ShippingRevision {
  const o = exact(v, [
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
  if (
    typeof o['fixtureCommit'] !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(o['fixtureCommit']) ||
    ![17, 18].includes(Number(o['configuration'])) ||
    typeof o['configuration'] !== 'number' ||
    !Array.isArray(o['artifacts']) ||
    !o['artifacts'].length ||
    o['artifacts'].length > 3
  )
    unavailable();
  const seen = new Set<string>();
  const artifacts = o['artifacts'].map((raw) => {
    const a = exact(raw, ['id', 'sha256', 'bytes']);
    if (
      typeof a['id'] !== 'string' ||
      ![
        'logs/base.jsonl',
        'logs/recovery-11045.jsonl',
        'logs/recovery-11062.jsonl',
      ].includes(a['id']) ||
      seen.has(a['id'])
    )
      unavailable();
    seen.add(a['id']);
    return {
      id: a['id'],
      sha256: digest(a['sha256']),
      bytes: integer(a['bytes'], 512 * 1024),
    };
  });
  if (!seen.has('logs/base.jsonl')) unavailable();
  return {
    generation: id(o['generation']),
    revision: integer(o['revision'], 16),
    sha256: digest(o['sha256']),
    fixtureCommit: o['fixtureCommit'],
    fixtureSHA256: digest(o['fixtureSHA256']),
    schemaSHA256: digest(o['schemaSHA256']),
    configuration: o['configuration'],
    businessClock: wallTime(o['businessClock']),
    bytes: integer(o['bytes'], 512 * 1024),
    artifacts,
    actorId: id(o['actorId']),
    acceptedAt: wallTime(o['acceptedAt']),
  };
}
export function readSourceOperation(
  v: unknown,
  scope: RetainedEvidenceScope,
  expected: SourceOperationRef,
): RetainedSourceOperationView {
  validateSourceOperationScope(scope, expected);
  bounded(v);
  const o = exact(v, ['reference', 'receipt']),
    reference = sourceOperationReference(o['reference']);
  validateSourceOperationScope(scope, reference);
  if (
    JSON.stringify(reference) !==
    JSON.stringify(sourceOperationReference(expected))
  )
    unavailable();
  const raw = exact(o['receipt'], [
    'operationId',
    'actorId',
    'requestSHA256',
    'action',
    'outcome',
    'revision',
    'acceptedAt',
  ]);
  const receipt = {
    operationId: id(raw['operationId']),
    actorId: id(raw['actorId']),
    requestSHA256: digest(raw['requestSHA256']),
    action: action(raw['action']),
    outcome: outcome(raw['outcome']),
    revision: revision(raw['revision']),
    acceptedAt: wallTime(raw['acceptedAt']),
  };
  const pointer = reference.result;
  if (
    receipt.operationId !== reference.operationId ||
    receipt.actorId !== reference.receiptActorId ||
    receipt.requestSHA256 !== reference.requestSHA256 ||
    receipt.revision.generation !== pointer.generation ||
    receipt.revision.revision !== pointer.revision ||
    receipt.revision.sha256 !== pointer.sha256 ||
    instant(receipt.revision.acceptedAt) > instant(receipt.acceptedAt) ||
    (receipt.outcome === 'applied' &&
      (receipt.revision.actorId !== receipt.actorId ||
        instant(receipt.revision.acceptedAt) !== instant(receipt.acceptedAt)))
  )
    unavailable();
  return { reference, receipt };
}
