import {
  EnvironmentScope,
  EnvironmentState,
  EnvironmentOperationResult,
  CreateEnvironmentRequest,
  SaveEnvironmentOrderRequest,
} from './environment-state';
import {
  assertScalarString,
  compareEnvironmentIds,
  resolveEnvironmentOrder,
} from './environment-order';
import { IEnvironmentFull } from './environments';

export type EnvironmentWrite =
  | CreateEnvironmentRequest
  | SaveEnvironmentOrderRequest;
// Go encoding/json escapes HTML and JS line separators, preserving Unicode scalars.
export function environmentGoJSON(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
/** Go strings.TrimSpace uses Unicode White_Space (unlike JS trim's BOM rule). */
export function environmentTrimName(value: string): string {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
}
export async function environmentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(environmentGoJSON(value));
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}
/** Field order and omission match Core dto.EnvironmentScope. */
function scopeJSON(scope: EnvironmentScope): object {
  return {
    storeId: scope.storeId,
    projectId: scope.projectId,
    ...(scope.spaceID !== undefined ? { spaceID: scope.spaceID } : {}),
    ...(scope.projectApi !== undefined ? { projectApi: scope.projectApi } : {}),
    ...(scope.branch !== undefined ? { branch: scope.branch } : {}),
    authorityId: scope.authorityId,
    ...(scope.resolvedBranch !== undefined
      ? { resolvedBranch: scope.resolvedBranch }
      : {}),
    ...(scope.repositoryId !== undefined
      ? { repositoryId: scope.repositoryId }
      : {}),
    ...(scope.owner !== undefined ? { owner: scope.owner } : {}),
    ...(scope.repository !== undefined ? { repository: scope.repository } : {}),
    ...(scope.folder !== undefined ? { folder: scope.folder } : {}),
  };
}
function briefJSON(environment: IEnvironmentFull): object {
  const presentation = environment.presentation;
  return {
    id: environment.id,
    ...(environment.title ? { title: environment.title } : {}),
    ...(environment.access ? { access: environment.access } : {}),
    ...(presentation
      ? {
          presentation: {
            ...(presentation.label ? { label: presentation.label } : {}),
            ...(presentation.icon ? { icon: presentation.icon } : {}),
            ...(presentation.tone ? { tone: presentation.tone } : {}),
          },
        }
      : {}),
  };
}
export function environmentPayloadDigest(
  request: EnvironmentWrite,
): Promise<string> {
  const create = 'name' in request;
  const kind = create ? 'create-environment' : 'save-environment-order';
  const name = create ? environmentTrimName(request.name) : '';
  const order = create ? null : request.environmentOrder;
  // Local CLI's Go anonymous struct has exported uppercase keys; Backend uses a tuple.
  return environmentHash(
    request.scope.storeId === 'local'
      ? {
          Kind: kind,
          Scope: scopeJSON(request.scope),
          IfRevision: request.ifRevision,
          OperationID: request.operationId,
          Name: name,
          Order: order,
        }
      : [
          kind,
          scopeJSON(request.scope),
          request.ifRevision,
          name,
          order,
          request.operationId,
        ],
  );
}
export function environmentAfterDigest(
  before: Pick<EnvironmentState, 'environments' | 'savedOrder'>,
  request: EnvironmentWrite,
  createdId?: string,
): Promise<string> {
  let environments = [...before.environments];
  const saved =
    'environmentOrder' in request
      ? request.environmentOrder
      : before.savedOrder;
  if ('name' in request) {
    if (
      !createdId ||
      environments.some((environment) => environment.id === createdId)
    )
      throw new Error('Created environment identity is invalid.');
    assertScalarString(createdId);
    if (!/^[a-z0-9][a-z0-9-]{0,116}$/.test(createdId))
      throw new Error('Created environment identity is invalid.');
    environments.push({
      id: createdId,
      title: environmentTrimName(request.name),
    });
  }
  environments = environments.sort((left, right) =>
    compareEnvironmentIds(left.id, right.id),
  );
  const order = resolveEnvironmentOrder(environments, saved).order;
  return environmentHash([environments.map(briefJSON), saved, order]);
}
export async function verifyEnvironmentReceipt(
  before: EnvironmentState,
  request: EnvironmentWrite,
  receipt: EnvironmentOperationResult,
): Promise<void> {
  if (
    !request.operationId.startsWith(`${before.scopeBinding}.`) ||
    receipt.operationId !== request.operationId ||
    receipt.kind !==
      ('name' in request ? 'create-environment' : 'save-environment-order') ||
    receipt.payloadDigest !== (await environmentPayloadDigest(request))
  )
    throw new Error(
      'Environment receipt does not match the original operation.',
    );
  const accepted = Date.parse(receipt.acceptedAt),
    until = Date.parse(receipt.replayUntil);
  if (
    !Number.isFinite(accepted) ||
    !Number.isFinite(until) ||
    until <= accepted ||
    until - accepted > 7 * 24 * 60 * 60 * 1000 + 1
  )
    throw new Error('Environment receipt lifetime is invalid.');
  if (receipt.status !== 'committed' && receipt.status !== 'expired')
    throw new Error('Environment operation is not confirmed.');
  if (
    'environmentOrder' in request &&
    (receipt.environmentId !== undefined ||
      JSON.stringify(receipt.environmentOrder) !==
        JSON.stringify(request.environmentOrder))
  )
    throw new Error('Environment receipt contains a different accepted order.');
  if (
    'name' in request &&
    (typeof receipt.environmentId !== 'string' ||
      !receipt.environmentId ||
      receipt.environmentOrder !== undefined)
  )
    throw new Error('Environment receipt is missing the generated identity.');
  if (
    receipt.afterStateDigest !==
    (await environmentAfterDigest(before, request, receipt.environmentId))
  )
    throw new Error('Environment receipt after-state could not be verified.');
}
