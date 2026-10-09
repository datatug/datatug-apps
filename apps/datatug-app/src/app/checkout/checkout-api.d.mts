import type {
  CheckoutApi,
  CheckoutAuth,
  CheckoutConfig,
  SpaceServiceCheckoutApi,
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
): CheckoutApi & SpaceServiceCheckoutApi;
export function validQuote(quote: unknown, mode: string): boolean;
export function discountDescription(quote: unknown): string;
export function validSpaceServiceQuote(
  quote: unknown,
  selection: { spaceID: string; planID: string },
  now?: number,
): boolean;
export function validSpaceServiceSession(
  session: unknown,
  selection: {
    spaceID: string;
    planID: string;
    quoteID: string;
    quotedDueMinor: number;
  },
): boolean;
export function validSpaceServiceStatus(
  status: unknown,
  selection: { spaceID: string; sessionID: string },
): boolean;
