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
  SHIPPING_SOURCE,
  ShippingApiService,
  ShippingPublicationIntent,
} from './shipping-api.service';
const ref = { storeId: 'firestore', spaceID: 'space', projectId: 'project' };
const intent: ShippingPublicationIntent = {
  spaceID: 'space',
  projectId: 'project',
  sourceId: SHIPPING_SOURCE,
  environment: 'demo',
  operationId: 'publish-one',
  expectedRevision: 0,
  enabled: true,
};
describe('Shipping publication actual native HTTP contract', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DatatugApiBaseUrl, useValue: 'https://datatug.test/v0/' },
      ],
    });
    TestBed.inject(SneatApiAuthTokenBridge).setExplicitToken('token-A');
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it.each([
    { exists: false },
    { exists: true, publication: { revision: 3, enabled: false } },
  ])(
    'reads explicit current state without conflating disabled/absent',
    async (value) => {
      const pending = firstValueFrom(
        TestBed.inject(ShippingApiService).publication(ref, 'demo'),
      );
      const req = http.expectOne((r) =>
        r.url.endsWith('/shipping/publication'),
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer token-A');
      expect(
        Object.fromEntries(
          req.request.params.keys().map((k) => [k, req.request.params.get(k)]),
        ),
      ).toEqual({
        storage: 'firestore',
        spaceID: 'space',
        project: 'project',
        sourceId: SHIPPING_SOURCE,
        environment: 'demo',
      });
      req.flush(value);
      await expect(pending).resolves.toEqual(value);
    },
  );
  it.each([
    {},
    { exists: false, publication: { revision: 0, enabled: false } },
    { exists: true },
    { exists: true, publication: { revision: 0, enabled: false } },
    { exists: true, publication: { revision: 1, enabled: 'false' } },
  ])(
    'rejects malformed metadata instead of assuming revision zero',
    async (value) => {
      const pending = firstValueFrom(
        TestBed.inject(ShippingApiService).publication(ref, 'demo'),
      );
      const assertion = expect(pending).rejects.toThrow(
        'could not be verified',
      );
      http
        .expectOne((r) => r.url.endsWith('/shipping/publication'))
        .flush(value);
      await assertion;
    },
  );
  it('posts the frozen CAS intent once and does not resubmit after401 with another token', async () => {
    const pending = firstValueFrom(
      TestBed.inject(ShippingApiService).publish(ref, intent, 'sarah'),
    );
    const assertion = expect(pending).rejects.toMatchObject({ status: 401 });
    const first = http.expectOne((r) =>
      r.url.endsWith('/shipping/publication'),
    );
    expect(first.request.body).toEqual(intent);
    expect(first.request.headers.get('Authorization')).toBe('Bearer token-A');
    TestBed.inject(SneatApiAuthTokenBridge).setExplicitToken('token-B');
    first.flush({}, { status: 401, statusText: 'Unauthorized' });
    await assertion;
    http.expectNone((r) => r.url.endsWith('/shipping/publication'));
  });
  it('refuses a receipt for a different revision, actor or requested access', async () => {
    for (const change of [
      { revision: 2 },
      { actorId: 'maya' },
      { enabled: false },
    ]) {
      const pending = firstValueFrom(
        TestBed.inject(ShippingApiService).publish(ref, intent, 'sarah'),
      );
      const assertion = expect(pending).rejects.toThrow('uncertain');
      http
        .expectOne((r) => r.url.endsWith('/shipping/publication'))
        .flush({
          environment: 'demo',
          revision: 1,
          enabled: true,
          actorId: 'sarah',
          ...change,
        });
      await assertion;
    }
  });
});
