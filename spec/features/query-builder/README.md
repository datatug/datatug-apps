# Feature: Query Builder

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/query-builder?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/query-builder?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/query-builder?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/query-builder?op=request-change) |
**Status:** Under Review
**Date:** 2026-06-05
**Owner:** alexander.trakhimenok
**Source Ideas:** —
**Supersedes:** —
**Implements:** specscore:feature/serve-brokered-query-builder@github.com/datatug/datatug
**Grade:** A

## Summary

The **Web Implementation** of the Serve-Brokered AI Query Builder Capability (`specscore:feature/serve-brokered-query-builder@github.com/datatug/datatug`): the web screen where a user *views and edits* the current query that a terminal AI-agent is building, with results, history, and tabs. The screen reads and writes the query through the [`ai-terminal-query-builder`](../ai-terminal-query-builder/README.md) comms layer and adapts to the tab's **mode**: in **DTQL mode** it offers point-and-click edit controls over the dalgo AST (viewable as DTQL-YAML or rendered native query); in **native mode** it shows the connection's native query text in an editable text area. It also presents the live results, change history with revert, candidate-option previews, parameter inputs, an Auto-run/Run control, and tabs — and deliberately contains **no AI-chat/prose input**, because the conversation lives in the terminal. This Feature specifies the Web-specific surface; platform-agnostic behavior is inherited from the Capability it `**Implements:**`.

## Problem

In the serve-brokered architecture the conversation happens in the user's AI-agent terminal, but the user still needs a rich place to *see* the query and results and to make precise, fiddly edits by hand (toggle a filter, drop a column) that are faster than asking the agent. The Web Implementation is that place. It must present one live query brokered by the local daemon, let the user edit it deterministically and revert through its history, compare the agent's candidate options by their results, and switch between named-query tabs — all without re-introducing the chat panel this architecture exists to remove. Without this screen, the daemon and comms layer have no human-facing surface.

## Behavior

This Implementation inherits the Capability's requirements; the requirements below specify the Web screen. All backend communication is delegated to [`ai-terminal-query-builder`](../ai-terminal-query-builder/README.md).

### Screen and attachment

#### REQ: builder-screen

The web app MUST expose a dedicated query-builder view that, when opened from the agent's deep link, attaches (via the comms layer) to that tab and displays its current query and results. The view MUST present the tabs of available named queries and let the user switch between them.

#### REQ: no-chat-panel

The view MUST NOT include an AI-chat or natural-language/prose request input. All in-view editing is through deterministic controls; the conversational surface is the terminal, not this screen.

### Query and results

#### REQ: query-visible

The view MUST show the current query's definition and indicate the tab's mode. In DTQL mode it MUST be viewable in DTQL-YAML (the dalgo form) and in the rendered native query form; in native mode it MUST show the native query text. The display MUST stay in sync with the live current query each change.

#### REQ: results-grid

When the current query executes, the view MUST render results in the app's interactive data grid, honoring a user-configurable row limit (default 1000) with "load next N" and "load all" controls rather than page numbers.

#### REQ: execution-mode-control

The view MUST present an **Auto-run** checkbox and an explicit **Run** button. When Auto-run is checked, a changed current query executes and results refresh automatically; when unchecked, the changed query MUST NOT execute until the user activates Run. The default is **Auto-run checked**, visible in the UI.

### Deterministic editing

#### REQ: deterministic-controls

In DTQL mode the view MUST provide point-and-click controls to add/remove/select fields/columns, add/remove row filters, change ordering, and select nested/sub-collections, each issued as a structured edit through the comms layer (never as prose).

#### REQ: native-text-editor

In native mode the view MUST present the tab's native query text in an editable text area and submit the edited text verbatim through the comms layer. This is query-language text, not chat prose: no natural-language instruction is sent for interpretation.

#### REQ: parameter-inputs

The view MUST present inputs for the tab's named parameters in both modes and submit their values (bound at execution) through the comms layer.

#### REQ: history-and-revert

The view MUST display the in-page change history (the running list of prose change-descriptions from the comms layer) and MUST let the user revert to any prior step, which makes that version the current query (via the comms layer).

### Disambiguation

#### REQ: option-preview

When the agent offers multiple candidate options for the tab, the view MUST present them and let the user preview each option's results — lazily when Auto-run is checked, otherwise via Run — and commit one as the current query, discarding the rest.

### Failure surfacing

#### REQ: error-surfacing

The view MUST surface error states from the comms layer (daemon unreachable, invalid/used link code, dropped connection) and the daemon's refusals (e.g. a read-only/mutation refusal) without presenting stale data as if live.

## Interaction with Other Features

