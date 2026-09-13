// Incident models (spec/features/incidents/README.md, datatug/datatug — hub
// Feature; spec/features/cli/incident/README.md, datatug/datatug-cli — CLI/API
// surface this client wraps).
//
// The wire shapes below mirror datatug-core/pkg/apicontract's frozen incident
// fixtures. The browser keeps the serving agent address separate from
// IncidentRef.storeId: the latter routes an incident store inside that agent
// and is not a hostname.

import type { PhysicalRef, TypedValue } from '@sneat/datatug-semantic';

/**
 * A reference to one incident: which incident store it lives in, and its id
 * within that store (hub REQ:incident-references-and-back-links; CLI
 * REQ:agent-friendly-ids fixes the string form as `<storeId>/<incidentId>`).
 */
export interface IncidentRef {
  readonly storeId: string;
  readonly incidentId: string;
}

export interface IncidentProjectRef {
  readonly storeId: string;
  readonly projectId: string;
  readonly environment?: string;
}

/** The Core `apicontract.IncidentScope` carried by every incident request. */
export interface IncidentScope {
  readonly storeId: string;
  readonly project: string;
  readonly environment: string;
  readonly securityContextId: string;
}

/** Browser-only transport context selecting both the agent and its incident store. */
export interface IncidentRequestContext {
  readonly agentStoreId: string;
  readonly scope: IncidentScope;
}

export interface IncidentProjectScope {
  readonly storeId: string;
  readonly projectId: string;
  readonly environment?: string;
}

export interface IncidentCanonicalProjectScope extends IncidentProjectScope {
  readonly environment: string;
}

export type IncidentFactValue = TypedValue | { readonly redacted: true };

export interface IncidentFactView {
  readonly id: string;
  readonly entity: string;
  readonly field?: string;
  readonly value: IncidentFactValue;
  readonly origin: 'selection' | 'context' | 'manual';
  readonly physical?: PhysicalRef;
  readonly mapping?: 'declared' | 'inferred';
  readonly enabled: boolean;
  readonly role?:
    | 'affected'
    | 'healthy_control'
    | 'suspected'
    | 'excluded'
    | 'recovered';
  readonly layer?: string;
  readonly scope?: IncidentProjectScope;
}

/** Canonical, fully scoped fact accepted by `IncidentCreateRequest`. */
export interface IncidentFactInput extends Omit<
  IncidentFactView,
  'value' | 'field' | 'scope'
> {
  readonly field: string;
  readonly value: TypedValue;
  readonly scope: IncidentCanonicalProjectScope;
}

export interface IncidentContextView {
  readonly facts: readonly IncidentFactView[];
}

export interface IncidentContextInput {
  readonly facts: readonly IncidentFactInput[];
}

export interface IncidentActor {
  readonly kind: 'human' | 'agent' | 'system';
  readonly id: string;
  readonly via?: 'web' | 'cli' | 'api' | 'slack';
}

export interface IncidentParticipant {
  readonly actor: IncidentActor;
  readonly role: 'reporter';
}

/** The seven lifecycle statuses (hub REQ:lifecycle-and-outcomes; CLI
 * REQ:status-and-outcome-vocabulary pins this exact list). */
export const INCIDENT_STATUSES = [
  'open',
  'investigating',
  'mitigating',
  'recovering',
  'resolved',
  'watching',
  'closed',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** The five closing outcomes (hub REQ:lifecycle-and-outcomes; CLI
 * REQ:status-and-outcome-vocabulary). `duplicate` is deliberately not a
 * member — merging is a separate verb (`link`/`merge`), not an outcome. */
export const INCIDENT_OUTCOMES = [
  'resolved',
  'false-alarm',
  'accepted',
  'handed-off',
  'unresolved',
] as const;
export type IncidentOutcome = (typeof INCIDENT_OUTCOMES)[number];

/** One row of `GET /datatug/incidents` (hub REQ:api-and-cli). */
export interface IncidentSummary {
  readonly ref: IncidentRef;
  readonly uid: string;
  readonly title: string;
  readonly status: IncidentStatus;
  readonly description?: string;
  readonly outcome?: IncidentOutcome;
  readonly mergedInto?: IncidentRef;
  readonly projects?: readonly IncidentProjectRef[];
  readonly participants?: readonly IncidentParticipant[];
  readonly canonicalContext: IncidentContextView;
  readonly notes?: readonly string[];
  readonly lastSeq: number;
}

/** `GET /datatug/incidents/{id}` (hub REQ:api-and-cli, REQ:houston-creation
 * for `description`). */
export type IncidentDetail = IncidentSummary;

export interface IncidentListResponse {
  readonly incidents: readonly IncidentSummary[];
}

export interface IncidentResponse {
  readonly incident: IncidentDetail;
}

/** Body of `POST /datatug/incidents` — title and free text (hub
 * REQ:houston-creation: "A user MUST be able to create an incident from a
 * title and free text ... The free text is kept as the incident's
 * `description`."). */
export interface CreateIncidentRequest extends IncidentScope {
  readonly mutationId: string;
  readonly title: string;
  readonly description?: string;
  readonly projects?: readonly IncidentProjectRef[];
  readonly canonicalContext: IncidentContextInput;
}

export interface IncidentListFilters {
  readonly status?: readonly string[];
  readonly query?: string;
  readonly check?: string;
  readonly board?: string;
}

export interface IncidentAssertion {
  readonly kind:
    | 'observation'
    | 'claim'
    | 'question'
    | 'hypothesis'
    | 'inference'
    | 'deterministic-result';
  readonly confidence?: 'speculative' | 'likely' | 'confirmed';
}

export interface IncidentEvent {
  readonly id: string;
  readonly seq: number;
  readonly at: string;
  readonly visibleAt: string;
  readonly incident: IncidentRef;
  readonly actor: IncidentActor;
  readonly type:
    | 'incident.created'
    | 'incident.status'
    | 'incident.outcome'
    | 'incident.merged'
    | 'note.added';
  readonly assertion: IncidentAssertion;
  readonly payload: unknown;
}

export interface IncidentStreamItem {
  readonly cursor: string;
  readonly event: IncidentEvent;
}

/**
 * The outcome of one incident-API call, without throwing. The UI reports an
 * explicit, honest "not available" state for older servers rather than using
 * mock data or silently hiding a failure.
 *
 *  - `ok`: the call succeeded; `data` is the parsed response.
 *  - `unavailable`: an older server returned an unstructured route-level 404
 *    or explicit 501 "not implemented"; the incident surface is not available
 *    on that server.
 *  - `error`: any other failure (network error, 5xx, malformed response).
 */
export type IncidentApiResult<T> =
  | { readonly kind: 'ok'; readonly data: T }
  | { readonly kind: 'unavailable'; readonly message: string }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly code?: string;
    };
