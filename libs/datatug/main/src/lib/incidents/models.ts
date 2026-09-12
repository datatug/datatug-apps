// Incident models (spec/features/incidents/README.md, datatug/datatug — hub
// Feature; spec/features/cli/incident/README.md, datatug/datatug-cli — CLI/API
// surface this client wraps).
//
// The wire shapes below mirror datatug-core/pkg/apicontract's frozen incident
// fixtures. The server routes are still delivered by the backend task; until
// then the client reports the honest unavailable state rather than fixtures.

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

export interface IncidentMutationScope {
  readonly storeId: string;
  readonly project: string;
  readonly environment: string;
  readonly securityContextId: string;
}

/** Body of `POST /datatug/incidents` — title and free text (hub
 * REQ:houston-creation: "A user MUST be able to create an incident from a
 * title and free text ... The free text is kept as the incident's
 * `description`."). */
export interface CreateIncidentRequest extends IncidentMutationScope {
  readonly mutationId: string;
  readonly title: string;
  readonly description?: string;
  readonly projects?: readonly IncidentProjectRef[];
}

/**
 * The outcome of one incident-API call, without throwing — every incident
 * page in this scaffold is written against a server that does not implement
 * these endpoints yet, and REQ:no-profile-private-data / the plan Task 9 scope
 * both require an explicit, honest "not available" state rather than mock
 * data or a silent failure.
 *
 *  - `ok`: the call succeeded; `data` is the parsed response.
 *  - `unavailable`: the server returned 404 (route not registered — the
 *    common case today) or 501/501-shaped "not implemented"; the incident
 *    store itself is not available on this server yet.
 *  - `error`: any other failure (network error, 5xx, malformed response).
 */
export type IncidentApiResult<T> =
  | { readonly kind: 'ok'; readonly data: T }
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };
