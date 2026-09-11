// Incident models (spec/features/incidents/README.md, datatug/datatug — hub
// Feature; spec/features/cli/incident/README.md, datatug/datatug-cli — CLI/API
// surface this client wraps).
//
// The server does not implement `/datatug/incidents/*` yet (Task 9 is a
// scaffold slice only — see the hub plan's `2026-09-11-incidentius-mvp.md` task
// list). The exact wire field names for an incident are explicitly not fixed
// yet either: the CLI Feature itself says "the wire spelling of the two
// [IncidentRef] fields is reconciled by the hub plan's model task" (still
// open). These types are therefore a best-effort, conservative shape — the
// fields both specs commit to today (id, title, status, description, the
// `IncidentRef` pair, the five outcomes, the seven statuses) — not a claim
// that the transport contract is final. Expect this file to be revisited once
// the model task lands.

/**
 * A reference to one incident: which incident store it lives in, and its id
 * within that store (hub REQ:incident-references-and-back-links; CLI
 * REQ:agent-friendly-ids fixes the string form as `<storeId>/<incidentId>`).
 */
export interface IncidentRef {
  readonly storeId: string;
  readonly incidentId: string;
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
  readonly id: string;
  readonly title: string;
  readonly status: IncidentStatus;
  readonly createdAt?: string;
}

/** `GET /datatug/incidents/{id}` (hub REQ:api-and-cli, REQ:houston-creation
 * for `description`). */
export interface IncidentDetail extends IncidentSummary {
  readonly description?: string;
  readonly outcome?: IncidentOutcome;
  readonly mergedInto?: IncidentRef;
}

/** Body of `POST /datatug/incidents` — title and free text (hub
 * REQ:houston-creation: "A user MUST be able to create an incident from a
 * title and free text ... The free text is kept as the incident's
 * `description`."). */
export interface CreateIncidentRequest {
  readonly title: string;
  readonly description?: string;
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
