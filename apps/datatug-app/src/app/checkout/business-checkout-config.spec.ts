import { TestBed } from '@angular/core/testing';
import { datatugBusinessCheckoutApiOrigin as developmentOrigin } from '../../environments/environment';
import { datatugBusinessCheckoutApiOrigin as productionOrigin } from '../../environments/environment.prod';
import { datatugBusinessCheckoutApiOrigin as ssoOrigin } from '../../environments/environment.sso-e2e';
import { TEST_CHECKOUT_ORIGIN } from './checkout-config.mjs';
import {
  DATATUG_BUSINESS_CHECKOUT_API_ORIGIN,
  isTrustedBusinessCheckoutOrigin,
  provideDatatugBusinessCheckoutApiOrigin,
} from './business-checkout-config';

afterEach(() => TestBed.resetTestingModule());

it('uses the fixed TEST origin only in the production build environment', () => {
  expect(productionOrigin).toBe(TEST_CHECKOUT_ORIGIN);
  expect(developmentOrigin).toBeNull();
  expect(ssoOrigin).toBeNull();
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
