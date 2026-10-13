import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { openDB } from 'idb';
import type { Fact } from '@sneat/datatug-semantic';
import type { TypedValue } from '@sneat/datatug-semantic';
import { IProjectRef, equalProjectRef, projectRefToString } from '../core/project-context';
import { SessionContextApiService } from './session-context-api.service';
import {
  AppliedContextSlot, ContextCapabilities, ContextCommand, ContextEntry,
  ContextEntryRef, ContextSession, ContextSnapshot, ContextSubject, ContextValue, ContextRun,
  SessionScope, contextOpaqueId, contextScopeKey, sameContextScope, sameContextSubject,
  ContextInputSnapshot, ContextEntryRevision, ContextWidgetOutcome,
  ContextDefinitionDocument,
  ContextReceipt,
  ContextLegacyImport,
} from './session-context-contract';

export interface SessionDeviceDraft {
  readonly selectedBagId: string;
  readonly enabled: boolean;
  readonly selections: Readonly<Record<string, readonly ContextEntryRef[]>>;
  readonly attachments: readonly ContextEntryRef[];
  readonly pinnedAttachments?: readonly string[];
  readonly composer: string;
}
export interface SessionDraftStore {
  read(key: string): Promise<SessionDeviceDraft | undefined>;
  write(key: string, draft: SessionDeviceDraft): Promise<void>;
  readPending(key: string): Promise<SessionPendingOperation | undefined>;
  writePending(key: string, pending: SessionPendingOperation): Promise<void>;
  removePending(key: string): Promise<void>;
}
export interface SessionPendingOperation { readonly project: IProjectRef; readonly capabilities: ContextCapabilities; readonly command: ContextCommand; }
/** Device drafts are recoverable working copies, never command receipts or OVDB authority. */
export const SESSION_DEVICE_DRAFTS = new InjectionToken<SessionDraftStore>('Session device drafts', {
  providedIn: 'root',
  factory: () => {
    const database = openDB('datatug-session-device-drafts', 1, {
      upgrade: (db) => { db.createObjectStore('drafts'); db.createObjectStore('pending'); },
    });
    return {
      read: async (key) => (await database).get('drafts', key),
      write: async (key, draft) => { await (await database).put('drafts', draft, key); },
      readPending: async (key) => (await database).get('pending', key),
      writePending: async (key, pending) => { await (await database).put('pending', pending, key); },
      removePending: async (key) => { await (await database).delete('pending', key); },
    };
  },
});

