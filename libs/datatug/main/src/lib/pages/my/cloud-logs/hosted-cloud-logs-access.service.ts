import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import {
  CanActivateFn,
  Router,
  RouterStateSnapshot,
} from '@angular/router';
import {
  AuthStatuses,
  SneatAuthStateService,
  loginRedirectPath,
} from '@sneat/auth-core';
import {
  BehaviorSubject,
  EMPTY,
  Subject,
  catchError,
  defer,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  of,
  startWith,
  switchMap,
  take,
  tap,
  timeout,
} from 'rxjs';
import { hostedCloudLogsEnabled } from '../../../core/feature-flags';
import { CloudLogsApiService } from './cloud-logs-api.service';

export type HostedCloudLogsAccessStatus =
  | 'disabled'
  | 'checking'
  | 'allowed'
  | 'denied'
  | 'signed-out'
  | 'auth-error'
  | 'error';

export interface HostedCloudLogsAccessState {
  readonly status: HostedCloudLogsAccessStatus;
}

const initialState: HostedCloudLogsAccessState = { status: 'checking' };
const AUTH_STATE_TIMEOUT_MS = 15_000;
const ACCESS_STATE_TIMEOUT_MS = 17_000;

/**
 * Probes the existing authenticated connections endpoint to discover whether
 * the server admits this user. The response body is intentionally discarded;
 * connection and grant data belongs to CloudLogsPageComponent only.
 */
@Injectable({ providedIn: 'root' })
export class HostedCloudLogsAccessService {
  private readonly api = inject(CloudLogsApiService);
  private readonly enabled = hostedCloudLogsEnabled();
  private readonly retryRequests = new Subject<void>();
  private readonly stateSubject = new BehaviorSubject(initialState);
  readonly state = signal<HostedCloudLogsAccessState>(initialState);
  readonly state$ = this.stateSubject
    .asObservable()
    .pipe(
      distinctUntilChanged(
        (previous, current) => previous.status === current.status,
      ),
    );

  private authGeneration = 0;
  private requestGeneration = 0;
  private currentUid?: string;

  constructor() {
    if (!this.enabled) {
      this.publish({ status: 'disabled' });
      return;
    }

    inject(SneatAuthStateService)
      .authState.pipe(
        distinctUntilChanged(
          (previous, current) =>
            previous.status === current.status &&
            previous.user?.uid === current.user?.uid &&
            previous.loadingPhase === current.loadingPhase,
        ),
        switchMap((authState) => {
          const authGeneration = ++this.authGeneration;
          ++this.requestGeneration;
          this.currentUid = undefined;
          if (authState.loadingPhase === 'failed') {
            this.publish({ status: 'auth-error' });
            return EMPTY;
          }
          const uid =
            authState.status === AuthStatuses.authenticated
              ? authState.user?.uid
              : undefined;

          if (authState.status === AuthStatuses.notAuthenticated) {
            this.publish({ status: 'signed-out' });
            return EMPTY;
          }
          if (!uid) {
            this.publish(
              authState.status === AuthStatuses.authenticated
                ? { status: 'auth-error' }
                : { status: 'checking' },
            );
            return EMPTY;
          }
          this.currentUid = uid;

          return this.retryRequests.pipe(
            startWith(undefined),
            switchMap(() => {
              const requestGeneration = ++this.requestGeneration;
              this.publish({ status: 'checking' });
              return defer(() => this.api.list()).pipe(
                timeout({ first: 15_000 }),
                tap(() => {
                  if (
                    authGeneration === this.authGeneration &&
                    requestGeneration === this.requestGeneration
                  ) {
                    this.publish({ status: 'allowed' });
                  }
                }),
                catchError((error: unknown) => {
                  if (
                    authGeneration === this.authGeneration &&
                    requestGeneration === this.requestGeneration
                  ) {
                    this.publish({
                      status: isAccessDenied(error) ? 'denied' : 'error',
                    });
                  }
                  return EMPTY;
                }),
              );
            }),
          );
        }),
      )
      .subscribe();
  }

  /** Retry a failed permission probe for the current authenticated identity. */
  retry(): void {
    if (this.state().status === 'error' || this.state().status === 'denied') {
      this.retryRequests.next();
    }
  }

  /** Marks a bounded auth wait as failed without retaining identity data. */
  markAuthUnavailable(): void {
    ++this.authGeneration;
    ++this.requestGeneration;
    this.currentUid = undefined;
    this.publish({ status: 'auth-error' });
  }

  /** Used only to bind the one-use OAuth finish key to the active session. */
  isCurrentUser(uid: string): boolean {
    return this.state().status === 'allowed' && this.currentUid === uid;
  }

  /** Returns the UID only to bind the one-use browser OAuth attempt. */
  currentUserId(): string | undefined {
    return this.state().status === 'allowed' ? this.currentUid : undefined;
  }

  private publish(state: HostedCloudLogsAccessState): void {
    this.state.set(state);
    this.stateSubject.next(state);
  }
}

function isAccessDenied(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    (error.status === 403 || error.status === 404)
  );
}

/**
 * Resolves auth before waiting for the server's own UID decision. Keeping both
 * waits in one guard avoids Angular running same-route guards concurrently.
 */
export const hostedCloudLogsAccessGuard: CanActivateFn = async (
  _route,
  routeState: RouterStateSnapshot,
) => {
  const access = inject(HostedCloudLogsAccessService);
  const router = inject(Router);
  const auth = inject(SneatAuthStateService);
  const authState = await firstValueFrom(
    auth.authState.pipe(
      filter(
        (current) =>
          current.status !== AuthStatuses.authenticating ||
          current.loadingPhase === 'failed',
      ),
      take(1),
      timeout({ first: AUTH_STATE_TIMEOUT_MS }),
      catchError(() => of(undefined)),
    ),
  );

  if (!authState) {
    access.markAuthUnavailable();
    return router.parseUrl(loginRedirectPath(routeState.url));
  }

  if (
    authState.status !== AuthStatuses.authenticated ||
    authState.loadingPhase === 'failed' ||
    !authState.user?.uid
  ) {
    return router.parseUrl(loginRedirectPath(routeState.url));
  }

  const state = await firstValueFrom(
    access.state$.pipe(
      filter((current) => current.status !== 'checking'),
      take(1),
      timeout({ first: ACCESS_STATE_TIMEOUT_MS }),
      catchError(() => of({ status: 'error' as const })),
    ),
  );
  if (state.status === 'allowed') return true;
  return router.createUrlTree(['/my'], {
    queryParams: {
      cloudLogsAccess:
        state.status === 'denied'
          ? 'denied'
          : state.status === 'error'
            ? 'unavailable'
            : state.status === 'disabled'
              ? 'disabled'
              : 'unavailable',
    },
  });
};
