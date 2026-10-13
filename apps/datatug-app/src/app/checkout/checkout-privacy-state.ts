export const CHECKOUT_PRIVACY_FLAG = '__datatugCheckoutPrivacy';
export const CHECKOUT_GA_IDS = [
  'G-SNF2R7PDY7',
  'G-TYBDTV738R',
  'G-PROVIDE_IF_NEEDED',
] as const;

export function isCheckoutAddress(url: string): boolean {
  try {
    const normalize = (address: string) =>
      address
        .split(/[?#]/)[0]
        .split('/')
        .filter(Boolean)
        .map((part) => decodeURIComponent(part).split(';')[0].toLowerCase())
        .join('/');
    const path = normalize(url);
    const fragment = url.split('#')[1];
    const returnTo = new URLSearchParams(url.split('?')[1]?.split('#')[0]).get(
      'returnTo',
    );
    const authPage = ['login', 'sso', 'sign-in-from-email-link'].includes(path);
    const continuation =
      authPage && fragment?.startsWith('/')
        ? normalize(fragment)
        : authPage && returnTo?.startsWith('/') && !returnTo.startsWith('//')
          ? normalize(returnTo)
          : '';
    return [path, continuation].some(
      (value) =>
        value === 'checkout/sign-in' ||
        value === 'subscriptions' ||
        value.startsWith('subscriptions/') ||
        value === 'subscribe' ||
        value === 'pricing/return' ||
        value === 'business/checkout' ||
        value === 'business/checkout/return',
    );
  } catch {
    return false;
  }
}

export function checkoutPrivacyActive(): boolean {
  return (
    (window as unknown as Record<string, unknown>)[CHECKOUT_PRIVACY_FLAG] ===
    true
  );
}

/** In-memory document latch: no local/session storage or persistent opt-out. */
export function disableCheckoutAnalytics(
  url: string,
  target: Record<string, unknown>,
): void {
  if (!isCheckoutAddress(url)) return;
  target[CHECKOUT_PRIVACY_FLAG] = true;
  for (const id of CHECKOUT_GA_IDS) target['ga-disable-' + id] = true;
}

/** Auth callbacks can carry return context outside the URL; suppress their menu too. */
export function isCheckoutShellAddress(url: string): boolean {
  if (isCheckoutAddress(url)) return true;
  return /^\/(?:login|sso(?:\/callback)?|sign-in-from-email-link)\/?(?:[?#]|$)/.test(
    url,
  );
}
