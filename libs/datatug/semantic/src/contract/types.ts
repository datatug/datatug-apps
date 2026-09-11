import type { AuthorizationResult } from './authorization';
// Frozen wire types for the DataTug agent HTTP contract described in the hub
// Feature's normative transport appendix:
// datatug/datatug: spec/features/core-investigation-loop/api-contract.md
//
// Field names and shapes MUST match that document exactly. This is the client
// half of the shared schema authority; the server half is the Go package
// `github.com/datatug/datatug-core/pkg/apicontract` (lane S64a). Do not add,
// rename, widen or loosen a field here without updating the appendix first —
// see plan Task 12 (core-investigation-loop#ac:real-transport-and-parameter-effect).
//
// For AI agents: this file defines shapes only, no behaviour. Runtime
// validation lives in ./decoders.ts; SemanticValue <-> TypedValue conversion
// at UI edges lives in ./adapt.ts.

// ---- Shared value types ----

export type TypedValue =
  | { readonly type: 'string'; readonly value: string }
  // Finite, exactly representable JSON number.
  | { readonly type: 'number'; readonly value: number }
  // Canonical decimal integer as a string — no leading '+' or leading zeros.
  | { readonly type: 'integer'; readonly value: string }
  // Canonical decimal as a string — preserves precision.
  | { readonly type: 'decimal'; readonly value: string }
  | { readonly type: 'boolean'; readonly value: boolean }
  // YYYY-MM-DD, a valid calendar date.
  | { readonly type: 'date'; readonly value: string }
  // RFC3339 normalized to UTC.
  | { readonly type: 'datetime'; readonly value: string }
  | { readonly type: 'null'; readonly value: null };

export type TypedValueKind = TypedValue['type'];

export interface PhysicalRef {
  readonly source: string;
  readonly collection: string;
  readonly column: string;
}

export type FactOrigin = 'selection' | 'context' | 'manual';
export type FactMapping = 'declared' | 'inferred';

/** Comparison operator a {@link Fact} (or an Investigation Context item built from one —
 * see `InvestigationContextService`'s `ContextItem`) may carry — founder ruling
 * 2026-09-10 (S156): "should have form to add context variable for selected
 * Entity.Field with conditions like ==, >, >=, etc." Operator set is a lead assumption
 * recorded in the hub Feature (`spec/features/investigation-context`
 * REQ:context-variable-conditions) and carried into the transport appendix
 * (`spec/features/core-investigation-loop/api-contract.md`, `Fact.condition`
 * paragraph), pending founder confirmation. `'=='` is the default. */
export type ContextCondition = '==' | '!=' | '>' | '>=' | '<' | '<=';

/** A semantic value the browser suggests to the server — never an access credential; the
 * server revalidates `physical`/`mapping` against authorized project metadata. */
export interface Fact {
  readonly id: string;
  readonly entity: string;
  readonly field: string;
  readonly value: TypedValue;
  /** OPTIONAL; absent means `'=='` — matches every fact produced before this field
   * existed. See api-contract.md's `Fact.condition` paragraph for the compatibility
   * rule an agent that does not implement conditions must follow (leave the parameter
   * unbound and report it unbound, never apply a non-`'=='` fact as equality). Lead
   * assumption 2026-09-10, pending founder confirmation. */
  readonly condition?: ContextCondition;
  readonly origin: FactOrigin;
  readonly physical?: PhysicalRef;
  readonly mapping?: FactMapping;
  readonly enabled: boolean;
}

/** Reports an applied restriction — never the rejected rows/values themselves. An empty
 * `hiddenColumns` list with a generic `policy` label is how a protected name stays hidden. */
export interface Limitation {
  readonly policy: string;
  readonly rowsFiltered: boolean;
  readonly hiddenColumns: readonly string[];
}

export type BindingOrigin = 'selection' | 'context' | 'manual' | 'default';
/** `server-default` only when validated against the query definition; every
 * client-supplied origin (`selection`/`context`/`manual`) is always `client-reported` —
 * the UI must never present it as server-attested provenance. */
export type OriginEvidence = 'server-default' | 'client-reported';

export interface Binding {
  readonly parameterId: string;
  readonly value: TypedValue;
  readonly origin: BindingOrigin;
  readonly originEvidence: OriginEvidence;
  readonly factId?: string;
}

