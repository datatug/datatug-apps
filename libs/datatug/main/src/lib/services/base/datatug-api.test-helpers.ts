import { expect } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { EnvironmentProviders, Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SneatApiAuthTokenBridge } from '@sneat/api';
import { DatatugApiService } from './datatug-api.service';
import { DatatugApiBaseUrl } from '@sneat/datatug-semantic';

/** Base URL every `datatug/*` request must start with in these specs. */
export const datatugApiTestBaseUrl = 'https://datatug-api.test/v0/';

/** Bearer token the real client sends in these specs. */
export const datatugApiTestToken = 'datatug-api-test-token';

/**
 * Providers for the real DatatugApiService on HttpClientTesting. A spec adds
 * them after its own mocks in a TestBed configuration, so the real service
 * replaces the mock and the spec sees the URL a call really hits.
 */
export function datatugApiRealProviders(): (Provider | EnvironmentProviders)[] {
  return [
    DatatugApiService,
    { provide: DatatugApiBaseUrl, useValue: datatugApiTestBaseUrl },
    {
      provide: SneatApiAuthTokenBridge,
      useFactory: () => {
        const bridge = new SneatApiAuthTokenBridge();
        bridge.setExplicitToken(datatugApiTestToken);
        return bridge;
      },
    },
    provideHttpClient(),
    provideHttpClientTesting(),
  ];
}

/**
 * Asserts that exactly one request with `method` went to `endpoint` under the
 * test base URL, carrying the Bearer token, and that nothing else is pending.
 */
export function expectDatatugApiRequest(
  method: string,
  endpoint: string,
): void {
  const http = TestBed.inject(HttpTestingController);
  const request = http.expectOne(
    (req) =>
      req.method === method &&
      req.url.startsWith(datatugApiTestBaseUrl + endpoint),
  );
  expect(request.request.headers.get('Authorization')).toBe(
    `Bearer ${datatugApiTestToken}`,
  );
  http.verify();
}
