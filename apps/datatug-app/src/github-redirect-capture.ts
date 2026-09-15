import {
  EnvironmentProviders,
  inject,
  provideAppInitializer,
} from '@angular/core';
import { SNEAT_FIREBASE_AUTH } from '@sneat/app-auth';
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
    if (token) {
      sessionStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, token);
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
