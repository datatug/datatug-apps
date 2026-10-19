/**
 * Which Firebase `authDomain` the browser uses for OAuth sign-in (Google, GitHub, Microsoft).
 *
 * Two domains can serve Firebase's `/__/auth/*` sign-in helper for the shared `sneat-eur3-1` identity project:
 *
 * - `auth.sneat.co`: the shared Sneat domain. It is a different site from the app, so the popup/redirect result is
 *   handed back through storage that the browser partitions for a cross-site iframe. The result then never reaches
 *   the app tab (the opener's console shows "Cross-Origin-Opener-Policy policy would block the window.closed call"
 *   and the popup ends up showing the app itself).
 * - The app's own host (`datatug.app`): Cloudflare reverse-proxies `/__/auth/*` and `/__/firebase/*` to Firebase
 *   (sneat-co/sneat-sites, infra/firebase-auth-proxy), so sign-in is first-party. This is Firebase's documented fix.
 *
 * The second option needs three things outside this repository first (founder steps): the host must be released from
 * any other Firebase Hosting project, listed in Firebase Auth's authorized domains, and
 * `https://<host>/__/auth/handler` must be an authorized redirect URI of every OAuth client in use (Google, GitHub,
 * Microsoft). Until they are done the shared domain stays the default, and the same-origin domain can be tried in
 * one browser with `?authDomain=same-origin` (kept in localStorage; `?authDomain=shared` or `?authDomain=default`
 * undoes it).
 */
export const SHARED_AUTH_DOMAIN = 'auth.sneat.co';

/**
 * Hosts on which Cloudflare proxies `/__/auth/*` to Firebase, so the host can be its own `authDomain`. Any other
 * host serving this bundle (app.incidentius.com) keeps the shared domain.
 */
export const SAME_ORIGIN_AUTH_HOSTS: readonly string[] = ['datatug.app'];

/** Query parameter and localStorage key of the per-browser choice. */
export const AUTH_DOMAIN_PARAM = 'authDomain';
export const AUTH_DOMAIN_STORAGE_KEY = 'datatug:authDomain';

type AuthDomainChoice = 'same-origin' | 'shared';

export interface AuthDomainInput {
  readonly hostname: string;
  readonly search: string;
  /** The deployed default for a host in {@link SAME_ORIGIN_AUTH_HOSTS}. */
  readonly sameOriginByDefault: boolean;
  readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

function isChoice(value: string | null): value is AuthDomainChoice {
  return value === 'same-origin' || value === 'shared';
}

/** Storage that is blocked or full must never stop the app from starting. */
function attempt<T>(action: () => T): T | null {
  try {
    return action();
  } catch {
    return null;
  }
}

export function resolveAuthDomain(input: AuthDomainInput): string {
  const { hostname, search, sameOriginByDefault, storage } = input;
  if (!SAME_ORIGIN_AUTH_HOSTS.includes(hostname)) {
    return SHARED_AUTH_DOMAIN;
  }
  const requested = new URLSearchParams(search).get(AUTH_DOMAIN_PARAM);
  if (isChoice(requested)) {
    attempt(() => storage?.setItem(AUTH_DOMAIN_STORAGE_KEY, requested));
  } else if (requested === 'default') {
    attempt(() => storage?.removeItem(AUTH_DOMAIN_STORAGE_KEY));
  }
  const stored = attempt(
    () => storage?.getItem(AUTH_DOMAIN_STORAGE_KEY) ?? null,
  );
  let choice: AuthDomainChoice = sameOriginByDefault ? 'same-origin' : 'shared';
  if (isChoice(requested)) {
    choice = requested;
  } else if (requested !== 'default' && isChoice(stored)) {
    choice = stored;
  }
  return choice === 'same-origin' ? hostname : SHARED_AUTH_DOMAIN;
}

/** The domain for the current page; `localStorage` may throw (blocked storage), so it is read lazily. */
export function authDomainOfLocation(
  where: Pick<Location, 'hostname' | 'search'>,
  sameOriginByDefault: boolean,
): string {
  const storage = attempt(() => localStorage) ?? undefined;
  return resolveAuthDomain({
    hostname: where.hostname,
    search: where.search,
    sameOriginByDefault,
    storage,
  });
}
