---
format: https://specscore.md/feature-specification
status: Approved
---

# Feature: Project cards

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/project-cards?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/project-cards?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/project-cards?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/project-cards?op=request-change) |
**Status:** Approved

**Source Ideas:** —

## Summary

Save a dashboard card as a standalone, parameterised project card; reference it from dashboards; and show the matching card beside a grid when the user selects a cell (for example a `CustomerID` on an orders list), with cached results.

## Problem

Dashboard cards (`BoardCard`) already present data through grid, chart, HTTP and tabs widgets bound to saved queries, but they exist only inline inside one board. Users cannot reuse a card, cannot give it inputs of its own, and get no presentation of a related record while browsing data: selecting a `CustomerID` cell shows a raw value, not the customer.

## Behavior

### REQ: one-card-model

A standalone card is the existing `BoardCard` shape (`id`, `title`, `widget`) plus `description`, `parameters` (existing `BoardParameterDef` plus `match`) and optional `display` (`panel` default, or `tooltip`). Dashboards and standalone cards share one model, one renderer (`board-card` / `board-widget`), one parameter-binding mechanism (`WidgetParameterBinding`) and one result cache class (`BoardQueryResults`, see REQ: result-cache). There is no second card renderer. Cards inherit the project's access; they carry no `access`/`userIds` of their own.

### REQ: card-kinds

A card whose widgets bind to saved queries fetches its own data (query card). A widget may instead take its rows from a card parameter (`source: {parameter: <id>}`), so a card whose widgets all read parameters renders only supplied data (data card). Parameter types `record` (one row object) and `recordset` (row array) carry supplied data. Saved-query bindings stay scalar: a query parameter binds to a scalar card parameter, a board parameter or a constant, never to a record.

### REQ: tabs-and-components

The tabs widget's tab holds `widgets[]` in addition to the legacy single `widget`, which still loads; each widget may carry the existing `WidgetBase.title`. A tabs widget with exactly one tab renders no tab strip. Two widget kinds join the shared registry: `text` and `fields` (one record as label/value pairs, from a saved query's first row or a `record` parameter). Dashboards gain all of these.

### REQ: safe-text

`text` renders markdown with raw HTML disabled. `{{parameterId}}` and `{{parameterId.column}}` placeholders are substituted after parsing, as text nodes, so a value can never become markup, a link or an image. Only `http`, `https` and `mailto` link targets render as links; other targets render as plain text. Images do not render.

### REQ: validators-and-go-parity

Every validator that admits board JSON accepts the new shapes and keeps rejecting unknown keys: the hosted definition validator (`ref` on cards; `widgets` on tabs; `text`/`fields` widgets), presentation validation, and parameter-definition validation (`match` on card parameters only). A dedicated card validator admits `cards/<id>/card.json`. Go `datatug-core` mirrors the model: a `Card` type with `Validate()`, `BoardCard.Ref`, `TabWidget.Widgets`, the `text` and `fields` widget names decoded strictly, and `BoardCard.Validate` accepting exactly one of `widget` or `ref`. A Go JSON round-trip preserves every new field.

### REQ: project-storage

Cards are stored in the DataTug project like dashboards: `cards/<id>/card.json`; the flat `cards/<id>.card.json` is also read, the folder form wins when both exist, and writes always use the folder form. Card ids match `^[A-Za-z0-9_-]{1,128}$`. Cards are read and written through every backend boards use: the local agent (`/cards/all_cards`, `/cards/card`, `/cards/create_card`, `/cards/save_card`, `/cards/delete_card`), the hosted shared-asset API (asset kind `card`), and the GitHub reader (read-only). `all_cards` returns `ProjectCardBrief` rows including each parameter's `id`, `type`, `isRequired` and `match`, so matching never loads every card.

### REQ: dashboard-reference

A dashboard cell carries exactly one of an inline `widget` or `ref: {cardId, parameters: WidgetParameterBinding[]}`. A reference resolves the project card and renders it through the same renderer, binding card parameters to board parameters or constants. References appear only on dashboard cells, never inside a card, so cards cannot cycle. An unresolved reference renders "Card not found: <id>" in the cell. "Save as project card" on an inline card of a writable board creates a card whose parameters are copies of the board parameters its widgets bind, with the same ids; the cell becomes a `ref` binding each of them to the same board parameter. The card id is the slugified title, suffixed `-2`, `-3`… on collision.

### REQ: input-matching

