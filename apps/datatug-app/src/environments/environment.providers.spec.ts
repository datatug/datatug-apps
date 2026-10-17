import { TestBed } from '@angular/core/testing';
import { DefaultSneatAppApiBaseUrl, SneatApiBaseUrl } from '@sneat/api';
import { DatatugApiBaseUrl } from '@sneat/datatug-semantic';
import { DATATUG_CHECKOUT_FORCE_TEST } from '../app/checkout/checkout-force-test';
import { datatugEnvironmentProviders as developmentProviders } from './environment';
import { datatugEnvironmentProviders as productionProviders } from './environment.prod';
import { datatugEnvironmentProviders as ssoProviders } from './environment.sso-e2e';

describe('DataTug API base URL in the regular builds', () => {
  it.each([
    ['development', developmentProviders],
    ['production', productionProviders],
    ['sso-e2e', ssoProviders],
  ])('adds no override in the %s build', (_name, providers) => {
    expect(providers).toEqual([]);
    TestBed.configureTestingModule({
      providers: [
        ...providers,
        { provide: SneatApiBaseUrl, useValue: DefaultSneatAppApiBaseUrl },
      ],
    });
    expect(TestBed.inject(DatatugApiBaseUrl)).toBe(DefaultSneatAppApiBaseUrl);
    expect(TestBed.inject(DATATUG_CHECKOUT_FORCE_TEST)).toBe(false);
  });
});
