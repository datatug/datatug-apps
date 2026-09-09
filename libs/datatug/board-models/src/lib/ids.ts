// Public API entry — see ../public_api.ts.

/**
 * A board's own id (`Board.id` / `ProjItemBrief.ID` in `boards.go` via the
 * embedded `ProjectItem`). Alias only — the Go field is a plain `string`.
 */
export type BoardId = string;

/**
 * A card's id within a board (`BoardCard.ID` in `boards.go`). Alias only —
 * the Go field is a plain `string`.
 */
export type BoardCardId = string;
