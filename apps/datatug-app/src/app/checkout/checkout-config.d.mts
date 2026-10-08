import type { CheckoutSelection } from './checkout-contracts';
export const PRO_PLANS: Readonly<Record<'monthly' | 'yearly', string>>;
export function selection(search: string): CheckoutSelection | null;
export function returnSelection(
  search: string,
): { mode: 'test' | 'live'; sessionId: string } | null;
export function checkoutChoice(
  search: string,
  returning?: boolean,
): { test: boolean } | null;
export function pricingReturnUrl(period: string | null, mode: string): string;
export const TEST_CHECKOUT_ORIGIN: string;
export function checkoutRail(
  search: string,
  returning: boolean,
  normalApiBaseUrl: string,
): {
  chosen: CheckoutSelection | { mode: 'test' | 'live'; sessionId: string };
  mode: 'test' | 'live';
  apiOrigin: string;
} | null;
