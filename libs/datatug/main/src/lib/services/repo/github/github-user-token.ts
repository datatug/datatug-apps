import { InjectionToken } from '@angular/core';

/**
 * Where the signed-in user's GitHub token is kept for this tab (`GithubOAuthService`, and the app's redirect capture,
 * `apps/datatug-app/src/github-redirect-capture.ts`, which must agree on the key).
 */
export const GITHUB_TOKEN_STORAGE_KEY = 'datatug:github:token';

/**
 * The signed-in user's GitHub token, or undefined when there is none (or storage is not available). Read at the moment
 * of each call, so a sign-in or a sign-out applies to the next request. A token lifts the anonymous `api.github.com`
 * limit (60 an hour per address) to the user's own 5,000 an hour; it is sent to `api.github.com` only.
 */
export function readGithubUserToken(): string | undefined {
  try {
    return globalThis.sessionStorage?.getItem(GITHUB_TOKEN_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

/** How the GitHub readers get the user's token. Injected so a test says whether there is one. */
export const GITHUB_USER_TOKEN = new InjectionToken<() => string | undefined>(
  'GITHUB_USER_TOKEN',
  { providedIn: 'root', factory: () => readGithubUserToken },
);
