import { InjectionToken, type ValueProvider } from '@angular/core';
import { TEST_CHECKOUT_ORIGIN } from './checkout-config.mjs';

/**
 * Business checkout accepts only the fixed TEST API origin. The production
 * build supplies it explicitly; development and SSO builds stay closed.
 */
export const DATATUG_BUSINESS_CHECKOUT_API_ORIGIN = new InjectionToken<
  string | null
>('DATATUG_BUSINESS_CHECKOUT_API_ORIGIN', {
  providedIn: 'root',
  factory: () => null,
});

export function provideDatatugBusinessCheckoutApiOrigin(
  value: string | null,
): ValueProvider {
  return {
    provide: DATATUG_BUSINESS_CHECKOUT_API_ORIGIN,
    useValue: isTrustedBusinessCheckoutOrigin(value) ? value : null,
  };
}

export function isTrustedBusinessCheckoutOrigin(
  value: string | null,
): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.origin === TEST_CHECKOUT_ORIGIN &&
      !!url.host &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === '/' || url.pathname === '')
    );
  } catch {
    return false;
  }
}
