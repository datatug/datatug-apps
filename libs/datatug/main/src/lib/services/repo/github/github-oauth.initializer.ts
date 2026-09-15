import {
  EnvironmentProviders,
  inject,
  provideAppInitializer,
} from '@angular/core';
import { GithubOAuthService } from './github-oauth.service';

/**
 * Reads a pending GitHub redirect sign-in result while the app starts.
 *
 * Ordering is the point: Firebase keeps a pending redirect result once and
 * hands it to whoever asks first, and the platform's own auth bootstrap calls
 * `getRedirectResult` during start-up. Reading it later — from the new-project
 * dialog, as this app first did — loses that race, leaving the user authorised
 * on GitHub but disconnected in DataTug. That is why this must be registered
 * BEFORE `provideSneatAuthenticatedProviders()`.
 */
export function captureGithubRedirectSignIn(): Promise<string | undefined> {
  return inject(GithubOAuthService).completeRedirectSignIn();
}

/** App initializer that captures a redirect sign-in result, if there is one. */
export function provideGithubRedirectCapture(): EnvironmentProviders {
  return provideAppInitializer(captureGithubRedirectSignIn);
}
