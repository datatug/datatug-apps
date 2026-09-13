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
  AppendIncidentEventRequest,
  AppendIncidentEventResponse,
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

  append(
    context: IncidentRequestContext,
    incidentId: string,
    request: AppendIncidentEventRequest,
  ): Observable<IncidentApiResult<AppendIncidentEventResponse>> {
    return this.http
      .post(
        buildAgentUrl(
          context.agentStoreId,
          `/incidents/${encodeURIComponent(incidentId)}/events`,
        ),
        request,
      )
      .pipe(
        map(
          (response): IncidentApiResult<AppendIncidentEventResponse> => ({
            kind: 'ok',
            data: decodeAppendIncidentEventResponse(response),
          }),
        ),
        catchError((err: unknown) =>
          of(toIncidentApiResult<AppendIncidentEventResponse>(err)),
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
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['cursor', 'event']) ||
    !isEventCursor(value['cursor'])
  ) {
    throw new Error('Invalid incident events response.');
  }
  const event = decodeIncidentEvent(value['event']);
  return { cursor: value['cursor'], event };
}

function decodeIncidentEvent(value: unknown): IncidentStreamItem['event'] {
  const event = value;
  if (
    !isRecord(event) ||
    !hasOnlyKeys(event, [
      'id',
      'seq',
      'at',
      'visibleAt',
      'incident',
      'importedFrom',
      'actor',
      'type',
      'assertion',
      'refs',
      'payload',
    ]) ||
    !isNonEmptyString(event['id']) ||
    typeof event['seq'] !== 'number' ||
    !Number.isSafeInteger(event['seq']) ||
    event['seq'] <= 0 ||
    !isRfc3339(event['at']) ||
    !isRfc3339(event['visibleAt']) ||
    !isIncidentRef(event['incident']) ||
    !optionalImportedEventRef(event['importedFrom'], event) ||
    !isActor(event['actor']) ||
    !isIncidentEventType(event['type']) ||
    !isAssertion(event['assertion']) ||
    !optionalArtifactRefs(event['refs']) ||
    !isEventAssertionProvenanceValid(event) ||
    !isIncidentEventPayload(event['type'], event['payload'], event['incident'])
  ) {
    throw new Error('Invalid incident events response.');
  }
  return event as unknown as IncidentStreamItem['event'];
}

function decodeAppendIncidentEventResponse(
  value: unknown,
): AppendIncidentEventResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['event', 'projection', 'replayed']) ||
    typeof value['replayed'] !== 'boolean'
  ) {
    throw new Error('Invalid incident append response.');
  }
  return {
    event: decodeIncidentEvent(value['event']),
    projection: decodeIncident(value['projection']),
    replayed: value['replayed'],
  };
}

function optionalImportedEventRef(
  value: unknown,
  event: Record<string, unknown>,
): boolean {
  if (value === undefined) {
    return true;
  }
  if (
    event['seq'] === 1 ||
    !isRecord(value) ||
    !hasOnlyKeys(value, ['incident', 'eventId', 'seq', 'mergeId']) ||
    !isIncidentRef(value['incident']) ||
    !isNonEmptyString(value['eventId']) ||
    typeof value['seq'] !== 'number' ||
    !Number.isSafeInteger(value['seq']) ||
    value['seq'] <= 0 ||
    !isValidSegment(value['mergeId']) ||
    !isRecord(event['incident']) ||
    !isRecord(value['incident'])
  ) {
    return false;
  }
  return (
    value['incident']['storeId'] === event['incident']['storeId'] &&
    !sameIncidentRef(value['incident'], event['incident'])
  );
}

