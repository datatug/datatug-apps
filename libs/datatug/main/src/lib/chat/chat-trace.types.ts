// The investigation trace: what DataTug did to answer one question, as data.
//
// A trace is built only from structured fields. There is no free text written by a model and no
// chain-of-thought: `message` is a dictionary key plus parameters, rendered per language. Every number
// in a message is a parameter taken from a check or query that actually ran.

/** Where a piece of knowledge came from, and how far it can be trusted. */
export type ProvenanceClass =
  | 'schema' | 'declared' | 'human-confirmed' | 'observed'
  | 'verified' | 'inferred-from-data' | 'ai-suggested' | 'hypothesis';

/** What produced the decision in this run. `cached` and `jev` and `llm` exist in the contract for later slices. */
export type DecisionMechanism = 'deterministic' | 'cached' | 'jev' | 'llm' | 'human';

export type TraceStepKind =
  | 'understand' | 'select-tables' | 'select-fields' | 'resolve-meaning'
  | 'need-source' | 'discover-source' | 'reconcile-identifiers' | 'plan-join'
  | 'execute' | 'derive-metric' | 'present' | 'follow-up' | 'insight';

export type TraceStatus = 'running' | 'ok' | 'warning' | 'failed' | 'skipped';

export interface TraceMessage {
  readonly key: string;
  readonly params: Readonly<Record<string, string | number>>;
}

export interface TraceDecision {
  readonly question: string;
  readonly selected: readonly string[];
  readonly considered?: readonly string[];
  readonly mechanism: DecisionMechanism;
  /** How the first decision was made, when this run only replayed it. */
  readonly origin?: { readonly mechanism: DecisionMechanism; readonly at: string; readonly model?: string };
  readonly provenance: ProvenanceClass;
  readonly validatedBy: readonly ('taxonomy' | 'schema' | 'fk-graph' | 'meaning' | 'data' | 'dtql-parse' | 'number-grounding')[];
}

export interface TraceEvidence {
  readonly kind: 'schema-object' | 'meaning' | 'mapping' | 'source' | 'data-check' | 'query' | 'prior-investigation';
  readonly ref: string;
  readonly label: TraceMessage;
  readonly observedAt?: string;
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

/** One sentence about a result, tied to the cells it rests on. */
export interface InsightClaim {
  readonly id: string;
  readonly message: TraceMessage;
  readonly rowKeys: readonly string[];
}

export interface TraceStep {
  /** `${turnId}:${index}` */
  readonly id: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly index: number;
  readonly kind: TraceStepKind;
  readonly status: TraceStatus;
  readonly message: TraceMessage;
  readonly decision?: TraceDecision;
  readonly evidence: readonly TraceEvidence[];
  readonly outputs?: { readonly queryId?: string; readonly recordSetId?: string; readonly mappingRef?: string; readonly sourceRef?: string };
  readonly startedAt: string;
  readonly durationMs?: number;
  /** Absent means no AI tokens were spent on this step. */
  readonly tokens?: { readonly input: number; readonly output: number };
  /** A boundary the product does not cross yet: shown as a Preview marker without opening the step. */
  readonly simulated?: { readonly reason: TraceMessage };
  readonly claims?: readonly InsightClaim[];
}
