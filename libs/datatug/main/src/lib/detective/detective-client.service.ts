import {
  HttpClient,
  HttpErrorResponse,
  HttpParams,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { buildAgentUrl } from '../services/repo/agent-url';
import {
  DetectiveActionRequest,
  DetectiveActionResponse,
  DetectiveState,
} from './models';

export interface DetectiveRequestContext {
  readonly agentStoreId: string;
  readonly project: string;
  readonly securityContextId: string;
}

export function detectiveErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    switch (error.status) {
      case 0:
        return 'Could not reach this project agent. Check that it is running and reload.';
      case 403:
        return 'This security context cannot access the Detective project store.';
      case 404:
      case 501:
        return 'This agent does not provide Detective yet. Update the local agent and reload.';
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
    : 'The Detective agent request failed.';
}

/** All Detective writes cross the same authenticated local-agent boundary as its reads. */
@Injectable({ providedIn: 'root' })
export class DetectiveClientService {
  private readonly http = inject(HttpClient);

  state(
    context: DetectiveRequestContext,
    runsBefore?: string,
  ): Observable<DetectiveState> {
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
  ): Observable<DetectiveActionResponse> {
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
}
