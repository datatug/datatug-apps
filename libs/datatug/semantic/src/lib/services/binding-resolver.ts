// REQ:parameter-auto-binding, REQ:no-hidden-filters — the parameter-binding precedence
// engine described in the hub Feature's transport appendix ("Binding and context
// behavior", datatug/datatug: spec/features/core-investigation-loop/api-contract.md):
//
//   "For each parameter: an explicit user edit wins; otherwise one compatible
//   selected fact wins; otherwise one compatible enabled context fact wins;
//   otherwise a declared default applies. More than one distinct typed value
//   within the highest eligible automatic tier is ambiguous and blocks Run.
//   Selection overriding a different context value is shown as an explicit
//   conflict requiring confirmation; an already-open query never rebinds
//   silently. Disabled facts are ignored. Defaults never hide an ambiguity.
//   The user can clear a value; a cleared required value blocks Run until
//   supplied."
//
// "Compatible" excludes a context fact whose `Fact.condition` is anything other than
// `'=='` (absent means `'=='`) — this resolver doesn't implement conditions, so per
// the appendix's `Fact.condition` paragraph it must never apply such a fact as
// equality. It's reported instead via `ResolvedBinding.skippedConditionFacts`, the
// client-side mirror of the wire `Candidate.chain`'s skip explanation, and otherwise
// falls through exactly as if that fact didn't exist (S168). Selection facts are
// unaffected — they're always treated as equality candidates regardless of
// `condition`.
//
// Pure, framework-free (no Angular, no HTTP) so its precedence/typed-equality/
// blocking logic is directly unit-testable — Task 15 item 3
// (core-investigation-loop#ac:typed-context-isolation,
// core-investigation-loop#ac:bound-from-selection,
// core-investigation-loop#ac:context-carries).
//
// For AI agents: this module owns ONLY the resolution decision (which value,
// which origin, which block reason). Whether a blocked/ambiguous/conflict state
// stops a Run, and how it's rendered, is the caller's job (QueryPageComponent).

import { EntityFieldRef } from '../models/models';
import { ContextCondition, Fact, TypedValue } from '../../contract/types';

/** One query parameter the resolver can bind — a subset of `IParameterDef`
 * (`libs/datatug/main`) kept dependency-free here. */
export interface BindingParameterRef {
  readonly id: string;
  readonly meta?: EntityFieldRef;
  readonly required?: boolean;
  /** A declared default, already typed — "otherwise a declared default applies".
   * Most parameters have none. */
  readonly defaultValue?: TypedValue;
}

export type ResolvedBindingOrigin = 'user' | 'selection' | 'context' | 'default';
export type BindingBlockReason = 'ambiguous' | 'conflict-unconfirmed' | 'missing-required';

/** One enabled context {@link Fact} excluded from binding candidacy for a parameter
 * because it declares a comparison other than `'=='` — api-contract.md's
 * `Fact.condition` paragraph: "An agent that does not implement conditions MUST NOT
 * apply a non-`==` fact as equality; it MUST leave the parameter unbound and report it
 * unbound in the response (`Candidate.missing`, and a `chain` entry whose `explanation`
 * says the fact was skipped for an unsupported condition)." This resolver doesn't
 * implement conditions, so it mirrors that agent rule client-side: every non-`==`
 * context fact for a parameter's field is reported here (mirroring the wire
 * `Candidate.chain` step shape) rather than silently dropped or applied as equality.
 * Present regardless of whether the parameter ultimately binds through another
 * tier — "why this query is constrained" must stay truthful either way. */
export interface SkippedConditionFact {
  readonly factId: string;
  readonly condition: ContextCondition;
  readonly explanation: string;
}

/** One parameter's resolved binding decision. Exactly one of `value`/`blocked` is set
 * for a semantic (meta-carrying) parameter with any candidate; a non-semantic,
 * non-required parameter with nothing bound gets neither (nothing to show, nothing
 * blocking). */
export interface ResolvedBinding {
  readonly parameterId: string;
  readonly meta?: EntityFieldRef;
  readonly value?: TypedValue;
  readonly origin?: ResolvedBindingOrigin;
  readonly blocked?: BindingBlockReason;
  /** Set only when `blocked === 'conflict-unconfirmed'`. */
  readonly conflict?: {
    readonly selectionValue: TypedValue;
    readonly contextValue: TypedValue;
  };
  /** Set only when `blocked === 'ambiguous'` — every distinct candidate value found in
   * the highest eligible automatic tier. */
  readonly ambiguousValues?: readonly TypedValue[];
  /** Present only when at least one enabled context fact for this parameter's field
   * was excluded from binding candidacy for an unsupported condition — see
   * {@link SkippedConditionFact}. */
  readonly skippedConditionFacts?: readonly SkippedConditionFact[];
}

