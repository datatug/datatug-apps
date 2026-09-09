// Public API entry — see ../public_api.ts.

import { BoardParameterDef } from './widget-parameter';

/**
 * Mirrors `WidgetBase` (boards.go) field for field. In Go this is embedded
 * (anonymous) in each widget def struct, which inlines its JSON fields into
 * the parent object — modelled here with `extends` on each widget def so the
 * TS shape matches the JSON shape exactly.
 */
export interface WidgetBase {
  title?: string;
  parameters?: BoardParameterDef[];
}
