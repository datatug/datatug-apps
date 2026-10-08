import type {
  CheckoutApi,
  CheckoutAuth,
  CheckoutConfig,
} from './checkout-contracts';
export class CheckoutError extends Error {
  constructor(
    code: string,
    status: number,
    retryAfter?: number | null,
    sessionId?: string | null,
  );
  code: string;
  status: number;
  retryAfter: number | null;
  sessionId: string | null;
}
export function checkoutApi(
  config: CheckoutConfig,
  auth: CheckoutAuth,
  fetcher?: typeof fetch,
): CheckoutApi;
export function validQuote(quote: unknown, mode: string): boolean;
export function discountDescription(quote: unknown): string;
