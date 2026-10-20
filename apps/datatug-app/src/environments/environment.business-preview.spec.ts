import { TestBed } from '@angular/core/testing';
import { DefaultSneatAppApiBaseUrl, SneatApiBaseUrl } from '@sneat/api';
import {
  DATATUG_TEST_PREVIEW_API_BASE_URL,
  DatatugApiBaseUrl,
} from '@sneat/datatug-semantic';
import { DATATUG_CHECKOUT_FORCE_TEST } from '../app/checkout/checkout-force-test';
import {
  TEST_CHECKOUT_ORIGIN,
  TEST_PREVIEW_PROJECT_ORIGIN,
} from '../app/checkout/checkout-config.mjs';
import { isTrustedBusinessCheckoutOrigin } from '../app/checkout/business-checkout-config';
import {
  datatugAppEnvironmentConfig,
  datatugBusinessCheckoutApiOrigin,
  datatugBusinessCheckoutLiveApiOrigin,
  datatugBusinessCheckoutLiveEnabled,
  datatugEnvironmentProviders,
} from './environment.business-preview';

const providesToken = (provider: unknown, token: unknown): boolean =>
  (provider as { provide?: unknown })?.provide === token;

describe('Business project preview environment', () => {
  it('sends DataTug API calls to datatug-cloud-preview and leaves SneatApiBaseUrl at its normal value', () => {
    // The preview providers come last, so an override of SneatApiBaseUrl
    // would win and fail this test.
    TestBed.configureTestingModule({
      providers: [
        { provide: SneatApiBaseUrl, useValue: DefaultSneatAppApiBaseUrl },
        ...datatugEnvironmentProviders,
      ],
    });
    expect(TestBed.inject(DatatugApiBaseUrl)).toBe(
      `${TEST_PREVIEW_PROJECT_ORIGIN}/v0/`,
    );
    expect(TestBed.inject(SneatApiBaseUrl)).toBe(DefaultSneatAppApiBaseUrl);
  });

  it('uses the same preview origin as the one DatatugApiService treats as the TEST preview', () => {
    // DatatugApiService keeps identity calls on the normal API only when the
    // injected DatatugApiBaseUrl equals this constant. If the two origins
    // disagree, the preview build silently sends identity calls to the preview.
    expect(`${TEST_PREVIEW_PROJECT_ORIGIN}/v0/`).toBe(
      DATATUG_TEST_PREVIEW_API_BASE_URL,
    );
  });

  it('forces every checkout rail to TEST', () => {
    TestBed.configureTestingModule({
      providers: [...datatugEnvironmentProviders],
    });
    expect(TestBed.inject(DATATUG_CHECKOUT_FORCE_TEST)).toBe(true);
  });

  it('provides no SneatApiBaseUrl override', () => {
    expect(
      datatugEnvironmentProviders.some((p) =>
        providesToken(p, SneatApiBaseUrl),
      ),
    ).toBe(false);
  });

  it('selects no LIVE Business checkout', () => {
    expect(datatugBusinessCheckoutApiOrigin).toBe(TEST_CHECKOUT_ORIGIN);
    expect(datatugBusinessCheckoutLiveApiOrigin).toBeNull();
    expect(datatugBusinessCheckoutLiveEnabled).toBe(false);
    expect(
      isTrustedBusinessCheckoutOrigin(
        datatugBusinessCheckoutLiveApiOrigin,
        'live',
      ),
    ).toBe(false);
  });

  it('has none of the inputs main.ts uses to pick a non-default SneatApiBaseUrl', () => {
    expect(datatugAppEnvironmentConfig.useNgrok).toBeFalsy();
    expect(datatugAppEnvironmentConfig.firebaseConfig.emulator).toBeUndefined();
    expect(datatugAppEnvironmentConfig.hostedCloudLogsEnabled).toBe(false);
  });
});
