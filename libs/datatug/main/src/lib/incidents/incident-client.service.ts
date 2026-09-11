import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { buildAgentUrl } from '../services/repo/agent-url';
import {
  CreateIncidentRequest,
  IncidentApiResult,
  IncidentDetail,
  IncidentSummary,
} from './models';

/**
 * Typed client for the incident endpoints under `/datatug/incidents/*` (hub
 * `incidents` REQ:api-and-cli; CLI `cli/incident` REQ:same-server-same-policy —
 * "Every verb MUST execute through the same trusted server boundary `datatug
 * serve` exposes"). Every call goes through the store's own agent
 * (`buildAgentUrl`, the same helper `AgentService`/`SemanticApiService` use for
 * every other DataTug-server call — REQ:same-server-same-policy, "no verb
 * introduces a second project-selection mechanism"): there is no local-only
 * write and no client-side cache standing in for the server.
 *
 * The server does not implement these routes yet (Task 9 scaffold slice).
 * Every method therefore never throws or rejects on a not-found/unimplemented
 * response — it resolves to an {@link IncidentApiResult}, so a page can render
 * an explicit "the incident store is not available on this server yet" state
 * instead of a crash or, worse, silently falling back to mock data.
 */
@Injectable({ providedIn: 'root' })
export class IncidentClientService {
  private readonly http = inject(HttpClient);

  list(
    storeId: string,
    filters?: { readonly status?: readonly string[] },
  ): Observable<IncidentApiResult<IncidentSummary[]>> {
    let params = new HttpParams();
    for (const status of filters?.status ?? []) {
      params = params.append('status', status);
    }
    return this.http
      .get<IncidentSummary[]>(buildAgentUrl(storeId, '/incidents'), { params })
      .pipe(
        map((data): IncidentApiResult<IncidentSummary[]> => ({
          kind: 'ok',
          data: data ?? [],
        })),
        catchError((err: unknown) => of(toIncidentApiResult<IncidentSummary[]>(err))),
      );
  }

  get(
    storeId: string,
    incidentId: string,
    at?: string,
  ): Observable<IncidentApiResult<IncidentDetail>> {
    const params = at ? new HttpParams().append('at', at) : undefined;
    return this.http
      .get<IncidentDetail>(
        buildAgentUrl(storeId, `/incidents/${encodeURIComponent(incidentId)}`),
        params ? { params } : {},
      )
      .pipe(
        map((data): IncidentApiResult<IncidentDetail> => ({ kind: 'ok', data })),
        catchError((err: unknown) => of(toIncidentApiResult<IncidentDetail>(err))),
      );
  }

  create(
    storeId: string,
    request: CreateIncidentRequest,
  ): Observable<IncidentApiResult<IncidentDetail>> {
    return this.http
      .post<IncidentDetail>(buildAgentUrl(storeId, '/incidents'), request)
      .pipe(
        map((data): IncidentApiResult<IncidentDetail> => ({ kind: 'ok', data })),
        catchError((err: unknown) => of(toIncidentApiResult<IncidentDetail>(err))),
      );
  }
}

/**
 * Normalizes any HTTP failure into an {@link IncidentApiResult}. `404` (the
 * route simply isn't registered on a server this old — today's actual live
 * behavior) and `501` (an explicit "not implemented") both mean the incident
 * store isn't available yet; every other failure (network error, `5xx`,
 * malformed response) is reported as a plain error, still explicit, never
 * silently swallowed.
 */
function toIncidentApiResult<T>(err: unknown): IncidentApiResult<T> {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 404 || err.status === 501) {
      return {
        kind: 'unavailable',
        message: 'The incident store is not available on this server yet.',
      };
    }
    if (err.status === 0) {
      return {
        kind: 'error',
        message: 'Could not reach the DataTug server.',
      };
    }
    const serverMessage =
      err.error && typeof err.error === 'object' && 'error' in err.error
        ? (err.error as { error?: { message?: string } }).error?.message
        : undefined;
    return {
      kind: 'error',
      message: serverMessage || err.message || `Request failed (${err.status}).`,
    };
  }
  return {
    kind: 'error',
    message: err instanceof Error ? err.message : 'Request failed.',
  };
}