export interface ResolveBindingsInput {
  readonly parameters: readonly BindingParameterRef[];
  /** Typically the panel/grid selection's Fact(s) for the current scope. More than one
   * distinct typed value for the same field is a real ambiguity — never deduped away. */
  readonly selectionFacts: readonly Fact[];
  /** The *enabled* Investigation Context facts for the current scope (disabled facts
   * must already be filtered out by the caller — "Disabled facts are ignored"). */
  readonly contextFacts: readonly Fact[];
  /** Explicit user edits — "an explicit user edit wins" over every automatic tier. */
  readonly userValues?: ReadonlyMap<string, TypedValue>;
  /** Parameter ids the user explicitly cleared — "The user can clear a value; a
   * cleared required value blocks Run until supplied." A cleared parameter is never
   * silently resurrected; the caller re-derives this set only from explicit user
   * action (never from re-running resolution). */
  readonly clearedParamIds?: ReadonlySet<string>;
  /** Parameter ids where the user has explicitly confirmed a shown selection-vs-context
   * conflict (accepting the selection value) — "shown as an explicit conflict requiring
   * confirmation". The caller owns clearing this set when the underlying facts change
   * (a *different* conflict must be re-confirmed, per "an already-open query never
   * rebinds silently"). */
  readonly confirmedConflicts?: ReadonlySet<string>;
}

/** `5 !== "5"`: an integer 5 and a string "5" are distinct TypedValues even though
 * `String(5) === "5"` — the appendix's "types stay distinct" requirement. Comparing
 * `type` first also keeps `false`/`0`/`null` distinct from each other and from their
 * same-looking-when-displayed siblings (a `boolean:false` never equals a `null`). */
function typedValuesEqual(a: TypedValue, b: TypedValue): boolean {
  return a.type === b.type && a.value === b.value;
}

function distinctValues(facts: readonly Fact[]): TypedValue[] {
  const out: TypedValue[] = [];
  for (const fact of facts) {
    if (!out.some((v) => typedValuesEqual(v, fact.value))) {
      out.push(fact.value);
    }
  }
  return out;
}

function factsFor(facts: readonly Fact[], meta: EntityFieldRef): Fact[] {
  return facts.filter((f) => f.entity === meta.entity && f.field === meta.field);
}

/** Absent `condition` means `'=='` (api-contract.md's `Fact.condition` paragraph —
 * "matching every fact produced before this field existed"). */
function isEqualityCondition(fact: Fact): boolean {
  return !fact.condition || fact.condition === '==';
}

/** Equality-binding candidates only — "Selection facts (`origin: 'selection'`) are
 * unaffected" (a selection fact is never filtered by condition here; only context
 * facts are), so callers pass the already-selection-scoped or already-context-scoped
 * slice explicitly rather than this helper branching on `origin`. */
function equalityFactsFor(facts: readonly Fact[], meta: EntityFieldRef): Fact[] {
  return factsFor(facts, meta).filter(isEqualityCondition);
}

/** The exact wording used for a `SkippedConditionFact.explanation` — exported so a
 * caller rendering the wire `Candidate.chain`'s own `explanation` (context-panel.md's
 * "why this query is constrained" view — server-driven, api-contract.md's `Fact.condition`
 * paragraph) can use the identical phrasing this client-side resolver uses for its own
 * skip, rather than inventing separate wording for the same rule. */
export function explainSkippedCondition(condition: ContextCondition): string {
  return `skipped: condition \`${condition}\` is not supported for parameter binding`;
}

/** Every enabled context fact for `meta` that declares a non-`'=='` condition —
 * reported on the {@link ResolvedBinding} regardless of which tier the parameter
 * ultimately binds through (or fails to). */
function skippedConditionFactsFor(
  contextFacts: readonly Fact[],
  meta: EntityFieldRef,
): SkippedConditionFact[] {
  return factsFor(contextFacts, meta)
    .filter((f) => !isEqualityCondition(f))
    .map((f) => {
      const condition = f.condition as ContextCondition;
      return { factId: f.id, condition, explanation: explainSkippedCondition(condition) };
    });
}

function withSkipped(
  binding: ResolvedBinding,
  skippedConditionFacts: readonly SkippedConditionFact[],
): ResolvedBinding {
  return skippedConditionFacts.length ? { ...binding, skippedConditionFacts } : binding;
}