export type ExecutionMode = 'live' | 'snapshot';
export type ExecutionProfile = 'protected' | 'opaque-privileged';

export interface ResultColumn {
  readonly name: string;
  readonly type: string;
}

export interface ResultProvenance {
  readonly source: string;
  readonly collection?: string;
  readonly queryId?: string;
  readonly mode: ExecutionMode;
  readonly snapshotId?: string;
  readonly observedAt: string;
  readonly executionProfile: ExecutionProfile;
}

/** The exact success envelope for every read/execute endpoint below except
 * `semantic/columns` and `semantic/related`. */
export interface Result {
  readonly recordset: {
    readonly columns: readonly ResultColumn[];
    readonly rows: readonly (readonly TypedValue[])[];
  };
  readonly limitations: readonly Limitation[];
  readonly bindingsApplied: readonly Binding[];
  readonly provenance: ResultProvenance;
  readonly truncated: boolean;
}

// ---- Scope and source identity ----

/** Carried on every scoped call. `securityContextId` is a staleness check, never
 * authentication — the server responds STALE_CONTEXT after a principal/policy-session
 * change and it must be refreshed from `agent-info`. */
export interface Scope {
  readonly project: string;
  readonly environment: string;
  readonly securityContextId: string;
}

export interface SourceRef {
  readonly source: string;
  readonly collection: string;
}

// ---- Candidate / applicable queries ----

export type CandidateState =
  | 'runnable'
  | 'needs-input'
  | 'needs-target'
  | 'source-unavailable';

export interface CandidateTarget {
  readonly source: string;
  readonly label: string;
}

export interface CandidateChainStep {
  readonly parameterId: string;
  readonly factId?: string;
  readonly explanation: string;
}

export interface CandidateAmbiguity {
  readonly parameterId: string;
  readonly factIds: readonly string[];
}

export interface Candidate {
  /** The saved query this candidate resolves to. May be a bare id
   * (`customer-invoices`) or folder-qualified (`customers/customer-invoices`,
   * as of datatug-cli#219) — opaque to the client either way: pass it
   * straight through to `get_query`/`run_query` (which accept both forms)
   * and, when routing to it, encode it as a single path segment rather than
   * assuming it has no `/`. Never parse or reconstruct it client-side. */
  readonly queryId: string;
  /** Authorized eligible targets only. */
  readonly targets: readonly CandidateTarget[];
  /** Present only when exactly one eligible target remains. */
  readonly selectedSource?: string;
  readonly bindings: readonly Binding[];
  readonly chain: readonly CandidateChainStep[];
  /** Parameter IDs, including non-semantic required parameters. */
  readonly missing: readonly string[];
  readonly ambiguous: readonly CandidateAmbiguity[];
  readonly state: CandidateState;
}

// ---- Execution request ----

export interface ExecutionBindingOrigin {
  readonly parameterId: string;
  readonly origin: BindingOrigin;
  readonly factId?: string;
}

export interface ExecutionRequest {
  readonly project: string;
  readonly environment: string;
  readonly securityContextId: string;
  readonly source?: string;
  /** Exactly one of `queryId`/`dtql` is required. */
  readonly queryId?: string;
  readonly dtql?: unknown;
  readonly parameters: Readonly<Record<string, TypedValue>>;
  /** Display provenance only, checked for exactly the submitted parameter keys — never
   * influences authorization (REQ:no-hidden-filters). */
  readonly bindingOrigins: readonly ExecutionBindingOrigin[];
  readonly mode: ExecutionMode;
  readonly snapshotId?: string;
  readonly limit?: number;
}

// ---- Endpoint request/response shapes ----

export type SemanticProvenance = 'declared' | 'inferred';

export interface SemanticColumnsRequest extends Scope, SourceRef {}

export interface SemanticColumnMapping {
  readonly column: string;
  readonly entity: string;
  readonly field: string;
  readonly provenance: SemanticProvenance;
}

/** `GET semantic/columns` — unmapped columns are omitted entirely. */
export interface SemanticColumnsResponse {
  readonly columns: readonly SemanticColumnMapping[];
}

export interface SemanticRelatedRequest extends Scope {
  readonly fact: Fact;
  readonly limit?: number;
}

