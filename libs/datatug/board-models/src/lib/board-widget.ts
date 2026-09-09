// Public API entry — see ../public_api.ts.

import { BOARD_WIDGET_NAME_HTTP } from './widget-http';
import { BOARD_WIDGET_NAME_SQL } from './widget-sql';

/** The `BoardWidget.name` value that selects {@link TabsWidgetDef} (boards.go literal `"tabs"`). */
export const BOARD_WIDGET_NAME_TABS = 'tabs' as const;

/**
 * The widget kinds `boards.go`'s `BoardWidget.Validate()` currently
 * recognizes. Not exhaustive by the Go *type* (`BoardWidget.Name` is a plain
 * `string`, and an unrecognized value is a validation error, not a type
 * error) — kept here purely as a documented convenience union, distinct from
 * {@link BoardWidget.name} itself, which stays `string` to match the Go
 * field type exactly.
 */
export type BoardWidgetName =
  | typeof BOARD_WIDGET_NAME_SQL
  | typeof BOARD_WIDGET_NAME_HTTP
  | typeof BOARD_WIDGET_NAME_TABS;

/**
 * Mirrors `BoardWidget` (boards.go) field for field. `data` stays `unknown`
 * (Go: `interface{}`) — which concrete shape it holds depends on `name`; see
 * {@link SQLWidgetDef}, {@link HTTPWidgetDef}, {@link TabsWidgetDef} for the
 * shapes `boards.go` currently switches on.
 */
export interface BoardWidget<TData = unknown> {
  name: string;
  data?: TData;
}
