---
format: https://specscore.md/feature-specification
status: Approved
---

# Feature: AI Query Builder

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/ai-query-builder?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/ai-query-builder?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/ai-query-builder?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/ai-query-builder?op=request-change) |

**Status:** Approved
**Date:** 2026-06-04
**Owner:** alexander.trakhimenok
**Source Ideas:** —
**Supersedes:** —
**Implements:** specscore:feature/ai-query-builder@github.com/datatug/datatug
**Grade:** A

## Summary

The **Web Implementation** of the AI Query Builder Capability (`specscore:feature/ai-query-builder@github.com/datatug/datatug`): an in-app web view where a user seeds and progressively refines a read-only query from natural language. The current query's SQL is shown in an always-visible panel, results render in the web app's interactive data grid, and execution is governed by an **Auto-run** checkbox with an explicit **Apply/Run** button for manual mode. This Feature specifies only the Web-specific surface and its deltas from the Capability; all platform-agnostic behavior is inherited from the Capability it `**Implements:**`.

## Problem

The AI Query Builder Capability defines *what* a conversational query builder must do on every surface. The web app needs a concrete realization that fits a browser UI: a chat-style request input, a rendered SQL panel, a data grid for results, and visible controls for execution mode — reusing the web app's existing connection selector and result-grid components rather than inventing new ones. Per the source Idea, the web surface follows the CLI; this spec pins its intended contract so it can be built to a target instead of improvised.

## Behavior

This Implementation inherits every Capability requirement (`session-source-binding`, `current-query-state`, `nl-seed`, `nl-transformation-delta`, `query-inspectable`, `execution-mode-toggle`, `results-visible`, `read-only-queries`, `unresolvable-request`). The requirements below specify only the Web-specific surface and the MVP limitations.

### Web surface

#### REQ: web-builder-view

The web app MUST expose the builder as a dedicated view (route) in which the data source is selected via the app's existing connection/environment selector **before** the first request, and natural-language requests are entered through a chat-style input, one request at a time.

#### REQ: web-query-panel

The view MUST show the current query's generated SQL in a dedicated, always-visible panel, kept in sync with the current query each turn — this is how the web app realizes the Capability's `query-inspectable` requirement.

#### REQ: web-results-grid

When the current query executes, the view MUST render its results in the web app's interactive data grid (the existing sortable/scrollable result table component), not a bespoke renderer.

### Execution mode in the UI

#### REQ: web-execution-mode-control

The view MUST realize the Capability's auto-run / manual-apply toggle as an **Auto-run** checkbox (switch). When Auto-run is checked, a changed current query executes and the results refresh automatically. When it is unchecked (manual-apply), the changed query MUST NOT execute until the user activates an explicit **Apply/Run** button or its equivalent keyboard shortcut. The view's default is **Auto-run checked**, and this default MUST be visible in the UI.

### MVP operation coverage

#### REQ: web-operation-coverage

Against a single source, the web builder MUST support, end to end, these transformations: seeding a query, adding or removing a column, adding or removing a row filter, and changing ordering or row limit. Operations requiring cross-source or computed columns (e.g. an exchange-rate column) and anti-join filters (e.g. "hide users who made an order") are NOT guaranteed in this MVP; such a request MUST be handled under the Capability's `unresolvable-request` rule — surfaced in the UI as an explicit unsupported-operation notice, leaving the current query unchanged — rather than silently producing an incorrect query. This is the `Partial` parity recorded in the Capability's Implementation Matrix.

## Acceptance Criteria

### AC: open-builder-view (verifies REQ:web-builder-view)

**Given** the web app with a connection selected in the builder view's source selector
**When** the user opens the AI query-builder view and submits the first natural-language request
**Then** an interactive session is established against that connection and the chat input accepts further requests one at a time.

### AC: sql-panel-in-sync (verifies REQ:web-query-panel)

**Given** an active builder view with a non-empty current query
**When** a turn completes
**Then** the SQL panel displays the current query's generated SQL, updated to match the latest turn, separately from the results grid.

### AC: results-in-grid (verifies REQ:web-results-grid)

**Given** a current query that executes successfully
**When** results are returned
**Then** they are rendered in the web app's interactive data grid.

### AC: autorun-checkbox-and-apply (verifies REQ:web-execution-mode-control)

**Given** the builder view
**When** the user inspects the execution controls and unchecks the Auto-run checkbox
**Then** an Auto-run checkbox is present and checked by default, and in manual mode an Apply/Run button with a documented keyboard shortcut is presented to execute the pending query.

(The defer-until-apply and auto-execute-on-change *behaviors* are verified by the Capability's `AC:manual-mode-defers-execution` and `AC:auto-run-executes-on-change`; this AC verifies only the Web controls that bind to those modes.)

### AC: simple-refinements-work-web (verifies REQ:web-operation-coverage)

**Given** a builder view seeded with "show the last 10 users who logged in" against one connection
**When** the user says "add a column for country" then "only users created this year" then "order by created date"
**Then** each transformation is applied to the current query and the refined query runs against that single source.

### AC: complex-op-notice-web (verifies REQ:web-operation-coverage)

**Given** a current query over a users source with no exchange-rate data available in that source
**When** the user asks "add a column showing the exchange rate of the user's primary currency to EUR"
**Then** the view shows an explicit unsupported-operation notice and leaves the current query unchanged, rather than rendering an incorrect query.

## Rehearse Integration

Every AC has a concrete UI surface (a view/route, a chat input, an SQL panel, a results grid, an Auto-run checkbox and Apply button, an unsupported-operation notice), so all six are testable via browser/DOM selectors — none skipped as subjective. Stub scaffolding under `_tests/` is deferred to the Plan/Implement phase so the stub set tracks the final task breakdown rather than being authored twice, consistent with the CLI Implementation and the upstream `capability-and-platform-implementations` Feature.

## Not Doing / Out of Scope

- Cross-source joins and computed columns, and anti-join filters — explicitly `Partial` for this MVP (REQ:web-operation-coverage); the Capability does not require them cross-surface.
- A visual point-and-click (no-chat) query builder — this Implementation is the conversational refinement loop; a drag-and-drop builder is a separate Feature.
- Real-time multi-user collaborative editing of the same session — single-user session for MVP.
- Choice of LLM provider and where the model is called from (server proxy vs client) — an implementation/config detail resolved at Plan/Implement time (see Open Questions).
- Mutating/DDL queries — refused per the Capability's `read-only-queries` requirement.

## Open Questions

- Which web app / Nx library hosts the view, and how does it slot into the existing DataTug app navigation?
- Which LLM provider does the MVP use, and is the model invoked via a server-side proxy or directly from the browser (credential exposure)?
- What is the keyboard shortcut bound to Apply/Run in manual-apply mode?

---
*This document follows the https://specscore.md/feature-specification*
