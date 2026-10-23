import {
  EnvironmentProviders,
  inject,
  provideAppInitializer,
} from '@angular/core';
import { SNEAT_FIREBASE_AUTH } from '@sneat/app-auth';
import { SneatAuthStateService } from '@sneat/auth-core';
import { tabStorage } from '@datatug/product-profiles';
import type { Observable } from 'rxjs';
import type { Auth } from 'firebase/auth';
import { GithubAuthProvider, getRedirectResult } from 'firebase/auth';

/**
 * Where the DataTug GitHub token is kept for this tab. The same key
 * `datatug-main`'s `GithubOAuthService` reads and writes
 * (`github-oauth.service.ts`). It is duplicated here on purpose: this app must
 * not statically import that lazily-loaded library (the module-boundary rule
 * forbids it), and the two must agree.
 */
export const GITHUB_TOKEN_STORAGE_KEY = 'datatug:github:token';

/** The Sneat user the token was obtained for; the same key as `datatug-main`'s `github-user-token.ts`. */
export const GITHUB_TOKEN_OWNER_STORAGE_KEY = 'datatug:github:token-owner';

/**
 * Captures a pending GitHub redirect sign-in at start-up.
 *
 * Firebase keeps a pending redirect result once and gives it to whoever asks
 * first — and the platform's own auth bootstrap asks during start-up. Reading it
 * later, from the new-project dialog as this app first did, silently lost the
 * GitHub token: the user came back authorised, but DataTug stayed disconnected.
 * Hence an app initializer registered BEFORE `provideSneatAuthenticatedProviders()`.
 */
export async function captureGithubRedirectSignIn(): Promise<void> {
  const auth = inject<Auth>(SNEAT_FIREBASE_AUTH);
  try {
    const credential = await getRedirectResult(auth);
    const token = credential
      ? GithubAuthProvider.credentialFromResult(credential)?.accessToken
      : undefined;
    const storage = tabStorage();
    if (token && storage) {
      storage.setItem(GITHUB_TOKEN_STORAGE_KEY, token);
      const owner = credential?.user?.uid;
      if (owner) storage.setItem(GITHUB_TOKEN_OWNER_STORAGE_KEY, owner);
      else storage.removeItem(GITHUB_TOKEN_OWNER_STORAGE_KEY);
    }
  } catch {
    // A redirect that carries no usable credential is not an error worth
    // failing start-up over: the user simply stays disconnected and can
    // connect again from the dialog.
  }
}

/** App initializer that captures a redirect sign-in result, if there is one. */
export function provideGithubRedirectCapture(): EnvironmentProviders {
  return provideAppInitializer(captureGithubRedirectSignIn);
}

/**
 * Announced on `window` when the GitHub token was removed at a Sneat sign-out or account switch. `datatug-main`'s
 * GitHub readers listen for it and drop, from memory, what they read with that token (the same name is in
 * `github-user-token.ts`; duplicated for the module-boundary reason above).
 */
export const GITHUB_SIGNED_OUT_EVENT = 'datatug:github-signed-out';

/** The part of the Sneat auth state the sign-out watch reads. */
export interface IGithubSignOutAuthState {
  readonly status: string;
  readonly user?: { readonly uid?: string } | null;
}

/**
 * Removes the tab's GitHub token when the signed-in Sneat user is not the one it was obtained for: at sign-out, when
 * another account signs in, and for a token kept with no owner. The token is the user's, and must not go on lifting
 * (or reading private repositories for) whoever uses the tab next. Comparing with the stored owner, not with the
 * previous auth event, makes the order of a popup sign-in's auth event and the storing of its token not matter. The
 * same effect as `GithubOAuthService.forget()` in `datatug-main`, which this app must not import. Returns the
 * subscription.
 */
export function forgetGithubTokenOnSignOut(
  authState: Observable<IGithubSignOutAuthState>,
  // A getter, read inside a try at each auth state: reading `sessionStorage` throws when the browser blocks storage.
  storage: () => Pick<Storage, 'getItem' | 'removeItem'> | undefined = tabStorage,
  target: Pick<EventTarget, 'dispatchEvent'> | undefined = globalThis,
) {
  return authState.subscribe((state) => {
    if (state.status !== 'authenticated' && state.status !== 'notAuthenticated') {
      return; // still deciding: neither a sign-out nor a new account
    }
    const uid = state.status === 'authenticated' ? state.user?.uid || undefined : undefined;
    try {
      const kept = storage();
      if (!kept?.getItem(GITHUB_TOKEN_STORAGE_KEY)) return;
      if ((kept.getItem(GITHUB_TOKEN_OWNER_STORAGE_KEY) || undefined) === uid && uid) return;
      kept.removeItem(GITHUB_TOKEN_STORAGE_KEY);
      kept.removeItem(GITHUB_TOKEN_OWNER_STORAGE_KEY);
    } catch {
      return; // Storage not available: nothing kept there.
    }
    target?.dispatchEvent(new Event(GITHUB_SIGNED_OUT_EVENT));
  });
}

/** App initializer that forgets the GitHub token at Sneat sign-out and account switch. */
export function provideGithubSignOutForget(): EnvironmentProviders {
  return provideAppInitializer(() => {
    const auth = inject(SneatAuthStateService, { optional: true });
    try {
      if (auth) forgetGithubTokenOnSignOut(auth.authState);
    } catch {
      // Never fail start-up over the sign-out watch: without it, a token is only kept until the tab closes.
    }
  });
}