const randomId = (prefix: string): string => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const errorStatus = (error: unknown, depth = 0): number | undefined => {
  if (depth > 3 || typeof error !== 'object' || error === null) return undefined;
  const value = error as Record<string, unknown>;
  const status = value['status'];
  if (typeof status === 'number' && Number.isInteger(status) && status >= 0 && status <= 599) return status;
  for (const key of ['error', 'response', 'cause']) {
    const nested = errorStatus(value[key], depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
};
const errorMessage = (error: unknown): string => {
  const status = errorStatus(error);
  if (status === 400 || status === 422) return 'The server rejected this request. No change was accepted; review the request and correct it before trying again.';
  if (status === 401 || status === 403) return 'Access to this session is no longer available.';
  if (status === 409) return 'This session changed elsewhere. Reload and review your draft before applying it.';
  if (status === 404 || status === 501) return 'Session Context Bags are not available on this server.';
  return error instanceof Error ? error.message : 'The server could not confirm this operation. Your draft is retained.';
};
const refsKey = (refs: readonly ContextEntryRef[]): string => JSON.stringify([...refs].sort((a, b) => a.entryId.localeCompare(b.entryId)));

/** One shell instance owns its session tabs. Cached snapshots never substitute for denied server reads. */
@Injectable()
export class SessionWorkspaceService {
  private readonly api = inject(SessionContextApiService);
  private readonly drafts = inject(SESSION_DEVICE_DRAFTS);
  private project?: IProjectRef;
  private authActorHint = '';
  private generation = 0;
  private focusGeneration = 0;
  private readonly snapshots = signal<Readonly<Record<string, ContextSnapshot>>>({});
  private readonly deviceDrafts = signal<Readonly<Record<string, SessionDeviceDraft>>>({});
  private saveQueue = Promise.resolve();
  private readonly pending = signal<SessionPendingOperation | undefined>(undefined);
  private readonly lastReceipt = signal<ContextReceipt | undefined>(undefined);
  readonly capabilities = signal<ContextCapabilities | undefined>(undefined);
  readonly sessions = signal<readonly ContextSession[]>([]);
  readonly openSessionIds = signal<readonly string[]>([]);
  readonly focusedSessionId = signal('');
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly draftError = signal('');
  readonly notice = signal('');
  readonly receipt = this.lastReceipt.asReadonly();
  readonly bagEditorRequests = signal(0);
  requestBagEditor(): void { this.bagEditorRequests.update((count) => count + 1); }
  readonly nextCursor = signal<string | undefined>(undefined);
  readonly hasMore = signal(false);
  readonly snapshot = computed(() => this.snapshots()[this.focusedSessionId()]);
  readonly session = computed(() => this.snapshot()?.session);
  readonly draft = computed(() => this.deviceDrafts()[this.focusedSessionId()]);
  readonly selectedBag = computed(() => this.snapshot()?.bags.find((bag) => bag.id === this.draft()?.selectedBagId));
  readonly selectedEntries = computed(() => {
    const snapshot = this.snapshot(), bag = this.selectedBag();
    return snapshot?.entries.filter((entry) => entry.bagId === bag?.id) ?? [];
  });
  readonly openSessions = computed(() => this.openSessionIds().map((id) => this.sessions().find((session) => session.id === id)).filter((session): session is ContextSession => !!session));
  readonly appliedCount = computed(() => this.snapshot()?.contextSet.enabled ? this.snapshot()?.contextSet.slots.reduce((sum, slot) => sum + slot.entries.length, 0) ?? 0 : 0);
  readonly canExecute = computed(() => this.session()?.state === 'active' && !this.pending() && !this.draftError());
  readonly canRetry = computed(() => !!this.pending() && !this.busy());
  readonly hasPendingSelection = computed(() => {
    const snapshot = this.snapshot(), draft = this.draft(), bag = this.selectedBag();
    if (!snapshot || !draft || !bag) return false;
    const slot = this.slotFor(snapshot, bag.scope);
    return draft.enabled !== snapshot.contextSet.enabled ||
      refsKey(draft.selections[bag.id] ?? []) !== refsKey(slot?.bagId === bag.id ? slot.entries : []) ||
      (slot?.bagId === bag.id && slot.bagVersion !== bag.version);
  });

  setActor(actor: string): void {
    if (actor === this.authActorHint) return;
    this.authActorHint = actor;
    this.reset();
  }

  async openProject(project: IProjectRef): Promise<void> {
    if (equalProjectRef(this.project, project) && this.capabilities()) return;
    this.reset();
    this.project = project;
    const generation = this.generation;
    this.loading.set(true);
    try {
      const capabilities = await this.api.capabilities(project);
      const page = await this.api.list(project, capabilities);
      const pending = await this.drafts.readPending(this.pendingKey(project, capabilities));
      if (generation !== this.generation) return;
      this.capabilities.set(capabilities);
      const actorPending = pending?.capabilities.actorId === capabilities.actorId ? pending : undefined;
      this.pending.set(actorPending);
      if (actorPending) this.error.set('An operation with no confirmed receipt was recovered for this local principal. Retry the same operation before making another change.');
      this.sessions.set(page.items.filter((session) => session.state !== 'deleted'));
      this.nextCursor.set(page.nextCursor);
      this.hasMore.set(page.hasMore);
      this.openSessionIds.set(this.readOpenTabs(capabilities).filter((id) => page.items.some((session) => session.id === id)));
    } catch (error) {
      if (generation === this.generation) this.error.set(errorMessage(error));
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    const project = this.project, capabilities = this.capabilities();
    if (!project || !capabilities || this.loading() || !this.hasMore()) return;
    const generation = this.generation;
    this.loading.set(true);
    try {
      const page = await this.api.list(project, capabilities, this.nextCursor());
      if (generation !== this.generation) return;
      this.sessions.update((sessions) => [...sessions, ...page.items.filter((item) => !sessions.some((session) => session.id === item.id) && item.state !== 'deleted')]);
      this.nextCursor.set(page.nextCursor); this.hasMore.set(page.hasMore);
    } catch (error) { if (generation === this.generation) this.error.set(errorMessage(error)); }
    finally { if (generation === this.generation) this.loading.set(false); }
  }

  async focus(sessionId: string): Promise<void> {
    const project = this.project, capabilities = this.capabilities();
    if (!project || !capabilities || !contextOpaqueId(sessionId)) return;
    if (!(await this.flushDraft())) return;
    const generation = this.generation;
    const focusGeneration = ++this.focusGeneration;
    this.focusedSessionId.set(sessionId); this.loading.set(true); this.error.set('');
    try {
      const snapshot = await this.api.read(project, capabilities, sessionId);
      const restoredDraft = await this.drafts.read(this.draftKey(sessionId));
      if (generation !== this.generation || focusGeneration !== this.focusGeneration) return;
      this.acceptSnapshot(snapshot);
      if (!this.deviceDrafts()[sessionId]) this.deviceDrafts.update((drafts) => ({ ...drafts, [sessionId]: this.reconcileDraft(snapshot, restoredDraft) }));
      this.openSessionIds.update((ids) => ids.includes(sessionId) ? ids : [...ids, sessionId]);
      this.saveOpenTabs();
    } catch (error) {
      if (generation !== this.generation || focusGeneration !== this.focusGeneration) return;
      this.snapshots.update((snapshots) => { const next = { ...snapshots }; delete next[sessionId]; return next; });
      this.error.set(errorMessage(error));
    } finally { if (generation === this.generation && focusGeneration === this.focusGeneration) this.loading.set(false); }
  }

  async closeTab(id: string): Promise<string | undefined> {
    if (!(await this.flushDraft())) return undefined;
    const ids = this.openSessionIds(), index = ids.indexOf(id);
    const remaining = ids.filter((item) => item !== id);
    this.openSessionIds.set(remaining); this.saveOpenTabs();
    if (this.focusedSessionId() !== id) return this.focusedSessionId();
    const next = remaining[Math.min(index, remaining.length - 1)] ?? '';
    this.focusedSessionId.set(next);
    return next;
  }

  async create(title: string, scope: SessionScope): Promise<string | undefined> {
    const capabilities = this.capabilities();
    if (!capabilities || !title.trim() || !this.scopeAdmitted(scope)) return undefined;
    const sessionId = randomId('s');
    const success = await this.execute({ opId: randomId('op'), action: 'createSession', sessionId, bagId: randomId('b'), title: title.trim(), scope });
    return success ? sessionId : undefined;
  }

  async importLegacy(legacyImport: ContextLegacyImport): Promise<string | undefined> {
    if (!this.scopeAdmitted(legacyImport.scope) || !legacyImport.sourceId ||
      legacyImport.entries.length > 400 || legacyImport.messages.length > 1000 ||
      legacyImport.messages.some((message) => message.text.length > 100_000)) {
      this.error.set('This legacy import is outside the admitted scope or size limit. Review it before continuing.');
      return undefined;
    }
    const success = await this.execute({ opId: randomId('op'), action: 'importLegacy', sessionId: '', legacyImport });
    return success ? this.lastReceipt()?.sessionId : undefined;
  }

  async createBag(title: string, scope: SessionScope): Promise<void> {
    const session = this.session();
    if (!session || !title.trim() || !this.scopeAdmitted(scope)) return;
    const bagId = randomId('b');
    if (await this.execute({ opId: randomId('op'), action: 'createBag', sessionId: session.id, expectedVersion: session.version, bagId, title: title.trim(), scope })) this.chooseBag(bagId);
  }

  async putEntry(subject: ContextSubject, value: ContextValue, alias?: string, entry?: ContextEntry): Promise<boolean> {
    const session = this.session(), bag = this.selectedBag();
    if (!session || !bag) return false;
    const entryId = entry?.id ?? randomId('e'), revisionId = randomId('er');
    const success = await this.execute({ opId: randomId('op'), action: 'putEntry', sessionId: session.id,
      expectedVersion: session.version, bagId: bag.id, expectedBagVersion: bag.version,
      entryId, expectedEntryVersion: entry?.version ?? 0, revisionId, subject, value, ...(alias?.trim() ? { alias: alias.trim() } : {}) });
    if (success) this.updateDraft((draft) => ({ ...draft, selections: { ...draft.selections,
      [bag.id]: [...(draft.selections[bag.id] ?? []).filter((ref) => ref.entryId !== entryId), { entryId, revisionId }],
    } }));
    return success;
  }

  chooseBag(id: string): void {
    if (!this.snapshot()?.bags.some((bag) => bag.id === id)) return;
    this.updateDraft((draft) => ({ ...draft, selectedBagId: id }));
  }
  stageEnabled(enabled: boolean): void { this.updateDraft((draft) => ({ ...draft, enabled })); }
  isChecked(entryId: string): boolean { const draft = this.draft(); return !!draft?.selections[draft.selectedBagId]?.some((ref) => ref.entryId === entryId); }
  stageEntry(entry: ContextEntry, checked: boolean): void {
    this.updateDraft((draft) => ({ ...draft, selections: { ...draft.selections,
      [entry.bagId]: [...(draft.selections[entry.bagId] ?? []).filter((ref) => ref.entryId !== entry.id), ...(checked ? [{ entryId: entry.id, revisionId: entry.currentRevisionId }] : [])],
    } }));
  }

  async apply(): Promise<void> {
    const snapshot = this.snapshot(), bag = this.selectedBag(), draft = this.draft();
    if (!snapshot || !bag || !draft || !this.hasPendingSelection()) return;
    const slot = this.slotFor(snapshot, bag.scope);
    await this.execute({ opId: randomId('op'), action: 'applyContext', sessionId: snapshot.session.id,
      expectedVersion: snapshot.session.version, bagId: bag.id, expectedBagVersion: bag.version,
      expectedSlotVersion: slot?.version ?? 0, expectedContextSetId: snapshot.contextSet.id,
      selection: draft.selections[bag.id] ?? [], enabled: draft.enabled });
  }

  async clearBag(): Promise<void> {
    const snapshot = this.snapshot(), bag = this.selectedBag();
    if (!snapshot || !bag) return;
    const slot = this.slotFor(snapshot, bag.scope);
    const entryIds = new Set(bag.entryIds);
    if (await this.execute({ opId: randomId('op'), action: 'clearBag', sessionId: snapshot.session.id,
      expectedVersion: snapshot.session.version, bagId: bag.id, expectedBagVersion: bag.version,
      expectedSlotVersion: slot?.version ?? 0, expectedContextSetId: snapshot.contextSet.id })) {
      this.updateDraft((draft) => ({ ...draft, selections: { ...draft.selections, [bag.id]: [] }, attachments: draft.attachments.filter((ref) => !entryIds.has(ref.entryId)) }), snapshot.session.id);
      this.notice.set(`Cleared ${bag.title}. Its unsent attachments were removed; composer text and other bags are retained.`);
    }
  }

  async transition(transition: NonNullable<ContextCommand['transition']>): Promise<void> {
    const session = this.session();
    if (!session) return;
    await this.flushDraft();
    await this.execute({ opId: randomId('op'), action: 'transitionSession', sessionId: session.id, expectedVersion: session.version, transition });
  }
  async rename(title: string, bag = false): Promise<void> {
    const session = this.session(), selectedBag = this.selectedBag();
    if (!session || !title.trim() || (bag && !selectedBag)) return;
    await this.execute({ opId: randomId('op'), action: bag ? 'renameBag' : 'renameSession', sessionId: session.id, expectedVersion: session.version,
      title: title.trim(), ...(bag && selectedBag ? { bagId: selectedBag.id, expectedBagVersion: selectedBag.version } : {}) });
  }

  attach(entry: ContextEntry): void {
    this.updateDraft((draft) => ({ ...draft, attachments: [...draft.attachments.filter((ref) => ref.entryId !== entry.id), { entryId: entry.id, revisionId: entry.currentRevisionId }] }));
  }
  attachChecked(): void {
    for (const entry of this.selectedEntries()) if (this.isChecked(entry.id)) this.attach(entry);
  }
  attachAll(): void { for (const entry of this.selectedEntries()) this.attach(entry); }
  pinAttachment(entryId: string, pinned: boolean): void {
    this.updateDraft((draft) => ({ ...draft, pinnedAttachments: [...(draft.pinnedAttachments ?? []).filter((id) => id !== entryId), ...(pinned ? [entryId] : [])] }));
  }
  detach(entryId: string): void { this.updateDraft((draft) => ({ ...draft, attachments: draft.attachments.filter((ref) => ref.entryId !== entryId) })); }
  setComposer(composer: string): void { this.updateDraft((draft) => ({ ...draft, composer })); }
  async retry(): Promise<void> {
    const pending = this.pending();
    if (!pending || this.busy()) return;
    const generation = this.generation;
    const operationIsCurrent = (): boolean => generation === this.generation && this.pending() === pending &&
      equalProjectRef(this.project, pending.project);
    const contextIsCurrent = (): boolean => operationIsCurrent() && this.capabilities()?.actorId === pending.capabilities.actorId &&
      this.capabilities()?.databaseId === pending.capabilities.databaseId && this.capabilities()?.projectId === pending.capabilities.projectId;
    const isCurrent = contextIsCurrent;
    const capabilities = this.capabilities();
    if (!capabilities || pending.capabilities.actorId !== capabilities.actorId) {
      if (!operationIsCurrent()) return;
      this.pending.set(undefined);
      this.error.set('The recovered operation belongs to a different local principal. It was not replayed.');
      return;
    }
    this.busy.set(true);
    let receipt: ContextReceipt;
    try {
      receipt = await this.api.operation(pending.project, pending.capabilities, pending.command.opId);
      if (!isCurrent()) return;
    } catch (error) {
      if (!isCurrent()) return;
      if (errorStatus(error) !== 404) {
        this.error.set(errorMessage(error));
        this.busy.set(false);
        return;
      }
      // Only a missing operation receipt permits retrying this exact command.
      this.busy.set(false);
      await this.execute(pending.command, true, { generation, pending, isCurrent });
      return;
    }
    const targetSessionId = pending.command.action === 'importLegacy' ? receipt.sessionId : pending.command.sessionId;
    try {
      const snapshot = await this.api.read(pending.project, pending.capabilities, targetSessionId);
      if (!isCurrent()) return;
      await this.drafts.removePending(this.pendingKey(pending.project, pending.capabilities));
      if (!isCurrent()) return;
      this.acceptSnapshot(snapshot);
      this.lastReceipt.set(receipt);
      this.pending.set(undefined);
      this.error.set('');
    } catch (error) {
      if (!isCurrent()) return;
      // The operation is confirmed. A snapshot read failure must never turn it
      // into a second dispatch, even when that read also returns 404.
      this.error.set(`The operation is confirmed, but its saved session could not be refreshed: ${errorMessage(error)}`);
    }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
  async pinInput(sessionId: string, scope: SessionScope, kind: 'dashboard' | 'chat' | 'query', definitionId: string, definitionRevision: string, text?: string, resolvedParameters?: Readonly<Record<string, TypedValue>>, definitionDocument?: ContextDefinitionDocument): Promise<{ runId: string; run: ContextRun; input: ContextInputSnapshot; revisions: readonly ContextEntryRevision[] } | undefined> {
    const snapshot = this.snapshotFor(sessionId), project = this.project, capabilities = this.capabilities();
    if (!snapshot || !project || !capabilities || !this.canExecuteFor(sessionId)) return undefined;
    const inputSnapshotId = randomId('input'), runId = randomId('run');
    const draft = this.deviceDrafts()[sessionId];
    const attachments = kind === 'chat' ? (draft?.attachments ?? []).map((ref) => {
      const entry = snapshot.entries.find((entry) => entry.id === ref.entryId);
      if (!entry) throw new Error('A composer attachment was cleared or is unavailable. Remove it before sending.');
      return { entryId: ref.entryId, revisionId: draft?.pinnedAttachments?.includes(ref.entryId) ? ref.revisionId : entry.currentRevisionId };
    }) : [];
    if (!(await this.execute({ opId: randomId('op'), action: 'pinInput', sessionId, expectedVersion: snapshot.session.version,
      inputSnapshotId, runId, scope, kind, definitionId, definitionRevision, attachments, ...(text !== undefined ? { text } : {}), ...(resolvedParameters ? { resolvedParameters } : {}), ...(definitionDocument ? { definitionDocument } : {}) }))) return undefined;
    const result = await this.api.input(project, capabilities, inputSnapshotId);
    if (result.input.sessionId !== sessionId || result.input.id !== inputSnapshotId || !sameContextScope(result.input.scope, scope)) throw new Error('The server returned a mismatched input snapshot.');
    const run = await this.api.run(project, capabilities, runId);
    if (run.sessionId !== sessionId || run.inputSnapshotId !== inputSnapshotId || run.kind !== kind) throw new Error('The server returned a run for a different accepted input.');
    return { runId, run, ...result };
  }
  async reportDashboard(sessionId: string, runId: string, widgets: readonly ContextWidgetOutcome[]): Promise<boolean> {
    return this.execute({ opId: randomId('op'), action: 'reportDashboard', sessionId, runId, expectedRunVersion: 1,
      runState: widgets.every((widget) => widget.state === 'completed') ? 'completed' : 'failed', widgets,
      resultRefs: widgets.flatMap((widget) => widget.resultRef ? [widget.resultRef] : []),
    });
  }
  async reportClientRun(sessionId: string, runId: string, kind: 'chat' | 'dashboard' | 'query', widgets: readonly ContextWidgetOutcome[], expectedRunVersion = 1, text?: string): Promise<boolean> {
    if (widgets.some((widget) => widget.state === 'completed' && !contextOpaqueId(widget.resultRef))) {
      this.error.set('A completed widget needs its content fingerprint before its outcome can be reported.');
      return false;
    }
    const failed = widgets.some((widget) => widget.state === 'failed');
    const reportedWidgets = widgets.map((widget) => widget.state === 'failed' && !widget.errorCode
      ? { ...widget, errorCode: 'CLIENT_EXECUTION_FAILED' }
      : widget);
    return this.execute({ opId: randomId('op'), action: 'reportClientRun', sessionId, runId, kind, expectedRunVersion,
      runState: reportedWidgets.every((widget) => widget.state === 'completed') ? 'completed' : 'failed', widgets: reportedWidgets,
      ...(failed ? { errorCode: reportedWidgets.find((widget) => widget.state === 'failed')?.errorCode ?? 'CLIENT_EXECUTION_FAILED' } : {}),
      ...(text !== undefined ? { text } : {}),
      resultRefs: reportedWidgets.flatMap((widget) => widget.resultRef ? [widget.resultRef] : []),
    });
  }
  async inspectAcceptedClientRun(sessionId: string, runId: string): Promise<ContextRun | undefined> {
    const project = this.project, capabilities = this.capabilities();
    if (!project || !capabilities || !capabilities.actions.includes('reportClientRun')) return undefined;
    const run = await this.api.run(project, capabilities, runId);
    if (run.sessionId !== sessionId || run.executionAuthority !== 'client' || run.state !== 'accepted' ||
      !['chat', 'dashboard', 'query'].includes(run.kind)) return undefined;
    return run;
  }
  async acknowledgeClientOutcomeUnknown(sessionId: string, runId: string): Promise<boolean> {
    const run = await this.inspectAcceptedClientRun(sessionId, runId);
    if (!run) {
      this.error.set('This run is no longer an accepted client run. Refresh history and review its current outcome.');
      return false;
    }
    return this.execute({ opId: randomId('op'), action: 'reportClientRun', sessionId, runId,
      kind: run.kind as 'chat' | 'dashboard' | 'query', expectedRunVersion: run.version,
      runState: 'outcome-unknown', errorCode: 'CLIENT_OUTCOME_UNKNOWN' });
  }
  async recordRunExecution(sessionId: string, runId: string, executionDocument: ContextDefinitionDocument, resolvedParameters: Readonly<Record<string, TypedValue>>): Promise<number | undefined> {
    const snapshot = this.snapshotFor(sessionId);
    if (!snapshot) return undefined;
    if (!(await this.execute({ opId: randomId('op'), action: 'recordRunExecution', sessionId, runId,
      expectedVersion: snapshot.session.version, expectedRunVersion: 1, executionDocument, resolvedParameters }))) return undefined;
    const receipt = this.lastReceipt();
    if (receipt?.resourceId !== runId || !Number.isSafeInteger(receipt.resourceVersion)) throw new Error('The execution plan version was not confirmed. No source query was started.');
    return receipt.resourceVersion;
  }
  deviceViewKey(sessionId: string, kind: string, authority?: { actorId?: string; databaseId?: string; project?: IProjectRef }): string {
    return JSON.stringify(['datatug-session-view/1', authority?.actorId ?? this.capabilities()?.actorId,
      projectRefToString(authority?.project ?? this.project), authority?.databaseId ?? this.capabilities()?.databaseId, sessionId, kind]);
  }
  history(sessionId: string, cursor?: string) {
    const project = this.project, capabilities = this.capabilities();
    if (!project || !capabilities) throw new Error('The session authority is unavailable.');
    return this.api.runs(project, capabilities, sessionId, cursor);
  }
  messages(sessionId: string, cursor?: string) {
    const project = this.project, capabilities = this.capabilities();
    if (!project || !capabilities) throw new Error('The session authority is unavailable.');
    return this.api.messages(project, capabilities, sessionId, cursor);
  }

  appliedFor(scope: SessionScope): AppliedContextSlot | undefined {
    const snapshot = this.snapshot();
    if (!snapshot?.contextSet.enabled) return undefined;
    const slot = this.slotFor(snapshot, scope);
    return slot?.bagId ? slot : undefined;
  }
  appliedForEnvironment(environmentId: string): AppliedContextSlot | undefined {
    const scopes = this.capabilities()?.environments.filter((scope) => scope.environmentId === environmentId) ?? [];
    return scopes.length === 1 ? this.appliedFor(scopes[0]) : undefined;
  }
  snapshotFor(sessionId: string): ContextSnapshot | undefined { return this.snapshots()[sessionId]; }
  canExecuteFor(sessionId: string): boolean {
    return this.snapshots()[sessionId]?.session.state === 'active' && this.pending()?.command.sessionId !== sessionId && !this.draftError();
  }
  /** Only pinned revisions in the exact admitted environment/identity domain become facts. */
  appliedFactsFor(sessionId: string, environmentId: string): readonly Fact[] {
    const snapshot = this.snapshotFor(sessionId);
    const scopes = this.capabilities()?.environments.filter((scope) => scope.environmentId === environmentId) ?? [];
    if (!snapshot?.contextSet.enabled || scopes.length !== 1) return [];
    const slot = this.slotFor(snapshot, scopes[0]);
    if (!slot?.bagId) return [];
    return slot.entries.flatMap((ref): Fact[] => {
      const revision = snapshot.revisions.find((item) => item.id === ref.revisionId && item.entryId === ref.entryId && item.bagId === slot.bagId);
      const subject = revision?.subject;
      if (!revision || !subject?.conceptId || !subject.fieldId || !subject.fieldMappingRef || revision.value.schemaVersion !== 1) return [];
      if (!this.capabilities()?.subjects?.some((candidate) => sameContextScope(candidate.scope, scopes[0]) && sameContextSubject(candidate.subject, subject))) return [];
      const base = { id: revision.id, entity: subject.conceptId, field: subject.fieldId, origin: 'context' as const, enabled: true, mapping: 'declared' as const };
      if (revision.value.kind === 'scalar' && revision.value.scalar) return [{ ...base, value: revision.value.scalar }];
      if (revision.value.kind === 'set' && revision.value.values) return [{ ...base, condition: 'in', values: revision.value.values }];
      return [];
    });
  }
  bindingScopeKey(sessionId: string, environmentId: string): string | undefined {
    const snapshot = this.snapshotFor(sessionId);
    const scopes = this.capabilities()?.environments.filter((scope) => scope.environmentId === environmentId) ?? [];
    return snapshot && scopes.length === 1 ? JSON.stringify([snapshot.session.databaseId, snapshot.session.projectId, sessionId, contextScopeKey(scopes[0]), snapshot.contextSet.id]) : undefined;
  }
  revision(ref: ContextEntryRef): ContextSnapshot['revisions'][number] | undefined {
    return this.snapshot()?.revisions.find((revision) => revision.id === ref.revisionId && revision.entryId === ref.entryId);
  }
  entryLabel(entry: ContextEntry): string { return entry.alias || entry.subject.record || entry.subject.conceptId; }
  valueLabel(ref: ContextEntryRef): string {
    const value = this.revision(ref)?.value;
    if (!value || value.schemaVersion !== 1) return 'Unsupported value';
    return value.kind === 'scalar' ? String(value.scalar?.value ?? 'null') : value.kind === 'set' ? `${value.values?.length ?? value.keys?.length ?? 0} values` : 'Unsupported value';
  }

  private async execute(command: ContextCommand, retry = false, retryGuard?: { generation: number; pending: SessionPendingOperation; isCurrent: () => boolean }): Promise<boolean> {
    const retryPending = retryGuard?.pending ?? this.pending();
    const project = retry ? retryPending?.project : this.project;
    const capabilities = retry ? retryPending?.capabilities : this.capabilities();
    if (!project || !capabilities || this.busy() || (!retry && this.pending())) return false;
    if (retryGuard && !retryGuard.isCurrent()) return false;
    if (retry && capabilities.actorId !== this.capabilities()?.actorId) {
      if (retryGuard && !retryGuard.isCurrent()) return false;
      this.pending.set(undefined);
      this.error.set('The recovered operation belongs to a different local principal. It was not replayed.');
      return false;
    }
    if (!capabilities.actions.includes(command.action)) { this.error.set('This server does not support this session action.'); return false; }
    const terminalOutcome = command.action === 'reportClientRun' || command.action === 'reportDashboard';
    const generation = retryGuard?.generation ?? this.generation;
    const isContextCurrent = (): boolean => generation === this.generation && equalProjectRef(this.project, project) &&
      this.capabilities()?.actorId === capabilities.actorId && this.capabilities()?.databaseId === capabilities.databaseId &&
      this.capabilities()?.projectId === capabilities.projectId;
    const isCurrent = (): boolean => isContextCurrent() && (!retryGuard || retryGuard.isCurrent());
    // An unrelated device-draft quota error cannot prevent the receipt for
    // source work that has already been accepted or executed.
    if (!terminalOutcome && !(await this.flushDraft())) return false;
    if (!isCurrent()) return false;
    const pending = retry ? retryPending : { project, capabilities, command };
    if (!pending) return false;
    const pendingKey = this.pendingKey(project, capabilities);
    let dispatched = false;
    let commandAccepted = false;
    this.pending.set(pending); this.busy.set(true); this.error.set('');
    try {
      await this.drafts.writePending(pendingKey, pending);
      if (!isCurrent()) return false;
      dispatched = true;
      const receipt = await this.api.command(project, capabilities, command);
      if (!isCurrent()) return false;
      commandAccepted = true;
      const targetSessionId = command.action === 'importLegacy' ? receipt.sessionId : command.sessionId;
      if (!contextOpaqueId(targetSessionId)) throw new Error('The server returned an invalid imported session ID.');
      const snapshot = await this.api.read(project, capabilities, targetSessionId);
      if (!isCurrent()) return false;
      await this.drafts.removePending(pendingKey);
      if (!isCurrent()) return false;
      this.acceptSnapshot(snapshot);
      this.lastReceipt.set(receipt);
      this.pending.set(undefined);
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      const status = errorStatus(error);
      if (!dispatched || (!commandAccepted && [400, 401, 403, 404, 409, 422].includes(status as number))) {
        await this.drafts.removePending(pendingKey).catch(() => undefined);
        if (!isCurrent()) return false;
        this.pending.set(undefined);
        if (status === 401 || status === 403) {
          this.snapshots.update((snapshots) => { const next = { ...snapshots }; delete next[command.sessionId]; return next; });
          this.sessions.update((sessions) => sessions.filter((session) => session.id !== command.sessionId));
        } else if (status === 409) {
          try {
            const snapshot = await this.api.read(project, capabilities, command.sessionId);
            if (isContextCurrent()) this.acceptSnapshot(snapshot);
          }
          catch { /* Preserve the rejected draft; no source execution occurs on reread. */ }
        }
      }
      if (isContextCurrent()) this.error.set(!dispatched ? 'The pending operation could not be saved on this device. No command was sent. Retry saving before continuing.' : errorMessage(error));
      return false;
    }
    finally { if (generation === this.generation) this.busy.set(false); }
  }

  private acceptSnapshot(snapshot: ContextSnapshot): void {
    this.snapshots.update((snapshots) => ({ ...snapshots, [snapshot.session.id]: snapshot }));
    this.sessions.update((sessions) => [...sessions.filter((session) => session.id !== snapshot.session.id), ...(snapshot.session.state === 'deleted' ? [] : [snapshot.session])]);
    const draft = this.deviceDrafts()[snapshot.session.id];
    if (draft) this.deviceDrafts.update((drafts) => ({ ...drafts, [snapshot.session.id]: this.reconcileDraft(snapshot, draft) }));
  }
  private reconcileDraft(snapshot: ContextSnapshot, draft?: SessionDeviceDraft): SessionDeviceDraft {
    const selections = { ...(draft?.selections ?? {}) };
    for (const bag of snapshot.bags) {
      const slot = this.slotFor(snapshot, bag.scope);
      selections[bag.id] = (selections[bag.id] ?? (slot?.bagId === bag.id ? slot.entries : [])).filter((ref) => bag.entryIds.includes(ref.entryId));
    }
    const selectedBagId = draft?.selectedBagId && snapshot.bags.some((bag) => bag.id === draft.selectedBagId)
      ? draft.selectedBagId
      : snapshot.session.defaultBagId;
    return { selectedBagId,
      enabled: draft?.enabled ?? snapshot.contextSet.enabled, selections,
      attachments: (draft?.attachments ?? []).filter((ref) => snapshot.entries.some((entry) => entry.id === ref.entryId)), pinnedAttachments: draft?.pinnedAttachments ?? [], composer: draft?.composer ?? '' };
  }
  private slotFor(snapshot: ContextSnapshot, scope: SessionScope): AppliedContextSlot | undefined { return snapshot.contextSet.slots.find((slot) => sameContextScope(slot.scope, scope)); }
  private scopeAdmitted(scope: SessionScope): boolean { return !!this.capabilities()?.environments.some((item) => sameContextScope(item, scope)); }
  private updateDraft(update: (draft: SessionDeviceDraft) => SessionDeviceDraft, sessionId = this.focusedSessionId()): void {
    const old = this.deviceDrafts()[sessionId];
    if (!old) return;
    const next = update(old), key = this.draftKey(sessionId);
    this.deviceDrafts.update((drafts) => ({ ...drafts, [sessionId]: next }));
    this.saveQueue = this.saveQueue.catch(() => undefined).then(() => this.drafts.write(key, next)).then(() => this.draftError.set(''), () => this.draftError.set('The device draft could not be saved. Retry saving before switching or closing.'));
  }
  async flushDraft(): Promise<boolean> { await this.saveQueue; return !this.draftError(); }
  async retryDraft(): Promise<void> {
    const draft = this.draft();
    if (!draft) return;
    try { await this.drafts.write(this.draftKey(this.focusedSessionId()), draft); this.draftError.set(''); }
    catch { this.draftError.set('The device draft could not be saved. Stay here and retry.'); }
  }
  private tabKey(capabilities = this.capabilities()): string { return JSON.stringify(['datatug-session-tabs/1', capabilities?.actorId, projectRefToString(this.project)]); }
  private draftKey(sessionId: string): string { return JSON.stringify(['datatug-session-draft/1', this.capabilities()?.actorId, projectRefToString(this.project), this.capabilities()?.databaseId, sessionId]); }
  private pendingKey(project: IProjectRef, capabilities: ContextCapabilities): string { return JSON.stringify(['datatug-session-pending/1', capabilities.actorId, projectRefToString(project), capabilities.databaseId]); }
  private readOpenTabs(capabilities: ContextCapabilities): readonly string[] {
    try { const ids: unknown = JSON.parse(localStorage.getItem(this.tabKey(capabilities)) ?? '[]'); return Array.isArray(ids) ? ids.filter(contextOpaqueId) : []; }
    catch { return []; }
  }
  private saveOpenTabs(): void { try { localStorage.setItem(this.tabKey(), JSON.stringify(this.openSessionIds())); } catch { /* Tab preferences carry no authority; draft persistence has a separate error. */ } }
  private reset(): void {
    this.generation++; this.focusGeneration++; this.capabilities.set(undefined); this.sessions.set([]); this.snapshots.set({}); this.deviceDrafts.set({});
    this.focusedSessionId.set(''); this.openSessionIds.set([]); this.pending.set(undefined); this.busy.set(false); this.loading.set(false); this.error.set(''); this.draftError.set(''); this.notice.set('');
  }
}
