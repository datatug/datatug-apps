import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import {
  NATIVE_OPERATION_STORE,
  NativeOperationDraft,
  nativeOperationDraftKey,
} from './session-detective-operation.service';

describe('native recovery IndexedDB transaction', () => {
  it('scrubs only the exact active operation and keeps a concurrently queued newer draft', async () => {
    const store = TestBed.inject(NATIVE_OPERATION_STORE);
    const project = { storeId: 'firestore', projectId: 'source', spaceID: 's' };
    const locator = {
      storage: 'firestore',
      project: 'source',
      spaceID: 's',
      databaseId: 'db',
      projectId: 'p',
      namespaceId: 'n',
    };
    const key = nativeOperationDraftKey(
      project,
      'alice',
      locator,
      'session',
      'check',
    );
    const a: NativeOperationDraft = {
      actor: 'alice',
      project,
      locator,
      operationId: 'a',
      recoveryId: 'ra',
      sessionId: 'session',
      checkId: 'check',
    };
    const b: NativeOperationDraft = {
      ...a,
      operationId: 'b',
      recoveryId: 'rb',
      request: {
        operationId: 'b',
        sessionId: 'session',
        expectedVersion: 1,
        expectedContextSetId: 'ctx',
        scope: { environmentId: 'env', identityDomain: 'domain' },
        checkId: 'check',
        inputs: { id: { type: 'integer', value: '9' } },
      },
    };
    await store.write(key, a);
    // Both transactions queue on the same object store; the scrub must compare
    // after B's write, inside its own readwrite transaction.
    await Promise.all([
      store.write(key, b),
      store.scrubRecovery({ ...a, draftKey: key }),
    ]);
    expect(await store.read(key)).toEqual(b);
    await store.scrubRecovery({
      ...a,
      operationId: b.operationId,
      recoveryId: b.recoveryId,
      draftKey: key,
    });
    expect(await store.read(key)).not.toHaveProperty('request');
    await store.remove(key);
  });
});
