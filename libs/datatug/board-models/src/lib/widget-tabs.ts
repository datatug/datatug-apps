// Public API entry — see ../public_api.ts.

import { BoardWidget } from './board-widget';
import { WidgetBase } from './widget-base';

/** Mirrors `TabWidget` (boards.go) field for field. */
export interface TabWidget {
  /** Stable identity for newly authored tabs; legacy saved tabs may omit it. */
  id?: string;
  title: string;
  /** Legacy single widget; still read. */
  widget?: BoardWidget;
  /** Several widgets stacked in the tab, each with optional `WidgetBase.title`. */
  widgets?: BoardWidget[];
}

/** Mirrors `TabsWidgetDef` (boards.go) field for field: `WidgetBase` inlined + `tabs`. */
export interface TabsWidgetDef extends WidgetBase {
  tabs: TabWidget[];
}
