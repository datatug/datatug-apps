import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  RouterLink,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { SneatAuthStateService } from '@sneat/auth-core';
import { SessionDetectiveRecoveryComponent } from './session-detective-recovery.component';
import {
  NATIVE_OPERATION_STORE,
  NativeOperationDraft,
  NativeOperationRecovery,
  nativeOperationDraftKey,
  sameNativeOperation,
} from './session-detective-operation.service';
import { SessionContextApiService } from './session-context-api.service';

const project = {
  storeId: 'firestore',
  projectId: 'source-project',
  spaceID: 'space-1',
};
const locator = {
  storage: 'firestore',
  project: 'source-project',
  spaceID: 'space-1',
  databaseId: 'ops',
  projectId: 'private-project',
  namespaceId: 'private-ns',
};
const recovery: NativeOperationRecovery = {
  recoveryId: 'recovery_1',
  draftKey: nativeOperationDraftKey(project, 'alice', locator, 's1', 'check_1'),
  actor: 'alice',
  project,
  locator,
  operationId: 'op_1',
  sessionId: 's1',
  checkId: 'check_1',
};
const result = {
  operationId: 'op_1',
  operationScope: locator,
  status: {
    runId: 'run_1',
    state: 'fenced',
    produced: true,
    done: true,
    fenceReason: 'contentrevoked',
  },
};
const privateDraft = {
  ...recovery,
  request: {
    operationId: 'op_1',
    sessionId: 's1',
    expectedVersion: 3,
    expectedContextSetId: 'cs1',
    scope: { environmentId: 'demo', identityDomain: 'private-domain' },
    checkId: 'check_1',
    inputs: {
      invoice_id: { type: 'integer', value: 'never-render-private-input' },
    },
  },
} as NativeOperationDraft;