function isEventAssertionProvenanceValid(
  event: Record<string, unknown>,
): boolean {
  const assertion = event['assertion'];
  const actor = event['actor'];
  const refs = Array.isArray(event['refs']) ? event['refs'] : [];
  if (!isRecord(assertion) || !isRecord(actor)) {
    return false;
  }
  if (
    assertion['kind'] === 'inference' &&
    !refs.some(
      (ref) => isRecord(ref) && ref['kind'] === 'event' && isArtifactRef(ref),
    )
  ) {
    return false;
  }
  if (
    actor['kind'] === 'agent' &&
    (assertion['kind'] === 'observation' ||
      assertion['kind'] === 'deterministic-result') &&
    !refs.some(
      (ref) =>
        isRecord(ref) &&
        (ref['kind'] === 'execution' ||
          ref['kind'] === 'check' ||
          ref['kind'] === 'compare') &&
        isArtifactRef(ref),
    )
  ) {
    return false;
  }
  return true;
}

function isIncidentEventPayload(
  type: unknown,
  payload: unknown,
  incident: unknown,
): boolean {
  if (!isRecord(payload)) {
    return false;
  }
  switch (type) {
    case 'incident.created':
      return (
        hasOnlyKeys(payload, [
          'uid',
          'title',
          'description',
          'projects',
          'reporter',
          'canonicalContext',
        ]) &&
        isNonEmptyString(payload['uid']) &&
        isNonEmptyString(payload['title']) &&
        typeof payload['description'] === 'string' &&
        optionalProjectRefs(payload['projects']) &&
        isCreatedReporter(payload['reporter']) &&
        isContextView(payload['canonicalContext'])
      );
    case 'incident.status':
      return (
        hasOnlyKeys(payload, ['status']) &&
        typeof payload['status'] === 'string' &&
        INCIDENT_STATUSES.includes(
          payload['status'] as (typeof INCIDENT_STATUSES)[number],
        )
      );
    case 'incident.outcome':
      return (
        hasOnlyKeys(payload, ['outcome']) &&
        typeof payload['outcome'] === 'string' &&
        INCIDENT_OUTCOMES.includes(
          payload['outcome'] as (typeof INCIDENT_OUTCOMES)[number],
        )
      );
    case 'incident.merged':
      return (
        hasOnlyKeys(payload, ['into', 'mergeId']) &&
        isIncidentRef(payload['into']) &&
        !sameIncidentRef(payload['into'], incident) &&
        isValidSegment(payload['mergeId'])
      );
    case 'note.added':
      return (
        hasOnlyKeys(payload, ['body']) && isNonEmptyString(payload['body'])
      );
    case 'context.fact.added':
      return (
        hasOnlyKeys(payload, ['fact']) &&
        isIncidentFactView(payload['fact']) &&
        isRecord(payload['fact']) &&
        isProjectScope(payload['fact']['scope'], true)
      );
    case 'context.fact.promoted':
      return (
        hasOnlyKeys(payload, ['fact', 'role']) &&
        isContextFactRef(payload['fact']) &&
        optionalFactRole(payload['role']) &&
        payload['role'] !== undefined
      );
    case 'context.fact.rejected':
      return (
        hasOnlyKeys(payload, ['layer']) &&
        optionalFactLayer(payload['layer']) &&
        payload['layer'] !== undefined &&
        payload['layer'] !== 'canonical'
      );
    default:
      return false;
  }
}

function isCreatedReporter(value: unknown): boolean {
  if (isActor(value)) {
    return true;
  }
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['kind', 'id', 'via']) &&
    value['id'] === '' &&
    value['kind'] === '' &&
    value['via'] === undefined
  );
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
    !hasOnlyKeys(incident, [
      'ref',
      'uid',
      'title',
      'description',
      'status',
      'outcome',
      'mergedInto',
      'projects',
      'participants',
      'canonicalContext',
      'contextPromotions',
      'contextRejections',
      'assetRefs',
      'notes',
      'lastSeq',
    ]) ||
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
    (incident['mergedInto'] !== undefined &&
      sameIncidentRef(ref, incident['mergedInto'])) ||
    !optionalProjectRefs(incident['projects']) ||
    !optionalParticipants(incident['participants']) ||
    !isContextView(incident['canonicalContext']) ||
    !optionalContextPromotions(incident['contextPromotions']) ||
    !optionalContextRejections(incident['contextRejections']) ||
    !hasValidContextDecisionHistory(incident) ||
    !optionalArtifactRefs(incident['assetRefs']) ||
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
    hasOnlyKeys(value, ['storeId', 'incidentId']) &&
    isValidSegment(value['storeId']) &&
    isValidSegment(value['incidentId'])
  );
}

