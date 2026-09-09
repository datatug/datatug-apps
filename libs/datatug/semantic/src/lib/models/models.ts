// Request/response and shared shapes for the semantic-foundation library.
//
// These mirror the "API contracts" table and the REQs in the hub Feature
// (datatug/datatug: spec/features/core-investigation-loop/README.md) exactly —
// behaviour, not the server's Go types. Field names match the table verbatim
// so the eventual server client stays a thin, obviously-correct mapping.
//
// For AI agents: when adding new lines to this file, keep each exported shape
// traceable to the REQ or endpoint row it implements (see the comment above it).

/** A reference to a declared semantic field, e.g. `{ entity: 'Customer', field: 'ID' }`. */
export interface EntityFieldRef {
  readonly entity: string;
  readonly field: string;
}

/** How a semantic mapping was established (REQ:field-mapping-model). */
export type SemanticProvenance = 'declared' | 'inferred';

/** A primitive value a semantic field can carry. */
export type SemanticValue = string | number | boolean;

/**
 * A semantic value the user currently has "selected" in a host page (e.g. a grid cell),
 * the input to {@link ContextPanelComponent}. Not part of the API contracts table —
 * this is UI-local state a host page (the S2/S8 table & query pages) builds and passes in.
 */
export interface SemanticSelection {
  readonly entity: string;
  readonly field: string;
  readonly value: SemanticValue;
  /** Human-readable label for chips/headers, e.g. `"Customer.ID = 5"`. */
  readonly label: string;
  /** Where the selection came from, e.g. `"grid"`, a source id — carried through as `origin`/`source`. */
  readonly source: string;
}

// ---- GET /datatug/semantic/columns (REQ:semantic-resolution-endpoint) ----

export interface SemanticColumnsRequest {
  readonly project: string;
  readonly source: string;
  readonly collection: string;
}

export interface SemanticColumnMapping {
  readonly column: string;
  readonly entity: string;
  readonly field: string;
  readonly provenance: SemanticProvenance;
}

export type SemanticColumnsResponse = readonly SemanticColumnMapping[];

// ---- GET /datatug/semantic/related (REQ:related-lookup-model) ----

export interface SemanticRelatedRequest {
  readonly project: string;
  readonly entity: string;
  readonly field: string;
  readonly value: SemanticValue;
  readonly limit?: number;
}

export interface RelatedLookup {
  readonly lookupId: string;
  readonly label: string;
  readonly source: string;
  readonly collection: string;
  /** Row count, or `null` when the server withholds it — rendered as "count unavailable". */
  readonly count: number | null;
}

export type SemanticRelatedResponse = readonly RelatedLookup[];

// ---- GET /datatug/semantic/related/rows (REQ:related-lookup-execution) ----

export interface SemanticRelatedRowsRequest {
  readonly project: string;
  readonly lookupId: string;
  readonly value: SemanticValue;
  readonly limit?: number;
}

export interface SemanticRelatedRowsResponse {
  readonly recordset: Recordset;
  readonly limitations: readonly ResultLimitation[];
}

// ---- POST /datatug/queries/applicable (REQ:applicable-queries) ----

export interface SemanticValueWithOrigin {
  readonly entity: string;
  readonly field: string;
  readonly value: SemanticValue;
  readonly origin: string;
}

export interface ApplicableQueriesRequest {
  readonly project: string;
  readonly values: readonly SemanticValueWithOrigin[];
}

export interface QueryParameterBinding {
  readonly parameterId: string;
  readonly entity: string;
  readonly field: string;
  readonly value: SemanticValue;
}

export interface ApplicableQuery {
  readonly queryId: string;
  readonly bindings: readonly QueryParameterBinding[];
  /**
   * Resolution chain steps, e.g.
   * `["CustomerId", "maps to Customer.ID (declared)", "requires Customer.ID"]`.
   * Render joined with " → " (see AC:applicable-with-chain).
   */
  readonly chain: readonly string[];
}

export interface NotYetApplicableQuery {
  readonly queryId: string;
  /** Missing `entity.field` names, e.g. `["Invoice.ID"]`. */
  readonly missing: readonly string[];
}

export interface ApplicableQueriesResponse {
  readonly applicable: readonly ApplicableQuery[];
  readonly notYet: readonly NotYetApplicableQuery[];
}

// ---- POST /datatug/exec/run_query (REQ:parameter-auto-binding, REQ:no-hidden-filters) ----

export interface RunQueryRequest {
  readonly project: string;
  readonly queryId?: string;
  /** Opaque DTQL document, used instead of `queryId` for an unsaved/ad-hoc DTQL query. */
  readonly dtql?: unknown;
  readonly parameters?: Readonly<Record<string, SemanticValue | undefined>>;
}

export interface AppliedBinding {
  readonly parameterId: string;
  readonly entity: string;
  readonly field: string;
  readonly value: SemanticValue;
  readonly origin: 'selection' | 'context';
}

export interface RunQueryResponse {
  readonly recordset: Recordset;
  readonly limitations: readonly ResultLimitation[];
  /** REQ:no-hidden-filters — every binding actually applied to this run, for the results header. */
  readonly bindingsApplied: readonly AppliedBinding[];
}

// ---- shared result shapes ----

export interface RecordsetColumn {
  readonly name: string;
  readonly title?: string;
}

export type RecordsetRow = readonly unknown[];

export interface Recordset {
  readonly columns: readonly RecordsetColumn[];
  readonly rows: readonly RecordsetRow[];
}

/** REQ:limitation-visible — policy limitations the server applied to a result. */
export interface ResultLimitation {
  readonly policy?: string;
  readonly rowsFiltered?: boolean;
  readonly hiddenColumns?: readonly string[];
  /** REQ:opaque-sql-limitation — "row/column policies not applied to native SQL". */
  readonly nativeSqlPoliciesNotApplied?: boolean;
}

/** Structured error shape used by every endpoint on refusal (e.g. `code: 'ACCESS_DENIED'`). */
export interface SemanticApiError {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}
