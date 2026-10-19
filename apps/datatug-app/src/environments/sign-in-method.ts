/**
 * Per-browser override for Firebase web sign-in. On datatug.app,
 * `?signInMethod=redirect` stores the redirect strategy for Firebase's return
 * to this browser; `?signInMethod=popup` opts back into popup; and
 * `?signInMethod=default` removes the stored choice and restores popup.
 * This setting does not change Firebase project or authDomain.
 */
export const SIGN_IN_METHOD_PARAM = 'signInMethod';
export const SIGN_IN_METHOD_STORAGE_KEY = 'datatug:signInMethod';

export type WebSignInMethod = 'popup' | 'redirect';

export interface SignInMethodInput {
  readonly search: string;
  readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

function isMethod(value: string | null | undefined): value is WebSignInMethod {
  return value === 'popup' || value === 'redirect';
}

function attempt<T>(action: () => T): T | null {
  try {
    return action();
  } catch {
    return null;
  }
}

/**
 * Resolves and persists a browser's explicit method choice. `default` clears
 * the choice and returns popup. Invalid query and stored values are ignored.
 */
export function resolveSignInMethod(input: SignInMethodInput): WebSignInMethod {
  const { search, storage } = input;
  const requested = new URLSearchParams(search).get(SIGN_IN_METHOD_PARAM);
  if (isMethod(requested)) {
    attempt(() => storage?.setItem(SIGN_IN_METHOD_STORAGE_KEY, requested));
    return requested;
  }
  if (requested === 'default') {
    attempt(() => storage?.removeItem(SIGN_IN_METHOD_STORAGE_KEY));
    return 'popup';
  }
  const stored = attempt(
    () => storage?.getItem(SIGN_IN_METHOD_STORAGE_KEY) ?? null,
  );
  return isMethod(stored) ? stored : 'popup';
}

/** Safe for SSR and browsers where localStorage is blocked. */
export function signInMethodOfLocation(
  where: Pick<Location, 'search'> | undefined = typeof window === 'undefined'
    ? undefined
    : window.location,
  storage: () => Storage = () => window.localStorage,
): WebSignInMethod {
  if (!where) return 'popup';
  return resolveSignInMethod({
    search: where.search,
    storage: attempt(storage) ?? undefined,
  });
}