function sameIncidentRef(left: unknown, right: unknown): boolean {
  return (
    isRecord(left) &&
    isRecord(right) &&
    left['storeId'] === right['storeId'] &&
    left['incidentId'] === right['incidentId']
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
    hasOnlyKeys(value, ['storeId', 'projectId', 'environment']) &&
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
    hasOnlyKeys(value, ['kind', 'id', 'via']) &&
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
    hasOnlyKeys(value, ['kind', 'confidence']) &&
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
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['facts']) ||
    !Array.isArray(value['facts'])
  ) {
    return false;
  }
  const seen = new Set<string>();
  for (const fact of value['facts']) {
    if (!isIncidentFactView(fact)) {
      return false;
    }
    const scope = fact['scope'];
    const scopeKey = isRecord(scope)
      ? JSON.stringify([
          scope['storeId'],
          scope['projectId'],
          scope['environment'] ?? '',
        ])
      : '';
    const key = JSON.stringify([
      scopeKey,
      fact['id'],
      fact['layer'] || 'canonical',
    ]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
  }
  return true;
}

function isIncidentFactView(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'id',
      'entity',
      'field',
      'value',
      'condition',
      'origin',
      'physical',
      'mapping',
      'enabled',
      'role',
      'layer',
      'scope',
    ]) ||
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
      hasOnlyKeys(value, ['source', 'collection', 'column']) &&
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
      return !!id && id.trim() === id && !/\p{Cc}/u.test(id);
    }
  }
  return false;
}

function optionalProjectScope(value: unknown): boolean {
  return value === undefined || isProjectScope(value, false);
}

function isProjectScope(value: unknown, requireEnvironment: boolean): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['storeId', 'projectId', 'environment']) &&
    isValidSegment(value['storeId']) &&
    isValidSegment(value['projectId']) &&
    (requireEnvironment
      ? isValidSegment(value['environment'])
      : value['environment'] === undefined ||
        isValidSegment(value['environment']))
  );
}

function isContextFactRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['scope', 'id', 'layer']) &&
    isProjectScope(value['scope'], true) &&
    isNonEmptyString(value['id']) &&
    optionalFactLayer(value['layer']) &&
    value['layer'] !== undefined &&
    value['layer'] !== 'canonical'
  );
}

function optionalContextPromotions(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (item) =>
          isRecord(item) &&
          hasOnlyKeys(item, ['eventId', 'fact', 'role']) &&
          isValidSegment(item['eventId']) &&
          isContextFactRef(item['fact']) &&
          optionalFactRole(item['role']) &&
          item['role'] !== undefined,
      ))
  );
}

function optionalContextRejections(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (item) =>
          isRecord(item) &&
          hasOnlyKeys(item, ['eventId', 'layer']) &&
          isValidSegment(item['eventId']) &&
          optionalFactLayer(item['layer']) &&
          item['layer'] !== undefined &&
          item['layer'] !== 'canonical',
      ))
  );
}

function hasValidContextDecisionHistory(
  incident: Record<string, unknown>,
): boolean {
  const promotions = (incident['contextPromotions'] ?? []) as Array<
    Record<string, unknown>
  >;
  const rejections = (incident['contextRejections'] ?? []) as Array<
    Record<string, unknown>
  >;
  const promotionKeys = new Set<string>();
  const promotedLayers = new Set<string>();
  for (const promotion of promotions) {
    const fact = promotion['fact'] as Record<string, unknown>;
    const scope = fact['scope'] as Record<string, unknown>;
    const layer = fact['layer'] as string;
    const key = JSON.stringify([
      scope['storeId'],
      scope['projectId'],
      scope['environment'] ?? '',
      fact['id'],
      layer,
    ]);
    if (promotionKeys.has(key)) {
      return false;
    }
    promotionKeys.add(key);
    promotedLayers.add(layer);
  }
  const rejectedLayers = new Set<string>();
  for (const rejection of rejections) {
    const layer = rejection['layer'] as string;
    if (rejectedLayers.has(layer) || promotedLayers.has(layer)) {
      return false;
    }
    rejectedLayers.add(layer);
  }
  return true;
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
    value === 'note.added' ||
    value === 'context.fact.added' ||
    value === 'context.fact.promoted' ||
    value === 'context.fact.rejected'
  );
}

