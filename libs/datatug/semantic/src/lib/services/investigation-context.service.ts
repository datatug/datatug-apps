import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { ContextCondition, Fact, TypedValue } from '../../contract/types';
import { toTypedValue, SemanticValue } from '../../contract/adapt';
import { DATATUG_AGENT_BASE_URL } from '../tokens/datatug-agent-base-url.token';
import { EntityFieldRef } from '../models/models';

/**
 * Identifies one isolated Investigation Context basket — api-contract.md "Binding and
 * context behavior": "Context is isolated by agent URL/project/environment/
 * securityContextId. Switching scope clears active bindings and opens that scope's own
 * empty or retained local context; it never imports facts automatically." `agentUrl`
 * comes from {@link DATATUG_AGENT_BASE_URL} (already normalized — see that token's own
 * doc comment), not a caller-supplied string, so two callers pointed at the same agent
 * can never disagree about which basket they mean.
 */
export interface ContextScope {
  readonly agentUrl: string;
  readonly project: string;
  readonly environment: string;
  readonly securityContextId: string;
}

/** Stable string key for a {@link ContextScope} — used for the storage map and for
 * comparing two scopes for equality. NUL-joined (`'\0'`) so no field value containing the
 * delimiter used elsewhere (`|`, `:`) can collide two distinct scopes into one key. */
export function scopeKey(scope: ContextScope): string {
  return [scope.agentUrl, scope.project, scope.environment, scope.securityContextId].join(
    '\0',
  );
}

/** `true` when both scopes name the same isolated basket. `undefined` compares equal
 * only to `undefined` (both "no scope yet"). */
export function scopesEqual(
  a: ContextScope | undefined,
  b: ContextScope | undefined,
): boolean {
  if (!a || !b) {
    return a === b;
  }
  return scopeKey(a) === scopeKey(b);
}

/** Comparison operator for a context variable — founder ruling 2026-09-10 (S156):
 * "should have form to add context variable for selected Entity.Field with conditions
 * like ==, >, >=, etc." `'=='` is the default. This type now lives on the wire
 * {@link Fact} shape itself (`../../contract/types.ts`, `Fact.condition` — see the hub
 * contract amendment `spec/features/core-investigation-loop/api-contract.md`); it is
 * re-exported here for backward-compatible imports, since `ContextItem extends Fact`
 * already inherits the field. `queries/applicable`/`exec/run_query` now receive
 * `condition` for real (via {@link contextItemToFact}) — an agent that doesn't
 * implement conditions must leave a non-`'=='` fact unbound rather than apply it as
 * equality (api-contract.md's compatibility rule). */
export type { ContextCondition } from '../../contract/types';

const DEFAULT_CONDITION: ContextCondition = '==';

/** Input to {@link InvestigationContextService.addValue} — a UI-local semantic value
 * (grid cell, related-lookup row, manual entry). Wrapped as a wire {@link Fact}
 * (`origin` fixed to `'context'`, `enabled: true`) at storage time — Task 15 item 2
 * ("InvestigationContextService holds Fact[] (contract shape) per scope"). */
export interface ContextItemInput {
  readonly entityField: EntityFieldRef;
  readonly value: SemanticValue;
  readonly label: string;
  /** Where this value came from, e.g. `"grid"`, a related-lookup id, `"manual"` for the
   * Investigation Context page's own "Add a context variable" form. */
  readonly source: string;
  /** Defaults to `'=='` (equality) — every pre-existing caller (grid "Add to context",
   * related-lookup rows) never sets this and keeps meaning equality, unchanged. */
  readonly condition?: ContextCondition;
}

/** REQ:context-basket — one Investigation Context entry: a wire {@link Fact} (so its
 * `entity`/`field`/`value`/`condition`/`origin`/`enabled` need no re-wrapping — see
 * {@link contextItemToFact} for the exact narrowing used before it reaches
 * `queries/applicable`/`exec/run_query`) plus UI-local display metadata. */
export interface ContextItem extends Fact {
  readonly label: string;
  readonly source: string;
  readonly addedAt: string;
  /** See {@link ContextCondition} — always populated (`'=='` when the caller didn't
   * specify one), never `undefined`, so every render site can show it uniformly.
   * Narrows back to Fact's OPTIONAL `condition?` when serialised — see
   * {@link contextItemToFact}. */
  readonly condition: ContextCondition;
}