export interface RelatedLookup {
  readonly lookupId: string;
  readonly label: string;
  readonly source: string;
  readonly collection: string;
  /** `null` when the server withholds it — render "count unavailable". */
  readonly count: number | null;
}

/** `POST semantic/related`. */
export interface SemanticRelatedResponse {
  readonly related: readonly RelatedLookup[];
  readonly truncated: boolean;
}

export interface SemanticRelatedRowsRequest extends Scope {
  readonly lookupId: string;
  readonly value: TypedValue;
  readonly limit?: number;
}

/** `POST semantic/related/rows` — a full `Result`. */
export type SemanticRelatedRowsResponse = Result;

export interface ApplicableQueriesRequest extends Scope {
  readonly values: readonly Fact[];
}

/** `POST queries/applicable`. `applicable` contains only `runnable` candidates; `notYet`
 * carries authorized metadata for needs-input/needs-target/source-unavailable ones. */
export interface ApplicableQueriesResponse {
  readonly applicable: readonly Candidate[];
  readonly notYet: readonly Candidate[];
}

/** `POST exec/run_query`. */
export type RunQueryRequest = ExecutionRequest;
export type RunQueryResponse = Result;

// ---- agent-info ----

export interface AgentPrincipal {
  readonly id: string;
  readonly roles: readonly string[];
  readonly groups: readonly string[];
}

export interface AgentCapabilities {
  readonly protectedQueries: boolean;
  readonly opaqueReadOnly: boolean;
}

export interface AgentProjectRef {
  readonly id: string;
}

/** `GET agent-info` — obtains the initial `securityContextId`; never authentication. */
export interface AgentInfo {
  readonly version: string;
  readonly principal: AgentPrincipal;
  readonly securityContextId: string;
  readonly projects: readonly AgentProjectRef[];
  readonly capabilities: AgentCapabilities;
}

// ---- Errors ----

export const ERROR_CODES = [
  'INVALID_REQUEST',
  'TYPE_MISMATCH',
  'MISSING_PARAMETER',
  'AMBIGUOUS_BINDING',
  'TARGET_REQUIRED',
  'UNAUTHENTICATED',
  'ACCESS_DENIED',
  'UNSUPPORTED_PROTECTED_EXECUTION',
  'NOT_FOUND',
  'STALE_CONTEXT',
  'RESPONSE_TOO_LARGE',
  'SOURCE_UNAVAILABLE',
  'TIMEOUT',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Only `TARGET_REQUIRED` may carry `targets`; every other field is always present. */
export interface ErrorBody {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
  readonly requestId: string;
  readonly targets?: readonly CandidateTarget[];
}

/** One recorded snapshot a client may explicitly request via
 * `ExecutionRequest.snapshotId` — `recordedAt` is RFC3339, the fixture's actual capture
 * time (never "now"). LEAD ASSUMPTION 2026-09-10, pending founder confirmation (see the
 * contract amendment, `spec/features/core-investigation-loop/api-contract.md`,
 * datatug/datatug hub): datatug-core v0.27.3's `apicontract.ErrorBody` has no generic
 * extension field, and its own `Validate()` restricts `targets` to `TARGET_REQUIRED`
 * only, so this travels as a sibling top-level `details` key next to `error` (never
 * nested inside it) — see `ErrorEnvelope.details` below. */
export interface AvailableSnapshot {
  readonly snapshotId: string;
  readonly recordedAt: string;
}

export interface ErrorDetails {
  /** Owner-projected DTQL blockers; does not expose editable policies. */
  readonly authorization?: AuthorizationResult;
  /** Present only on a `SOURCE_UNAVAILABLE` response for an HTTP-typed saved query that
   * has a recorded fixture; always exactly one entry for Phase 1 (one fixture per
   * query — see datatug-cli's `pkg/httpsource` fixtureFS doc comment). */
  readonly availableSnapshots?: readonly AvailableSnapshot[];
}

export interface ErrorEnvelope {
  readonly error: ErrorBody;
  /** Sibling to `error`, never nested inside it — see `ErrorDetails`'s own doc comment
   * for why. Absent on every error that isn't `SOURCE_UNAVAILABLE` for an HTTP query
   * with a recorded fixture. */
  readonly details?: ErrorDetails;
}

export function isKnownErrorCode(code: string): code is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code);
}
