import type { CheckoutProvider } from './checkout-contracts';
export class StripeCheckoutStageError extends Error {
  phase: string;
  code: string;
}
export function stripeCheckoutAdapter(): Promise<CheckoutProvider>;
