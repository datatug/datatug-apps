// Converts between the browser's simple `SemanticValue` (string | number |
// boolean, used by pre-existing UI-local state: SemanticSelection,
// InvestigationContextService, ContextItem — see ../lib/models/models.ts)
// and the wire-exact {@link TypedValue} the appendix requires. Plan Task 12
// item 3 ("typed values end to end — grid adapters unwrap at the edge")
// means this conversion happens exactly at the boundary where UI-local state
// crosses into a SemanticApiService call (wrap) or a Result's recordset
// rows are rendered (unwrap) — not throughout the whole app. Task 15 owns
// converting the UI-local state itself to Fact-shaped typed storage.

import { Fact, FactOrigin, PhysicalRef, TypedValue } from './types';

export type SemanticValue = string | number | boolean | null;

/**
 * Wraps a raw grid/context value as a client-reported {@link TypedValue}. The browser is
 * never authoritative about type — the server revalidates — so this is a best-effort,
 * JS-typeof-driven guess: whole numbers become `integer` (the common case for keys/ids),
 * other finite numbers become `number`.
 */
export function toTypedValue(value: SemanticValue | undefined): TypedValue {
  if (value === null || value === undefined) {
    return { type: 'null', value: null };
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean', value };
  }
  if (typeof value === 'string') {
    return { type: 'string', value };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`toTypedValue: non-finite number ${value}`);
    }
    return Number.isInteger(value)
      ? { type: 'integer', value: String(value) }
      : { type: 'number', value };
  }
  throw new Error(`toTypedValue: unsupported value ${JSON.stringify(value)}`);
}

/** Unwraps a {@link TypedValue} back to a plain JS value for display or legacy UI-local
 * state. `decimal` stays a string to preserve precision a JS number could lose. */
export function fromTypedValue(tv: TypedValue): SemanticValue {
  switch (tv.type) {
    case 'string':
      return tv.value;
    case 'number':
      return tv.value;
    case 'integer':
      return Number(tv.value);
    case 'decimal':
      return tv.value;
    case 'boolean':
      return tv.value;
    case 'date':
      return tv.value;
    case 'datetime':
      return tv.value;
    case 'null':
      return null;
  }
}

/** Unwraps a {@link TypedValue} to a display string for a grid cell / result table —
 * the "grid adapters unwrap at the edge" half of plan Task 12 item 3. */
export function displayTypedValue(tv: TypedValue): string {
  const value = fromTypedValue(tv);
  return value === null ? '' : String(value);
}

/** Stable id for a client-suggested {@link Fact} — mirrors
 * `InvestigationContextService`'s pre-existing `contextItemId()` scheme (`entity.field=value`)
 * so the same semantic value produces the same id whether it reaches the wire from a grid
 * selection or from the Investigation Context basket. */
export function buildFactId(entity: string, field: string, value: TypedValue): string {
  return `${entity}.${field}=${displayTypedValue(value)}`;
}

/** Builds a wire {@link Fact} from a UI-local semantic value — the "grid adapters wrap at
 * the edge" direction. The browser's suggestion is never authoritative (the server
 * revalidates); `enabled` defaults to `true` since a disabled Investigation Context item is
 * filtered out by the caller before it ever reaches this function. */
export function toFact(
  entity: string,
  field: string,
  value: SemanticValue,
  origin: FactOrigin,
  enabled = true,
  physical?: PhysicalRef,
): Fact {
  const typedValue = toTypedValue(value);
  return {
    id: buildFactId(entity, field, typedValue),
    entity,
    field,
    value: typedValue,
    origin,
    enabled,
    ...(physical ? { physical } : {}),
  };
}
