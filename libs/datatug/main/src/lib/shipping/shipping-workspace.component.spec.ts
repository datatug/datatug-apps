import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { ShippingWorkspaceComponent } from './shipping-workspace.component';
import { ShippingApiService, ShippingAck } from './shipping-api.service';
import { DetectiveClientService } from '../detective/detective-client.service';
import { ShippingRevision } from './shipping-api.service';
const revisionFixture = (revision = 1): ShippingRevision => ({
  generation: 'g1',
  revision,
  sha256: 'a'.repeat(64),
  configuration: 17,
  fixtureCommit: 'fixture',
  fixtureSHA256: 'b'.repeat(64),
  schemaSHA256: 'c'.repeat(64),
  businessClock: '2018-05-20T10:00:00Z',
  bytes: 100,
  artifacts: [{ id: 'logs/base.jsonl', sha256: 'd'.repeat(64), bytes: 40 }],
  actorId: 'sarah',
  acceptedAt: '2026-10-21T01:00:00Z',
});
const page = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../detective/detective-page-context', () => ({
  useDetectivePageContext: () => page.current,
}));
describe('Shipping workspace native DOM lifecycle', () => {
  const ref = signal({
    storeId: 'firestore',
    spaceID: 'space',
    projectId: 'training',
  });
  const changes = new Subject<string | undefined>();
  const actor = signal('sarah');
  const identity = () => JSON.stringify([ref(), actor()]);
  const api = { revision: vi.fn(), action: vi.fn() };
  const detective = { state: vi.fn() };
  beforeEach(() => {
    sessionStorage.clear();
    ref.set({ storeId: 'firestore', spaceID: 'space', projectId: 'training' });
    actor.set('sarah');
    page.current = {
      scopeChanges$: changes,
      ref,
      identity,
      context: () => ({
        kind: 'cloud',
        principal: actor(),
        storage: 'firestore',
        spaceID: ref().spaceID,
        project: ref().projectId,
      }),
    };
    api.revision.mockReset().mockReturnValue(of(revisionFixture()));
    api.action.mockReset();
    detective.state
      .mockReset()
      .mockReturnValue(of({ capabilities: { canWrite: true } }));
    TestBed.configureTestingModule({
      imports: [ShippingWorkspaceComponent],
      providers: [
        provideRouter([]),
        { provide: ShippingApiService, useValue: api },
        { provide: DetectiveClientService, useValue: detective },
      ],
    });
  });
  const mount = async (waitForMetadata = true) => {
    const f = TestBed.createComponent(ShippingWorkspaceComponent);
    f.detectChanges();
    await f.whenStable();
    if (waitForMetadata)
      await vi.waitFor(() => expect(f.componentInstance.loading()).toBe(false));
    await f.whenStable();
    return f;
  };
  const button = (f: Awaited<ReturnType<typeof mount>>, text: string) => {
    const b = Array.from(
      f.nativeElement.querySelectorAll('ion-button') as NodeListOf<HTMLElement>,
    ).find((b) => b.textContent?.includes(text));
    if (!b) throw new Error('Missing button: ' + text);
    return b;
  };
  it('renders asynchronous current revision without an extra change detection and preserves scoped entry/exit', async () => {
    const result = new Subject<ReturnType<typeof revisionFixture>>();
    api.revision.mockReturnValue(result);
    const f = await mount(false);
    expect(f.nativeElement.textContent).toContain('Loading current');
    result.next(revisionFixture());
    result.complete();
    await f.whenStable();
    await vi.waitFor(() =>
      expect(f.nativeElement.textContent).toContain('Routing configuration 17'),
    );
    expect(f.nativeElement.querySelector('a').getAttribute('href')).toBe(
      '/space/space/store/firestore/project/training/overview',
    );
    expect(f.nativeElement.textContent).toContain('logs/base.jsonl');
    expect(api.action).not.toHaveBeenCalled();
  });
  it('keeps the exact correction intent after a lost response, retries once explicitly and fresh-reads newer metadata', async () => {
    const f = await mount();
    api.action.mockReturnValueOnce(throwError(() => new Error('lost reply')));
    button(f, 'Correct routing').click();
    await f.whenStable();
    const intent = api.action.mock.calls[0][1];
    expect(intent.expected.revision).toBe(1);
    expect(intent.action).toBe('correct');
    expect(intent.orderId).toBeUndefined();
    api.revision.mockReturnValue(of(revisionFixture(4)));
    api.action.mockReturnValueOnce(
      of({
        receipt: {
          operationId: intent.operationId,
          actorId: 'sarah',
          action: 'correct',
          outcome: 'applied',
          acceptedAt: '2026-10-21T01:00:00Z',
          requestSHA256: 'e'.repeat(64),
          revision: revisionFixture(),
        },
        current: revisionFixture(3),
      } as ShippingAck),
    );
    button(f, 'Retry original').click();
    await f.whenStable();
    expect(api.action.mock.calls[1][1]).toEqual(intent);
    expect(f.componentInstance.revision()?.revision).toBe(4);
  });
  it('retains401 uncertainty for explicit same-actor refresh and exact retry without an automatic POST', async () => {
    const f = await mount();
    api.action.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 401 })),
    );
    button(f, 'Correct routing').click();
    await f.whenStable();
    const intent = api.action.mock.calls[0][1];
    expect(f.componentInstance.pending()).toEqual(intent);
    expect(f.componentInstance.canWrite()).toBe(false);
    expect(api.action).toHaveBeenCalledTimes(1);
    button(f, 'Refresh current').click();
    await vi.waitFor(() => expect(f.componentInstance.canWrite()).toBe(true));
    await f.whenStable();
    expect(api.action).toHaveBeenCalledTimes(1);
    api.action.mockReturnValueOnce(
      throwError(() => new Error('still uncertain')),
    );
    button(f, 'Retry original').click();
    await f.whenStable();
    expect(api.action.mock.calls[1][1]).toEqual(intent);
  });
  it('restores the exact uncertain operation on remount without resubmitting automatically', async () => {
    const f = await mount();
    api.action.mockReturnValueOnce(throwError(() => new Error('lost reply')));
    button(f, 'Correct routing').click();
    await f.whenStable();
    const intent = api.action.mock.calls[0][1];
    f.destroy();
    const reopened = await mount();
    expect(api.action).toHaveBeenCalledTimes(1);
    expect(reopened.componentInstance.pending()).toEqual(intent);
    api.action.mockReturnValueOnce(
      throwError(() => new Error('still uncertain')),
    );
    button(reopened, 'Retry original').click();
    await reopened.whenStable();
    expect(api.action.mock.calls[1][1]).toEqual(intent);
  });
  it('does not treat unavailable metadata as empty or initialize automatically; explicit initialize conflict requires review', async () => {
    api.revision.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 503 })),
    );
    const f = await mount();
    expect(api.action).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain(
      'No current revision could be confirmed',
    );
    api.action.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409 })),
    );
    button(f, 'Initialize working').click();
    await f.whenStable();
    expect(api.action).toHaveBeenCalledTimes(1);
    expect(api.action.mock.calls[0][1].expected).toBeUndefined();
    expect(f.nativeElement.textContent).toContain('server refused');
    expect(f.nativeElement.textContent).not.toContain('Retry original');
    api.revision.mockReturnValue(of(revisionFixture(2)));
    f.componentInstance.refresh();
    await f.whenStable();
    button(f, 'I reviewed').click();
    await f.whenStable();
    expect(api.action).toHaveBeenCalledTimes(1);
    expect(f.nativeElement.textContent).toContain('Correct routing');
  });
  it('requires explicit order replay and reset confirmation', async () => {
    const f = await mount();
    api.action.mockReturnValue(throwError(() => new Error('lost')));
    button(f, 'Replay order 11062').click();
    await f.whenStable();
    expect(api.action.mock.calls[0][1]).toMatchObject({
      action: 'replay',
      orderId: 11062,
      expected: { revision: 1 },
    });
  });

  it('does not reset until the separate confirmation is activated', async () => {
    const f = await mount();
    api.action.mockReturnValue(throwError(() => new Error('lost')));
    button(f, 'Reset working').click();
    await f.whenStable();
    expect(api.action).not.toHaveBeenCalled();
    button(f, 'Cancel').click();
    await f.whenStable();
    expect(api.action).not.toHaveBeenCalled();
    button(f, 'Reset working').click();
    await f.whenStable();
    button(f, 'Confirm reset').click();
    await f.whenStable();
    expect(api.action.mock.calls[0][1]).toMatchObject({
      action: 'reset',
      expected: { revision: 1 },
    });
  });
  it('withholds protected metadata and mutation controls for a viewer and public project', async () => {
    detective.state.mockReturnValue(of({ capabilities: { canWrite: false } }));
    const f = await mount();
    expect(f.componentInstance.canWrite()).toBe(false);
    expect(f.nativeElement.textContent).not.toContain('Correct routing');
    ref.set({ storeId: 'github', spaceID: '', projectId: 'public' });
    await f.whenStable();
    expect(f.componentInstance.revision()).toBeUndefined();
    expect(f.nativeElement.textContent).not.toContain('Initialize working');
  });
  it('disables duplicate submissions while the original response is pending', async () => {
    const result = new Subject<ShippingAck>();
    const f = await mount();
    api.action.mockReturnValue(result);
    button(f, 'Correct routing').click();
    await f.whenStable();
    f.componentInstance.prepare('replay', 11045);
    await f.componentInstance.send();
    expect(api.action).toHaveBeenCalledTimes(1);
    expect(f.componentInstance.busy()).toBe(true);
    result.error(new Error('uncertain delivery'));
    await f.whenStable();
    expect(f.componentInstance.pending()?.action).toBe('correct');
  });
  it('fences late actor/project results, clears intent and protected metadata, and hides writes after revocation', async () => {
    const late = new Subject<ShippingAck>();
    const f = await mount();
    api.action.mockReturnValue(late);
    button(f, 'Correct routing').click();
    await f.whenStable();
    actor.set('maya');
    ref.set({ storeId: 'firestore', spaceID: 'space', projectId: 'other' });
    detective.state.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 403 })),
    );
    await f.whenStable();
    late.next({} as ShippingAck);
    late.complete();
    await f.whenStable();
    expect(f.componentInstance.pending()).toBeUndefined();
    expect(sessionStorage.getItem('datatug.shipping.intent.v1')).toBeNull();
    expect(f.componentInstance.revision()).toBeUndefined();
    expect(f.componentInstance.canWrite()).toBe(false);
    expect(f.nativeElement.textContent).not.toContain('Correct routing');
  });
});
