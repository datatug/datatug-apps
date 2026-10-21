import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { ShippingQueryAccessComponent } from './shipping-query-access.component';
import { ShippingApiService } from './shipping-api.service';
const page = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../detective/detective-page-context', () => ({
  useDetectivePageContext: () => page.current,
}));
describe('Shipping current query access lifecycle', () => {
  const actor = signal('sarah'),
    ref = signal({
      storeId: 'firestore',
      spaceID: 'space',
      projectId: 'project',
    }),
    changes = new Subject<string | undefined>();
  const identity = () => JSON.stringify([actor(), ref()]);
  const api = { publication: vi.fn(), publish: vi.fn() };
  beforeEach(() => {
    sessionStorage.clear();
    actor.set('sarah');
    ref.set({ storeId: 'firestore', spaceID: 'space', projectId: 'project' });
    api.publication.mockReset().mockReturnValue(of({ exists: false }));
    api.publish.mockReset();
    page.current = {
      ref,
      identity,
      scopeChanges$: changes,
      context: () => ({ principal: actor() }),
    };
    TestBed.configureTestingModule({
      imports: [ShippingQueryAccessComponent],
      providers: [{ provide: ShippingApiService, useValue: api }],
    });
  });
  const mount = async () => {
    const f = TestBed.createComponent(ShippingQueryAccessComponent);
    f.componentRef.setInput('environments', ['demo']);
    f.componentRef.setInput('canWrite', true);
    f.detectChanges();
    await f.whenStable();
    return f;
  };
  const choose = async (f: Awaited<ReturnType<typeof mount>>) => {
    const select = f.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = 'demo';
    select.dispatchEvent(new Event('change'));
    await f.whenStable();
  };
  it('requires explicit admitted environment and observed absence before CAS0; rereads current state after an old acknowledgement', async () => {
    const f = await mount();
    expect(api.publication).not.toHaveBeenCalled();
    await choose(f);
    api.publish.mockReturnValue(of({ revision: 1 }));
    api.publication.mockReturnValue(
      of({ exists: true, publication: { revision: 3, enabled: false } }),
    );
    f.componentInstance.prepare(true);
    await f.whenStable();
    expect(api.publish.mock.calls[0][1]).toMatchObject({
      expectedRevision: 0,
      enabled: true,
      environment: 'demo',
    });
    expect(f.componentInstance.current()).toEqual({
      exists: true,
      publication: { revision: 3, enabled: false },
    });
    expect(f.nativeElement.textContent).toContain('Query access disabled');
  });
  it('does not turn read failure into absent state or enable an unobserved mutation', async () => {
    api.publication.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 503 })),
    );
    const f = await mount();
    await choose(f);
    f.componentInstance.prepare(true);
    expect(api.publish).not.toHaveBeenCalled();
    expect(f.componentInstance.current()).toBeUndefined();
    expect(f.nativeElement.querySelector('[role=alert]')).toBeTruthy();
  });
  it('retains the exact uncertain intent across remount;401 requires explicit metadata refresh then exact retry', async () => {
    api.publish.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 401 })),
    );
    const first = await mount();
    await choose(first);
    first.componentInstance.prepare(true);
    await first.whenStable();
    const original = api.publish.mock.calls[0][1];
    expect(first.componentInstance.pending()?.intent).toEqual(original);
    first.destroy();
    const second = await mount();
    expect(second.componentInstance.pending()?.intent).toEqual(original);
    expect(api.publish).toHaveBeenCalledTimes(1);
    api.publish.mockReturnValue(of({ revision: 1 }));
    await second.componentInstance.send();
    await second.whenStable();
    expect(api.publish.mock.calls[1][1]).toEqual(original);
    expect(second.componentInstance.pending()).toBeUndefined();
  });
  it('requires explicit conflict review against fresh current metadata before a new operation', async () => {
    const f = await mount();
    await choose(f);
    api.publish.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409 })),
    );
    api.publication.mockReturnValue(
      of({ exists: true, publication: { revision: 4, enabled: false } }),
    );
    f.componentInstance.prepare(true);
    await f.whenStable();
    const original = api.publish.mock.calls[0][1];
    await f.componentInstance.send();
    expect(api.publish).toHaveBeenCalledTimes(1);
    f.componentInstance.reviewConflict();
    api.publish.mockReturnValue(of({ revision: 5 }));
    f.componentInstance.prepare(true);
    await f.whenStable();
    expect(api.publish.mock.calls[1][1]).toMatchObject({ expectedRevision: 4 });
    expect(api.publish.mock.calls[1][1].operationId).not.toBe(
      original.operationId,
    );
  });
  it('immediately withholds old metadata on actor change and drops a late read', async () => {
    const response = new Subject<unknown>();
    api.publication.mockReturnValue(response);
    const f = await mount();
    await choose(f);
    actor.set('maya');
    changes.next(identity());
    response.next({
      exists: true,
      publication: { revision: 1, enabled: true },
    });
    expect(f.componentInstance.current()).toBeUndefined();
    f.destroy();
  });
  it('revocation clears the old intent and metadata instead of offering a retry', async () => {
    const f = await mount();
    await choose(f);
    api.publish.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 403 })),
    );
    f.componentInstance.prepare(true);
    await f.whenStable();
    expect(f.componentInstance.pending()).toBeUndefined();
    expect(f.componentInstance.current()).toBeUndefined();
    expect(
      sessionStorage.getItem('datatug.shipping.publication.intent.v1'),
    ).toBeNull();
  });
});
