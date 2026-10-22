import { SneatApiNotAuthenticatedError } from '@sneat/api';

/**
 * True when the hosted DataTug API declined to answer a read: the visitor is
 * signed out (the API client rejects before sending, with
 * `SneatApiNotAuthenticatedError` and no HTTP status), the API refused the
 * actor (401/403), or it has no such resource (404). A public GitHub project
 * can still be read straight from its repository in each of these cases. Any
 * other failure (outage, network, malformed response) is a real error.
 */
export const isHostedReadRefused = (error: unknown): boolean =>
  error === SneatApiNotAuthenticatedError ||
  [401, 403, 404].includes((error as { status?: number } | null)?.status ?? 0);
