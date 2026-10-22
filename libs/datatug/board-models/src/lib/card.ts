// Public API entry — see ../public_api.ts.
//
// Standalone project cards (spec/features/project-cards). A project card is
// the same `BoardCard` a dashboard cell holds, plus its own parameters and a
// default display, stored at `cards/<id>/card.json`. Mirrors `Card` in
// datatug-core `pkg/datatug/cards.go` field for field.

import { BoardCard } from './board';
import { WidgetParameterBinding } from './widget-sql';
import { BoardParameterDef } from './widget-parameter';
import { WidgetBase } from './widget-base';

/** The `BoardWidget.name` value for a markdown text widget. */
export const BOARD_WIDGET_NAME_TEXT = 'text' as const;
/** The `BoardWidget.name` value for a one-record label/value widget. */
export const BOARD_WIDGET_NAME_FIELDS = 'fields' as const;

/** How a matched card is shown beside a grid when no session override applies. */
export type CardDisplay = 'panel' | 'tooltip';

/**
 * One rule telling which grid cells feed a card parameter.
 * Exactly one shape: meaning-graph `{entity, field}`, `{table, column}`, or
 * `{column}`. `table`/`column` accept case-insensitive `*`/`?` globs; `table`
 * may be `schema.table` or `table`.
 */
export type CardMatchRule =
  | { entity: string; field: string; table?: never; column?: never }
  | { table: string; column: string; entity?: never; field?: never }
  | { column: string; table?: never; entity?: never; field?: never };

/** A card parameter: the existing parameter definition plus match rules. */
export interface CardParameterDef extends BoardParameterDef {
  match?: CardMatchRule[];
}

/** A standalone project card: `BoardCard` + parameters + display. Never carries a `ref`. */
export interface ProjectCard extends Omit<BoardCard, 'cols' | 'ref'> {
  description?: string;
  parameters?: CardParameterDef[];
  display?: CardDisplay;
}

/** A dashboard cell's reference to a project card, in place of an inline widget. */
export interface BoardCardRef {
  cardId: string;
  /** Binds card parameters to board parameters or constants. */
  parameters?: WidgetParameterBinding[];
}

/** Card ids, also the `cards/<id>/` folder name. */
export const CARD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Lists the project cards (`all_cards`); `cards/<id>/card.json` stores the full card. */
export interface ProjectCardBrief {
  id: string;
  title: string;
  description?: string;
  /** Parameter ids with their match rules, enough to index cell matching without loading every card. */
  parameters?: Pick<CardParameterDef, 'id' | 'type' | 'isRequired' | 'match'>[];
  display?: CardDisplay;
}

/**
 * A widget data source that reads rows from a card parameter instead of a
 * saved query (data cards). A `record` parameter yields one row; a
 * `recordset` parameter yields rows.
 */
export interface ParameterRowsSource {
  parameter: string;
}

/** `text` widget data: markdown (raw HTML disabled) with `{{parameterId}}` / `{{parameterId.column}}` placeholders substituted as text after parsing. */
export interface TextWidgetDef extends WidgetBase {
  markdown: string;
}

/** `fields` widget data: one record as label/value pairs. */
export interface FieldsWidgetDef extends WidgetBase {
  /** A saved query (first row is used) or a `record` parameter. */
  source: { queryId: string; parameters?: WidgetParameterBinding[] } | ParameterRowsSource;
  /** Columns to show in order; all columns when omitted. */
  fields?: { column: string; label?: string }[];
}
