// Public API entry — see ../public_api.ts.

import { WidgetBase } from './widget-base';

/** The `BoardWidget.name` value that selects {@link SQLWidgetDef} (boards.go `QueryTypeSQL`). */
export const BOARD_WIDGET_NAME_SQL = 'SQL' as const;

/**
 * Mirrors `SQLWidgetSettings` (boards.go) field for field.
 *
 * Binds a SQL widget to a query in the project's query library. It carries
 * no query text and no execution target of its own: the text and the target
 * come from the referenced `QueryDef` (query.go), and the environment is the
 * viewer's choice at view time. Founder ruling 2026-09-09 ("I'm Ok with the
 * suggested option 1"). The field shape here is the coding agent's design,
 * not the founder's — see this package's README "Open questions" section.
 */
export interface SQLWidgetSettings {
  /** References a `QueryDef` (query.go) by id within the same project. */
  queryId: string;
  /** Binds the referenced query's parameters. */
  parameters?: WidgetParameterBinding[];
}

/**
 * Mirrors `WidgetParameterBinding` (boards.go) field for field.
 *
 * Binds one parameter of the referenced query to either a constant `value`
 * or one of the board's own parameters (`boardParameterId`). Neither being
 * set is valid and means "use the query parameter's own default"
 * (`BoardParameterDef.defaultValue`). `value` and `boardParameterId` are
 * mutually exclusive.
 */
export interface WidgetParameterBinding {
  /** The id of the referenced query's parameter. */
  id: string;
  /** A constant value for the parameter, e.g. recorded by "pin this result to a board". */
  value?: unknown;
  /** Takes the value from the board parameter with this id. */
  boardParameterId?: string;
}

/** Mirrors `SQLWidgetDef` (boards.go) field for field: `WidgetBase` inlined + `sql`. */
export interface SQLWidgetDef extends WidgetBase {
  sql: SQLWidgetSettings;
}
