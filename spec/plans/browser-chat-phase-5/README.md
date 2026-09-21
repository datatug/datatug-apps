---
format: https://specscore.md/plan-specification
status: Implemented
---

# Plan: Browser Chat Phase 5 FK JOIN exploration

**Status:** Implemented
**Source Feature:** browser-chat-phase-5
**Date:** 2026-09-21
**Owner:** alex
**Supersedes:** —

## Summary

Build browser FK JOIN exploration on the existing Chat result, session and DALgo paths. Release only after deterministic and real-Chinook browser journeys, independent review and the repository's required checks pass.

## User journey

1. I ask for recent invoices and see real rows. Below that result I see Invoice's FK JOIN choices, including Customer and InvoiceLine; no JOIN occurs until I choose one.
2. I focus Customer by keyboard or pointer and inspect its Invoice.CustomerId → Customer.CustomerId fields and many-to-one cardinality. I apply it once and see progress, then a new result with valid DTQL, SQL and joined rows.
3. I open the new result. The Invoice and Customer relation instances each have their own remaining choices. I add another JOIN and see another saved result. Refreshing restores both results and their exact lineage without executing them again.
4. I can instead type “Join customers” after an invoice result. The same candidate action runs. If a target has two FK paths, I see the choices and must pick one.
5. If no FK choice exists or schema metadata changed, I see a concise empty/error state. I can still use existing selections, docks and attachments, switch projects or clear the session safely.

## Approach

Consume the already-merged recursive `@dalgo/core` JOIN parser/executor by updating the app's pinned dependency. Bundle FK metadata from the pinned Chinook SQLite DDL because IndexedDB has no FK catalog. Put edge discovery and DTQL derivation in pure browser-domain functions, then route UI and chat JOIN commands through one session-scoped application operation. The operation validates, executes via DALgo's joined-query entrypoint, and commits a new immutable session RecordSet with edge provenance. Preserve the current add-only interaction; dependency-aware removal and non-FK evidence remain later work.

## Tasks

### Task 1: Land browser Phase 4 bookmark and tag lifecycle

**Status:** complete
**Verifies:** browser-chat-phase-5#ac:lifecycle-and-failure

Implement or integrate the browser's project-scoped Phase 4 bookmark/tag storage and UI before Phase 5 releases. Verify immutable RecordSet references, cross-session reuse and session deletion semantics, then include joined RecordSets in the same lifecycle checks.

### Task 2: Pin the shared JOIN runtime and FK schema

**Status:** complete
**Verifies:** browser-chat-phase-5#ac:fk-discovery, browser-chat-phase-5#ac:valid-join

Update the pinned DALgo core commit and verify its recursive parser/executor with the installed IndexedDB adapter. Create `tools/generate-chinook-chat-schema.mjs`, generate and check in a versioned FK manifest from the pinned SQLite schema, and test regeneration plus synthetic composites, ambiguous and self relationships.

### Task 3: Derive and execute a candidate

**Status:** complete
**Verifies:** browser-chat-phase-5#ac:valid-join, browser-chat-phase-5#ac:chain-and-lineage, browser-chat-phase-5#ac:lifecycle-and-failure

Build pure relation-instance traversal, edge identity, active-edge suppression, collision-safe aliases, ON construction, inherited-clause qualification and duplicate-safe projection. Validate derived DTQL, execute through DALgo, store parent/edge metadata transactionally and restore it without query reruns.

### Task 4: Browser candidate controls and details

**Status:** complete
**Verifies:** browser-chat-phase-5#ac:keyboard-details, browser-chat-phase-5#ac:chain-and-lineage

Place grouped choices below each result grid, wire focus and pointer/keyboard actions, and show exact relationship details in the existing Selected workspace. Keep grid and composer focus behavior intact, with pending/error states for application.

### Task 5: Chat command route and ambiguity

**Status:** complete
**Verifies:** browser-chat-phase-5#ac:agent-ambiguity, browser-chat-phase-5#ac:lifecycle-and-failure

Resolve join requests against the current result's candidate IDs and call the same application operation. Show available choices when target text is ambiguous; never accept a model-authored ON condition.

### Task 6: End-to-end validation and release

**Status:** complete
**Verifies:** browser-chat-phase-5#ac:browser-proof, browser-chat-phase-5#ac:fk-discovery, browser-chat-phase-5#ac:valid-join, browser-chat-phase-5#ac:chain-and-lineage, browser-chat-phase-5#ac:agent-ambiguity, browser-chat-phase-5#ac:lifecycle-and-failure

Run synthetic tests, actual Chinook IndexedDB browser journey, reload/project/session and Phase 4 bookmark/tag regressions, Nx build/lint and independent adversarial review. Address findings, land with WB, verify exact remote main and required checks, then verify the configured Cloudflare deployment. The Phase 4 receipt and joined-RecordSet bookmark/tag acceptance are release gates.

## Open Questions

None. Browser Phase 4 is a required dependency and part of this release plan.

---
*This document follows the https://specscore.md/plan-specification*
