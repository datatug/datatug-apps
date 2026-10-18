import { provideHttpClient } from '@angular/common/http';
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
