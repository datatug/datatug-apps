export const CHECKOUT_PRIVACY_FLAG = '__datatugCheckoutPrivacy';
export const CHECKOUT_GA_IDS = [
  'G-SNF2R7PDY7',
  'G-TYBDTV738R',
  'G-PROVIDE_IF_NEEDED',
] as const;

export function isCheckoutAddress(url: string): boolean {
  try {
    const path = url
      .split(/[?#]/)[0]
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part).split(';')[0].toLowerCase())
      .join('/');
    return path === 'subscribe' || path === 'pricing/return';
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