function optionalArtifactRefs(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => isArtifactRef(item)))
  );
}

function isArtifactRef(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'kind',
      'id',
      'incident',
      'project',
      'execution',
      'artifact',
      'comparison',
    ])
  ) {
    return false;
  }
  const identities = [
    value['id'] !== undefined && value['id'] !== '',
    value['incident'] !== undefined,
    value['project'] !== undefined,
    value['execution'] !== undefined,
    value['artifact'] !== undefined,
    value['comparison'] !== undefined,
  ].filter(Boolean).length;
  if (identities !== 1) {
    return false;
  }
  switch (value['kind']) {
    case 'incident':
      return isIncidentRef(value['incident']);
    case 'project':
      return isProjectRef(value['project']);
    case 'execution':
    case 'snapshot':
      return isExecutionRef(value['execution']);
    case 'event':
    case 'hypothesis':
      return typeof value['id'] === 'string' && value['id'].length > 0;
    case 'fact':
    case 'annotation':
    case 'check':
    case 'query':
    case 'board':
      return isProjectArtifactRef(value['artifact']);
    case 'compare':
      return isComparisonRef(value['comparison']);
    default:
      return false;
  }
}

function isExecutionRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['storeId', 'projectId', 'executionId']) &&
    isValidSegment(value['storeId']) &&
    isValidSegment(value['projectId']) &&
    isValidSegment(value['executionId'])
  );
}

function isProjectArtifactRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['storeId', 'projectId', 'environment', 'id']) &&
    isValidSegment(value['storeId']) &&
    isValidSegment(value['projectId']) &&
    optionalString(value['environment']) &&
    isValidSegment(value['id'])
  );
}

function isComparisonRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['left', 'right']) &&
    isExecutionRef(value['left']) &&
    isExecutionRef(value['right'])
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
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
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!isStrictErrorEnvelope(parsed)) {
        return undefined;
      }
      return readServerError(parsed);
    } catch {
      return undefined;
    }
  }
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

function isStrictErrorEnvelope(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['error']) ||
    !isRecord(value['error'])
  ) {
    return false;
  }
  const error = value['error'];
  const code = error['code'];
  const targets = error['targets'];
  return (
    hasOnlyKeys(error, ['code', 'message', 'field', 'requestId', 'targets']) &&
    isIncidentErrorCode(code) &&
    isNonEmptyString(error['message']) &&
    isNonEmptyString(error['requestId']) &&
    (error['field'] === undefined || typeof error['field'] === 'string') &&
    (targets === undefined ||
      (code === 'TARGET_REQUIRED' &&
        Array.isArray(targets) &&
        targets.length > 0 &&
        targets.every(
          (target) =>
            isRecord(target) &&
            hasOnlyKeys(target, ['source', 'label']) &&
            isNonEmptyString(target['source']) &&
            isNonEmptyString(target['label']),
        )))
  );
}

function isIncidentErrorCode(value: unknown): value is string {
  return (
    value === 'INVALID_REQUEST' ||
    value === 'TYPE_MISMATCH' ||
    value === 'MISSING_PARAMETER' ||
    value === 'AMBIGUOUS_BINDING' ||
    value === 'TARGET_REQUIRED' ||
    value === 'UNAUTHENTICATED' ||
    value === 'ACCESS_DENIED' ||
    value === 'UNSUPPORTED_PROTECTED_EXECUTION' ||
    value === 'NOT_FOUND' ||
    value === 'STALE_CONTEXT' ||
    value === 'REVISION_CONFLICT' ||
    value === 'RESPONSE_TOO_LARGE' ||
    value === 'SOURCE_UNAVAILABLE' ||
    value === 'TIMEOUT'
  );
}