/** Narrows a {@link ContextItem} to the exact wire {@link Fact} shape — the boundary
 * where a context basket entry becomes a request payload for `queries/applicable`/
 * `exec/run_query`. `condition` is included only when it differs from the default
 * (`'=='`), so a plain equality item serialises byte-for-byte exactly as it always
 * has — see api-contract.md's `Fact.condition` paragraph for the compatibility rule
 * this preserves for an agent that doesn't implement conditions (it must leave a
 * non-`'=='` fact unbound and report it unbound, never apply it as equality). */
export function contextItemToFact(item: ContextItem): Fact {
  return {
    id: item.id,
    entity: item.entity,
    field: item.field,
    value: item.value,
    origin: item.origin,
    enabled: item.enabled,
    ...(item.physical ? { physical: item.physical } : {}),
    ...(item.mapping ? { mapping: item.mapping } : {}),
    ...(item.condition !== DEFAULT_CONDITION ? { condition: item.condition } : {}),
  };
}

/** The subset of a query parameter's shape {@link InvestigationContextService.bindingsFor} needs. */
export interface SemanticParameterRef {
  readonly id: string;
  readonly meta?: EntityFieldRef;
}

/** A candidate binding {@link InvestigationContextService.bindingsFor} found for a parameter. */
export interface ParameterBinding {
  readonly parameterId: string;
  readonly entityField: EntityFieldRef;
  readonly value: SemanticValue;
  readonly label: string;
  readonly source: string;
  readonly contextItemId: string;
}

const STORAGE_KEY_PREFIX = 'datatug.investigationContext.v2.';

/** `5 !== "5"` — see `binding-resolver.ts`'s identical comment; this service enforces
 * the same typed-distinctness rule when deciding whether an added value is "already
 * present" (REQ:context-basket idempotency) rather than comparing display strings. */
function typedValuesEqual(a: TypedValue, b: TypedValue): boolean {
  return a.type === b.type && a.value === b.value;
}

function itemMatches(
  item: ContextItem,
  entityField: EntityFieldRef,
  value: TypedValue,
  condition: ContextCondition,
): boolean {
  return (
    item.entity === entityField.entity &&
    item.field === entityField.field &&
    item.condition === condition &&
    typedValuesEqual(item.value, value)
  );
}

function contextItemId(
  entityField: EntityFieldRef,
  value: TypedValue,
  condition: ContextCondition,
): string {
  // Includes the TypedValue's own `type` (not just its display value) so 5 (integer)
  // and "5" (string) never collide into the same context-item id — see this file's
  // header and binding-resolver.ts's typedValuesEqual. The condition is folded in only
  // when it isn't the default (`'=='`) so every pre-existing id (grid/related-lookup
  // adds, always equality) is byte-for-byte unchanged — e.g. `Age > 5` and `Age >= 5`
  // get distinct ids from each other and from the default-equality `Age = 5`, while
  // `Age = 5` keeps the exact id it always had.
  const conditionTag = condition === DEFAULT_CONDITION ? '' : condition;
  return `${entityField.entity}.${entityField.field}${conditionTag}:${value.type}=${JSON.stringify(value.value)}`;
}

/**
 * REQ:context-basket — the Investigation Context ("basket", A3: internal name only).
 * An ordered, per-{@link ContextScope} set of semantic values the user explicitly
 * added, each removable and independently disable-able without being removed.
 *
 * Task 15 item 2 ("typed context store keyed by scope"): storage is one `Fact[]`
 * basket per `{agentUrl, project, environment, securityContextId}` — switching scope
 * (via {@link setScope}) never copies facts from another scope; each scope's basket is
 * loaded from (and persisted to) its own `sessionStorage` key, so it's retained across
 * a scope switch-and-back within the same tab but never shared across scopes or tabs
 * (`sessionStorage` is per-tab by browser spec — the "a new tab starts empty" half of
 * api-contract.md's context-isolation paragraph; see this file's own ASSUMPTION note).
 *
 * REQ:no-hidden-filters — this service NEVER filters, binds, or otherwise constrains a
 * query on its own. {@link bindingsFor} only reports candidate bindings; a caller (a
 * query page, via `binding-resolver.ts`) decides whether to show and apply them before
 * running.
 *
 * ASSUMPTION (Task 15, mine, challengeable): storage stays `sessionStorage`
 * (per-scope-keyed, not a single global key as before) rather than adding an explicit
 * cross-tab "import shared state" action. `sessionStorage` is already per-tab in every
 * browser, so "a new tab starts without another tab's context" (api-contract.md) holds
 * for free; an explicit import affordance for Epilogue B (share/replay) is real product
 * surface the brief doesn't ask this lane to build, and is left as a follow-up.
 */
