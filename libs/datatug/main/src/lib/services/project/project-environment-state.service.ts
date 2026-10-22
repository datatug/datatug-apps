import { SneatAuthStateService } from '@sneat/auth-core';
import { inject, Injectable } from '@angular/core';
import {
  catchError,
  defer,
  map,
  Observable,
  of,
  switchMap,
  throwError,
  Subject,
  filter,
  startWith,
  combineLatest,
  distinctUntilChanged,
} from 'rxjs';
import { IEnvironmentFull } from '../../models/definition/environments';
import { equalProjectRef, IProjectRef } from '../../core/project-context';
import {
  EnvironmentState,
  EnvironmentMutation,
  EnvironmentOperationResult,
  CreateEnvironmentRequest,
  SaveEnvironmentOrderRequest,
} from '../../models/definition/environment-state';
import { resolveEnvironmentOrder } from '../../models/definition/environment-order';
import { ProjectQueryApiService } from './project-query-api.service';

type EnvironmentReadResult =
  | { status: 'pending' | 'unavailable' }
  | {
      status: 'ready';
      view: {
        state?: EnvironmentState;
        items: IEnvironmentFull[];
        reason?: string;
      };
    };

@Injectable({ providedIn: 'root' })
export class ProjectEnvironmentStateService {
  private readonly api = inject(ProjectQueryApiService);
  private readonly auth = inject(SneatAuthStateService);
  private readonly changes = new Subject<IProjectRef>();
  changed(ref: IProjectRef): void {
    this.changes.next(ref);
  }
  watch(
    ref: IProjectRef,
    legacy: () => Observable<IEnvironmentFull[]>,
  ): Observable<{
    state?: EnvironmentState;
    items: IEnvironmentFull[];
    reason?: string;
  }> {
    return this.triggers(ref).pipe(switchMap(() => this.view(ref, legacy)));
  }

  /** Presentation only: each attempt clears prior items and can recover on a fresh trigger. */
  watchResult(
    ref: IProjectRef,
    legacy: () => Observable<IEnvironmentFull[]>,
  ): Observable<EnvironmentReadResult> {
    return this.triggers(ref).pipe(
      switchMap(() =>
        defer(() => this.view(ref, legacy)).pipe(
          map((view): EnvironmentReadResult => ({ status: 'ready', view })),
          catchError(() =>
            of<EnvironmentReadResult>({ status: 'unavailable' }),
          ),
          startWith<EnvironmentReadResult>({ status: 'pending' }),
        ),
      ),
    );
  }

  private triggers(ref: IProjectRef) {
    return combineLatest([
      this.changes.pipe(
        filter((changed) => equalProjectRef(changed, ref)),
        startWith(ref),
      ),
      this.auth.authState.pipe(
        map((auth) => `${auth.status}:${auth.user?.uid || ''}`),
        distinctUntilChanged(),
      ),
    ]);
  }
  read(ref: IProjectRef): Observable<EnvironmentState> {
    return this.api.environmentState<EnvironmentState>(ref).pipe(
      map((state) => {
        const scope = state?.scope;
        const requested = this.api.environmentReference(ref);
        if (
          state?.contract !== 'environment-state/1' ||
          !scope ||
          scope.storeId !== requested.storeId ||
          scope.projectId !== requested.projectId ||
          scope.branch !== requested.branch ||
          scope.spaceID !== requested.spaceID ||
          scope.projectApi !== requested.projectApi ||
          !scope.authorityId ||
          !state.revision ||
          !/^[a-f0-9]{64}$/.test(state.scopeBinding)
        )
          throw new Error('Environment state scope could not be verified.');
        const resolved = resolveEnvironmentOrder(
          state.environments,
          state.savedOrder,
        );
        if (JSON.stringify(resolved.order) !== JSON.stringify(state.order))
          throw new Error('Environment order could not be verified.');
        return { ...state, environments: resolved.items };
      }),
    );
  }
  view(
    ref: IProjectRef,
    legacy: () => Observable<IEnvironmentFull[]>,
  ): Observable<{
    state?: EnvironmentState;
    items: IEnvironmentFull[];
    reason?: string;
  }> {
    return this.read(ref).pipe(
      map((state) => ({ state, items: [...state.environments] })),
      catchError((error) => {
        // A public GitHub project keeps its environments as plain files in the repository, which anyone can read.
        // When the visitor is signed out (no token, or a 401), read them anonymously instead of showing nothing.
        const publicGithub =
          ['github', 'github.com'].includes(ref.storeId) &&
          ref.projectApi !== 'cloud' &&
          ref.spaceID === undefined;
        if (publicGithub && isSignedOutFailure(error))
          return legacy().pipe(
            map((items) => ({
              items,
              reason: 'Sign in to create environments or manage shared order.',
            })),
          );
        const local =
          !['github', 'github.com', 'firestore'].includes(ref.storeId) &&
          ref.projectApi !== 'cloud' &&
          ref.spaceID === undefined;
        if (!local || error?.status !== 426) return throwError(() => error);
        const unsupported = of(true);
        return unsupported.pipe(
          switchMap((old) =>
            old
              ? legacy().pipe(
                  map((items) => ({
                    items,
                    reason:
                      'Update the local DataTug agent to create environments or manage shared order.',
                  })),
                )
              : throwError(() => error),
          ),
        );
      }),
    );
  }

  mutation(state: EnvironmentState): EnvironmentMutation {
    return {
      scope: state.scope,
      ifRevision: state.revision,
      operationId: `${state.scopeBinding}.${crypto.randomUUID()}`,
    };
  }
  create(
    ref: IProjectRef,
    request: CreateEnvironmentRequest,
  ): Observable<EnvironmentOperationResult> {
    return defer(() =>
      this.api.environmentOperation<EnvironmentOperationResult>(
        ref,
        'environment/create_environment',
        request,
      ),
    );
  }
  save(
    ref: IProjectRef,
    request: SaveEnvironmentOrderRequest,
  ): Observable<EnvironmentOperationResult> {
    return defer(() =>
      this.api.environmentOperation<EnvironmentOperationResult>(
        ref,
        'environments/save_order',
        request,
      ),
    );
  }
  status(
    ref: IProjectRef,
    request: EnvironmentMutation,
  ): Observable<EnvironmentOperationResult> {
    return this.api.environmentOperation<EnvironmentOperationResult>(
      ref,
      'environments/operation_status',
      {
        scope: request.scope,
        operationId: request.operationId,
      },
    );
  }
}

/** A request that failed only because nobody is signed in: a 401, or the auth layer having no ID token yet. */
function isSignedOutFailure(error: unknown): boolean {
  const { status, message } = (error ?? {}) as {
    status?: unknown;
    message?: unknown;
  };
  return (
    status === 401 ||
    (typeof message === 'string' &&
      /not authenticated|no firebase id token/i.test(message))
  );
}
