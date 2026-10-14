import { InjectionToken, type ValueProvider } from '@angular/core';
import { TEST_CHECKOUT_ORIGIN } from './checkout-config.mjs';

/** Rail origins come from trusted build configuration, never from URL input. */
export const DATATUG_BUSINESS_CHECKOUT_API_ORIGIN = new InjectionToken<
  string | null
>('DATATUG_BUSINESS_CHECKOUT_API_ORIGIN', {
  providedIn: 'root',
  factory: () => null,
});

export const DATATUG_BUSINESS_CHECKOUT_LIVE_API_ORIGIN =
  new InjectionToken<string | null>('DATATUG_BUSINESS_CHECKOUT_LIVE_API_ORIGIN', {
    providedIn: 'root',
    factory: () => null,
  });

export const DATATUG_BUSINESS_CHECKOUT_LIVE_ENABLED = new InjectionToken<boolean>(
  'DATATUG_BUSINESS_CHECKOUT_LIVE_ENABLED',
  {
    providedIn: 'root',
    factory: () => false,
  },
);

export function provideDatatugBusinessCheckoutApiOrigin(
  value: string | null,
): ValueProvider {
  return {
    provide: DATATUG_BUSINESS_CHECKOUT_API_ORIGIN,
    useValue: isTrustedBusinessCheckoutOrigin(value) ? value : null,
  };
}

export function provideDatatugBusinessCheckoutLiveEnabled(
  value: boolean,
): ValueProvider {
  return {
    provide: DATATUG_BUSINESS_CHECKOUT_LIVE_ENABLED,
    useValue: value === true,
  };
}

export function provideDatatugBusinessCheckoutLiveApiOrigin(
  value: string | null,
): ValueProvider {
  return {
    provide: DATATUG_BUSINESS_CHECKOUT_LIVE_API_ORIGIN,
    useValue: isTrustedBusinessCheckoutOrigin(value, 'live') ? value : null,
  };
}

export function isTrustedBusinessCheckoutOrigin(
  value: string | null,
  mode: 'test' | 'live' = 'test',
): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (mode === 'test'
        ? url.origin === TEST_CHECKOUT_ORIGIN
        : url.origin !== TEST_CHECKOUT_ORIGIN) &&
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
