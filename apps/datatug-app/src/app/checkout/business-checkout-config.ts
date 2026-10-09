import { InjectionToken } from '@angular/core';

/**
 * No checkout host is wired into the DataTug app yet. Supplying a trusted
 * HTTPS origin is a deploy-time decision; the route remains closed by default.
 */
export const DATATUG_BUSINESS_CHECKOUT_API_ORIGIN = new InjectionToken<
  string | null
>('DATATUG_BUSINESS_CHECKOUT_API_ORIGIN', {
  providedIn: 'root',
  factory: () => null,
});

export function isTrustedBusinessCheckoutOrigin(
  value: string | null,
): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
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
