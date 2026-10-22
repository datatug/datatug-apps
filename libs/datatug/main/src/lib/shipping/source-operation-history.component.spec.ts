import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { SourceOperationHistoryComponent } from './source-operation-history.component';
import { RetainedEvidenceApiService } from '../evidence/retained-evidence-api.service';
import { RetainedEvidenceViewerComponent } from '../evidence/retained-evidence-viewer.component';
import { NativeSourceInvalidationService } from '../evidence/native-source-invalidation';
import { readSourceOperationHistory } from '../evidence/source-operation-contract';
import fixture from '../evidence/testdata/source-operation.facade.go.json';
const page = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../detective/detective-page-context', () => ({
  useDetectivePageContext: () => page.current,
}));
@Component({
  selector: 'sneat-datatug-retained-evidence-viewer',
  template: '<p>Historical receipt viewer</p>',
})
class ViewerStub {
  readonly projectRef = input<unknown>();
  readonly environment = input('');
  readonly target = input<unknown>();
}
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
      imports: [SourceOperationHistoryComponent],
      providers: [{ provide: RetainedEvidenceApiService, useValue: api }],
    });
    TestBed.overrideComponent(SourceOperationHistoryComponent, {
      remove: { imports: [RetainedEvidenceViewerComponent] },
      add: { imports: [ViewerStub] },
    });
  });
  async function mount() {
    const f = TestBed.createComponent(SourceOperationHistoryComponent);
    f.componentRef.setInput('environments', ['demo', 'other']);
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
    expect(f.nativeElement.textContent).toContain('Loading source history');
    finish(readSourceOperationHistory(fixture.discovery, scope()));
    await pending;
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain('No new change');
    expect(f.nativeElement.textContent).toContain('2026-10-21T12:00:00Z');
    expect(f.nativeElement.querySelector('ion-card')).toBeNull();
    const item = f.componentInstance.operations()?.[0];
    if (!item) throw new Error('Missing actual source operation');
    f.componentInstance.open({
      ...item,
      reference: { ...item.reference, operationId: 'forged' },
    });
    expect(f.componentInstance.target()).toBeUndefined();
    f.componentInstance.openActivity('not-offered');
    expect(f.componentInstance.target()).toBeUndefined();
    const openButton = (
      f.nativeElement as HTMLElement
    ).querySelector<HTMLElement>('sneat-activity-list li ion-button');
    expect(openButton?.textContent).toContain('Open receipt');
    openButton?.click();
    await f.whenStable();
    expect(f.componentInstance.target()).toEqual({
      kind: 'source-operation',
      sourceOperation: item.reference,
    });
    expect(f.nativeElement.textContent).toContain('Historical receipt viewer');
    expect(f.nativeElement.textContent).not.toContain('Resolve');
    f.componentInstance.selected.set(undefined);
    await f.whenStable();
    expect(f.nativeElement.textContent).not.toContain(
      'Historical receipt viewer',
    );
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
    expect(f.nativeElement.textContent).toContain(
      'No source operations were returned',
    );
    api.sourceOperations.mockRejectedValue(
      new Error('protected provider details'),
    );
    await f.componentInstance.load();
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain(
      'Source history is unavailable',
    );
    expect(f.nativeElement.textContent).not.toContain(
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
