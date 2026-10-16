import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { SessionContextApiService } from './session-context-api.service';
import { ContextCapabilities } from './session-context-contract';
import {
  SessionDetectiveRequest,
  SessionDetectiveResponse,
} from './session-detective-contract';
import {
  NATIVE_OPERATION_STORE,
  NativeOperationDraft,
  nativeOperationDraftKey,
  SessionDetectiveOperationService,
} from './session-detective-operation.service';
import { detectiveOperationScopeKey } from './session-detective-contract';

const project = { storeId: 'http-localhost:8989', projectId: 'source-project' };
const locator = {
  storage: 'local',
  project: 'source-project',
  databaseId: 'private-db',
  projectId: 'private-project',
  namespaceId: 'private-ns',
};
const caps: ContextCapabilities = {
  schemaVersion: 1,
  actorId: 'alice',
  databaseId: locator.databaseId,
  projectId: locator.projectId,
  operationScope: locator,
  nativeDetective: true,
  actions: [],
  environments: [],
};
const request: SessionDetectiveRequest = {
  operationId: 'op_1',
  sessionId: 'session_1',
  expectedVersion: 2,
  expectedContextSetId: 'context_1',
  scope: { environmentId: 'demo', identityDomain: 'embedded' },
  checkId: 'check_1',
  inputs: { invoice_id: { type: 'integer', value: 'private-input' } },
};
const response = (done = false): SessionDetectiveResponse => ({
  operationId: request.operationId,
  operationScope: locator,
  status: {
    runId: 'run_1',
    state: done ? 'completed' : 'dispatching',
    produced: done,
    done,
  },
});
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};

