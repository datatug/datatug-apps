import {
  HttpClient,
  HttpErrorResponse,
  HttpParams,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { buildAgentUrl } from '../services/repo/agent-url';
import {
  CreateIncidentRequest,
  INCIDENT_OUTCOMES,
  INCIDENT_STATUSES,
  IncidentApiResult,
  IncidentDetail,
  IncidentListResponse,
  IncidentResponse,
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
      .get<IncidentListResponse>(buildAgentUrl(storeId, '/incidents'), {
        params,
      })
      .pipe(
        map((response): IncidentApiResult<IncidentSummary[]> => {
          if (!response || !Array.isArray(response.incidents)) {
            throw new Error('Invalid incident list response.');
          }
          return { kind: 'ok', data: response.incidents.map(decodeIncident) };
        }),
        catchError((err: unknown) =>
          of(toIncidentApiResult<IncidentSummary[]>(err)),
        ),
      );
  }

  get(
    storeId: string,
    incidentId: string,
    at?: string,
  ): Observable<IncidentApiResult<IncidentDetail>> {
    const params = at ? new HttpParams().append('at', at) : undefined;
    return this.http
      .get<IncidentResponse>(
        buildAgentUrl(storeId, `/incidents/${encodeURIComponent(incidentId)}`),
        params ? { params } : {},
      )
      .pipe(
        map(
          (response): IncidentApiResult<IncidentDetail> => ({
            kind: 'ok',
            data: requireIncident(response),
          }),
        ),
        catchError((err: unknown) =>
          of(toIncidentApiResult<IncidentDetail>(err)),
        ),
      );
  }

  create(
    request: CreateIncidentRequest,
  ): Observable<IncidentApiResult<IncidentDetail>> {
    return this.http
      .post<IncidentResponse>(
        buildAgentUrl(request.storeId, '/incidents'),
        request,
      )
      .pipe(
        map(
          (response): IncidentApiResult<IncidentDetail> => ({
            kind: 'ok',
            data: requireIncident(response),
          }),
        ),
        catchError((err: unknown) =>
          of(toIncidentApiResult<IncidentDetail>(err)),
        ),
      );
  }
}

function requireIncident(
  response: IncidentResponse | undefined,
): IncidentDetail {
  if (!response?.incident) {
    throw new Error('Invalid incident response.');
  }
  return decodeIncident(response.incident);
}

function decodeIncident(value: unknown): IncidentDetail {
  if (!isRecord(value)) {
    throw new Error('Invalid incident response.');
  }
  const incident = value;
  const ref = incident['ref'];
  if (
    !isIncidentRef(ref) ||
    typeof incident['uid'] !== 'string' ||
    !incident['uid'].trim() ||
    typeof incident['title'] !== 'string' ||
    !incident['title'].trim() ||
    typeof incident['status'] !== 'string' ||
    !INCIDENT_STATUSES.includes(
      incident['status'] as (typeof INCIDENT_STATUSES)[number],
    ) ||
    typeof incident['lastSeq'] !== 'number' ||
    !Number.isSafeInteger(incident['lastSeq']) ||
    incident['lastSeq'] <= 0 ||
    !optionalString(incident['description']) ||
    !optionalOutcome(incident['outcome']) ||
    !optionalIncidentRef(incident['mergedInto']) ||
    !optionalProjectRefs(incident['projects']) ||
    !optionalStringArray(incident['notes'])
  ) {
    throw new Error('Invalid incident response.');
  }
  return value as unknown as IncidentDetail;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isValidSegment(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !/\p{Cc}/u.test(value)
  );
}

function isIncidentRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    isValidSegment(value['storeId']) &&
    isValidSegment(value['incidentId'])
  );
}

function optionalIncidentRef(value: unknown): boolean {
  return value === undefined || isIncidentRef(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalOutcome(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      INCIDENT_OUTCOMES.includes(value as (typeof INCIDENT_OUTCOMES)[number]))
  );
}

function optionalProjectRefs(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => isProjectRef(item)))
  );
}

function isProjectRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    isValidSegment(value['storeId']) &&
    isValidSegment(value['projectId']) &&
    optionalString(value['environment'])
  );
}

function optionalStringArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
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
      message:
        serverMessage || err.message || `Request failed (${err.status}).`,
    };
  }
  return {
    kind: 'error',
    message: err instanceof Error ? err.message : 'Request failed.',
  };
}
