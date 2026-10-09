import { isTrustedBusinessCheckoutOrigin } from './business-checkout-config';

it('keeps Business checkout closed without an explicitly configured HTTPS API origin', () => {
  expect(isTrustedBusinessCheckoutOrigin(null)).toBe(false);
  expect(isTrustedBusinessCheckoutOrigin('')).toBe(false);
  expect(isTrustedBusinessCheckoutOrigin('http://api.test.invalid')).toBe(
    false,
  );
  expect(isTrustedBusinessCheckoutOrigin('https://api.test.invalid/path')).toBe(
    false,
  );
  expect(isTrustedBusinessCheckoutOrigin('https://api.test.invalid')).toBe(
    true,
  );
});