describe('native Detective operation recovery', () => {
  let service: SessionDetectiveOperationService;
  let stored: Map<string, NativeOperationDraft>;
  let api: {
    nativeDetective: ReturnType<typeof vi.fn>;
    nativeDetectiveOperation: ReturnType<typeof vi.fn>;
    reconcileNativeDetective: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    stored = new Map();
    api = {
      nativeDetective: vi.fn(async () => response()),
      nativeDetectiveOperation: vi.fn(async () => response()),
      reconcileNativeDetective: vi.fn(async () => response()),
    };
    TestBed.configureTestingModule({
      providers: [
        SessionDetectiveOperationService,
        { provide: SessionContextApiService, useValue: api },
        {
          provide: NATIVE_OPERATION_STORE,
          useValue: {
            read: async (key: string) => stored.get(key),
            write: async (key: string, value: NativeOperationDraft) => {
              stored.set(key, structuredClone(value));
            },
            remove: async (key: string) => {
              stored.delete(key);
            },
            readRecovery: async () => undefined,
            writeRecovery: async () => undefined,
          },
        },
      ],
    });
    service = TestBed.inject(SessionDetectiveOperationService);
  });

  it('keeps the predeployment storage key for an unqualified project ref', () => {
    const key = nativeOperationDraftKey(project, caps.actorId, locator, request.sessionId, request.checkId);
    const legacyProject = 'source-project@http-localhost:8989';
    const legacyScope = detectiveOperationScopeKey(locator);

    expect(key).toBe(JSON.stringify([
      'native-detective/1', 'alice', legacyProject, '', legacyScope,
      'session_1', 'check_1', '',
    ]));
  });

  it('keeps the predeployment branch-qualified key, whose branch is already a separate key member', () => {
    const branched = { ...project, branch: 'main' };
    const key = nativeOperationDraftKey(branched, caps.actorId, locator, request.sessionId, request.checkId);

    expect(key).toBe(JSON.stringify([
      'native-detective/1', 'alice', 'source-project@http-localhost:8989', 'main',
      detectiveOperationScopeKey(locator), 'session_1', 'check_1', '',
    ]));
  });

  it('keeps the predeployment common-API project encoding inside native operation keys', () => {
    const commonApiProject = { ...project, projectApi: 'local' as const, branch: 'topic' };
    const key = nativeOperationDraftKey(commonApiProject, caps.actorId, locator, request.sessionId, request.checkId);

    expect(key).toBe(JSON.stringify([
      'native-detective/1', 'alice',
      '["common-project/1","local","http-localhost:8989","source-project","topic"]',
      'topic', detectiveOperationScopeKey(locator), 'session_1', 'check_1', '',
    ]));
  });
  it('persists original request before dispatch and reload only observes accepted metadata', async () => {
    await service.open(project, caps, request.sessionId, request.checkId);
    api.nativeDetective.mockImplementation(async () => {
      expect([...stored.values()][0].request).toEqual(request);
      return response();
    });
    await service.start(project, caps, request);
    await service.open(project, caps, request.sessionId, request.checkId);
    expect(api.nativeDetective).toHaveBeenCalledTimes(1);
    expect(api.nativeDetectiveOperation).toHaveBeenCalledTimes(1);
    expect(api.reconcileNativeDetective).not.toHaveBeenCalled();
    await service.observe();
    expect(api.reconcileNativeDetective).toHaveBeenCalledTimes(1);
    expect(api.nativeDetective).toHaveBeenCalledTimes(1);
  });
  it('retains uncertain acceptance and retries only immutable original bytes with the same ID', async () => {
    await service.open(project, caps, request.sessionId, request.checkId);
    api.nativeDetective.mockRejectedValueOnce(
      new HttpErrorResponse({ status: 0 }),
    );
    const editable = structuredClone(request);
    await service.start(project, caps, editable);
    if (!editable.inputs) throw new Error('Missing fixture inputs.');
    (editable.inputs['invoice_id'] as { value: string }).value = 'changed-form';
    expect(service.error()).not.toContain('private-input');
    await service.retry(caps);
    expect(api.nativeDetective.mock.calls[1][2]).toEqual(request);
  });
  it.each(['done', 'fenced', 'denied'])(
    'removes private request values on %s and reload never dispatches',
    async (kind) => {
      await service.open(project, caps, request.sessionId, request.checkId);
      if (kind === 'denied')
        api.nativeDetective.mockRejectedValue(
          new HttpErrorResponse({
            status: 403,
            error: { private: 'private-input' },
          }),
        );
      else
        api.nativeDetective.mockResolvedValue(
          kind === 'done'
            ? response(true)
            : {
                ...response(),
                status: {
                  ...response().status,
                  state: 'fenced',
                  fenceReason: 'contentrevoked',
                },
              },
        );
      await service.start(project, caps, request);
      expect(service.draft()?.request).toBeUndefined();
      expect(JSON.stringify([...stored.values()])).not.toContain(
        'private-input',
      );
      expect(service.error()).not.toContain('private-input');
      await service.retry(caps);
      expect(api.nativeDetective).toHaveBeenCalledTimes(1);
    },
  );
  it('separates actors and sessions without deleting another authority draft', async () => {
    await service.open(project, caps, request.sessionId, request.checkId);
    await service.start(project, caps, request);
    await service.open(
      project,
      { ...caps, actorId: 'bob' },
      request.sessionId,
      request.checkId,
    );
    expect(service.draft()).toBeUndefined();
    expect(stored.size).toBe(1);
    await service.open(project, caps, 'another-session', request.checkId);
    expect(service.draft()).toBeUndefined();
    expect(api.nativeDetectiveOperation).not.toHaveBeenCalled();
  });
  it('ignores stale async status after switching session', async () => {
    await service.open(project, caps, request.sessionId, request.checkId);
    await service.start(project, caps, request);
    const waiting = deferred<SessionDetectiveResponse>();
    api.reconcileNativeDetective.mockReturnValue(waiting.promise);
    const observe = service.observe();
    await service.open(project, caps, 'another-session', request.checkId);
    waiting.resolve(response(true));
    await observe;
    expect(service.draft()).toBeUndefined();
    expect(service.busy()).toBe(false);
  });
  it('invalidates a pending dispatch on capability loss or component destruction', async () => {
    await service.open(project, caps, request.sessionId, request.checkId);
    const waiting = deferred<SessionDetectiveResponse>();
    api.nativeDetective.mockReturnValue(waiting.promise);
    const start = service.start(project, caps, request);
    await vi.waitFor(() =>
      expect(api.nativeDetective).toHaveBeenCalledTimes(1),
    );
    service.invalidate();
    waiting.resolve(response(true));
    await start;
    expect(service.draft()).toBeUndefined();
    expect(service.busy()).toBe(false);
    expect([...stored.values()][0].request).toEqual(request);
    await service.retry(caps);
    expect(api.nativeDetective).toHaveBeenCalledTimes(1);
  });
  it('does not start with a default-off native capability', async () => {
    await service.open(project, caps, request.sessionId, request.checkId);
    await service.start(project, { ...caps, nativeDetective: false }, request);
    expect(api.nativeDetective).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
  });
});
