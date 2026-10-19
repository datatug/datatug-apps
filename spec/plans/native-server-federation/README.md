---
format: https://specscore.md/plan-specification
status: Draft
---

# Plan: Deliver native cross-database OVDB queries

**Status:** Draft
**Source Feature:** native-server-federation
**Date:** 2026-10-19
**Owner:** showcase-interaction-design
**Supersedes:** —

## Summary

Visitor opens the showcase inspector, selects the comparison tab and presses Run. Without another action, the grid shows 17 exact-name shared countries with Northwind and Chinook customer-record counts. Opening the saved query exposes the same document and real source lineage; retry after failure executes a fresh request. Root owns landing; this local macOS Sol6.1 lane owns Apps transport and the paired Demo Project query only.

## Approach

Extend the existing native planner from `{database,sources}` to a root/database endpoint plan. Use the existing source-rights preflight, deadlines, redirect refusal, bounded ordinary reader, result sink and generic inspection components. Require exact unique physical-source equality, `complete:true`, `route:in-memory`, exact rowsReturned and typed row/column validation for root responses before exposure. Keep legacy native database behavior compatible. Persist the comparison as two small saved-query files using `cloud.openvaultdb.com`; optionally add an inspector grid tab. The server endpoint is already verified: HTTP200, CORS for datatug.app, 17 rows, 93 Northwind and59 Chinook input rows, 39ms execution. Grouped bars, linked country filtering, core model changes and clone-offer files are subsequent work.

Contract sketch: `NativePlan = {database?: string, sources: PlannedNativeSource[]}` where missing database means `/v1/dtql`; every root source is explicitly database-qualified; root selection requires aggregation, grouping, HAVING or ordering. Flat detail joins retain existing visible-row continuation paging. The ordinary consumer receives planned sources and execution path, validates all evidence first, then converts columns and rows. Compare `(database,collection)` identities as a set, reject duplicates, omissions and additions. Preserve integer/decimal precision guards. Saved comparison uses an inner equality country join, separate `COUNT(DISTINCT source.CustomerId)` aggregates, qualified ordering and limit100. No aliases are fabricated.

Files: Apps `queries/federated-query-executor.ts`, `queries/ovdb-ordinary-execution.ts`, a pure result typing helper if needed, focused native/ordinary tests and one focused browser journey. Demo Project `queries/demodb/customer-country-comparison-server.query.{json,dtql}` and existing showcase board only. No API, Worker, infrastructure or datatug-core changes are required for this delivery. Independent plan review r1: root reported APPROVED, blockers=0, majors=0, minors=0; global-only native eligibility was confirmed by root to preserve flat-detail continuation. Run focused unit tests and lint through Nx, one bounded real browser query, and existing project-copy preflight; preserve its500KiB budget.

## Tasks

### Task 1: Execute and admit the whole server plan

**Verifies:** native-server-federation#ac:server-query, native-server-federation#ac:trusted-result, native-server-federation#ac:cancel-errors
**Status:** planning

Extend endpoint planning and ordinary result validation for global queries; preserve flat detail visible-row paging. Add tests that fail on client scans, wrong source receipts, incomplete/invalid rows, cancellation and server refusal. Retain native single-database tests.

### Task 2: Publish the reproducible comparison definition

**Verifies:** native-server-federation#ac:comparison
**Status:** planning

Add the saved query pair with exact source fields, typed projection, limit and units/caveat copy. Reuse the inspector grid and measure materialized project-copy proof against its unchanged budget.

### Task 3: Verify the complete browser journey

**Verifies:** native-server-federation#ac:journey
**Status:** planning

Run the focused query/browser journey with the paired committed demo tree and a bounded live root request, asserting the request mechanism, source receipt and result values. Obtain independent review, publish cross-referenced PRs with normal hooks and hand exact heads to root for landing.

### Local browser resource ownership

The single Playwright acceptance run owns port4328 through the existing tools/serve-checkout-provider.mjs. Playwright terminates its child server at run completion; explicit teardown is SIGTERM to that recorded child if interrupted. No persistent daemon or shared browser is used.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/plan-specification*
