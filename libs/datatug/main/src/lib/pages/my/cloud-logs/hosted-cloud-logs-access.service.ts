import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStatuses, SneatAuthStateService } from '@sneat/auth-core';
import {
  BehaviorSubject,
  EMPTY,
  Subject,
  catchError,
  defer,
  distinctUntilChanged,
  filter,
  firstValueFrom,
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
  | 'error';

export interface HostedCloudLogsAccessState {
  readonly status: HostedCloudLogsAccessStatus;
}

const initialState: HostedCloudLogsAccessState = { status: 'checking' };

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
            previous.user?.uid === current.user?.uid,
        ),
        switchMap((authState) => {
          const authGeneration = ++this.authGeneration;
          ++this.requestGeneration;
          const uid =
            authState.status === AuthStatuses.authenticated
              ? authState.user?.uid
              : undefined;

          if (authState.status === AuthStatuses.notAuthenticated) {
            this.publish({ status: 'signed-out' });
            return EMPTY;
          }
          if (!uid) {
            this.publish({ status: 'checking' });
            return EMPTY;
          }

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
    if (this.state().status === 'error') this.retryRequests.next();
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
 * Auth guard runs first. This guard then waits for the server's own UID
 * decision; denied users land on the real My page with an accessible reason.
 */
export const hostedCloudLogsAccessGuard: CanActivateFn = async () => {
  const access = inject(HostedCloudLogsAccessService);
  const router = inject(Router);
  const state = await firstValueFrom(
    access.state$.pipe(
      filter((current) => current.status !== 'checking'),
      take(1),
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
              : 'signed-out',
    },
  });
};
