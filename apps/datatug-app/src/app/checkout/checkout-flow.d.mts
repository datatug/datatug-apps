import type {
  CheckoutApi,
  CheckoutAuth,
  CheckoutProvider,
  CheckoutSelection,
  CheckoutState,
  SpaceServiceCheckoutApi,
  SpaceServiceSelection,
} from './checkout-contracts';
interface Common {
  auth: CheckoutAuth;
  mode: 'test' | 'live';
  render(state: CheckoutState): void;
}
type CheckoutCommon = Common & { api: CheckoutApi };
type SpaceServiceCommon = Common & {
  api: CheckoutApi & SpaceServiceCheckoutApi;
};
interface Flow {
  start(): void;
  dispose(): void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
export function createCheckoutFlow(
  options: CheckoutCommon & {
    provider: CheckoutProvider;
    selection: CheckoutSelection;
  },
): Flow & {
  load(): Promise<void>;
  acknowledge(element: HTMLElement): Promise<void>;
};
export function createReturnFlow(
  options: CheckoutCommon & {
    sessionId: string;
    serviceScope?: never;
    wait?: (ms: number) => Promise<void>;
  },
): Flow & { refresh(): Promise<void> };
export function createReturnFlow(
  options: SpaceServiceCommon & {
    sessionId: string;
    serviceScope: { spaceID: string; mode?: 'test' | 'live' };
    wait?: (ms: number) => Promise<void>;
  },
): Flow & { refresh(): Promise<void> };
export function createSpaceServiceCheckoutFlow(options: {
  auth: CheckoutAuth;
  api: SpaceServiceCommon['api'];
  provider: CheckoutProvider;
  selection: SpaceServiceSelection;
  render(state: CheckoutState): void;
  ready?: () => boolean;
}): Flow & {
  load(): Promise<void>;
  acknowledge(element: HTMLElement): Promise<void>;
};
