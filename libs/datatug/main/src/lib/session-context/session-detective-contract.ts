import { DetectiveInputValue } from '../detective/models';
import {
  ContextEntryRef,
  SessionScope,
  contextOpaqueId,
} from './session-context-contract';

/** Source selector and private authority locator; never an authorization grant. */
export interface DetectiveOperationScope {
  readonly storage: string;
  readonly project: string;
  readonly spaceID?: string;
  readonly databaseId: string;
  readonly projectId: string;
  readonly namespaceId: string;
}
export interface SessionDetectiveRequest {
  readonly operationId: string;
  readonly sessionId: string;
  readonly expectedVersion: number;
  readonly expectedContextSetId: string;
  readonly scope: SessionScope;
  readonly checkId: string;
  readonly caseId?: string;
  readonly attachments?: readonly ContextEntryRef[];
  readonly bindings?: readonly {
    readonly inputName: string;
    readonly entryId: string;
    readonly revisionId: string;
  }[];
  readonly inputs?: Readonly<Record<string, DetectiveInputValue>>;
}
export interface AcceptedDetectiveStatus {
  readonly runId: string;
  readonly state:
    | 'accepted'
    | 'dispatching'
    | 'completed'
    | 'failed'
    | 'canceled'
    | 'fenced';
  readonly fenceReason?: 'canceled' | 'contentrevoked' | 'deleted';
  readonly produced: boolean;
  readonly done: boolean;
  readonly evidenceState?: 'pending' | 'blocked' | 'delivered' | 'redacted';
}
export interface SessionDetectiveResponse {
  readonly operationId: string;
  readonly status: AcceptedDetectiveStatus;
  readonly operationScope: DetectiveOperationScope;
}
export function validDetectiveOperationScope(
  value: DetectiveOperationScope | undefined,
): value is DetectiveOperationScope {
  return (
    !!value &&
    Object.keys(value).every((key) =>
      [
        'storage',
        'project',
        'spaceID',
        'databaseId',
        'projectId',
        'namespaceId',
      ].includes(key),
    ) &&
    ['storage', 'project', 'databaseId', 'projectId', 'namespaceId'].every(
      (key) =>
        typeof value[key as keyof DetectiveOperationScope] === 'string' &&
        !!value[key as keyof DetectiveOperationScope],
    ) &&
    contextOpaqueId(value.databaseId) &&
    contextOpaqueId(value.projectId) &&
    contextOpaqueId(value.namespaceId) &&
    (value.spaceID === undefined || contextOpaqueId(value.spaceID))
  );
}
export function detectiveOperationScopeKey(
  scope: DetectiveOperationScope,
): string {
  return JSON.stringify([
    scope.storage,
    scope.project,
    scope.spaceID || '',
    scope.databaseId,
    scope.projectId,
    scope.namespaceId,
  ]);
}
/** Return only recognized metadata, even if a broken server adds private fields. */
export function readSessionDetectiveResponse(
  value: SessionDetectiveResponse,
  operationId: string,
  scope: DetectiveOperationScope,
): SessionDetectiveResponse {
  const status = value?.status;
  if (
    value?.operationId !== operationId ||
    !validDetectiveOperationScope(value.operationScope) ||
    detectiveOperationScopeKey(value.operationScope) !==
      detectiveOperationScopeKey(scope) ||
    !status ||
    !contextOpaqueId(status.runId) ||
    ![
      'accepted',
      'dispatching',
      'completed',
      'failed',
      'canceled',
      'fenced',
    ].includes(status.state) ||
    typeof status.produced !== 'boolean' ||
    typeof status.done !== 'boolean' ||
    (status.done && !status.produced) ||
    (['completed', 'failed', 'canceled'].includes(status.state) &&
      !status.done) ||
    (status.done && ['accepted', 'dispatching'].includes(status.state)) ||
    (status.fenceReason !== undefined && status.state !== 'fenced') ||
    (status.fenceReason !== undefined &&
      !['canceled', 'contentrevoked', 'deleted'].includes(
        status.fenceReason,
      )) ||
    (status.evidenceState !== undefined &&
      !['pending', 'blocked', 'delivered', 'redacted'].includes(
        status.evidenceState,
      ))
  )
    throw new Error(
      'Native status was not confirmed. Refresh saved status without starting another run.',
    );
  return {
    operationId,
    operationScope: { ...scope },
    status: {
      runId: status.runId,
      state: status.state,
      produced: status.produced,
      done: status.done,
      ...(status.fenceReason ? { fenceReason: status.fenceReason } : {}),
      ...(status.evidenceState ? { evidenceState: status.evidenceState } : {}),
    },
  };
}
