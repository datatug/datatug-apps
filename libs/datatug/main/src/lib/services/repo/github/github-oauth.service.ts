import { Injectable, inject } from '@angular/core';
import { SNEAT_FIREBASE_AUTH } from '@sneat/app-auth';
import type { Auth } from 'firebase/auth';
import {
  GithubAuthProvider,
  UserCredential,
  getRedirectResult,
  linkWithPopup,
  linkWithRedirect,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth';

/**
 * The extra OAuth scope this app needs on top of the platform's default GitHub
 * scopes (`read:user`, `user:email`): full control of repositories, which is
 * what creating a repository and committing project files requires.
 *
 * Requested here rather than in `@sneat/auth-core` on purpose — the platform's
 * generic provider config is shared by every Sneat app, and none of the others
 * should ask users for repository access.
 */
export const GITHUB_REPO_SCOPE = 'repo';

/** Where the token is kept: this tab only, cleared when the tab closes. */
export const GITHUB_TOKEN_STORAGE_KEY = 'datatug:github:token';

/**
 * Firebase error codes that mean "the browser refused the popup". Sign-in falls
 * back to a full-page redirect for these instead of failing: pop-ups are
 * blocked by Safari/iOS, in-app browsers and strict enterprise policies, and
 * the redirect path works everywhere the popup does not.
 */
const POPUP_BLOCKED_CODES = [
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
];

/**
 * Thrown when the popup was blocked and the browser has been sent to GitHub
 * instead. It is not a failure: the page is navigating away, and
 * {@link GithubOAuthService.completeRedirectSignIn} picks the result up when
 * the app loads again.
 */
export class GithubSignInRedirecting extends Error {
  constructor() {
    super('Redirecting to GitHub to finish signing in');
    this.name = 'GithubSignInRedirecting';
  }
}

/** Firebase error codes that mean "this GitHub account is already attached". */
const ALREADY_LINKED_CODES = [
  'auth/provider-already-linked',
  'auth/credential-already-in-use',
];

/**
 * GitHub sign-in for repository work.
 *
 * Uses Firebase Auth's GitHub provider — the OAuth app is registered against
 * Firebase's auth handler, so Firebase runs the whole authorisation dance and
 * hands back the GitHub access token with the requested scope. The token is
 * kept in memory (and this tab's sessionStorage) and never sent to our servers.
 */
@Injectable({ providedIn: 'root' })
export class GithubOAuthService {
  private readonly auth = inject<Auth>(SNEAT_FIREBASE_AUTH);

  private token?: string;
  private redirectResultChecked = false;

  constructor() {
    this.token = sessionStorage.getItem(GITHUB_TOKEN_STORAGE_KEY) ?? undefined;
  }

  /** True when a GitHub token is available for API calls. */
  public get isSignedIn(): boolean {
    return !!this.token;
  }

  /** The GitHub token, or undefined when the user has not signed in. */
  public get accessToken(): string | undefined {
    return this.token;
  }

  /**
   * Signs in to GitHub, or links GitHub to the already signed-in Sneat account,
   * and returns the access token.
   *
   * Linking is preferred: signing in with GitHub outright could switch the
   * user's Sneat identity. When the provider is already attached (the account
   * was created with GitHub, or GitHub is linked elsewhere) a plain sign-in is
   * the working path — it returns the same user when it is this account.
   */
  public async signIn(): Promise<string> {
    const provider = this.createProvider();
    try {
      return this.tokenFrom(await this.signInOrLink(provider));
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code && POPUP_BLOCKED_CODES.includes(code)) {
        // The browser refused the popup: navigate to GitHub instead. This never
        // returns — the page is on its way out.
        await this.redirectToGithub(provider);
        throw new GithubSignInRedirecting();
      }
      throw err;
    }
  }

  /**
   * Reads the result of a redirect sign-in. Call once when the app starts (the
   * dialog does): after GitHub sends the user back, the credential — and with
   * it the access token — is waiting here. Idempotent, so repeated calls are
   * harmless.
   */
  public async completeRedirectSignIn(): Promise<string | undefined> {
    if (this.redirectResultChecked) {
      return this.token;
    }
    this.redirectResultChecked = true;
    const credential = await getRedirectResult(this.auth);
    if (credential) {
      this.tokenFrom(credential);
    }
    return this.token;
  }

  /** Forgets the GitHub token (does not sign the user out of Sneat). */
  public forget(): void {
    sessionStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
    this.token = undefined;
  }

  private createProvider(): GithubAuthProvider {
    const provider = new GithubAuthProvider();
    provider.addScope(GITHUB_REPO_SCOPE);
    return provider;
  }

  /** Exchanges a credential for the token, remembering it for this tab. */
  private tokenFrom(credential: UserCredential): string {
    const token =
      GithubAuthProvider.credentialFromResult(credential)?.accessToken;
    if (!token) {
      throw new Error(
        `GitHub did not return an access token for the "${GITHUB_REPO_SCOPE}" scope`,
      );
    }
    this.setToken(token);
    return token;
  }

  /**
   * The redirect counterpart of {@link signInOrLink}: links GitHub to the
   * signed-in Sneat account, or signs in with it. Neither call resolves — the
   * browser leaves for GitHub.
   */
  private async redirectToGithub(provider: GithubAuthProvider): Promise<void> {
    const currentUser = this.auth.currentUser;
    if (!currentUser) {
      await signInWithRedirect(this.auth, provider);
      return;
    }
    try {
      await linkWithRedirect(currentUser, provider);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (!code || !ALREADY_LINKED_CODES.includes(code)) {
        throw err;
      }
      await signInWithRedirect(this.auth, provider);
    }
  }

  private async signInOrLink(
    provider: GithubAuthProvider,
  ): Promise<UserCredential> {
    const currentUser = this.auth.currentUser;
    if (!currentUser) {
      return signInWithPopup(this.auth, provider);
    }
    try {
      return await linkWithPopup(currentUser, provider);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code && ALREADY_LINKED_CODES.includes(code)) {
        return signInWithPopup(this.auth, provider);
      }
      throw err;
    }
  }

  private setToken(token: string): void {
    this.token = token;
    sessionStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, token);
  }
}
