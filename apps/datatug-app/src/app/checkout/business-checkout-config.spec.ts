import { TestBed } from '@angular/core/testing';
import {
  datatugBusinessCheckoutApiOrigin as developmentOrigin,
  datatugBusinessCheckoutLiveApiOrigin as developmentLiveOrigin,
  datatugBusinessCheckoutLiveEnabled as developmentLiveEnabled,
} from '../../environments/environment';
import {
  datatugBusinessCheckoutApiOrigin as productionOrigin,
  datatugBusinessCheckoutLiveApiOrigin as productionLiveOrigin,
  datatugBusinessCheckoutLiveEnabled as productionLiveEnabled,
} from '../../environments/environment.prod';
import {
  datatugBusinessCheckoutApiOrigin as ssoOrigin,
  datatugBusinessCheckoutLiveApiOrigin as ssoLiveOrigin,
  datatugBusinessCheckoutLiveEnabled as ssoLiveEnabled,
} from '../../environments/environment.sso-e2e';
import { TEST_CHECKOUT_ORIGIN } from './checkout-config.mjs';
import {
  DATATUG_BUSINESS_CHECKOUT_API_ORIGIN,
  DATATUG_BUSINESS_CHECKOUT_LIVE_API_ORIGIN,
  isTrustedBusinessCheckoutOrigin,
  provideDatatugBusinessCheckoutApiOrigin,
  provideDatatugBusinessCheckoutLiveApiOrigin,
} from './business-checkout-config';

afterEach(() => TestBed.resetTestingModule());

it('configures TEST only in production and leaves LIVE origin and activation closed', () => {
  expect(productionOrigin).toBe(TEST_CHECKOUT_ORIGIN);
  expect(productionLiveOrigin).toBeNull();
  expect(productionLiveEnabled).toBe(false);
  expect(developmentOrigin).toBeNull();
  expect(developmentLiveOrigin).toBeNull();
  expect(developmentLiveEnabled).toBe(false);
  expect(ssoOrigin).toBeNull();
  expect(ssoLiveOrigin).toBeNull();
  expect(ssoLiveEnabled).toBe(false);
});

it('provides only the trusted fixed origin through the app injector', () => {
  TestBed.configureTestingModule({
    providers: [provideDatatugBusinessCheckoutApiOrigin(productionOrigin)],
  });
  expect(TestBed.inject(DATATUG_BUSINESS_CHECKOUT_API_ORIGIN)).toBe(
    TEST_CHECKOUT_ORIGIN,
  );
});

it('fails closed for a non-allowlisted production configuration', () => {
  TestBed.configureTestingModule({
    providers: [
      provideDatatugBusinessCheckoutApiOrigin('https://api.test.invalid'),
    ],
  });
  expect(TestBed.inject(DATATUG_BUSINESS_CHECKOUT_API_ORIGIN)).toBeNull();
});

it('keeps Business checkout closed without a trusted TEST API origin', () => {
  expect(isTrustedBusinessCheckoutOrigin(null)).toBe(false);
  expect(isTrustedBusinessCheckoutOrigin('')).toBe(false);
  expect(isTrustedBusinessCheckoutOrigin('http://api.test.invalid')).toBe(
    false,
  );
  expect(isTrustedBusinessCheckoutOrigin('https://api.test.invalid')).toBe(false);
  expect(isTrustedBusinessCheckoutOrigin(`${TEST_CHECKOUT_ORIGIN}/path`)).toBe(
    false,
  );
  expect(isTrustedBusinessCheckoutOrigin(TEST_CHECKOUT_ORIGIN)).toBe(true);
  expect(isTrustedBusinessCheckoutOrigin(`${TEST_CHECKOUT_ORIGIN}/`)).toBe(true);
});

it('accepts only an explicit secure bare LIVE origin from build configuration', () => {
  expect(isTrustedBusinessCheckoutOrigin('https://live.example.test', 'live')).toBe(true);
  expect(isTrustedBusinessCheckoutOrigin('http://live.example.test', 'live')).toBe(false);
  expect(isTrustedBusinessCheckoutOrigin('https://live.example.test/path', 'live')).toBe(false);
  expect(isTrustedBusinessCheckoutOrigin('https://buyer@live.example.test', 'live')).toBe(false);
  expect(isTrustedBusinessCheckoutOrigin(TEST_CHECKOUT_ORIGIN, 'live')).toBe(false);
  TestBed.configureTestingModule({
    providers: [provideDatatugBusinessCheckoutLiveApiOrigin(null)],
  });
  expect(TestBed.inject(DATATUG_BUSINESS_CHECKOUT_LIVE_API_ORIGIN)).toBeNull();
});
