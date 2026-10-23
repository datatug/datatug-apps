/**
 * The tab's sessionStorage, or undefined when the browser blocks it: reading `sessionStorage` itself throws a
 * SecurityError then (blocked site data, some private modes), so it is never touched outside a try. Callers treat
 * undefined as "nothing stored", never as a failure.
 *
 * The one guard for both the app shell (which must not statically import the lazily loaded `@sneat/datatug-main`)
 * and the DataTug library; it lives here because both already depend on this small package.
 */
export function tabStorage(): Storage | undefined {
  try {
    return globalThis.sessionStorage ?? undefined;
  } catch {
    return undefined;
  }
}
