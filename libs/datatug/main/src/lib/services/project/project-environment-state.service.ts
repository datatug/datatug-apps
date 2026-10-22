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
import { isHostedReadRefused, isSignedOut } from './hosted-read-refused';

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
        if (isPublicGithubRead(ref, error))
          // A signed-out visitor (or one the hosted API refuses) can still read
          // a public GitHub project's environments straight from the
          // repository, exactly as the other public project pages do. There is
          // no verified state, so management stays unavailable. A private or
          // missing repository fails that anonymous read too, and the error
          // surfaces instead of an empty list.
          return legacy().pipe(
            map((items) => ({
              items,
              reason: isSignedOut(error)
                ? 'Sign in to create environments or manage shared order.'
                : 'These environments are read from the public repository. Managing them needs access to this project in DataTug.',
            })),
          );
        const local =
          !['github', 'github.com', 'firestore'].includes(ref.storeId) &&
          ref.projectApi !== 'cloud' &&
          ref.spaceID === undefined;
        if (!local) return throwError(() => error);
        const readOnly = () =>
          legacy().pipe(
            map((items) => ({
              items,
              reason:
                'Update the local DataTug agent to create environments or manage shared order.',
            })),
          );
        if (isPreContractAgent(error)) return readOnly();
        // A released agent's unmounted route has no CORS headers, so the browser
        // reports only status 0. Treat it as pre-contract only when the same
        // agent answers its own agent-info: an unreachable agent (or any other
        // network failure) keeps its real error.
        if ((error as { status?: number } | null)?.status === 0)
          return this.api.agentInfo(ref).pipe(
            catchError(() => throwError(() => error)),
            switchMap(() => readOnly()),
          );
        return throwError(() => error);
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

const isPublicGithubRead = (ref: IProjectRef, error: unknown): boolean =>
  ['github', 'github.com'].includes(ref.storeId) &&
  ref.projectApi !== 'cloud' &&
  ref.spaceID === undefined &&
  isHostedReadRefused(error);

/**
 * A local agent that says it cannot serve `environment-state/1` (426), or
 * predates the contract: its router answers the unmounted route with Go's plain
 * text `404 page not found`. An agent that implements the route and answers a
 * structured 404 is still surfaced as an error. (A browser sees that plain 404
 * as status 0, because it has no CORS headers: `view()` confirms those against
 * the agent's own agent-info first.)
 */
const isPreContractAgent = (error: unknown): boolean => {
  const failure = error as { status?: number; error?: unknown } | null;
  return (
    failure?.status === 426 ||
    (failure?.status === 404 && typeof failure.error === 'string')
  );
};
