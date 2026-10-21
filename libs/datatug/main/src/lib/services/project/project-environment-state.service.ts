import { inject, Injectable } from '@angular/core';
import { defer, map, Observable } from 'rxjs';
import { IProjectRef } from '../../core/project-context';
import {
  EnvironmentState,
  EnvironmentMutation,
  EnvironmentOperationResult,
  CreateEnvironmentRequest,
  SaveEnvironmentOrderRequest,
} from '../../models/definition/environment-state';
import { resolveEnvironmentOrder } from '../../models/definition/environment-order';
import { ProjectQueryApiService } from './project-query-api.service';

@Injectable({ providedIn: 'root' })
export class ProjectEnvironmentStateService {
  private readonly api = inject(ProjectQueryApiService);
  read(ref: IProjectRef): Observable<EnvironmentState> {
    return this.api.environmentState<EnvironmentState>(ref).pipe(
      map((state) => {
        const scope = state?.scope;
        if (
          state?.contract !== 'environment-state/1' ||
          !scope ||
          scope.storeId !== ref.storeId ||
          scope.projectId !== ref.projectId ||
          scope.branch !== ref.branch ||
          scope.spaceID !== ref.spaceID ||
          scope.projectApi !== ref.projectApi ||
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
