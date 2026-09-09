// Public API entry — see ../public_api.ts.

import { WidgetBase } from './widget-base';
import { BoardParameterDef } from './widget-parameter';

/** The `BoardWidget.name` value that selects {@link HTTPWidgetDef} (boards.go `QueryTypeHTTP`). */
export const BOARD_WIDGET_NAME_HTTP = 'HTTP' as const;

/** Mirrors `HTTPHeaderItem` (boards.go) field for field. */
export interface HTTPHeaderItem {
  name: string;
  value: string;
}

/** Mirrors `HTTPRequest` (boards.go) field for field. */
export interface HTTPRequest {
  method: string;
  url: string;
  protocol?: string;
  headers?: HTTPHeaderItem[];
  /** In milliseconds. */
  timeoutThresholdMs?: number;
  parameters?: BoardParameterDef[];
  content?: string;
}

/** Mirrors `HTTPWidgetDef` (boards.go) field for field: `WidgetBase` inlined + `request`. */
export interface HTTPWidgetDef extends WidgetBase {
  request: HTTPRequest;
}
