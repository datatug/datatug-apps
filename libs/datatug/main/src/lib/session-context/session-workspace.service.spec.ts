import { TestBed } from '@angular/core/testing';
import { SessionContextApiService } from './session-context-api.service';
import { SessionWorkspaceService, SESSION_DEVICE_DRAFTS, SessionDeviceDraft, SessionPendingOperation } from './session-workspace.service';
import { ContextCapabilities, ContextCommand, ContextReceipt, ContextSnapshot } from './session-context-contract';

const project = { storeId: 'http-localhost:8989', projectId: 'shop' };
const uat = { environmentId: 'uat', identityDomain: 'uat-orders' }, prod = { environmentId: 'prod', identityDomain: 'prod-orders' };
const subject = { conceptId: 'invoice', fieldId: 'InvoiceId', fieldMappingRef: 'invoice-key' };
const capabilities: ContextCapabilities = { schemaVersion: 1, actorId: 'local-principal', databaseId: 'ops', projectId: 'shop', environments: [uat, prod], actions: ['createSession', 'createBag', 'putEntry', 'applyContext', 'clearBag', 'transitionSession', 'reportClientRun'], subjects: [uat, prod].map((scope) => ({ id: scope.environmentId, label: 'Invoice ID', subject, scope, type: 'integer', shape: 'scalar' })) };
function snapshot(id = 's1'): ContextSnapshot {
  return {
    session: { schemaVersion: 1, id, owner: 'actor', databaseId: 'ops', projectId: 'shop', title: id, state: 'active', version: 3, defaultBagId: 'b1', bagIds: ['b1', 'b2'], contextSetId: 'cs1', createdAt: '', updatedAt: '' },
    bags: [{ id: 'b1', sessionId: id, title: 'UAT', scope: uat, version: 2, entryIds: ['e1'] }, { id: 'b2', sessionId: id, title: 'PROD', scope: prod, version: 2, entryIds: ['e2'] }],
    entries: ['e1', 'e2'].map((entryId, index) => ({ id: entryId, sessionId: id, bagId: `b${index + 1}`, subject, version: 1, currentRevisionId: `r${index + 1}` })),
    revisions: ['e1', 'e2'].map((entryId, index) => ({ id: `r${index + 1}`, entryId, bagId: `b${index + 1}`, subject, value: { schemaVersion: 1, kind: 'scalar', scalar: { type: 'integer', value: `${index + 1}` } }, createdAt: '' })),
    contextSet: { id: 'cs1', sessionId: id, enabled: true, createdAt: '', slots: [
      { scope: uat, bagId: 'b1', bagVersion: 2, version: 1, entries: [{ entryId: 'e1', revisionId: 'r1' }] },
      { scope: prod, bagId: 'b2', bagVersion: 2, version: 1, entries: [{ entryId: 'e2', revisionId: 'r2' }] },
    ] },
  };
}
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

