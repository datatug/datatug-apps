import type { ContextQuerySource } from './session-query-scope';
import type { DetectiveOperationScope } from './session-detective-contract';
import type { TypedValue, TypedValueKind } from '@sneat/datatug-semantic';

/** Additive sessioncontext wire contract; the command owner is DataTug Core. */
export interface SessionScope { readonly environmentId: string; readonly identityDomain: string; }
export interface ContextSession {
  readonly schemaVersion: 1;
  readonly id: string; readonly databaseId: string; readonly projectId: string;
  readonly owner: string; readonly title: string; readonly state: 'active' | 'stopped' | 'archived' | 'deleted';
  readonly pendingRunCount?: number;
  readonly version: number; readonly defaultBagId: string; readonly contextSetId: string;
  readonly bagIds: readonly string[]; readonly createdAt: string; readonly updatedAt: string;
}
export interface ContextBag {
  readonly id: string; readonly sessionId: string; readonly title: string;
  readonly scope: SessionScope; readonly version: number; readonly clearVersion?: number; readonly entryIds: readonly string[];
}
export interface ContextSubject {
  readonly conceptId: string; readonly fieldId: string; readonly fieldMappingRef: string;
  readonly graphResource?: string; readonly graphRevision?: string;
  readonly modelRef?: string; readonly modelRevision?: string;
  readonly record?: string; readonly fields?: readonly string[];
}
export interface ContextValue {
  readonly schemaVersion: 1; readonly kind: 'scalar' | 'set';
  readonly scalar?: TypedValue; readonly values?: readonly TypedValue[];
  readonly keys?: readonly { readonly components: readonly { readonly field: string; readonly value: TypedValue }[] }[];
  readonly keyFields?: readonly string[];
}
export interface ContextEntry {
  readonly id: string; readonly sessionId: string; readonly bagId: string;
  readonly alias?: string; readonly subject: ContextSubject;
  readonly currentRevisionId: string; readonly version: number;
}
export interface ContextEntryRevision {
  readonly id: string; readonly entryId: string; readonly bagId: string;
  readonly parentRevisionId?: string; readonly subject: ContextSubject; readonly value: ContextValue; readonly createdAt: string;
}
export interface ContextEntryRef { readonly entryId: string; readonly revisionId: string; }
export interface AppliedContextSlot {
  readonly scope: SessionScope; readonly bagId: string; readonly bagVersion: number;
  readonly version: number; readonly entries: readonly ContextEntryRef[];
}
export interface AppliedContextSet {
  readonly id: string; readonly sessionId: string; readonly enabled: boolean;
  readonly slots: readonly AppliedContextSlot[]; readonly createdAt: string;
}
export interface ContextSnapshot {
  readonly session: ContextSession; readonly bags: readonly ContextBag[];
  readonly entries: readonly ContextEntry[]; readonly revisions: readonly ContextEntryRevision[];
  readonly contextSet: AppliedContextSet;
}
export interface ContextSessionPage { readonly items: readonly ContextSession[]; readonly nextCursor?: string; readonly hasMore: boolean; }
export interface ContextReceipt {
  readonly opId: string; readonly actor: string; readonly action: string;
  readonly payloadDigest: string; readonly sessionId: string; readonly sessionVersion: number;
  readonly resourceId?: string; readonly resourceVersion?: number; readonly at: string;
}
export interface ContextCommand {
  readonly opId: string;
  readonly action: 'createSession' | 'createBag' | 'putEntry' | 'applyContext' | 'clearBag' | 'transitionSession' | 'pinInput' | 'reportDashboard' | 'reportClientRun' | 'renameSession' | 'renameBag' | 'recordRunExecution' | 'importLegacy';
  readonly sessionId: string; readonly expectedVersion?: number;
  readonly bagId?: string; readonly expectedBagVersion?: number; readonly expectedSlotVersion?: number;
  readonly expectedContextSetId?: string; readonly entryId?: string;
  readonly expectedEntryVersion?: number; readonly revisionId?: string;
  readonly title?: string; readonly alias?: string; readonly scope?: SessionScope;
  readonly subject?: ContextSubject; readonly value?: ContextValue; readonly selection?: readonly ContextEntryRef[];
  readonly enabled?: boolean; readonly transition?: 'start' | 'stop' | 'archive' | 'restore' | 'delete';
  readonly databaseId?: string; readonly projectId?: string;
  readonly inputSnapshotId?: string; readonly runId?: string; readonly kind?: 'query' | 'dashboard' | 'chat' | 'check';
  readonly definitionId?: string; readonly definitionRevision?: string; readonly attachments?: readonly ContextEntryRef[]; readonly text?: string;
  readonly expectedRunVersion?: number; readonly runState?: string; readonly widgets?: readonly ContextWidgetOutcome[]; readonly resultRefs?: readonly string[]; readonly errorCode?: string;
  readonly resolvedParameters?: Readonly<Record<string, TypedValue>>;
  readonly definitionDocument?: ContextDefinitionDocument;
  readonly executionDocument?: ContextDefinitionDocument;
  readonly legacyImport?: ContextLegacyImport;
}
export interface ContextLegacyImport {
  readonly sourceId: string;
  readonly title?: string;
  readonly scope: SessionScope;
  readonly entries: readonly {
    readonly id: string; readonly alias?: string; readonly subject: ContextSubject;
    readonly value: ContextValue; readonly createdAt?: string;
  }[];
  readonly messages: readonly {
    readonly id: string; readonly role: 'user' | 'assistant'; readonly text: string; readonly createdAt?: string;
  }[];
}
export interface ContextDefinitionDocument {
  readonly schemaVersion: 1; readonly kind: 'query' | 'dashboard' | 'chat';
  readonly queries: readonly { readonly id: string; readonly queryType: 'SQL' | 'DTQL' | 'TugQL'; readonly text: string; readonly connectionId?: string; readonly parameters: readonly { readonly id: string; readonly type: string; readonly isRequired?: boolean }[] }[];
  readonly widgets?: readonly { readonly id: string; readonly queryId: string }[];
}
export interface ContextInputSnapshot { readonly id: string; readonly sessionId: string; readonly contextSetId: string; readonly scope: SessionScope; readonly entries: readonly ContextEntryRef[]; readonly createdAt: string; readonly resolvedParameters?: Readonly<Record<string, TypedValue>>; readonly parametersOrigin?: string; readonly definitionDocument?: ContextDefinitionDocument; readonly definitionDigest?: string; }
export interface ContextWidgetOutcome { readonly id: string; readonly state: 'completed' | 'failed' | 'cancelled'; readonly resultRef?: string; readonly errorCode?: string; }
export interface ContextRun {
  readonly id: string; readonly sessionId: string; readonly inputSnapshotId: string;
  readonly kind: string; readonly definitionId: string; readonly definitionRevision: string;
  readonly executionAuthority: 'client' | 'server';
  readonly state: string; readonly version: number; readonly outcomeOrigin?: 'client-reported' | 'server-executor' | 'client-outcome-unknown';
  readonly widgets?: readonly ContextWidgetOutcome[]; readonly resultRefs?: readonly string[]; readonly errorCode?: string;
  readonly createdAt: string; readonly completedAt?: string;
}
export interface ContextMessage { readonly id: string; readonly sessionId: string; readonly inputSnapshotId: string; readonly role: 'user' | 'assistant'; readonly text: string; readonly createdAt: string; }
export interface ContextCapabilities {
  readonly nativeDetective?: boolean;
  readonly operationScope?: DetectiveOperationScope;
  readonly schemaVersion: 1; readonly actorId: string; readonly databaseId: string; readonly projectId: string;
  readonly environments: readonly (SessionScope & { readonly title?: string; readonly querySources?: readonly ContextQuerySource[] })[];
  readonly actions: readonly ContextCommand['action'][];
  readonly subjects?: readonly {
    readonly id: string; readonly label: string; readonly subject: ContextSubject;
    readonly type: TypedValueKind; readonly shape: 'scalar' | 'set'; readonly scope: SessionScope;
  }[];
}

