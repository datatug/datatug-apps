import { mountShippingController } from './shipping-controller.spec-helper';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ShippingHistoryController } from './shipping-history.controller';
import { RetainedEvidenceApiService } from '../evidence/retained-evidence-api.service';
import { NativeSourceInvalidationService } from '../evidence/native-source-invalidation';
import { readSourceOperationHistory } from '../evidence/source-operation-contract';
import fixture from '../evidence/testdata/source-operation.facade.go.json';
const page = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../detective/detective-page-context', () => ({
  useDetectivePageContext: () => page.current,
}));
const ref = {
  storeId: 'firestore',
  spaceID: fixture.request.spaceID,
  projectId: fixture.request.projectId,
};
describe('explicit source history discovery and receipt selection', () => {
  const currentRef = signal(ref),
    actor = signal(fixture.request.reference.receiptActorId),
    changes = new Subject<void>(),
    api = { sourceOperations: vi.fn() };
  const identity = () => JSON.stringify([currentRef(), actor()]);
  const scope = () => ({
    projectRef: currentRef(),
    environment: 'demo',
    actor: actor(),
  });
  beforeEach(() => {
    currentRef.set(ref);
    actor.set(fixture.request.reference.receiptActorId);
    api.sourceOperations
      .mockReset()
      .mockResolvedValue(
        readSourceOperationHistory(fixture.discovery, scope()),
      );
    page.current = {
      ref: currentRef,
      identity,
      context: () => ({ kind: 'cloud', principal: actor() }),
      scopeChanges$: changes,
    };
    TestBed.configureTestingModule({
      imports: [],
      providers: [{ provide: RetainedEvidenceApiService, useValue: api }],
    });
  });
  async function mount() {
    const f = await mountShippingController(ShippingHistoryController);
    f.setInput('environments', ['demo', 'other']);
    f.detectChanges();
    await f.whenStable();
    return f;
  }
  it('does not discover on entry/environment selection; explicit History renders compact actual outcomes/time and opens only offered refs', async () => {
    const f = await mount();
    expect(api.sourceOperations).not.toHaveBeenCalled();
    f.componentInstance.chooseEnvironment('demo');
    await f.whenStable();
    expect(api.sourceOperations).not.toHaveBeenCalled();
    let finish: (v: unknown) => void = () => undefined;
    api.sourceOperations.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.componentInstance.load();
    await f.whenStable();
    expect(f.componentInstance.loading()).toBe(true);
    finish(readSourceOperationHistory(fixture.discovery, scope()));
    await pending;
    await f.whenStable();
    expect(
      f.componentInstance.activityItems()?.map((i) => i.outcome),
    ).toContain('No new change');
    expect(
      f.componentInstance.activityItems()?.map((i) => i.acceptedAt),
    ).toContain('2026-10-21T12:00:00Z');
    const item = f.componentInstance.operations()?.[0];
    if (!item) throw new Error('Missing actual source operation');
    f.componentInstance.open({
      ...item,
      reference: { ...item.reference, operationId: 'forged' },
    });
    expect(f.componentInstance.target()).toBeUndefined();
    f.componentInstance.openActivity('not-offered');
    expect(f.componentInstance.target()).toBeUndefined();
    f.componentInstance.openActivity(item.reference.operationId);
    await f.whenStable();
    expect(f.componentInstance.target()).toEqual({
      kind: 'source-operation',
      sourceOperation: item.reference,
    });
    expect(f.componentInstance.target()).toBeDefined();
    expect(f.componentInstance.target()?.kind).toBe('source-operation');
    f.componentInstance.selected.set(undefined);
    await f.whenStable();
    expect(f.componentInstance.target()).toBeUndefined();
  });
  it.each(['account', 'project', 'environment', 'source'] as const)(
    'clears and rejects ignored-abort late discovery after %s changes',
    async (change) => {
      const f = await mount();
      f.componentInstance.chooseEnvironment('demo');
      await f.whenStable();
      await f.componentInstance.load();
      const item = f.componentInstance.operations()?.[0];
      if (!item) throw new Error('Missing item');
      f.componentInstance.open(item);
      let finish: (v: unknown) => void = () => undefined;
      api.sourceOperations.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = f.componentInstance.load();
      const signal = api.sourceOperations.mock.calls.at(-1)?.[1] as AbortSignal;
      if (change === 'account') {
        actor.set('other');
        changes.next();
      } else if (change === 'project') {
        currentRef.set({ ...ref, projectId: 'other-project' });
        changes.next();
      } else if (change === 'environment')
        f.componentInstance.chooseEnvironment('other');
      else
        TestBed.inject(NativeSourceInvalidationService).invalidate({
          projectRef: ref,
          actor: actor(),
          sourceId: 'shipping-working-copy',
          action: 'reset',
        });
      expect(signal.aborted).toBe(true);
      finish(fixture.discovery.operations);
      await pending;
      await f.whenStable();
      expect(f.componentInstance.operations()).toBeUndefined();
      expect(f.componentInstance.target()).toBeUndefined();
    },
  );
  it('shows empty/error without leaking provider details and allows explicit rediscovery after reset', async () => {
    const f = await mount();
    f.componentInstance.chooseEnvironment('demo');
    await f.whenStable();
    api.sourceOperations.mockResolvedValue([]);
    await f.componentInstance.load();
    await f.whenStable();
    expect(f.componentInstance.operations()).toEqual([]);
    api.sourceOperations.mockRejectedValue(
      new Error('protected provider details'),
    );
    await f.componentInstance.load();
    await f.whenStable();
    expect(f.componentInstance.error()).toContain(
      'Source history is unavailable',
    );
    expect(f.componentInstance.error()).not.toContain(
      'protected provider details',
    );
    TestBed.inject(NativeSourceInvalidationService).invalidate({
      projectRef: ref,
      actor: actor(),
      sourceId: 'shipping-working-copy',
      action: 'reset',
    });
    api.sourceOperations.mockResolvedValue(
      readSourceOperationHistory(fixture.discovery, scope()),
    );
    await f.componentInstance.load();
    await f.whenStable();
    expect(f.componentInstance.operations()?.length).toBe(5);
  });
});