describe('SessionWorkspaceService authority and draft boundaries', () => {
  let service: SessionWorkspaceService;
  let current: ContextSnapshot;
  let commands: ContextCommand[];
  let drafts: Map<string, SessionDeviceDraft>;
  let pending: Map<string, SessionPendingOperation>;
  let api: { capabilities: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn>; command: ReturnType<typeof vi.fn>; operation: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> };
  let write: ReturnType<typeof vi.fn>;
  const currentSnapshot = (): ContextSnapshot => {
    const value = service.snapshot();
    if (!value) throw new Error('The fixture session was not loaded.');
    return value;
  };
  beforeEach(async () => {
    localStorage.clear();
    current = snapshot(); commands = []; drafts = new Map(); pending = new Map();
    write = vi.fn(async (key: string, draft: SessionDeviceDraft) => { drafts.set(key, structuredClone(draft)); });
    api = {
      capabilities: vi.fn(async () => capabilities), list: vi.fn(async () => ({ items: [snapshot().session, snapshot('s2').session], hasMore: false })),
      read: vi.fn(async (_project, _caps, id: string) => structuredClone(id === current.session.id ? current : snapshot(id))),
      command: vi.fn(async (_project, _caps, command: ContextCommand) => {
        commands.push(command);
        if (command.action === 'applyContext') current = { ...current, session: { ...current.session, version: 4, contextSetId: 'cs2' }, contextSet: { ...current.contextSet, id: 'cs2', enabled: command.enabled ?? false, slots: current.contextSet.slots.map((slot) => slot.bagId === command.bagId ? { ...slot, version: slot.version + 1, entries: command.selection ?? [] } : slot) } };
        if (command.action === 'clearBag') current = { ...current, bags: current.bags.map((bag) => bag.id === command.bagId ? { ...bag, version: 3, entryIds: [] } : bag), entries: current.entries.filter((entry) => entry.bagId !== command.bagId), session: { ...current.session, version: 4, contextSetId: 'cs2' }, contextSet: { ...current.contextSet, id: 'cs2', slots: current.contextSet.slots.map((slot) => slot.bagId === command.bagId ? { ...slot, bagId: '', version: 2, entries: [] } : slot) } };
        return { opId: command.opId, sessionId: command.sessionId };
      }),
      operation: vi.fn(async () => { throw { status: 404 }; }),
      run: vi.fn(async (_project, _caps, id: string) => ({ id, sessionId: 's1', inputSnapshotId: 'input_1', kind: 'query', definitionId: 'query_1', definitionRevision: 'rev_1', executionAuthority: 'client', state: 'accepted', version: 4, createdAt: '' })),
    };
    TestBed.configureTestingModule({ providers: [SessionWorkspaceService, { provide: SessionContextApiService, useValue: api }, { provide: SESSION_DEVICE_DRAFTS, useValue: {
      read: async (key: string) => drafts.get(key), write,
      readPending: async (key: string) => pending.get(key),
      writePending: async (key: string, operation: SessionPendingOperation) => { pending.set(key, structuredClone(operation)); },
      removePending: async (key: string) => { pending.delete(key); },
    } }] });
    service = TestBed.inject(SessionWorkspaceService);
    await service.openProject(project); await service.focus('s1');
  });

  it('stages entry/master changes and applies only the selected environment', async () => {
    const before = service.appliedFactsFor('s1', 'uat');
    service.stageEntry(service.selectedEntries()[0], false); service.stageEnabled(false);
    expect(commands).toHaveLength(0);
    expect(service.appliedFactsFor('s1', 'uat')).toEqual(before);
    service.stageEnabled(true); await service.apply();
    expect(commands[0].selection).toEqual([]);
    expect(commands[0].expectedSlotVersion).toBe(1);
    expect(service.appliedFactsFor('s1', 'uat')).toEqual([]);
    expect(service.appliedFactsFor('s1', 'prod')[0].value).toEqual({ type: 'integer', value: '2' });
  });

  it('Clear removes this bag attachments and binding, retains text and the other bag/history', async () => {
    service.attach(currentSnapshot().entries[0]); service.attach(currentSnapshot().entries[1]); service.setComposer('Keep this typed question');
    await service.clearBag();
    expect(commands).toHaveLength(1); expect(commands[0].action).toBe('clearBag');
    expect(service.draft().composer).toBe('Keep this typed question');
    expect(service.draft().attachments).toEqual([{ entryId: 'e2', revisionId: 'r2' }]);
    expect(currentSnapshot().revisions).toHaveLength(2);
    expect(service.appliedFactsFor('s1', 'uat')).toEqual([]);
    expect(service.appliedFactsFor('s1', 'prod')).toHaveLength(1);
    expect(service.notice()).toContain('unsent attachments');
  });

  it('retains and recovers the same uncertain operation across a new client instance', async () => {
    api.command.mockRejectedValueOnce({ status: 0 });
    service.stageEntry(service.selectedEntries()[0], false); await service.apply();
    const recovered = [...pending.values()][0];
    expect(recovered.command.opId).toBeTruthy(); expect(service.canRetry()).toBe(true);
    const reopened = TestBed.runInInjectionContext(() => new SessionWorkspaceService());
    await reopened.openProject(project); await reopened.focus('s1'); await reopened.retry();
    expect(api.command.mock.calls[1][2]).toEqual(recovered.command);
    expect(pending.size).toBe(0); expect(reopened.canRetry()).toBe(false);
  });

  it('keeps an accepted command pending when the follow-up snapshot read returns 404', async () => {
    api.read.mockRejectedValueOnce({ status: 404 });
    service.stageEnabled(false);
    await service.apply();
    expect(commands).toHaveLength(1);
    expect(service.canRetry()).toBe(true);
    expect(pending.size).toBe(1);
    api.operation.mockResolvedValueOnce({ opId: commands[0].opId, sessionId: 's1', action: commands[0].action });
    api.read.mockRejectedValueOnce({ status: 404 });
    await service.retry();
    expect(commands).toHaveLength(1);
    expect(pending.size).toBe(1);
    expect(service.error()).toContain('operation is confirmed');
  });

  it('releases retry busy state when the operation lookup fails without a definitive receipt', async () => {
    api.command.mockRejectedValueOnce({ status: 0 });
    service.stageEnabled(false);
    await service.apply();
    expect(service.canRetry()).toBe(true);
    api.operation.mockRejectedValueOnce({ status: 503, message: 'temporarily unavailable' });

    await service.retry();

    expect(service.canRetry()).toBe(true);
    expect(service.busy()).toBe(false);
    expect(pending.size).toBe(1);
    expect(api.command).toHaveBeenCalledTimes(1);
  });

  it('does not apply a delayed operation lookup after changing principal and project', async () => {
    api.command.mockRejectedValueOnce({ status: 0 });
    service.stageEnabled(false); await service.apply();
    const original = [...pending.values()][0];
    const operation = deferred<ContextReceipt>();
    api.operation.mockImplementationOnce(() => operation.promise);
    const readCount = api.read.mock.calls.length;
    const retry = service.retry();
    await Promise.resolve();
    expect(api.operation).toHaveBeenCalledWith(project, capabilities, original.command.opId);

    const projectB = { ...project, projectId: 'shop-b' };
    const capabilitiesB = { ...capabilities, actorId: 'principal-b', databaseId: 'ops-b', projectId: 'shop-b' };
    api.capabilities.mockResolvedValue(capabilitiesB);
    api.list.mockResolvedValueOnce({ items: [snapshot('b1').session], hasMore: false });
    service.setActor('principal-b');
    await service.openProject(projectB);
    operation.resolve({ opId: original.command.opId, actor: 'principal-a', payloadDigest: 'sha256:receipt', sessionId: 's1', sessionVersion: 4, action: original.command.action, at: '2026-10-13T00:00:00Z' });
    await retry;

    expect(api.read).toHaveBeenCalledTimes(readCount);
    expect(service.sessions().map((session) => session.id)).toEqual(['b1']);
    expect(service.snapshotFor('s1')).toBeUndefined();
    expect(service.canRetry()).toBe(false);
    expect(pending.size).toBe(1);
  });

  it('does not apply a delayed snapshot read after changing principal and project', async () => {
    api.command.mockRejectedValueOnce({ status: 0 });
    service.stageEnabled(false); await service.apply();
    const original = [...pending.values()][0];
    api.operation.mockResolvedValueOnce({ opId: original.command.opId, sessionId: 's1', action: original.command.action });
    const delayedSnapshot = deferred<ContextSnapshot>();
    api.read.mockImplementationOnce(() => delayedSnapshot.promise);
    const retry = service.retry();
    await Promise.resolve(); await Promise.resolve();
    expect(api.read).toHaveBeenCalledWith(project, capabilities, 's1');

    const projectB = { ...project, projectId: 'shop-b' };
    const capabilitiesB = { ...capabilities, actorId: 'principal-b', databaseId: 'ops-b', projectId: 'shop-b' };
    api.capabilities.mockResolvedValue(capabilitiesB);
    api.list.mockResolvedValueOnce({ items: [snapshot('b1').session], hasMore: false });
    service.setActor('principal-b');
    await service.openProject(projectB);
    delayedSnapshot.resolve(snapshot('s1'));
    await retry;

    expect(service.sessions().map((session) => session.id)).toEqual(['b1']);
    expect(service.snapshotFor('s1')).toBeUndefined();
    expect(service.canRetry()).toBe(false);
    expect(pending.size).toBe(1);
  });

  it('reports Core-valid client outcome fields without claiming server artifacts', async () => {
    await service.reportClientRun('s1', 'run_123', 'dashboard', [
      { id: 'lines', state: 'completed', resultRef: 'device_run_123_lines' },
      { id: 'genres', state: 'failed', errorCode: 'SOURCE_QUERY_FAILED' },
    ]);
    const report = commands[0];
    expect(report.action).toBe('reportClientRun');
    expect(report.runState).toBe('failed');
    expect(report.errorCode).toBe('SOURCE_QUERY_FAILED');
    expect(report.widgets).toEqual([
      { id: 'lines', state: 'completed', resultRef: 'device_run_123_lines' },
      { id: 'genres', state: 'failed', errorCode: 'SOURCE_QUERY_FAILED' },
    ]);
    expect(report.resultRefs).toEqual(['device_run_123_lines']);
    expect(report).not.toHaveProperty('caseId');
    expect(report).not.toHaveProperty('detectiveRunId');
  });

  it('requires a fresh accepted client run and reports unknown without fabricating an outcome', async () => {
    expect(await service.acknowledgeClientOutcomeUnknown('s1', 'run_1')).toBe(true);
    expect(api.run).toHaveBeenCalledWith(project, capabilities, 'run_1');
    const command = commands.at(-1);
    expect(command).toMatchObject({ action: 'reportClientRun', sessionId: 's1', runId: 'run_1', kind: 'query', expectedRunVersion: 4, runState: 'outcome-unknown', errorCode: 'CLIENT_OUTCOME_UNKNOWN' });
    expect(command).not.toHaveProperty('widgets');
    expect(command).not.toHaveProperty('resultRefs');
    expect(command).not.toHaveProperty('text');
  });

  it('refuses to mark server-owned or already terminal runs as client outcome-unknown', async () => {
    api.run.mockResolvedValueOnce({ id: 'run_server', sessionId: 's1', inputSnapshotId: 'input_1', kind: 'query', definitionId: 'q', definitionRevision: 'r', executionAuthority: 'server', state: 'accepted', version: 1, createdAt: '' });
    expect(await service.acknowledgeClientOutcomeUnknown('s1', 'run_server')).toBe(false);
    api.run.mockResolvedValueOnce({ id: 'run_done', sessionId: 's1', inputSnapshotId: 'input_1', kind: 'chat', definitionId: 'q', definitionRevision: 'r', executionAuthority: 'client', state: 'completed', version: 2, createdAt: '' });
    expect(await service.acknowledgeClientOutcomeUnknown('s1', 'run_done')).toBe(false);
    expect(commands).toEqual([]);
  });

  it('reports an accepted run outcome even when an unrelated device draft cannot be saved', async () => {
    service.setComposer('retain this draft');
    write.mockRejectedValueOnce(new Error('quota'));
    expect(await service.flushDraft()).toBe(false);
    expect(service.draftError()).toContain('could not be saved');
    expect(await service.reportClientRun('s1', 'run_123', 'dashboard', [
      { id: 'lines', state: 'failed', errorCode: 'SOURCE_QUERY_FAILED' },
    ])).toBe(true);
    expect(commands.at(-1)?.action).toBe('reportClientRun');
  });

  it('clears a definitively rejected operation when the HTTP status is nested in the error body', async () => {
    api.command.mockRejectedValueOnce({ error: { status: 400 } });
    service.stageEnabled(false);
    await service.apply();
    expect(service.canRetry()).toBe(false);
    expect(pending.size).toBe(0);
    expect(service.error()).toContain('rejected');
  });

  it('releases a definitive conflict, refreshes authority and permits a reviewed new operation', async () => {
    api.command.mockRejectedValueOnce({ status: 409 });
    service.stageEntry(service.selectedEntries()[0], false); await service.apply();
    expect(service.canRetry()).toBe(false); expect(pending.size).toBe(0);
    expect(service.hasPendingSelection()).toBe(true);
    expect(service.error()).toContain('review');
    await service.apply(); expect(commands).toHaveLength(1);
  });

  it('does not let a delayed read replace the focused session or clear its loading state', async () => {
    const first = deferred<ContextSnapshot>(), second = deferred<ContextSnapshot>();
    api.read.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const focusFirst = service.focus('s1'); await Promise.resolve(); await Promise.resolve();
    const focusSecond = service.focus('s2'); await Promise.resolve(); await Promise.resolve();
    first.resolve(snapshot('s1')); await focusFirst;
    expect(service.focusedSessionId()).toBe('s2'); expect(service.loading()).toBe(true);
    second.resolve(snapshot('s2')); await focusSecond;
    expect(service.snapshot()?.session.id).toBe('s2'); expect(service.loading()).toBe(false);
  });

  it('blocks closing/switching on a failed device save, and does not stop on close', async () => {
    write.mockRejectedValueOnce(new Error('quota'));
    service.setComposer('Unsaved question'); await service.flushDraft();
    expect(await service.closeTab('s1')).toBeUndefined();
    expect(service.focusedSessionId()).toBe('s1'); expect(commands).toHaveLength(0);
    await service.retryDraft();
    expect(await service.closeTab('s1')).toBe(''); expect(commands).toHaveLength(0);
  });

  it('purges a denied snapshot instead of showing its cached values', async () => {
    api.read.mockRejectedValueOnce({ status: 403 }); await service.focus('s1');
    expect(service.snapshot()).toBeUndefined(); expect(service.appliedFactsFor('s1', 'uat')).toEqual([]);
    expect(service.error()).toContain('Access');
  });

  it('keys drafts by database, actor, project and session', async () => {
    service.setComposer('Draft'); await service.flushDraft();
    expect([...drafts.keys()][0]).toContain('ops'); expect([...drafts.keys()][0]).toContain('s1');
  });

  it('isolates local drafts, pending operations and tabs by the server principal', async () => {
    service.setComposer('Private draft for principal A');
    await service.flushDraft();
    api.command.mockRejectedValueOnce({ status: 0 });
    service.stageEnabled(false);
    await service.apply();
    expect(service.canRetry()).toBe(true);
    const priorCalls = api.command.mock.calls.length;

    api.capabilities.mockResolvedValue({ ...capabilities, actorId: 'local-principal-b' });
    const principalB = TestBed.runInInjectionContext(() => new SessionWorkspaceService());
    await principalB.openProject(project);
    expect(principalB.openSessionIds()).toEqual([]);
    expect(principalB.canRetry()).toBe(false);
    await principalB.retry();
    expect(api.command.mock.calls).toHaveLength(priorCalls);
    await principalB.focus('s1');
    expect(principalB.draft().composer).toBe('');
    expect(principalB.deviceViewKey('s1', 'chat-replies')).not.toBe(service.deviceViewKey('s1', 'chat-replies'));
  });
});