A card parameter may declare `match` rules. A rule is exactly one of: meaning-graph `{entity, field}`; `{table, column}`; or `{column}`. Malformed rules are ignored, never fatal. `table` and `column` accept case-insensitive `*`/`?` globs. Table names are compared after stripping `[]`, `""` and backtick quoting; when either side has no schema the comparison ignores schema. A selected cell identity is its physical table and column plus, when known, the meaning-graph `entity.field` (semantic column mapping first, else the foreign key's referenced table and column). Only required parameters' rules match. Matches rank: entity.field; exact table+column; table/column glob; exact column only; column glob only. Ties order by title, then id.

### REQ: cell-to-card

Selecting a non-null, non-empty cell in the table viewer or in query results looks up matching cards after a 150 ms debounce; a newer selection cancels the older lookup and its unshared in-flight queries. The cell value binds to the matched parameter; a `record` parameter, if declared, receives the selected row. Required parameters still unbound show an inline input form in the card instead of querying. With one match the card renders; with several, a switcher lists them in rank order. In the table viewer the card renders at the top of the existing context side panel; in query results a side pane opens. A card whose `display` is `tooltip` renders as a compact popover anchored at the selected cell showing its first tab, with "Open in panel"; it opens on selection (mouse, touch or keyboard) and closes on Escape or selection change. The panel offers a session override between panel and tooltip. No match shows nothing extra.

### REQ: card-states

Every card render has visible states: loading (skeleton per widget), query error (message plus retry), empty result ("No data"), missing saved query ("Query not found: <id>"), unsupported widget kind ("Unsupported widget: <name>"), and missing input form. A failing widget never blanks sibling widgets.

### REQ: result-cache

`BoardQueryResults` gains configurable bounds (entries, bytes, time-to-live) and an injectable clock. Dashboards keep a component-scoped instance with today's bounds (12 runs, 8 MB, no expiry). Cards beside grids share one project-scoped instance bounded at 200 entries, 32 MB and 5 minutes, least recently used evicted first. The key is the scope (actor, project, environment) plus the saved query id, its revision when the backend supplies one, and the bound parameters canonicalised as JSON with sorted keys, preserving value types (`"42"` and `42` differ; `null` is explicit; unset parameters are omitted). An in-flight run is shared by every requester of its key. Completed results stay cached when their last viewer leaves; an in-flight run is aborted only when no requester remains. The panel's refresh action invalidates the shown card's keys. A scope change never serves another scope's entries.

### REQ: cards-pages

The project menu shows a "Cards" item placed alphabetically among the existing project menu items. Cards list → New card → card page → Save → reload shows the saved card. The card page has a structured builder (title, description, parameters with match rules, display, widgets/tabs using the dashboard card editors) beside a live preview with parameter inputs, plus a JSON view. Read-only projects and save failures show the list and preview without save affordances or with the backend's error, respectively. Deleting a card asks for confirmation.

## Acceptance Criteria

### AC: customer-card-from-orders

Given a project containing a `customer` card whose required `customerId` parameter matches `{column: "CustomerID"}`, when the user selects a `CustomerID` cell in an orders grid, then the customer card renders in the side panel with that value bound; selecting another row of the same customer issues no second query; selecting a NULL `CustomerID` shows no card.

### AC: matching-rank

Given cards matching a cell by entity.field, by table+column, by glob, by exact column and by column glob, and one card matching only through an optional parameter, when the cell is selected, then the switcher lists the first five in that order and omits the optional-only card; malformed rules do not prevent other cards from matching.

### AC: missing-input

Given a matched card with a second required parameter that the cell cannot supply, when it renders, then it shows an input form for that parameter and issues no query until it is filled.

### AC: shared-renderer

Given a dashboard cell referencing `customer` with a board parameter binding, when the dashboard renders, then the card renders through the same `board-card` component as the side panel, and a missing card shows "Card not found: customer".

### AC: tabs-text-fields

Given a one-tab tabs widget with `widgets[]` holding `text` and `fields`, when it renders, then no tab strip shows, both widgets render with their titles, and a parameter value `](javascript:alert(1))` renders as literal text.

### AC: validators

Given board and card JSON using `ref`, `widgets`, `text`, `fields` and `match`, when validated in TypeScript and round-tripped through Go, then they are admitted and preserved, and an unknown key is still rejected.

### AC: storage-round-trip

Given the local agent, when a card is created, saved, listed, read and deleted through `/cards/*`, then `cards/<id>/card.json` is written and removed and an invalid id is rejected; the GitHub reader lists and reads the demo project's `customer` card.

### AC: cache-bounds

Given the card result cache with an injected clock, when entries exceed 200 or 32 MB, become older than 5 minutes, or refresh is pressed, then they are evicted or refetched; parameters `"42"` and `42` are distinct keys; keys from another project or environment never hit.

## Open Questions

None at this time.

---

_This document follows the https://specscore.md/feature-specification_
