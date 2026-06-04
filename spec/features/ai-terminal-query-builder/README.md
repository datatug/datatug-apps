# Feature: AI-Terminal Query Builder

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/ai-terminal-query-builder?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/ai-terminal-query-builder?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/ai-terminal-query-builder?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/ai-terminal-query-builder?op=request-change) |
**Status:** Approved
**Date:** 2026-06-05
**Owner:** alexander.trakhimenok
**Source Ideas:** —
**Supersedes:** —
**Grade:** A

## Summary

The web-side **communication layer** between the DataTug Web UI and the local DataTug DAL backend daemon (`datatug serve` + the serve-brokered query-builder broker). It ingests the deep link the terminal AI-agent produces, exchanges the one-time code for a session token, connects to the local daemon over HTTP (commands) and WebSocket (live updates), and brokers the query-builder protocol for the [`query-builder`](../query-builder/README.md) screen: subscribing to the tab's live current query + results, maintaining the in-page change history, sending deterministic edits / revert / run, and transporting candidate options. This Feature owns the client/transport contract only; the screen and its controls are specified in `query-builder`.

## Problem

The daemon (`specscore:feature/serve-brokered-query-builder@github.com/datatug/datatug-cli`) exposes the query state over MCP (for the terminal agent) and over HTTP/WS (for the web). The hosted Web UI at `datatug.app` must reach that *local* daemon — across origins, authenticated by a token it never typed, for the right tab — and keep a live, two-way view of one canonical query it does not itself own. That bootstrapping-and-sync problem is distinct from rendering a screen, so it is factored into its own feature that the `query-builder` view consumes. Without it, the web screen has no defined way to attach to, read from, or write to the daemon.

## Behavior

### Connection bootstrap

#### REQ: deep-link-ingest

The web app MUST accept a deep link carrying the tab (query) id, the daemon host, and a one-time code in the link fragment, and MUST exchange that code exactly once for the tab's session token before issuing any other request. If the code has already been exchanged or is invalid, the layer MUST surface an explicit error (see REQ:connection-error-surfaced).

#### REQ: daemon-connection

Using the host and token from the link, the layer MUST open an HTTP channel (for commands) and a WebSocket channel (for live updates) to the local daemon, sending the session token on every request from the hosted `datatug.app` origin and relying on the daemon's CORS allowlist.

### Live synchronization

#### REQ: subscribe-live

On connecting, the layer MUST subscribe over WebSocket to the tab and expose to the UI the tab's current query and latest results, applying every subsequent daemon-pushed update so the UI reflects the live state without manual refresh.

#### REQ: maintain-history

The layer MUST receive the prose + delta change-descriptions the daemon pushes and maintain them as the in-page change history (the daemon retains none). This history is client-side and need not survive a page reload.

#### REQ: reload-rehydrate

On a page reload, the layer MUST rehydrate the tab's current query and results from the daemon. The in-page history is not replayed and starts empty after reload.

### Outgoing operations

#### REQ: send-structured-edits

The layer MUST send the user's deterministic edits (add/remove/select column, add filter, set ordering) to the daemon as structured operations on the tab — never as prose.

#### REQ: send-revert

The layer MUST send a revert operation that sets the tab's current query to a prior version chosen from the in-page history.

#### REQ: trigger-run

The layer MUST trigger execution with a row limit (defaulting to 1000) and MUST support "load next N" and "load all" continuation against the same tab, without re-stating the conversation.

### Disambiguation transport

#### REQ: transport-options

When the daemon offers multiple candidate options for a tab, the layer MUST expose them to the UI, request a selected option's results on demand, and send the commit that adopts the chosen option and discards the rest.

### Failure handling

#### REQ: connection-error-surfaced

If the daemon is unreachable, the token/code is invalid, or the WebSocket drops, the layer MUST expose a clear error state to the UI rather than failing silently or showing stale data as if live.

## Interaction with Other Features