| Feature | Interaction |
|---|---|
| [ai-terminal-query-builder](../ai-terminal-query-builder/README.md) | Dependency. This screen performs all daemon communication (attach, subscribe, edit, revert, run, options) through that comms layer. |
| Capability `serve-brokered-query-builder@github.com/datatug/datatug` | This Feature is its Web Implementation (the matrix's Web row). |
| Daemon `serve-brokered-query-builder@github.com/datatug/datatug-cli` | The server the comms layer connects to; this screen never talks to it directly. |

## Acceptance Criteria

### AC: open-and-show-tab (verifies REQ:builder-screen)

**Given** a deep link from the agent for a tab
**When** the user opens the query-builder view
**Then** the view attaches to that tab, shows its current query and results, and presents tabs the user can switch between.

### AC: no-prose-input-present (verifies REQ:no-chat-panel)

**Given** the query-builder view is open
**When** the user inspects its controls
**Then** there is no AI-chat or natural-language request input — only deterministic editing controls.

### AC: query-viewable-both-forms (verifies REQ:query-visible)

**Given** a `dtql`-mode tab with a non-empty current query
**When** the user views the query panel
**Then** the panel indicates DTQL mode and the query can be viewed in DTQL-YAML and rendered native forms, in sync with the live current query; and for a `native`-mode tab the panel indicates native mode and shows the native query text.

### AC: results-grid-limited (verifies REQ:results-grid)

**Given** an executed query whose result set exceeds the row limit
**When** results are rendered
**Then** they appear in the app's data grid with at most the configured limit (default 1000) and "load next N" / "load all" controls.

### AC: autorun-and-run (verifies REQ:execution-mode-control)

**Given** the query-builder view
**When** the user toggles the Auto-run checkbox and changes the query
**Then** with Auto-run checked the results refresh automatically, and with it unchecked the query executes only when the user clicks Run; Auto-run is checked by default.

### AC: deterministic-edit-issued (verifies REQ:deterministic-controls)

**Given** a `dtql`-mode tab with a current query
**When** the user adds a filter via the controls
**Then** a structured edit is issued through the comms layer and the current query updates — with no prose involved.

### AC: native-text-edit-issued (verifies REQ:native-text-editor)

**Given** a `native`-mode tab shown in the view
**When** the user edits the native query text and submits it
**Then** the edited text is sent verbatim through the comms layer and becomes the current query, with no natural-language interpretation.

### AC: parameter-values-submitted (verifies REQ:parameter-inputs)

**Given** a tab declaring a named parameter, in either mode
**When** the user enters a parameter value and runs the query
**Then** the value is submitted through the comms layer and bound at execution.

### AC: revert-from-history (verifies REQ:history-and-revert)

**Given** the view showing a change history of several steps
**When** the user reverts to an earlier step
**Then** that version becomes the current query via the comms layer.

### AC: options-previewed-and-committed (verifies REQ:option-preview)

**Given** the agent offered multiple candidate options for the tab
**When** the user previews each option's results and commits one
**Then** the chosen option becomes the current query and the others are discarded.

### AC: errors-surfaced (verifies REQ:error-surfacing)

**Given** the view attached to a tab
**When** the daemon becomes unreachable or refuses a mutation request
**Then** the view surfaces the error/refusal and does not present stale data as live.

## Rehearse Integration

Every AC has a concrete UI surface (view route, panels, grid, controls, error states) and is testable with the app's component/e2e tooling. Stub scaffolding under `_tests/` is deferred to the Plan/Implement phase so the stub set tracks the final task breakdown, consistent with the `ai-query-builder` web Implementation in this repo.

## Not Doing / Out of Scope

- Backend communication mechanics — owned by [ai-terminal-query-builder](../ai-terminal-query-builder/README.md).
- An AI-chat/prose panel — explicitly excluded (REQ:no-chat-panel); the conversation is in the terminal.
- The terminal agent and its query construction — owned by the `query-builder` skill in `datatug-ai-skills`.
- Persisting history across reloads — in-page only; the comms layer rehydrates current state from the daemon.
- Switching a tab's mode — `dtql`→`native` conversion is an agent/daemon operation; this screen reflects the tab's mode and never parses native text back into the AST.
- Which refinement operations are guaranteed vs unsupported — an agent/skill concern; this screen renders and edits whatever valid read-only query the tab holds.

## Open Questions

- Where does the builder view live in the app's navigation, and can it open standalone (deep-link target) as well as inside the main shell?
- How are tabs surfaced when several were created across different agent sessions against the same daemon — all visible, or only those from the current link?

---
*This document follows the https://specscore.md/feature-specification*
