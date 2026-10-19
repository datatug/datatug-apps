import {
  PUBLIC_OVDB_DEV_TRANSPORT,
  PUBLIC_OVDB_LOOPBACK_MODE,
} from '@sneat/datatug-semantic';
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
    if (_name === 'development')
      expect(providers).toEqual([
        {
          provide: PUBLIC_OVDB_DEV_TRANSPORT,
          useValue: PUBLIC_OVDB_LOOPBACK_MODE,
        },
      ]);
    else expect(providers).toEqual([]);
    TestBed.configureTestingModule({
      providers: [
        ...providers,
        { provide: SneatApiBaseUrl, useValue: DefaultSneatAppApiBaseUrl },
      ],
    });
    expect(TestBed.inject(PUBLIC_OVDB_DEV_TRANSPORT, null)).toBe(
      _name === 'development' ? PUBLIC_OVDB_LOOPBACK_MODE : null,
    );
    expect(TestBed.inject(DatatugApiBaseUrl)).toBe(DefaultSneatAppApiBaseUrl);
    expect(TestBed.inject(DATATUG_CHECKOUT_FORCE_TEST)).toBe(false);
  });
});
