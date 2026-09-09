// UI-local shapes for the semantic-foundation library. Plan Task 12 moved every
// *wire* shape (requests/responses SemanticApiService sends and receives) to
// ../../contract/types.ts, matching the hub Feature's normative transport appendix
// (datatug/datatug: spec/features/core-investigation-loop/api-contract.md) exactly.
// What remains here is UI-local state that never crosses the wire as-is:
// InvestigationContextService's storage model and the grid-selection shape a host
// page builds. SemanticApiService's callers wrap/unwrap at that boundary — see
// ../../contract/adapt.ts (`toFact`, `toTypedValue`, `displayTypedValue`).
//
// For AI agents: a shape that IS sent/received over `/datatug/*` verbatim belongs in
// ../../contract/types.ts, not here — see that file's own header comment.

// `SemanticValue` is defined once, in ../../contract/adapt.ts (next to the
// `toTypedValue`/`fromTypedValue` functions that convert it), and re-exported here —
// public_api.ts re-exports both this file and the contract barrel with `export *`, so a
// second definition here would collide.
import type { SemanticValue } from '../../contract/adapt';
import type { PhysicalRef } from '../../contract/types';
export type { SemanticValue };

/** A reference to a declared semantic field, e.g. `{ entity: 'Customer', field: 'ID' }`. */
export interface EntityFieldRef {
  readonly entity: string;
  readonly field: string;
}

/**
 * A semantic value the user currently has "selected" in a host page (e.g. a grid cell),
 * the input to {@link ContextPanelComponent}. Not part of the wire contract —
 * this is UI-local state a host page (the S2/S8 table & query pages) builds and passes in;
 * ContextPanelComponent wraps it as a {@link import('../../contract/types').Fact} with
 * `origin: 'selection'` before calling SemanticApiService.
 */
export interface SemanticSelection {
  readonly entity: string;
  readonly field: string;
  readonly value: SemanticValue;
  /** Human-readable label for chips/headers, e.g. `"Customer.ID = 5"`. */
  readonly label: string;
  /** Where the selection came from, e.g. `"grid"`, a source id — UI-local only, never
   * sent as the wire Fact's `origin` (that is always the fixed `'selection'` enum value). */
  readonly source: string;
  /** The wire `Fact.physical` this selection resolves to — the server rejects
   * `POST /datatug/semantic/related` with `INVALID_REQUEST` on `fact.physical`
   * ("is required to compute related lookups") without it. A host page that
   * already called `GET /datatug/semantic/columns` (e.g.
   * `EnvDbTablePageComponent.loadSemanticColumns`) has every part of this on
   * hand from that same call's own request/response (`source`/`collection` it
   * sent, `column` from the matched `SemanticColumnMapping`) — optional only
   * because a host page without that context (see also lane S90's report) has
   * nothing to populate it with, not because the server treats it as optional. */
  readonly physical?: PhysicalRef;
}