@Injectable({ providedIn: 'root' })
export class InvestigationContextService {
  private readonly agentUrl = inject(DATATUG_AGENT_BASE_URL);

  private readonly scopeSignal = signal<ContextScope | undefined>(undefined);
  /** `undefined` until the first {@link setScope} call — no request can have a Scope to
   * carry yet, so there is nothing to isolate against. */
  readonly scope: Signal<ContextScope | undefined> = this.scopeSignal.asReadonly();

  /** One basket per scope key, loaded lazily (see {@link setScope}) — never all loaded
   * eagerly, since most sessions only ever touch one or two scopes. */
  private readonly basketsSignal = signal<ReadonlyMap<string, readonly ContextItem[]>>(
    new Map(),
  );

  /** The *current scope's* items, disabled items included. Empty before the first
   * {@link setScope} call. */
  readonly items: Signal<readonly ContextItem[]> = computed(() => {
    const scope = this.scopeSignal();
    if (!scope) {
      return [];
    }
    return this.basketsSignal().get(scopeKey(scope)) ?? [];
  });

  /** Count of *enabled* items in the current scope — what the collapsed context
   * indicator on every screen shows. */
  readonly enabledCount: Signal<number> = computed(
    () => this.items().filter((item) => item.enabled).length,
  );

  /**
   * Switches the active scope (REQ:context-basket / api-contract.md "Switching scope
   * clears active bindings and opens that scope's own empty or retained local
   * context"). A no-op if `scope` names the same basket already active — callers may
   * call this on every render/effect tick without thrashing storage reads.
   * `agentUrl` is filled in from {@link DATATUG_AGENT_BASE_URL} automatically.
   */
  setScope(scope: Omit<ContextScope, 'agentUrl'>): void {
    const next: ContextScope = { agentUrl: this.agentUrl, ...scope };
    if (scopesEqual(this.scopeSignal(), next)) {
      return;
    }
    this.scopeSignal.set(next);
    this.ensureLoaded(next);
  }

  /** `true` when `scope` names the currently active basket — the late-response-discard
   * gate a caller uses before applying a Scope-bearing response: `if
   * (!investigationContext.isCurrentScope(requestScope)) return;` (api-contract.md
   * "Requests/responses carry the requested scope internally; late responses from
   * another scope are discarded."). Takes the same `Omit<ContextScope, 'agentUrl'>`
   * shape as {@link setScope} (a full {@link ContextScope} — e.g. from {@link scope} —
   * satisfies it too) so a caller building a request-time scope from its own
   * project/environment/securityContextId never has to look up `agentUrl` itself; this
   * fills it in from the same injected token {@link setScope} uses, so the two can never
   * disagree about it. */
  isCurrentScope(scope: Omit<ContextScope, 'agentUrl'>): boolean {
    return scopesEqual(this.scopeSignal(), { agentUrl: this.agentUrl, ...scope });
  }

  /** Adds a semantic value to the *current* scope's basket; a no-op (returns the
   * existing item) for an already-present `entityField` + typed value pair — typed
   * equality, not display-string equality (5 ≠ "5"). Does nothing (returns a transient,
   * unstored item) if no scope is active yet. */
  addValue(input: ContextItemInput): ContextItem {
    const scope = this.scopeSignal();
    const typedValue = toTypedValue(input.value);
    const condition = input.condition ?? DEFAULT_CONDITION;
    if (!scope) {
      // No scope yet — nothing to key storage by. Same shape as a stored item so
      // callers don't need a special case, but never persisted.
      return {
        id: contextItemId(input.entityField, typedValue, condition),
        entity: input.entityField.entity,
        field: input.entityField.field,
        value: typedValue,
        origin: 'context',
        enabled: true,
        label: input.label,
        source: input.source,
        addedAt: new Date().toISOString(),
        condition,
      };
    }
    const key = scopeKey(scope);
    const existingItems = this.basketsSignal().get(key) ?? [];
    const existing = existingItems.find((item) =>
      itemMatches(item, input.entityField, typedValue, condition),
    );
    if (existing) {
      return existing;
    }
    const item: ContextItem = {
      id: contextItemId(input.entityField, typedValue, condition),
      entity: input.entityField.entity,
      field: input.entityField.field,
      value: typedValue,
      origin: 'context',
      enabled: true,
      label: input.label,
      source: input.source,
      addedAt: new Date().toISOString(),
      condition,
    };
    this.setBasket(key, [...existingItems, item]);
    return item;
  }

