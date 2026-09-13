import {
  HttpClient,
  HttpErrorResponse,
  HttpParams,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { decodeTypedValue } from '@sneat/datatug-semantic';
import { Observable, catchError, map, of } from 'rxjs';
import { buildAgentUrl } from '../services/repo/agent-url';
import {
  CreateIncidentRequest,
  INCIDENT_OUTCOMES,
  INCIDENT_STATUSES,
  IncidentApiResult,
  IncidentDetail,
  IncidentListFilters,
  IncidentListResponse,
  IncidentRequestContext,
  IncidentResponse,
  IncidentScope,
  IncidentStreamItem,
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
 * Every method resolves HTTP failures to an {@link IncidentApiResult}, so a
 * page can render the server's real error. In particular, clients retain an
 * explicit "the incident store is not available on this server yet" state for
 * older DataTug servers that predate these routes, instead of crashing or
 * silently falling back to mock data.
 */
@Injectable({ providedIn: 'root' })
export class IncidentClientService {
  private readonly http = inject(HttpClient);

  list(
    context: IncidentRequestContext,
    filters?: IncidentListFilters,
  ): Observable<IncidentApiResult<IncidentSummary[]>> {
    let params = incidentScopeParams(context.scope);
    for (const status of filters?.status ?? []) {
      params = params.append('status', status);
    }
    for (const key of ['query', 'check', 'board'] as const) {
      const value = filters?.[key];
      if (value) {
        params = params.set(key, value);
      }
    }
    return this.http
      .get<IncidentListResponse>(
        buildAgentUrl(context.agentStoreId, '/incidents'),
        { params },
      )
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
    context: IncidentRequestContext,
    incidentId: string,
    at?: string,
  ): Observable<IncidentApiResult<IncidentDetail>> {
    let params = incidentScopeParams(context.scope);
    if (at) {
      params = params.set('at', at);
    }
    return this.http
      .get<IncidentResponse>(
        buildAgentUrl(
          context.agentStoreId,
          `/incidents/${encodeURIComponent(incidentId)}`,
        ),
        { params },
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
    agentStoreId: string,
    request: CreateIncidentRequest,
  ): Observable<IncidentApiResult<IncidentDetail>> {
    return this.http
      .post<IncidentResponse>(
        buildAgentUrl(agentStoreId, '/incidents'),
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

  events(
    context: IncidentRequestContext,
    incidentId: string,
  ): Observable<IncidentApiResult<IncidentStreamItem[]>> {
    const params = incidentScopeParams(context.scope).set('follow', 'false');
    return this.http
      .get(
        buildAgentUrl(
          context.agentStoreId,
          `/incidents/${encodeURIComponent(incidentId)}/events`,
        ),
        { params, responseType: 'text' },
      )
      .pipe(
        map(
          (response): IncidentApiResult<IncidentStreamItem[]> => ({
            kind: 'ok',
            data: decodeIncidentStream(response),
          }),
        ),
        catchError((err: unknown) =>
          of(toIncidentApiResult<IncidentStreamItem[]>(err)),
        ),
      );
  }
}

function incidentScopeParams(scope: IncidentScope): HttpParams {
  return new HttpParams()
    .set('storeId', scope.storeId)
    .set('project', scope.project)
    .set('environment', scope.environment)
    .set('securityContextId', scope.securityContextId);
}

function decodeIncidentStream(response: string): IncidentStreamItem[] {
  if (!response.trim()) {
    return [];
  }
  try {
    return response
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => decodeIncidentStreamItem(JSON.parse(line)));
  } catch {
    throw new Error('Invalid incident events response.');
  }
}

function decodeIncidentStreamItem(value: unknown): IncidentStreamItem {
  if (!isRecord(value) || !isEventCursor(value['cursor'])) {
    throw new Error('Invalid incident events response.');
  }
  const event = value['event'];
  if (
    !isRecord(event) ||
    !isNonEmptyString(event['id']) ||
    typeof event['seq'] !== 'number' ||
    !Number.isSafeInteger(event['seq']) ||
    event['seq'] <= 0 ||
    !isRfc3339(event['at']) ||
    !isRfc3339(event['visibleAt']) ||
    !isIncidentRef(event['incident']) ||
    !isActor(event['actor']) ||
    !isIncidentEventType(event['type']) ||
    !isAssertion(event['assertion']) ||
    !('payload' in event)
  ) {
    throw new Error('Invalid incident events response.');
  }
  return value as unknown as IncidentStreamItem;
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
    !optionalParticipants(incident['participants']) ||
    !isContextView(incident['canonicalContext']) ||
    !optionalStringArray(incident['notes'])
  ) {
    throw new Error('Invalid incident response.');
  }
  return value as unknown as IncidentDetail;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim();
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

function optionalParticipants(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (item) =>
          isRecord(item) &&
          item['role'] === 'reporter' &&
          isActor(item['actor']),
      ))
  );
}

function isActor(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value['kind'] === 'human' ||
      value['kind'] === 'agent' ||
      value['kind'] === 'system') &&
    isNonEmptyString(value['id']) &&
    (value['via'] === undefined ||
      value['via'] === 'web' ||
      value['via'] === 'cli' ||
      value['via'] === 'api' ||
      value['via'] === 'slack')
  );
}

