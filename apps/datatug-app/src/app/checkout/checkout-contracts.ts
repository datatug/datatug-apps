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
}
export interface CheckoutApi {
  config(): Promise<unknown>;
  session(plan: string): Promise<unknown>;
  status(sessionId: string): Promise<unknown>;
  plan(): Promise<unknown>;
}
export interface CheckoutProvider {
  mount(options: {
    publishableKey: string;
    clientSecret: string;
    element: HTMLElement;
  }): Promise<{ destroy(): void }>;
}
export interface CheckoutState {
  stage: string;
  user?: CheckoutUser | null;
  message?: string;
  code?: string;
  status?: number;
  retryAfter?: number;
  existingSession?: string | null;
  supportReference?: string | null;
  quote?: { list: string; due: string; discount: string; mode: string };
}
export interface CheckoutConfig {
  apiOrigin: string;
  planApiOrigin?: string;
  mode: 'test' | 'live';
}
