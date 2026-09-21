---
format: https://specscore.md/feature-specification
status: Draft
---

# Feature: Browser Chat Phase 1

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/browser-chat-phase-1?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/browser-chat-phase-1?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/browser-chat-phase-1?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/browser-chat-phase-1?op=request-change) |
**Status:** Draft
**Source Ideas:** —

## Summary

Browser Chat translates questions to validated DTQL and queries a versioned local 11-table Chinook IndexedDB dataset through DALgo, rendering structured rows in AG Grid.

## Problem

The project browser has no way to ask a data question and inspect local demo rows. This is the first **browser Chat** slice, separate from the terminal-led Query Builder and from DataTug's wider product Phase 1. It is a local trial before any release.

## Behavior

The project menu opens `/store/:storeId/project/:projectId/chat`. A cold link restores scope from the URL. The bottom composer sends one question at a time; history above it shows progress, errors, row counts and an AG Grid Community table. Changing project clears the in-memory turn state. This local trial seeds only `datatug-demo-project` into the top-level `chinook` IndexedDB database and rejects other projects.

The user can add, edit, select and remove AI endpoints from Chat. The form offers DeepSeek, OpenAI and Anthropic presets, a protocol choice (OpenAI-compatible Chat Completions or Anthropic Messages), editable base URL and model, and a masked API key. DeepSeek defaults to `deepseek-flash` at `https://api.deepseek.com`. Endpoint entries, including keys, are stored in this browser origin's `localStorage` at the user's explicit request; the UI states that this storage is readable by scripts on that origin and offers deletion. Keys are never placed in URLs, build configuration, IndexedDB, analytics or logs.

For a turn, the browser sends the question, compact schema description, selected protocol/model/base URL and key in a POST body to the locally running DataTug agent. The agent reuses the CLI Chat Google ADK conversation and its `run_dtql` action tool in browser-interpretation mode, then returns **only a validated DTQL action**; it does not persist the key or execute against its own SQLite copy. The browser validates the DTQL against an allowlisted schema and row cap, compiles it through `@dalgo/core`, executes it via `@dalgo/indexeddb` against the selected project's seeded Chinook data, then passes structured records to AG Grid. No model-produced SQL, HTML, table markup or rows are trusted.

The browser seed is generated reproducibly from the pinned MIT-licensed Chinook SQLite revision and SHA-256 recorded in `datatug-demo-projects/demo-project-1/fixtures/chinook/phase1-acceptance.json`. The fixture contains all 11 source tables and their fields. IndexedDB has one physical object store per table plus `_meta`; seed metadata records the fixture version. A complete seed is idempotent, an absent seed is a loading/unavailable state, and a successful zero-row query is distinct. Track includes an `ArtistName` field derived from Chinook's Track → Album → Artist relation so the Phase 1 single-source DALgo query can answer artist-name prompts without a browser join engine.

The interpreter sends schema and relationship hints only. The browser does not send database rows. Model output and provider errors are shown as errors after bounded parsing, never inserted as HTML.

## Acceptance Criteria

### AC: route-and-context

Chat is linked from the project menu; direct navigation and reload restore the exact store/project. Switching projects cannot reuse the prior project's database or turns.

### AC: provider-settings

Adding DeepSeek prefills its OpenAI-compatible protocol, `https://api.deepseek.com`, and `deepseek-flash`; OpenAI and Anthropic presets are available. An entry can be edited, selected and removed, and survives a reload on the same browser origin. The key is masked and absent from URLs and network query strings.

### AC: real-seed

The pinned fixture generates versioned Chinook Artist, Album, Track, Genre, MediaType, Playlist, PlaylistTrack, Customer, Employee, Invoice and InvoiceLine records in IndexedDB using DALgo writes. Reopening is idempotent, and an existing three-table `chinook` database upgrades in place. Missing seed and zero matches display different states.

### AC: bounded-dtql

Malformed, unknown-source/field, unsupported, or unbounded DTQL is rejected before DALgo execution. A valid single-source comparison, ordering and limit preserves schema-qualified identity and returns structured rows. Joins and aggregation are not available in this slice, even though the full data model supports future examples.

### AC: chinook-prompts

With a deterministic fake interpreter, the six requested prompts return the same IDs/order/counts as SQL against the pinned SQLite input: last 100 orders (InvoiceId 412 first, 313 last), 50 Prague customers (IDs 5,6), last 20 invoices (412..393), Brazil customers (five), newest 30 invoices (412..383), and 10 AC/DC tracks (TrackId 1 first, 14 last). “Orders” resolves via schema context, with no prompt-specific browser branch.

### AC: grid-and-states

AG Grid shows headers, typed cells, keyboard navigation, sort, resize, scroll, empty state and row count. The composer stays below history. Loading, invalid-model-response, query-error and unavailable-agent/database states remain understandable.

### AC: browser-proof

Focused tests and a real Playwright journey use seeded IndexedDB and inspect the rendered route, grid and provider form. Fake-model and real-model evidence are reported separately. Local user trial occurs before release.

## Open Questions

No release is authorized by this local-trial milestone. The user will provide their own DeepSeek key in the browser; no test credential is committed.

---
*This document follows the https://specscore.md/feature-specification*
