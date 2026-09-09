// Public API entry — see ../public_api.ts.

import { WidgetBase } from './widget-base';

/** The `BoardWidget.name` value that selects {@link SQLWidgetDef} (boards.go `QueryTypeSQL`). */
export const BOARD_WIDGET_NAME_SQL = 'SQL' as const;

/** Mirrors `SQLWidgetSettings` (boards.go) field for field. */
export interface SQLWidgetSettings {
  query: string;
}

/** Mirrors `SQLWidgetDef` (boards.go) field for field: `WidgetBase` inlined + `sql`. */
export interface SQLWidgetDef extends WidgetBase {
  sql: SQLWidgetSettings;
}