| Feature | Interaction |
|---|---|
| [query-builder](../query-builder/README.md) | Consumer. The screen uses this layer for all backend communication; this layer carries no UI. |
| Daemon `serve-brokered-query-builder@github.com/datatug/datatug-cli` | The server side this layer is a client of: MCP for the agent, HTTP/WS for this web layer. |
| Capability `serve-brokered-query-builder@github.com/datatug/datatug` | Defines the cross-surface contract this layer helps the Web Implementation realize. |

## Acceptance Criteria

### AC: link-exchanges-code-once (verifies REQ:deep-link-ingest)

**Given** a deep link with a tab id, daemon host, and a one-time code in the fragment
**When** the web app opens the link
**Then** the code is exchanged exactly once for the session token, and a second exchange of the same code yields an explicit error.

### AC: connects-http-and-ws (verifies REQ:daemon-connection)

**Given** a valid tab id, host, and token
**When** the layer connects
**Then** it opens HTTP and WebSocket channels to that host, sends the token on requests, and is permitted by the daemon's CORS allowlist for the `datatug.app` origin.

### AC: live-updates-applied (verifies REQ:subscribe-live)

**Given** an active subscription to a tab
**When** the daemon pushes a current-query or results change
**Then** the layer exposes the updated query and results to the UI without a manual refresh.

### AC: history-accumulates (verifies REQ:maintain-history)

**Given** an active subscription
**When** the daemon pushes prose + delta change-descriptions
**Then** the layer appends them to the in-page change history.

### AC: reload-restores-current (verifies REQ:reload-rehydrate)

**Given** a tab being viewed with some accumulated history
**When** the page is reloaded
**Then** the current query and results are rehydrated from the daemon and the in-page history starts empty.

### AC: edits-sent-structured (verifies REQ:send-structured-edits)

**Given** a connected tab
**When** the user adds a filter through the UI
**Then** the layer sends it to the daemon as a structured edit operation, not as prose.

### AC: revert-sent (verifies REQ:send-revert)

**Given** an in-page history with several steps
**When** the user reverts to an earlier step
**Then** the layer sends a revert operation setting the tab's current query to that prior version.

### AC: run-with-limit-and-continuation (verifies REQ:trigger-run)

**Given** a tab whose query returns more rows than the limit
**When** the layer triggers a run without an explicit limit
**Then** at most 1000 rows are requested and "load next N" / "load all" retrieve the remainder against the same tab.

### AC: options-transported (verifies REQ:transport-options)

**Given** the daemon offers multiple candidate options for a tab
**When** the user selects one and commits it
**Then** the layer requests the selected option's results on demand and sends the commit that adopts it and discards the others.

### AC: failure-shows-error (verifies REQ:connection-error-surfaced)

**Given** a connected tab
**When** the daemon becomes unreachable or the WebSocket drops
**Then** the layer exposes a clear error state to the UI rather than continuing to present stale data as live.

## Rehearse Integration

Every AC has a concrete client-surface (link parsing, token exchange, HTTP/WS calls, message handling, error state) and is testable. Stub scaffolding under `_tests/` is deferred to the Plan/Implement phase so the stub set tracks the final task breakdown, consistent with the `ai-query-builder` web Implementation in this repo.

## Not Doing / Out of Scope

- The screen, controls, grid, and any rendering — owned by [query-builder](../query-builder/README.md); this layer carries no UI.
- The daemon's server-side behavior — specified in `serve-brokered-query-builder@github.com/datatug/datatug-cli`.
- The terminal agent's conversation and prose interpretation — owned by the `query-builder` skill in `datatug-ai-skills`.
- Persisting history across reloads — in-page only; rehydrate current state from the daemon.
- Remote/multi-user sharing of a daemon link — local single-session this cycle (a post-MVP follow-on).

## Open Questions

- Transport specifics for the live channel — WebSocket vs SSE — must match whatever the daemon settles on.
- Token lifetime and refresh: does a dropped connection re-exchange a fresh one-time code, or reuse the session token until the daemon session ends?

---
*This document follows the https://specscore.md/feature-specification*