function unresolved(
  parameterId: string,
  meta: EntityFieldRef | undefined,
  required: boolean | undefined,
): ResolvedBinding {
  return required
    ? { parameterId, meta, blocked: 'missing-required' }
    : { parameterId, meta };
}

/**
 * Resolves every parameter's binding per the appendix's precedence, in one pass, with
 * no side effects and no mutation of its inputs. Callers (QueryPageComponent) decide
 * what to send on Run: only bindings with a `value` and no `blocked` reason are safe
 * to submit; any `blocked` result must stop Run (REQ:no-hidden-filters).
 */
export function resolveBindings(
  input: ResolveBindingsInput,
): readonly ResolvedBinding[] {
  const userValues = input.userValues ?? new Map<string, TypedValue>();
  const clearedParamIds = input.clearedParamIds ?? new Set<string>();
  const confirmedConflicts = input.confirmedConflicts ?? new Set<string>();

  return input.parameters.map((param): ResolvedBinding => {
    if (clearedParamIds.has(param.id)) {
      return unresolved(param.id, param.meta, param.required);
    }

    const userValue = userValues.get(param.id);
    if (userValue !== undefined) {
      return { parameterId: param.id, meta: param.meta, value: userValue, origin: 'user' };
    }

    const meta = param.meta;
    if (!meta) {
      return unresolved(param.id, meta, param.required);
    }

    // "Selection facts (`origin: 'selection'`) are unaffected" — a selection candidate
    // is never filtered by `condition`; only *context* facts are (see
    // `equalityFactsFor`/`skippedConditionFactsFor` below), per api-contract.md's
    // `Fact.condition` paragraph.
    const selectionValues = distinctValues(factsFor(input.selectionFacts, meta));
    const skippedConditionFacts = skippedConditionFactsFor(input.contextFacts, meta);
    const resolved = (binding: ResolvedBinding): ResolvedBinding =>
      withSkipped(binding, skippedConditionFacts);

    if (selectionValues.length > 1) {
      return resolved({
        parameterId: param.id,
        meta,
        blocked: 'ambiguous',
        ambiguousValues: selectionValues,
      });
    }

    // A non-`==` context fact is never an equality-binding candidate — it must not be
    // applied as equality and must not be treated as conflicting with a selection
    // value either (`skippedConditionFacts` above already reports it separately).
    const contextValues = distinctValues(equalityFactsFor(input.contextFacts, meta));

    if (selectionValues.length === 1) {
      const selectionValue = selectionValues[0];
      const conflictingContext = contextValues.find(
        (v) => !typedValuesEqual(v, selectionValue),
      );
      if (conflictingContext && !confirmedConflicts.has(param.id)) {
        return resolved({
          parameterId: param.id,
          meta,
          blocked: 'conflict-unconfirmed',
          conflict: { selectionValue, contextValue: conflictingContext },
        });
      }
      return resolved({
        parameterId: param.id,
        meta,
        value: selectionValue,
        origin: 'selection',
      });
    }

    // No selection candidate — fall through to context, then default.
    if (contextValues.length > 1) {
      return resolved({
        parameterId: param.id,
        meta,
        blocked: 'ambiguous',
        ambiguousValues: contextValues,
      });
    }
    if (contextValues.length === 1) {
      return resolved({
        parameterId: param.id,
        meta,
        value: contextValues[0],
        origin: 'context',
      });
    }

    // "Defaults never hide an ambiguity" — reaching here means neither tier was
    // ambiguous, so applying the default is safe. A skipped non-equality-only context
    // fact isn't an ambiguity either — it was never a candidate — so it doesn't block
    // the default (it's still reported via `skippedConditionFacts`).
    if (param.defaultValue !== undefined) {
      return resolved({
        parameterId: param.id,
        meta,
        value: param.defaultValue,
        origin: 'default',
      });
    }

    return resolved(unresolved(param.id, meta, param.required));
  });
}

/** `true` for a binding that is safe to submit on Run — has a value and nothing
 * blocking it (REQ:no-hidden-filters: never send a blocked/absent value). */
export function isBindingRunnable(binding: ResolvedBinding): boolean {
  return binding.value !== undefined && !binding.blocked;
}

/** `true` if any *required* parameter is missing a runnable binding — the caller must
 * disable Run and show why. */
export function hasBlockingBindings(bindings: readonly ResolvedBinding[]): boolean {
  return bindings.some((b) => !!b.blocked);
}
