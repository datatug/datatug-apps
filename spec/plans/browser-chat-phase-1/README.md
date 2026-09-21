---
format: https://specscore.md/plan-specification
status: Draft
---

# Plan: Browser Chat Phase 1 vertical slice

**Status:** Draft
**Source Feature:** browser-chat-phase-1
**Date:** 2026-09-21
**Owner:** alex
**Supersedes:** —

## Summary

Build one local trial of browser Chat from project navigation through provider configuration, DTQL interpretation, DALgo IndexedDB execution and AG Grid. Keep provider credentials in this browser's localStorage by explicit user choice; the local agent uses each key for one request without persisting it. Do not release before the user tries the result.

## User journey

1. The user opens a project and clicks **Chat**. The URL names the same store and project; the page loads directly after refresh without another click.
2. The page checks this project's Chinook seed. While it loads, the page says so; once ready, the composer is usable. If the seed or agent is unavailable, the page explains the next step.
3. The user clicks **Add AI provider**, selects DeepSeek, sees the default protocol, base URL and `deepseek-flash`, enters a key, and saves. The saved endpoint appears in Chat's selector and remains selected after reload.
4. The user asks “Show last 100 orders”. The submitted message appears immediately; progress is visible without another action. A valid DTQL action yields 100 actual Invoice rows in a sortable, resizable grid, with InvoiceId 412 first and 313 last.
5. The user asks the remaining five sample questions; each yields the expected Chinook rows or a clear error. Switching to another project cannot show or query the former project's data.

## Approach

Use a pinned SQLite-to-JSON fixture generator and project-scoped DALgo storage. Add strict DTQL-to-structured-query validation in `@dalgo/core`; extend the adapter only for verified defects. The local agent reuses the CLI Chat Google ADK conversation and `run_dtql` tool in browser-interpretation mode, accepts OpenAI-compatible and Anthropic provider settings without persisting keys, and returns an action only. Keep the app responsible for provider settings, route state and the grid. Deterministic model fakes prove the browser path; a separate credentialed smoke is conditional on the user's local key. No chat-session persistence, saved result sets or general query engine is added.

## Tasks

### Task 1: DALgo DTQL boundary

**Status:** in_progress
**Verifies:** browser-chat-phase-1#ac:bounded-dtql

Implement and test strict single-source DTQL parsing/validation and conversion to `StructuredQuery`. Include qualified source names, order, comparison, limit, unknown fields and unsupported constructs. Exercise the published IndexedDB adapter with those queries; fix any adapter bug at its source.

### Task 2: Pinned browser seed

**Status:** planning
**Verifies:** browser-chat-phase-1#ac:real-seed, browser-chat-phase-1#ac:chinook-prompts

Generate fixture data and a version manifest from the pinned SQLite hash with license notice. Import via DALgo transactions into a database name derived from store/project. Verify exact counts/IDs and idempotent reload.

### Task 3: Local model interpreter and provider settings

**Status:** planning
**Verifies:** browser-chat-phase-1#ac:provider-settings, browser-chat-phase-1#ac:bounded-dtql

Expose a bounded local-agent POST accepting question, compact schema and selected endpoint configuration, returning DTQL only. Support the two named protocols. In the app add editable provider presets, localStorage persistence and endpoint selection with no key in navigation or logs. Test with a deterministic fake provider.

### Task 4: Chat route, menu and grid

**Status:** planning
**Verifies:** browser-chat-phase-1#ac:route-and-context, browser-chat-phase-1#ac:grid-and-states

Wire project route and menu entry, Ionic chat shell and composer, AG Grid result rows, and error/loading/empty states. Reset on project change and hydrate direct links from URL.

### Task 5: Browser acceptance and review

**Status:** planning
**Verifies:** browser-chat-phase-1#ac:browser-proof, browser-chat-phase-1#ac:chinook-prompts

Run focused checks, lint/build and Playwright against seeded IndexedDB. Compare the six prompts with the pinned SQLite IDs/counts, inspect rendered output and try a real DeepSeek call if a local key is available. Review security, complexity and UX; fix findings. Keep the branch local for the user's trial.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/plan-specification*
