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
