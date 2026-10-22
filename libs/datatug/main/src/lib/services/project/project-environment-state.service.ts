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
import { isHostedReadRefused } from './hosted-read-refused';

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
          // no verified state, so management stays unavailable.
          return legacy().pipe(map((items) => ({ items })));
        const local =
          !['github', 'github.com', 'firestore'].includes(ref.storeId) &&
          ref.projectApi !== 'cloud' &&
          ref.spaceID === undefined;
        if (!local || !isPreContractAgent(error))
          return throwError(() => error);
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

const isPublicGithubRead = (ref: IProjectRef, error: unknown): boolean =>
  ['github', 'github.com'].includes(ref.storeId) &&
  ref.projectApi !== 'cloud' &&
  ref.spaceID === undefined &&
  isHostedReadRefused(error);

/**
 * A local agent that cannot serve `environment-state/1`: either it says so
 * (426), or it predates the contract and its router has no such route at all.
 * Released `datatug serve` agents answer the unmounted route with Go's plain
 * text `404 page not found` and no CORS headers, so a browser sees it as an
 * opaque failure (status 0) and only a same-origin caller sees the 404. An
 * agent that implements the route and answers a structured 404 is still
 * surfaced as an error, and so is an unreachable agent: the legacy read that
 * follows fails too.
 */
const isPreContractAgent = (error: unknown): boolean => {
  const failure = error as { status?: number; error?: unknown } | null;
  return (
    failure?.status === 426 ||
    failure?.status === 0 ||
    (failure?.status === 404 && typeof failure.error === 'string')
  );
};