export const contextScopeKey = (scope: SessionScope): string => JSON.stringify([scope.environmentId, scope.identityDomain]);
export const sameContextScope = (a: SessionScope, b: SessionScope): boolean => contextScopeKey(a) === contextScopeKey(b);
export const sameContextSubject = (a: ContextSubject, b: ContextSubject): boolean =>
  ['conceptId', 'fieldId', 'fieldMappingRef', 'graphResource', 'graphRevision', 'modelRef', 'modelRevision', 'record'].every((key) =>
    a[key as keyof ContextSubject] === b[key as keyof ContextSubject]) && JSON.stringify(a.fields ?? []) === JSON.stringify(b.fields ?? []);
export const contextOpaqueId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function readContextSnapshot(value: ContextSnapshot): ContextSnapshot {
  const session = value?.session;
  if (!session || session.schemaVersion !== 1 || !contextOpaqueId(session.id) ||
    !Number.isSafeInteger(session.version) || session.version < 1 ||
    !['active', 'stopped', 'archived', 'deleted'].includes(session.state) ||
    !Array.isArray(value.bags) || !Array.isArray(value.entries) || !Array.isArray(value.revisions) ||
    !value.contextSet || value.contextSet.sessionId !== session.id || value.contextSet.id !== session.contextSetId ||
    !Array.isArray(value.contextSet.slots) || typeof value.contextSet.enabled !== 'boolean')
    throw new Error('The server returned an unsupported session snapshot.');
  for (const bag of value.bags) {
    if (!contextOpaqueId(bag.id) || bag.sessionId !== session.id || !Array.isArray(bag.entryIds) ||
      !bag.scope?.environmentId || !bag.scope.identityDomain || !Number.isSafeInteger(bag.version))
      throw new Error('The server returned an invalid Context Bag.');
  }
  for (const entry of value.entries) {
    const bag = value.bags.find((item) => item.id === entry.bagId);
    if (!bag || entry.sessionId !== session.id || !bag.entryIds.includes(entry.id) ||
      !entry.subject?.conceptId || !entry.subject.fieldMappingRef ||
      !value.revisions.some((revision) => revision.id === entry.currentRevisionId && revision.entryId === entry.id && revision.bagId === bag.id))
      throw new Error('The server returned inconsistent entry revisions.');
  }
  for (const slot of value.contextSet.slots) {
    if (slot.bagId === '' && Array.isArray(slot.entries) && slot.entries.length === 0 && Number.isSafeInteger(slot.version)) continue;
    const bag = value.bags.find((item) => item.id === slot.bagId);
    if (!bag || !sameContextScope(bag.scope, slot.scope) || !Array.isArray(slot.entries) ||
      slot.entries.some((ref: ContextEntryRef) => !value.revisions.some((revision) => revision.id === ref.revisionId && revision.entryId === ref.entryId && revision.bagId === bag.id)))
      throw new Error('The applied context has an invalid environment or revision.');
  }
  return value;
}
