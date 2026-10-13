import {
  HttpClient,
  HttpErrorResponse,
  HttpParams,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { SneatApiService } from '@sneat/api';
import { Observable, throwError } from 'rxjs';
import { tap } from 'rxjs/operators';
import { buildAgentUrl } from '../services/repo/agent-url';
import {
  DetectiveActionRequest,
  DetectiveActionResponse,
  DetectiveState,
} from './models';

export type DetectiveRequestContext =
  | {
      readonly kind: 'agent';
      readonly agentStoreId: string;
      readonly project: string;
      readonly securityContextId: string;
    }
  | {
      readonly kind: 'cloud';
      readonly storage: 'firestore';
      readonly spaceID: string;
      readonly project: string;
    };

export function detectiveErrorMessage(error: unknown, cloud = false): string {
  if (error instanceof HttpErrorResponse) {
    switch (error.status) {
      case 0:
        return cloud
          ? 'Could not reach DataTug cloud. Check your connection and retry.'
          : 'Could not reach this project agent. Check that it is running and reload.';
      case 401:
        return 'Sign in to access this Detective project.';
      case 403:
        return cloud
          ? 'This account cannot access the Detective project in its Space.'
          : 'This security context cannot access the Detective project store.';
      case 404:
      case 501:
        return cloud
          ? 'Hosted Detective is unavailable for this project.'
          : 'This agent does not provide Detective yet. Update the local agent and reload.';
      case 409:
        return 'This definition changed since it was opened. Reload and review the latest version before saving.';
      default:
        return typeof error.error?.error?.message === 'string'
          ? error.error.error.message
          : typeof error.error?.message === 'string'
            ? error.error.message
            : error.message;
    }
  }
  return error instanceof Error
    ? error.message
    : cloud
      ? 'The Detective cloud request failed.'
      : 'The Detective agent request failed.';
}

export interface CaseEventsPage {
  caseId: string;
  events: import('./models').CaseEvent[];
  nextBefore?: number;
  hasMore: boolean;
}

/** Mutations use the selected server boundary; the browser never writes project records directly. */
@Injectable({ providedIn: 'root' })
export class DetectiveClientService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(SneatApiService);
  private readonly pendingOperations = new Map<string, string>();

  private cloudParams(
    context: Extract<DetectiveRequestContext, { kind: 'cloud' }>,
  ): HttpParams {
    return new HttpParams()
      .set('storage', context.storage)
      .set('spaceID', context.spaceID)
      .set('project', context.project);
  }

  state(
    context: DetectiveRequestContext,
    runsBefore?: string,
  ): Observable<DetectiveState> {
    if (context.kind === 'cloud') {
      return this.api.get<DetectiveState>(
        'datatug/detective/state',
        runsBefore
          ? this.cloudParams(context).set('runsBefore', runsBefore)
          : this.cloudParams(context),
      );
    }
    return this.http.get<DetectiveState>(
      buildAgentUrl(context.agentStoreId, '/detective/state'),
      {
        params: new HttpParams()
          .set('project', context.project)
          .set('securityContextId', context.securityContextId)
          .set('runsBefore', runsBefore || ''),
      },
    );
  }

  action(
    context: DetectiveRequestContext,
    action: Omit<DetectiveActionRequest, 'project' | 'securityContextId'>,
    ifMatch?: number,
  ): Observable<DetectiveActionResponse> {
    if (context.kind === 'cloud') {
      const resourceVersion =
        action.check?.version ??
        action.validator?.version ??
        action.queryValidators?.version ??
        action.scenario?.version ??
        action.case?.version;
      const expectedVersion = ifMatch ?? resourceVersion;
      const payload = {
        storage: context.storage,
        spaceID: context.spaceID,
        project: context.project,
        ...action,
        ...(expectedVersion === undefined ? {} : { ifMatch: expectedVersion }),
      };
      const key = JSON.stringify(payload);
      const operationId =
        this.pendingOperations.get(key) ?? crypto.randomUUID();
      this.pendingOperations.set(key, operationId);
      return this.api
        .post<DetectiveActionResponse>('datatug/detective/action', {
          ...payload,
          operationId,
        })
        .pipe(tap({ next: () => this.pendingOperations.delete(key) }));
    }
    return this.http.post<DetectiveActionResponse>(
      buildAgentUrl(context.agentStoreId, '/detective/action'),
      {
        ...action,
        project: context.project,
        securityContextId: context.securityContextId,
      },
      { params: new HttpParams().set('project', context.project) },
    );
  }

  caseEvents(
    context: DetectiveRequestContext,
    caseId: string,
    before?: number,
  ): Observable<CaseEventsPage> {
    if (context.kind === 'cloud') {
      return this.api.get<CaseEventsPage>(
        'datatug/detective/case_events',
        this.cloudParams(context)
          .set('caseId', caseId)
          .set('before', before === undefined ? '' : String(before)),
      );
    }
    return this.http.get<CaseEventsPage>(
      buildAgentUrl(context.agentStoreId, '/detective/case-events'),
      {
        params: new HttpParams()
          .set('project', context.project)
          .set('securityContextId', context.securityContextId)
          .set('caseId', caseId)
          .set('before', before === undefined ? '' : String(before)),
      },
    );
  }

  demoProject(
    spaceID: string | undefined,
    operationId: string,
  ): Observable<{ storeId: 'firestore'; spaceID: string; projectId: string }> {
    if (spaceID && !/^[A-Za-z0-9_-]{1,128}$/.test(spaceID))
      return throwError(() => new Error('Invalid Personal Space reference.'));
    return this.api.post<{
      storeId: 'firestore';
      spaceID: string;
      projectId: string;
    }>('datatug/detective/demo_project', {
      ...(spaceID ? { spaceID } : {}),
      operationId,
    });
  }
}
