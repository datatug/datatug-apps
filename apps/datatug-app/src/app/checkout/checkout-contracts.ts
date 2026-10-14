export interface CheckoutUser {
  id: string;
  email: string | null;
}
export interface CheckoutAuth {
  observe(callback: (user: CheckoutUser | null) => void): () => void;
  token(): Promise<string | null>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
export interface CheckoutSelection {
  period: 'monthly' | 'yearly';
  plan: string;
  kind?: 'business';
  purchaseId?: string;
  spaceID?: string;
}
export interface CheckoutApi {
  purchases(after?: string): Promise<unknown>;
  config(): Promise<unknown>;
  session(plan: string, purchase?: CheckoutSelection): Promise<unknown>;
  setup(
    accountId: string,
    destination: { spaceID?: string; title?: string },
  ): Promise<PurchaseSetup>;
  options(accountId: string, cancel?: boolean): Promise<PurchaseOptions>;
  status(sessionId: string): Promise<unknown>;
  plan(): Promise<unknown>;
}
export interface SpaceServiceCheckoutApi {
  serviceQuote(spaceID: string, planID: string): Promise<unknown>;
  serviceSession(spaceID: string, quoteID: string): Promise<unknown>;
  serviceStatus(spaceID: string, sessionID: string): Promise<unknown>;
}
export interface SpaceServiceSelection {
  spaceID: string;
  planID: 'datatug-business-usage-monthly' | 'datatug-business-usage-annual';
  mode?: 'test' | 'live';
}
export interface CheckoutProvider {
  mount(options: {
    publishableKey: string;
    clientSecret: string;
    element: HTMLElement;
  }): Promise<{ destroy(): void }>;
}
export interface PurchaseSetup {
  accountId: string;
  spaceID?: string;
  spaceHint?: string;
  setupRequired: boolean;
  paid: boolean;
}
export interface PurchaseOptions {
  canCancelPersonal: boolean;
  cancellationScheduled: boolean;
  personalPaidThroughUTC?: string;
}
export interface CheckoutState {
  purchase?: PurchaseSetup;
  stage: string;
  spaceID?: string;
  user?: CheckoutUser | null;
  message?: string;
  code?: string;
  status?: number;
  retryAfter?: number;
  existingSession?: string | null;
  supportReference?: string | null;
  quote?: {
    renewal?: string;
    invitationMonths?: number;
    list: string;
    due: string;
    discount?: string;
    discountAmount?: string;
    mode?: string;
    interval?: 'month' | 'year';
    claimed?: boolean;
  };
  retrySameQuote?: boolean;
  providerAmountTotal?: number | null;
}
export interface CheckoutConfig {
  apiOrigin: string;
  planApiOrigin?: string;
  mode: 'test' | 'live';
}