  /** Removes a value from the current scope's basket entirely. */
  removeValue(id: string): void {
    this.updateCurrentBasket((items) => items.filter((item) => item.id !== id));
  }

  /** Temporarily enables/disables a value without removing it (REQ:context-basket). */
  setEnabled(id: string, enabled: boolean): void {
    this.updateCurrentBasket((items) =>
      items.map((item) => (item.id === id ? { ...item, enabled } : item)),
    );
  }

  /** Clears the current scope's whole basket (e.g. after `STALE_CONTEXT`, or "start a
   * new investigation"). Never touches another scope's basket. */
  clear(): void {
    this.updateCurrentBasket(() => []);
  }

  /**
   * REQ:parameter-auto-binding (context half) — for each of `parameters` that carries
   * semantic `meta`, reports the *enabled* context value it would bind from, if any, in
   * the current scope. Purely informational: it never mutates a query. The caller must
   * show the binding (with its origin) before running, and let the user clear or
   * override it (REQ:no-hidden-filters, REQ:parameter-auto-binding).
   *
   * Picks the first enabled match per parameter for backward-compatible callers that
   * don't need ambiguity detection; `binding-resolver.ts`'s `resolveBindings` (fed
   * directly from {@link items}, filtered to enabled) is the full precedence/ambiguity/
   * conflict engine Task 15 item 3 adds — new call sites should prefer that.
   */
  bindingsFor(
    parameters: readonly SemanticParameterRef[],
  ): readonly ParameterBinding[] {
    const enabled = this.items().filter((item) => item.enabled);
    const bindings: ParameterBinding[] = [];
    for (const parameter of parameters) {
      const meta = parameter.meta;
      if (!meta) {
        continue;
      }
      const match = enabled.find(
        (item) => item.entity === meta.entity && item.field === meta.field,
      );
      if (match) {
        bindings.push({
          parameterId: parameter.id,
          entityField: { entity: match.entity, field: match.field },
          value: fromStoredValue(match),
          label: match.label,
          source: match.source,
          contextItemId: match.id,
        });
      }
    }
    return bindings;
  }

  private updateCurrentBasket(
    update: (items: readonly ContextItem[]) => readonly ContextItem[],
  ): void {
    const scope = this.scopeSignal();
    if (!scope) {
      return;
    }
    const key = scopeKey(scope);
    const current = this.basketsSignal().get(key) ?? [];
    this.setBasket(key, update(current));
  }

  private setBasket(key: string, items: readonly ContextItem[]): void {
    const next = new Map(this.basketsSignal());
    next.set(key, items);
    this.basketsSignal.set(next);
    this.persist(key, items);
  }

  /** Loads `scope`'s basket from `sessionStorage` into {@link basketsSignal} if it
   * isn't already cached in memory — "retained local context" (api-contract.md), never
   * imported from another scope. */
  private ensureLoaded(scope: ContextScope): void {
    const key = scopeKey(scope);
    if (this.basketsSignal().has(key)) {
      return;
    }
    const restored = this.restore(key);
    const next = new Map(this.basketsSignal());
    next.set(key, restored);
    this.basketsSignal.set(next);
  }

  private restore(key: string): readonly ContextItem[] {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_PREFIX + key);
      return raw ? (JSON.parse(raw) as ContextItem[]) : [];
    } catch {
      // sessionStorage unavailable (private mode, SSR, or a full quota) or corrupted
      // JSON — start empty rather than throwing.
      return [];
    }
  }

  private persist(key: string, items: readonly ContextItem[]): void {
    try {
      sessionStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(items));
    } catch {
      // Same as above: in-memory state still works even if it can't be persisted.
    }
  }
}

/** Unwraps a stored item's typed value back to the UI-local `SemanticValue` shape
 * {@link ParameterBinding} (a pre-Task-15 caller contract) expects — `bindingsFor`'s own
 * wrap/unwrap edge, mirroring `../../contract/adapt.ts`'s `fromTypedValue` without a
 * decimal/date/datetime special case callers here have never needed. */
function fromStoredValue(item: ContextItem): SemanticValue {
  const v = item.value;
  switch (v.type) {
    case 'string':
      return v.value;
    case 'number':
      return v.value;
    case 'integer':
      return Number(v.value);
    case 'boolean':
      return v.value;
    case 'null':
      return null;
    default:
      // decimal/date/datetime: no lossless SemanticValue representation — fall back to
      // the display string rather than throwing (this path only feeds the legacy
      // bindingsFor() label; resolveBindings() consumes the typed value directly).
      return v.value as string;
  }
}