function fixture(
  actor: string,
  denied = false,
  metadata: NativeOperationRecovery = recovery,
  active: NativeOperationDraft = privateDraft,
) {
  const authState = new BehaviorSubject({
    status: 'authenticated',
    user: { uid: actor },
  });
  const read = vi.fn(async () => privateDraft);
  const writes = new Map<string, NativeOperationDraft>([
    [metadata.draftKey, active],
  ]);
  const write = vi.fn(async (key: string, value: NativeOperationDraft) => {
    writes.set(key, value);
  });
  const readRecovery = vi.fn(async () => ({
    ...metadata,
    request: privateDraft.request,
  }));
  const api = {
    nativeDetectiveOperation: vi.fn(
      denied
        ? async () => {
            throw new HttpErrorResponse({ status: 403 });
          }
        : async () => result,
    ),
    reconcileNativeDetective: vi.fn(async () => result),
    nativeDetective: vi.fn(),
    capabilities: vi.fn(),
    read: vi.fn(),
    input: vi.fn(),
  };
  const paramMap = convertToParamMap({ recoveryId: 'recovery_1' });
  TestBed.configureTestingModule({
    imports: [SessionDetectiveRecoveryComponent],
    providers: [
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap }, paramMap: of(paramMap) },
      },
      { provide: SneatAuthStateService, useValue: { authState } },
      { provide: SessionContextApiService, useValue: api },
      {
        provide: NATIVE_OPERATION_STORE,
        useValue: {
          readRecovery,
          scrubRecovery: async (value: NativeOperationRecovery) => {
            const current = writes.get(value.draftKey);
            if (current && sameNativeOperation(current, value)) {
              const { draftKey, ...metadataOnly } = value;
              await write(draftKey, metadataOnly);
            }
          },
          writeRecovery: vi.fn(async () => undefined),
          read,
          write,
        },
      },
    ],
  });
  return {
    view: TestBed.createComponent(SessionDetectiveRecoveryComponent),
    api,
    authState,
    read,
    write,
    writes,
  };
}
describe('cold native metadata recovery after content revocation', () => {
  it('reads only cached metadata and GET status, without caps, content, pins or dispatch', async () => {
    const { view, api, read } = fixture('alice');
    view.detectChanges();
    await Promise.resolve();
    await view.whenStable();
    expect(api.nativeDetectiveOperation).toHaveBeenCalledTimes(1);
    expect(api.nativeDetectiveOperation).toHaveBeenCalledWith(
      project,
      locator,
      'op_1',
    );
    expect(view.nativeElement.textContent).toContain('contentrevoked');
    expect(view.nativeElement.textContent).not.toContain(
      'never-render-private-input',
    );
    expect(read).not.toHaveBeenCalled();
    expect(api.capabilities).not.toHaveBeenCalled();
    expect(api.read).not.toHaveBeenCalled();
    expect(api.input).not.toHaveBeenCalled();
    expect(api.nativeDetective).not.toHaveBeenCalled();
  });
  it('preserves GitHub branch and API query selectors in the return UrlTree', async () => {
    const githubProject = {
      storeId: 'github.com',
      projectId: 'chinook-demo@datatug@',
      projectApi: 'cloud' as const,
      branch: 'release/context',
    };
    const metadata = {
      ...recovery,
      project: githubProject,
      draftKey: nativeOperationDraftKey(
        githubProject,
        'alice',
        locator,
        's1',
        'check_1',
      ),
    };
    const { view } = fixture('alice', false, metadata);
    view.detectChanges();
    await Promise.resolve();
    await view.whenStable();
    const link = view.debugElement
      .queryAll(By.directive(RouterLink))
      .find((item) =>
        item.nativeElement.textContent.includes('Return to session'),
      );
    if (!link) throw new Error('Missing session return link.');
    const tree = link.injector.get(RouterLink).urlTree;
    expect(tree?.queryParams).toMatchObject({
      projectApi: 'cloud',
      branch: 'release/context',
    });
    expect(tree?.toString()).not.toContain('%3F');
  });

  it('fails closed for a different active account without deleting its private draft', async () => {
    const { view, api, read, write } = fixture('bob');
    view.detectChanges();
    await Promise.resolve();
    await view.whenStable();
    expect(api.nativeDetectiveOperation).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(view.nativeElement.textContent).not.toContain(
      'never-render-private-input',
    );
    expect(view.nativeElement.textContent).not.toContain('run_1');
  });
  it('shows metadata-only denial and removes same-account cached request values', async () => {
    const { view, api, write } = fixture('alice', true);
    view.detectChanges();
    await Promise.resolve();
    await view.whenStable();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    await view.whenStable();
    expect(view.nativeElement.textContent).toContain(
      'Access to this operation is denied',
    );
    expect(view.nativeElement.textContent).not.toContain(
      'never-render-private-input',
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][1]).not.toHaveProperty('request');
    expect(api.nativeDetective).not.toHaveBeenCalled();
  });
  it.each(['done', 'fenced', 'denied'])(
    'does not scrub newer pending B when recovery A returns %s',
    async (state) => {
      if (!privateDraft.request) throw new Error('Missing fixture request');
      const newer = {
        ...privateDraft,
        operationId: 'op_2',
        recoveryId: 'recovery_2',
        request: { ...privateDraft.request, operationId: 'op_2' },
      };
      const { view, api, writes } = fixture(
        'alice',
        state === 'denied',
        recovery,
        newer,
      );
      if (state === 'done')
        api.nativeDetectiveOperation.mockResolvedValue({
          ...result,
          status: { ...result.status, state: 'completed', fenceReason: '' },
        });
      view.detectChanges();
      await view.whenStable();
      expect(writes.get(recovery.draftKey)).toEqual(newer);
      expect(api.nativeDetective).not.toHaveBeenCalled();
    },
  );
  it('rejects a prior account epoch response after the same account returns', async () => {
    const { view, api, authState } = fixture('alice');
    let completeOld!: (value: typeof result) => void;
    api.nativeDetectiveOperation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeOld = resolve;
        }),
    );
    view.detectChanges();
    await vi.waitFor(() =>
      expect(api.nativeDetectiveOperation).toHaveBeenCalledTimes(1),
    );
    authState.next({ status: 'unauthenticated', user: { uid: '' } });
    await view.whenStable();
    authState.next({ status: 'authenticated', user: { uid: 'alice' } });
    await view.whenStable();
    expect(api.nativeDetectiveOperation).toHaveBeenCalledTimes(2);
    completeOld({
      ...result,
      status: {
        ...result.status,
        state: 'accepted',
        produced: false,
        done: false,
        fenceReason: '',
      },
    });
    await view.whenStable();
    expect(view.nativeElement.textContent).toContain('contentrevoked');
    expect(view.nativeElement.textContent).not.toContain('accepted');
  });
});
