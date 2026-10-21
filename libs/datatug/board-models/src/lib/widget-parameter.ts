// Public API entry — see ../public_api.ts.
//
// `WidgetBase.Parameters` (boards.go) is typed `Parameters` (`[]ParameterDef`),
// but `ParameterDef` itself is declared in `parameters.go`, and its `Meta`
// field references `EntityFieldRef` from `entities.go` — both outside this
// package's ONLY-the-board-model-types scope (see the brief / README).
// `BoardParameterDef` / `BoardParameterFieldRef` below are a minimal,
// self-contained field-for-field copy of just enough of that shape to keep
// widget defs faithful. If a `@datatug/parameter-models` (or similar)
// package is published later, this should be replaced with an import from
// it rather than kept as a second copy.

import { ParameterLookup } from './parameter-lookup';

/** Field-for-field copy of `EntityFieldRef` (entities.go), scoped to widget parameters. */
export interface BoardParameterFieldRef {
  entity: string;
  field: string;
}

/** Field-for-field copy of `ParameterDef` (parameters.go), scoped to widget parameters. */
export interface BoardParameterDef {
  id: string;
  type: string;
  title?: string;
  defaultValue?: unknown;
  isRequired?: boolean;
  isMultiValue?: boolean;
  maxLength?: number;
  minLength?: number;
  meta?: BoardParameterFieldRef;
  lookup?: ParameterLookup;
}

/** Raw board JSON admission for the owning ParameterDef shape (parameters.go).
 * Definitions declare inputs; they are not WidgetParameterBinding query bindings.
 * Core does not require distinct declaration IDs or constrain unknown type names.
 */
export function validBoardParameterDefinitions(
  value: unknown,
): value is BoardParameterDef[] | null | undefined {
  const record = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === 'object' && !Array.isArray(item);
  const fields = (item: Record<string, unknown>, allowed: readonly string[]) =>
    Object.keys(item).every((key) => allowed.includes(key));
  const optionalString = (item: unknown) =>
    item == null || typeof item === 'string';
  return (
    value == null ||
    (Array.isArray(value) &&
      value.every((item) => {
        if (
          !record(item) ||
          !fields(item, [
            'id',
            'type',
            'title',
            'defaultValue',
            'isRequired',
            'isMultiValue',
            'maxLength',
            'minLength',
            'meta',
            'lookup',
          ]) ||
          typeof item['id'] !== 'string' ||
          !item['id'] ||
          typeof item['type'] !== 'string' ||
          !item['type'] ||
          !optionalString(item['title']) ||
          ['isRequired', 'isMultiValue'].some(
            (key) => item[key] != null && typeof item[key] !== 'boolean',
          ) ||
          ['maxLength', 'minLength'].some(
            (key) => item[key] != null && !Number.isSafeInteger(item[key]),
          )
        )
          return false;
        const meta = item['meta'];
        if (
          meta != null &&
          (!record(meta) ||
            !fields(meta, ['entity', 'field']) ||
            !optionalString(meta['entity']) ||
            !optionalString(meta['field']))
        )
          return false;
        const lookup = item['lookup'];
        if (
          lookup != null &&
          (!record(lookup) ||
            !fields(lookup, ['db', 'sql', 'keyFields']) ||
            !optionalString(lookup['db']) ||
            !optionalString(lookup['sql']) ||
            (lookup['keyFields'] != null &&
              (!Array.isArray(lookup['keyFields']) ||
                !lookup['keyFields'].every((key) => typeof key === 'string'))))
        )
          return false;
        const fallback = item['defaultValue'];
        if (fallback == null) return true;
        switch (item['type']) {
          case 'string':
            return typeof fallback === 'string';
          case 'number':
            return typeof fallback === 'number' && Number.isFinite(fallback);
          case 'boolean':
            return typeof fallback === 'boolean';
          // Core's JSON-safe integer/bit contract preserves exact values only.
          case 'integer':
          case 'bit':
            return Number.isSafeInteger(fallback);
          default:
            return true;
        }
      }))
  );
}
