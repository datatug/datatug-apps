import { TestBed } from '@angular/core/testing';
import { DefaultSneatAppApiBaseUrl, SneatApiBaseUrl } from '@sneat/api';
import { DatatugApiBaseUrl } from '@sneat/datatug-semantic';
import { TEST_PREVIEW_PROJECT_ORIGIN } from '../app/checkout/checkout-config.mjs';
import { datatugEnvironmentProviders } from './environment.business-preview';

describe('Business project preview environment', () => {
  it('sends DataTug API calls to datatug-cloud-preview and leaves SneatApiBaseUrl alone', () => {
    TestBed.configureTestingModule({
      providers: [
        ...datatugEnvironmentProviders,
        { provide: SneatApiBaseUrl, useValue: DefaultSneatAppApiBaseUrl },
      ],
    });
    expect(TestBed.inject(DatatugApiBaseUrl)).toBe(
      `${TEST_PREVIEW_PROJECT_ORIGIN}/v0/`,
    );
    expect(TestBed.inject(SneatApiBaseUrl)).toBe(DefaultSneatAppApiBaseUrl);
  });
});