function isAssertion(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value['kind'] === 'observation' ||
      value['kind'] === 'claim' ||
      value['kind'] === 'question' ||
      value['kind'] === 'hypothesis' ||
      value['kind'] === 'inference' ||
      value['kind'] === 'deterministic-result') &&
    (value['confidence'] === undefined ||
      value['confidence'] === 'speculative' ||
      value['confidence'] === 'likely' ||
      value['confidence'] === 'confirmed')
  );
}

function isContextView(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value['facts']) &&
    value['facts'].every((fact) => isIncidentFactView(fact))
  );
}

function isIncidentFactView(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value['id']) ||
    !isNonEmptyString(value['entity']) ||
    (value['origin'] !== 'selection' &&
      value['origin'] !== 'context' &&
      value['origin'] !== 'manual') ||
    typeof value['enabled'] !== 'boolean'
  ) {
    return false;
  }
  const factValue = value['value'];
  const redacted =
    isRecord(factValue) &&
    Object.keys(factValue).length === 1 &&
    factValue['redacted'] === true;
  if (!redacted) {
    try {
      decodeTypedValue(factValue, 'incident.canonicalContext.fact.value');
    } catch {
      return false;
    }
  }
  if (!redacted && !isNonEmptyString(value['field'])) {
    return false;
  }
  if (
    (value['field'] !== undefined && !isNonEmptyString(value['field'])) ||
    !optionalPhysicalRef(value['physical']) ||
    !optionalFactMapping(value['mapping']) ||
    !optionalFactCondition(value['condition']) ||
    !optionalFactRole(value['role']) ||
    !optionalFactLayer(value['layer']) ||
    !optionalProjectScope(value['scope'])
  ) {
    return false;
  }
  // Core deliberately strips physical provenance and mapping from a
  // value-redacted projection. Accepting them here would expose a malformed
  // response as though it had passed the current policy view boundary.
  return (
    !redacted ||
    (value['physical'] === undefined && value['mapping'] === undefined)
  );
}

function optionalPhysicalRef(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      isNonEmptyString(value['source']) &&
      isNonEmptyString(value['collection']) &&
      isNonEmptyString(value['column']))
  );
}

function optionalFactMapping(value: unknown): boolean {
  return value === undefined || value === 'declared' || value === 'inferred';
}

function optionalFactCondition(value: unknown): boolean {
  return (
    value === undefined ||
    value === '==' ||
    value === '!=' ||
    value === '>' ||
    value === '>=' ||
    value === '<' ||
    value === '<='
  );
}

function optionalFactRole(value: unknown): boolean {
  return (
    value === undefined ||
    value === 'affected' ||
    value === 'healthy_control' ||
    value === 'suspected' ||
    value === 'excluded' ||
    value === 'recovered'
  );
}

function optionalFactLayer(value: unknown): boolean {
  if (value === undefined || value === 'canonical') {
    return true;
  }
  if (typeof value !== 'string') {
    return false;
  }
  for (const prefix of ['hypothesis:', 'participant:', 'question:']) {
    if (value.startsWith(prefix)) {
      const id = value.slice(prefix.length);
      return !!id && id.trim() === id;
    }
  }
  return false;
}

function optionalProjectScope(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      isValidSegment(value['storeId']) &&
      isValidSegment(value['projectId']) &&
      (value['environment'] === undefined ||
        isValidSegment(value['environment'])))
  );
}

function isRfc3339(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isEventCursor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 2048 &&
    value.trim() === value &&
    !/[\p{Cc}\s]/u.test(value)
  );
}

function isIncidentEventType(value: unknown): boolean {
  return (
    value === 'incident.created' ||
    value === 'incident.status' ||
    value === 'incident.outcome' ||
    value === 'incident.merged' ||
    value === 'note.added'
  );
}

function optionalStringArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

/**
 * Normalizes any HTTP failure into an {@link IncidentApiResult}. An
 * unstructured route-level `404` or explicit `501` from an older server means
 * the incident surface is unavailable. A current server's structured 404,
 * network errors, `5xx`, and malformed responses remain distinct plain
 * errors, never silently swallowed.
 */
function toIncidentApiResult<T>(err: unknown): IncidentApiResult<T> {
  if (err instanceof HttpErrorResponse) {
    const serverError = readServerError(err.error);
    // Current incident endpoints use the frozen structured NOT_FOUND error
    // for a missing store or incident. A route-level 404 from an older server
    // has no such envelope, which is the only case reported as unavailable.
    if ((err.status === 404 && !serverError?.message) || err.status === 501) {
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
    return {
      kind: 'error',
      message:
        serverError?.message ||
        err.message ||
        `Request failed (${err.status}).`,
      ...(serverError?.code === 'STALE_CONTEXT'
        ? { code: serverError.code }
        : {}),
    };
  }
  return {
    kind: 'error',
    message: err instanceof Error ? err.message : 'Request failed.',
  };
}

function readServerError(
  value: unknown,
): { readonly code?: string; readonly message?: string } | undefined {
  if (!isRecord(value) || !isRecord(value['error'])) {
    return undefined;
  }
  const code = value['error']['code'];
  const message = value['error']['message'];
  return {
    ...(typeof code === 'string' && code.trim() ? { code } : {}),
    ...(typeof message === 'string' && message.trim() ? { message } : {}),
  };
}
