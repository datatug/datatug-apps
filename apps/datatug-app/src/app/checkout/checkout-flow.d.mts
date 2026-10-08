import type {
  CheckoutApi,
  CheckoutAuth,
  CheckoutProvider,
  CheckoutSelection,
  CheckoutState,
} from './checkout-contracts';
interface Common {
  auth: CheckoutAuth;
  api: CheckoutApi;
  mode: 'test' | 'live';
  render(state: CheckoutState): void;
}
interface Flow {
  start(): void;
  dispose(): void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
export function createCheckoutFlow(
  options: Common & {
    provider: CheckoutProvider;
    selection: CheckoutSelection;
  },
): Flow & {
  load(): Promise<void>;
  acknowledge(element: HTMLElement): Promise<void>;
};
export function createReturnFlow(
  options: Common & { sessionId: string; wait?: (ms: number) => Promise<void> },
): Flow & { refresh(): Promise<void> };
