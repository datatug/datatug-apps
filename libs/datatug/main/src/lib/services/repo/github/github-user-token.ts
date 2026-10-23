import { InjectionToken } from '@angular/core';

/**
 * Where the signed-in user's GitHub token is kept for this tab (`GithubOAuthService`, and the app's redirect capture,
 * `apps/datatug-app/src/github-redirect-capture.ts`, which must agree on the key; the app also removes it on Sneat
 * sign-out and account switch).
 */
export const GITHUB_TOKEN_STORAGE_KEY = 'datatug:github:token';

/**
 * The Sneat user (Firebase uid) the token was obtained for, kept next to it. The app removes the token when the
 * signed-in user is not its owner (sign-out, another account), whichever of the auth event and the storing of the
 * token comes first.
 */
export const GITHUB_TOKEN_OWNER_STORAGE_KEY = 'datatug:github:token-owner';

/**
 * Announced on `window` by the app when it removed the token at a Sneat sign-out or account switch
 * (`apps/datatug-app/src/github-redirect-capture.ts`, same name): the readers then drop what they read with it.
 */
export const GITHUB_SIGNED_OUT_EVENT = 'datatug:github-signed-out';

/** The cache identity of a reader that holds no token. */
export const ANONYMOUS_GITHUB_IDENTITY = 'anonymous';

/**
 * A fingerprint of a token, for in-memory cache keys only: two FNV-1a 32-bit hashes (different seeds) in hex. Never
 * the token itself, and never persisted. Not a secret-strength hash; it only tells one sign-in from another.
 */
export function githubTokenFingerprint(token: string): string {
  const hash = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return hash(0x811c9dc5) + hash(0x01000193);
}

/** The identity a cached GitHub answer belongs to: anonymous, or the fingerprint of the token it was asked with. */
export function githubIdentity(token: string | undefined): string {
  return token ? `user:${githubTokenFingerprint(token)}` : ANONYMOUS_GITHUB_IDENTITY;
}

/** The fingerprint of the token GitHub refused (401) in this page, if any. */
let rejected: string | undefined;

/**
 * GitHub refused this token (401: expired or revoked). It is not sent again in this page, and it is removed from the
 * tab's storage when it is the one kept there: calls go on anonymously until a new sign-in brings a new token.
 */
export function rejectGithubUserToken(token: string): void {
  rejected = githubTokenFingerprint(token);
  try {
    if (globalThis.sessionStorage?.getItem(GITHUB_TOKEN_STORAGE_KEY) === token) {
      globalThis.sessionStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
      globalThis.sessionStorage.removeItem(GITHUB_TOKEN_OWNER_STORAGE_KEY);
    }
  } catch {
    // Storage not available: the in-page rejection still applies.
  }
}

/** `token`, unless GitHub has refused it in this page. */
export function usableGithubToken(token: string | undefined): string | undefined {
  return token && githubTokenFingerprint(token) !== rejected ? token : undefined;
}

/** Forgets a refused token. For tests. */
export function resetGithubTokenRejection(): void {
  rejected = undefined;
}

/**
 * The signed-in user's GitHub token, or undefined when there is none, when GitHub refused it, or when storage is not
 * available. Read at the moment of each call, so a sign-in or a sign-out applies to the next request. A token lifts
 * the anonymous `api.github.com` limit (60 an hour per address) to the user's own 5,000 an hour; it is sent to
 * `api.github.com` only.
 */
export function readGithubUserToken(): string | undefined {
  try {
    return usableGithubToken(
      globalThis.sessionStorage?.getItem(GITHUB_TOKEN_STORAGE_KEY) || undefined,
    );
  } catch {
    return undefined;
  }
}

/** Removes the tab's GitHub token (sign-out). */
export function forgetGithubUserToken(): void {
  try {
    globalThis.sessionStorage?.removeItem(GITHUB_TOKEN_STORAGE_KEY);
    globalThis.sessionStorage?.removeItem(GITHUB_TOKEN_OWNER_STORAGE_KEY);
  } catch {
    // Nothing kept.
  }
}

/** How the GitHub readers get the user's token. Injected so a test says whether there is one. */
export const GITHUB_USER_TOKEN = new InjectionToken<() => string | undefined>(
  'GITHUB_USER_TOKEN',
  { providedIn: 'root', factory: () => readGithubUserToken },
);
