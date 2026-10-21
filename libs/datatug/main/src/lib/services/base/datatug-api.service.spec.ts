import { HttpResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  DefaultSneatAppApiBaseUrl,
  SneatApiAuthTokenBridge,
  SneatApiBaseUrl,
  SneatApiService,
} from '@sneat/api';
import { firstValueFrom } from 'rxjs';
import { DatatugApiService } from './datatug-api.service';
import { DatatugApiBaseUrl } from '@sneat/datatug-semantic';

function configure(providers: Provider[] = []): HttpTestingController {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), ...providers],
  });
  TestBed.inject(SneatApiAuthTokenBridge).setExplicitToken('token');
  return TestBed.inject(HttpTestingController);
}

describe('DatatugApiService', () => {
  const preview = 'https://datatug-cloud-preview-354fvnqbaa-ew.a.run.app/v0/';
  const identity = 'https://identity.test/v0/';

  it.each([
    ['GET', 'datatug/github/oauth/repositories'],
    ['POST', 'datatug/github/oauth/start'],
    ['POST', 'datatug/github/oauth/complete'],
    ['POST', 'datatug/github/oauth/resolve-repository'],
    ['POST', 'datatug/github/authorization/start'],
    ['POST', 'datatug/github/authorization/complete'],
  ])(
    'keeps TEST %s %s on the injected authoritative service',
    (method, endpoint) => {
      const http = configure([
        { provide: SneatApiBaseUrl, useValue: identity },
        { provide: DatatugApiBaseUrl, useValue: preview },
      ]);
      const api = TestBed.inject(DatatugApiService);
      const body = { operationID: 'operation', state: 'state' };
      (method === 'GET'
        ? api.get(endpoint)
        : api.post(endpoint, body)
      ).subscribe();
      const request = http.expectOne(identity + endpoint);
      expect(request.request.method).toBe(method);
      expect(request.request.headers.get('Authorization')).toBe('Bearer token');
      if (method === 'POST') expect(request.request.body).toEqual(body);
      request.flush({});
      http.verify();
    },
  );

  it.each([
    ['POST', 'datatug/projects/create_project'],
    ['GET', 'datatug/projects/create_project/status'],
    ['GET', 'datatug/github/projects/pending-setups'],
    ['GET', 'datatug/projects/get_project'],
    ['GET', 'datatug/github/repositories'],
    ['POST', 'datatug/github/oauth/repositories'],
    ['GET', 'datatug/github/oauth/start'],
    ['GET', 'datatug/github/oauth/repositories/extra'],
    ['GET', 'datatug/github/oauth/repositories?redirect=https://other.test'],
  ])(
    'keeps non-identity TEST %s %s on the scoped preview',
    (method, endpoint) => {
      const http = configure([
        { provide: SneatApiBaseUrl, useValue: identity },
        { provide: DatatugApiBaseUrl, useValue: preview },
      ]);
      const api = TestBed.inject(DatatugApiService);
      (method === 'GET'
        ? api.get(endpoint)
        : api.post(endpoint, {})
      ).subscribe();
      http.expectOne(preview + endpoint).flush({});
      http.verify();
    },
  );

  it('does not change identity routes for another overridden DataTug base', () => {
    const http = configure([
      { provide: SneatApiBaseUrl, useValue: identity },
      { provide: DatatugApiBaseUrl, useValue: 'https://datatug.test/v0/' },
    ]);
    TestBed.inject(DatatugApiService)
      .get('datatug/github/oauth/repositories')
      .subscribe();
    http
      .expectOne('https://datatug.test/v0/datatug/github/oauth/repositories')
      .flush({});
    http.verify();
  });

  it('retains the authoritative token-refresh path for TEST identity reads', async () => {
    const http = configure([
      { provide: SneatApiBaseUrl, useValue: identity },
      { provide: DatatugApiBaseUrl, useValue: preview },
    ]);
    const response = firstValueFrom(
      TestBed.inject(DatatugApiService).get(
        'datatug/github/oauth/repositories',
      ),
    );
    http
      .expectOne(identity + 'datatug/github/oauth/repositories')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    const retry = http.expectOne(
      identity + 'datatug/github/oauth/repositories',
    );
    expect(retry.request.headers.get('Authorization')).toBe('Bearer token');
    retry.flush({ repositories: [] });
    await expect(response).resolves.toEqual({ repositories: [] });
    http.verify();
  });

  it('retains real response headers and the authenticated 401 retry for asset detail', async () => {
    const http = configure([
      { provide: DatatugApiBaseUrl, useValue: 'https://datatug.test/v0/' },
    ]);
    const pending = firstValueFrom(
      TestBed.inject(DatatugApiService).getResponse<{ id: string }>(
        'datatug/boards/board',
      ),
    );
    const first = http.expectOne(
      'https://datatug.test/v0/datatug/boards/board',
    );
    expect(first.request.headers.get('Authorization')).toBe('Bearer token');
    first.flush({}, { status: 401, statusText: 'Unauthorized' });
    const retry = http.expectOne(
      'https://datatug.test/v0/datatug/boards/board',
    );
    expect(retry.request.headers.get('Authorization')).toBe('Bearer token');
    retry.flush(
      { id: 'b' },
      { headers: { ETag: '"rev"', 'X-Datatug-Asset-Revision': 'rev' } },
    );
    const result = await pending;
    expect(result).toBeInstanceOf(HttpResponse);
    expect(result.body).toEqual({ id: 'b' });
    expect(result.headers.get('ETag')).toBe('"rev"');
    http.verify();
  });

  it('calls the default Sneat API origin when no base URL is configured', () => {
    const http = configure();
    const api = TestBed.inject(DatatugApiService);
    expect(api).toBeInstanceOf(SneatApiService);
    api.get('datatug/ping').subscribe();
    http
      .expectOne(`${DefaultSneatAppApiBaseUrl}datatug/ping`)
      .flush({ ok: true });
    http.verify();
  });

  it('mirrors SneatApiBaseUrl when no DataTug base URL is provided', () => {
    const http = configure([
      { provide: SneatApiBaseUrl, useValue: 'https://local.test/v0/' },
    ]);
    TestBed.inject(DatatugApiService).get('datatug/ping').subscribe();
    http.expectOne('https://local.test/v0/datatug/ping').flush({});
    http.verify();
  });

  it('uses DatatugApiBaseUrl without changing SneatApiService', async () => {
    const http = configure([
      { provide: SneatApiBaseUrl, useValue: 'https://sneat.test/v0/' },
      { provide: DatatugApiBaseUrl, useValue: 'https://datatug.test/v0/' },
    ]);
    const sneat = firstValueFrom(
      TestBed.inject(SneatApiService).get<{ ok: boolean }>('checkout/ping'),
    );
    const datatug = firstValueFrom(
      TestBed.inject(DatatugApiService).get<{ ok: boolean }>('datatug/ping'),
    );
    http.expectOne('https://sneat.test/v0/checkout/ping').flush({ ok: true });
    http.expectOne('https://datatug.test/v0/datatug/ping').flush({ ok: true });
    await expect(sneat).resolves.toEqual({ ok: true });
    await expect(datatug).resolves.toEqual({ ok: true });
    http.verify();
  });

  it('inherits the Bearer header from the Sneat token bridge', () => {
    const http = configure();
    TestBed.inject(DatatugApiService).get('datatug/ping').subscribe();
    const request = http.expectOne(`${DefaultSneatAppApiBaseUrl}datatug/ping`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer token');
    request.flush({ ok: true });
    http.verify();
  });
});
