import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { SneatApiAuthTokenBridge } from '@sneat/api';
import { DatatugApiBaseUrl } from '@sneat/datatug-semantic';
import { firstValueFrom } from 'rxjs';
import {
  ShippingApiService,
  ShippingIntent,
  SHIPPING_SOURCE,
} from './shipping-api.service';
export const revisionFixture = (revision = 1) => ({
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
const ref = { storeId: 'firestore', spaceID: 'space', projectId: 'training' };
describe('Shipping native authenticated transport', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DatatugApiBaseUrl, useValue: 'https://datatug.test/v0/' },
      ],
    });
    TestBed.inject(SneatApiAuthTokenBridge).setExplicitToken('test-token');
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('uses exact published environment-independent metadata scope and native auth', async () => {
    const result = firstValueFrom(
      TestBed.inject(ShippingApiService).revision(ref),
    );
    const r = http.expectOne((r) => r.url.endsWith('/shipping/revision'));
    expect(r.request.headers.get('Authorization')).toBe('Bearer test-token');
    expect(
      Object.fromEntries(
        r.request.params.keys().map((k) => [k, r.request.params.get(k)]),
      ),
    ).toEqual({
      storage: 'firestore',
      spaceID: 'space',
      project: 'training',
      sourceId: SHIPPING_SOURCE,
    });
    r.flush(revisionFixture());
    expect((await result).configuration).toBe(17);
  });
  it.each(['initialize', 'correct', 'replay', 'reset'] as const)(
    'sends only the published %s body and verifies actor-bound receipt without replacing current pointer',
    async (action) => {
      const intent: ShippingIntent = {
        spaceID: 'space',
        projectId: 'training',
        sourceId: SHIPPING_SOURCE,
        action,
        operationId: 'op',
        ...(action !== 'initialize'
          ? {
              expected: {
                generation: 'g1',
                revision: 1,
                sha256: 'a'.repeat(64),
              },
            }
          : {}),
        ...(action === 'replay' ? { orderId: 11045 as const } : {}),
      };
      const result = firstValueFrom(
        TestBed.inject(ShippingApiService).action(ref, intent, 'sarah'),
      );
      const r = http.expectOne((r) => r.url.endsWith('/shipping/action'));
      expect(r.request.method).toBe('POST');
      expect(r.request.params.keys()).toEqual([]);
      expect(r.request.body).toEqual(intent);
      r.flush({
        receipt: {
          operationId: 'op',
          actorId: 'sarah',
          action,
          outcome: 'applied',
          revision: revisionFixture(),
        },
        current: revisionFixture(3),
      });
      expect((await result).current.revision).toBe(3);
    },
  );
  it('refuses a response attributed to a different actor while retaining the original intent for caller review', async () => {
    const intent: ShippingIntent = {
      spaceID: 'space',
      projectId: 'training',
      sourceId: SHIPPING_SOURCE,
      operationId: 'op',
      action: 'initialize',
    };
    const result = firstValueFrom(
      TestBed.inject(ShippingApiService).action(ref, intent, 'sarah'),
    );
    const assertion = expect(result).rejects.toThrow(
      /Receipt could not be verified/,
    );
    http
      .expectOne((r) => r.url.endsWith('/shipping/action'))
      .flush({
        receipt: {
          operationId: 'op',
          actorId: 'other',
          action: 'initialize',
          outcome: 'applied',
          revision: revisionFixture(),
        },
        current: revisionFixture(),
      });
    await assertion;
  });
  it('rejects readonly public identity and malformed mutation before HTTP', async () => {
    const api = TestBed.inject(ShippingApiService);
    await expect(
      firstValueFrom(api.revision({ storeId: 'github', projectId: 'public' })),
    ).rejects.toThrow(/native/);
    await expect(
      firstValueFrom(
        api.action(
          ref,
          {
            spaceID: 'space',
            projectId: 'training',
            sourceId: SHIPPING_SOURCE,
            operationId: 'op',
            action: 'correct',
          },
          'sarah',
        ),
      ),
    ).rejects.toThrow(/Invalid/);
    http.expectNone(() => true);
  });
});
