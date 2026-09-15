import { Injectable, inject } from '@angular/core';
import { SNEAT_FIREBASE_AUTH } from '@sneat/app-auth';
import type { Auth } from 'firebase/auth';
import {
  GithubAuthProvider,
  UserCredential,
  linkWithPopup,
  signInWithPopup,
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
    const provider = new GithubAuthProvider();
    provider.addScope(GITHUB_REPO_SCOPE);
    const credential = await this.signInOrLink(provider);
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

  /** Forgets the GitHub token (does not sign the user out of Sneat). */
  public forget(): void {
    sessionStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
    this.token = undefined;
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
