import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { DetectiveClientService } from '../detective/detective-client.service';
import { ShippingApiService } from './shipping-api.service';
import { ShippingComponentApiService } from './shipping-component-api.service';
import { ShippingSourceAdapterService } from './shipping-source-adapter.service';

const scope = {
  projectRef: { storeId: 'firestore', spaceID: 'S1', projectId: 'p1' },
  actor: 'u1',
  identity: 'id',
  sourceId: 'shipping-working-copy',
};

function setup(revision: ShippingApiService['revision']) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ShippingApiService, useValue: { revision } },
      { provide: DetectiveClientService, useValue: {} },
      { provide: ShippingComponentApiService, useValue: {} },
    ],
  });
  return TestBed.inject(ShippingSourceAdapterService).registration;
}

afterEach(() => TestBed.resetTestingModule());

describe('Shipping working copy business clock', () => {
  it('declares workspace_state.business_clock as the demo clock, and nothing else from the revision', async () => {
    const revision = vi.fn(() =>
      of({ businessClock: '2018-05-20T10:05:00Z', actorId: 'u1' }),
    );
    const registration = setup(revision as never);
    await expect(
      registration.businessClock?.(scope, new AbortController().signal),
    ).resolves.toEqual({ label: 'Demo clock', at: '2018-05-20T10:05:00Z' });
    expect(revision).toHaveBeenCalledWith(scope.projectRef);
  });

  it('rejects when the current read fails or the caller aborts', async () => {
    const failing = setup((() =>
      throwError(() => new Error('denied'))) as never);
    await expect(
      failing.businessClock?.(scope, new AbortController().signal),
    ).rejects.toThrow('denied');
    TestBed.resetTestingModule();
    const pending = setup((() => NEVER) as never);
    const abort = new AbortController();
    const read = pending.businessClock?.(scope, abort.signal);
    abort.abort();
    await expect(read).rejects.toBeTruthy();
  });
});
