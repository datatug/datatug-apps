// Public API entry — see ../public_api.ts.

import { BoardWidget } from './board-widget';
import { BoardCardId, BoardId } from './ids';

/**
 * Mirrors `Board` (boards.go) field for field, JSON-shape only.
 *
 * `Board` embeds `ProjectItem` → `ProjItemBrief` → `ListOfTags`
 * (proj_item.go, tag.go), which Go's JSON encoder inlines (anonymous
 * embedding) into the same object `rows` sits in. `id`/`title`/`folder`/
 * `tags`/`userIds`/`access` below are that inlined shape, flattened directly
 * onto `Board` rather than reproduced as a separate, importable
 * `ProjectItem`/`ProjItemBrief`/`ListOfTags` hierarchy — that generic
 * project-item system (shared by every DataTug item kind, not just boards)
 * is out of scope for this package; see the README's "Scope boundary".
 *
 * `id` and `title` are required here because `Board.Validate()` always calls
 * `ValidateWithOptions(true)` (title required); everything else carries the
 * Go struct's own `omitempty`.
 */
export interface Board {
  id: BoardId;
  title: string;
  /** TODO(boards.go): "Document what is Folder? should it be moved somewhere?" — carried as-is. */
  folder?: string;
  tags?: string[];
  userIds?: string[];
  access?: 'private' | 'protected' | 'public';
  rows?: BoardRow[];
}

/** Mirrors `BoardRow` (boards.go) field for field. */
export interface BoardRow {
  minHeight?: string;
  maxHeight?: string;
  cards?: BoardCard[];
}

/** Mirrors `BoardCard` (boards.go) field for field. */
export interface BoardCard {
  id: BoardCardId;
  title: string;
  /** How many of the 12 available grid columns this card spans. */
  cols?: number;
  widget?: BoardWidget;
}
