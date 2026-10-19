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

Extend the existing native planner from `{database,sources}` to a root/database endpoint plan. Use the existing source-rights preflight, deadlines, redirect refusal, bounded ordinary reader, result sink and generic inspection components. Require exact unique physical-source equality, `complete:true`, `route:in-memory`, exact rowsReturned and typed row/column validation for root responses before exposure. Keep legacy native database behavior compatible. Persist the comparison as two small saved-query files using `cloud.openvaultdb.com`; optionally add an inspector grid tab. The server endpoint is already verified: HTTP200, CORS for datatug.app, 17 rows, 93 Northwind and59 Chinook input rows, 39ms execution. Grouped bars, linked country filtering and Core model changes were deferred from the initial transport/inspector work and are now specified as the coordinated follow-on slice below. Clone-offer files remain separate.

Contract sketch: `NativePlan = {database?: string, sources: PlannedNativeSource[]}` where missing database means `/v1/dtql`; every root source is explicitly database-qualified; root selection requires aggregation, grouping, HAVING or ordering. Flat detail joins retain existing visible-row continuation paging. The ordinary consumer receives planned sources and execution path, validates all evidence first, then converts columns and rows. Compare `(database,collection)` identities as a set, reject duplicates, omissions and additions. Preserve integer/decimal precision guards. Saved comparison uses an inner equality country join, separate `COUNT(DISTINCT source.CustomerId)` aggregates, qualified ordering and limit100. No aliases are fabricated.

Initial transport/inspector files: Apps `queries/federated-query-executor.ts`, `queries/ovdb-ordinary-execution.ts`, a pure result typing helper, focused native/ordinary tests and one focused browser journey; Demo Project `queries/demodb/customer-country-comparison-server.query.{json,dtql}` and the showcase inspector. That initial delivery required no API, Worker, infrastructure or datatug-core changes. Independent plan review r1: root reported APPROVED, blockers=0, majors=0, minors=0; global-only native eligibility was confirmed by root to preserve flat-detail continuation. The new visual presentation slice below has its own Core provider contract and review.

### Follow-on visual comparison journey

The visitor opens the completed board and sees a paired Northwind/Chinook customer-country chart beside the existing Northwind country chart, with the inspector on its separate full-width row. One native root POST supplies the comparison's 17 exact shared labels. Chart/grid toggle and keyboard focus reveal both series without a rerun. Selecting a country only filters the already held, complete publisher-verified 830-row Orders detail by exact `ShipCountry`; its caption describes orders shipped to that country, shows `X of 830`, and offers Clear. No selection goes through `boardContext`, query parameters or storage. An unverified/partial Orders result is visibly unsupported. This linked view does not join people or orders across businesses, and UK remains different from United Kingdom. Tutorial restart/Show Full clears the selection. One-option SQL runtime select is hidden while preserving real working-copy choices.

Core's `board-multi-series-chart` Feature and Plan own the single release containing `series`, `selectionId` and SQL `presentationFilter`. Consume it first in backend, Cloud, CLI, Demo Project validation and Apps. Apps mirrors Core's wire in `widget-chart.ts`, `widget-sql.ts` and tutorial validation, plus a shared whole-board runtime validator for raw GitHub and tutorial boards. Existing `BoardWidget.chartResult` only promotes one-table profiled ordinary results, so add a narrow two-source native-root chart admission path in the current board widget/held-result presentation: verify `ordinaryComplete`, `nativeDirect`, exact planned physical source pair, `totalRows`/materialized row equality and typed columns, with neutral unprofiled provenance. Do not cast it to the one-table `ServerChartRecordset` arm or weaken backend result decoding. Use the current complete Orders public admission/receipt, not an invented completion flag. Keep execution identity tied to actual project/query/environment/actor/runtime inputs; presentation selection lives in a separate narrow board-scoped state. Do not add DTQL parameter execution or run a new query when selecting/Clearing. Deploy the compatible Apps parser, runtime validator, tutorial and renderer and record its exact production build before publishing the new Demo board; keep the old public board until that gate passes.

## Tasks

### Task 1: Execute and admit the whole server plan

**Verifies:** native-server-federation#ac:server-query, native-server-federation#ac:trusted-result, native-server-federation#ac:cancel-errors
**Status:** complete

Extend endpoint planning and ordinary result validation for global queries; preserve flat detail visible-row paging. Add tests that fail on client scans, wrong source receipts, incomplete/invalid rows, cancellation and server refusal. Retain native single-database tests.

### Task 2: Publish the reproducible comparison definition

**Verifies:** native-server-federation#ac:comparison
**Status:** complete

Add the saved query pair with exact source fields, typed projection, limit and units/caveat copy. Reuse the inspector grid and measure materialized project-copy proof against its unchanged budget.

### Task 3: Verify the complete browser journey

**Verifies:** native-server-federation#ac:journey
**Status:** in_progress

Run the focused query/browser journey with the paired committed demo tree and a bounded live root request, asserting the request mechanism, source receipt and result values. Obtain independent review, publish cross-referenced PRs with normal hooks and hand exact heads to root for landing.

### Task 4: Keep result claims truthful and inspector readable

**Verifies:** native-server-federation#ac:truthful-provenance, native-server-federation#ac:readable-inspector
**Status:** complete

Remove locally fabricated protected profiles from ordinary, streaming and browser result builders while preserving API-issued profile metadata and browser receipt labels. Place the existing DemoProject inspector in its own full-width row and enable native Ionic scrolling/focus selection. Check separate desktop/mobile contexts against captured anonymous public read responses, one query across held-result tab changes and no invented source terms. Preserve tab IDs, saved query references and other chart slots. Root independently reviews screenshots and lands both repositories.

### Task 5: Mirror and present the released paired bar wire

**Verifies:** native-server-federation#ac:paired-chart, native-server-federation#ac:raw-board-validation
**Status:** complete

After the Core release and consumer checks, add the exact discriminated two-to-eight-series `bar` wire to board models, tutorial guard and authoring path while preserving legacy `valueColumn` and bar-race behavior. Add a bounded whole-board runtime pass for raw GitHub boards as well as tutorial/Show Full: validate all rows/cards and active/inactive nested tabs to depth32, typed/map forms, empty placeholders, closed new fields, producer uniqueness and resolved references. Extend existing chart presentation for every declared two-to-eight series, with one zero baseline/common numeric scale, stable colors/legend, visible exact values and keyboard selection. Preserve zero values and reject duplicate categories or invalid/imprecise numeric cells. Stage and validate all 17 typed rows before bars appear. Chart/grid toggle reuses held raw rows; existing bar-race preparation and focus remain stable.

### Task 6: Admit the two-source native root result without invented profile

**Verifies:** native-server-federation#ac:root-chart-admission, native-server-federation#ac:paired-chart
**Status:** complete

Keep the existing one-table `chartResult` conversion unchanged. Add a distinct ordinary-root presentation helper/arm that requires `nativeDirect`, `ordinaryComplete`, exact planned Northwind Customers and Chinook Customer physical sources, no paging, `totalRows === recordset.rows.length === 17` and all declared typed category/measure cells before publishing bars. Preserve neutral no-profile provenance and actual source rights. Reject absent/extra sources, truncated/incomplete or malformed columns/rows before chart callbacks. Do not fabricate an execution profile, collection, right or protected execution reference and do not relax backend Result decoding. The ordinary inspector remains functional.

### Task 7: Bind only the declared local detail presentation

**Verifies:** native-server-federation#ac:linked-orders
**Status:** complete

Introduce one board-scoped ephemeral selection keyed by the saved chart's `selectionId`, and consume it only in SQL widgets with matching `presentationFilter`. Bind the detail widget to `demodb/northwind-orders-full-sqlite`, whose default execution is the public OVDB server despite its historical name. Require the existing saved-text hash/scope admission and publisher-verified complete Orders proof: valid source rights, `complete:true`, `hasMore:false`, `truncated:false`, canonical digest and receipt row count matching all830 held rows. Compare typed `ShipCountry` strings exactly, filtering a presentation projection while retaining the original rows/receipt. Show `X of 830 orders shipped to`, zero/unsupported states and Clear. Assert rapid latest-wins interaction, restoration order, no extra request on toggle/select/Clear and unchanged unrelated execution/cache identities, race playback and focus.

### Task 8: Preserve tutorial and runtime smoothness

**Verifies:** native-server-federation#ac:tutorial-and-runtime
**Status:** complete

Keep selection in the active board view only, clear it on disappearing chart, tutorial restart/Show Full and route exit, and test back/forward without storage writes. Hide the SQL runtime picker when `workingCopies().length===0`; keep its runtime caption, keyboard behavior and real multi-choice switch. Match the tutorial's cross-source step to the actually available paired chart.

### Task 9: Publish the paired board and prove it live

**Verifies:** native-server-federation#ac:paired-chart, native-server-federation#ac:root-chart-admission, native-server-federation#ac:raw-board-validation, native-server-federation#ac:linked-orders, native-server-federation#ac:tutorial-and-runtime
**Status:** in_progress

Keep the public Demo board at its working `eaba7b052fff26ad16a21649cf536c59b68d61a5` shape until a compatible Apps parser, whole-board validator, tutorial and renderer has merged, deployed and produced an exact-build production receipt. After that gate, retain the inspector full-width row, place the paired card in the neighboring six-column slot, bind the native comparison plus `demodb/northwind-orders-full-sqlite`, and run backend `TestCloneCurrentProjectCheckout` against its existing 500 KiB source-proof and 768 KiB operation caps. Validate Core/Apps/backend/Cloud/CLI/Demo consumer versions, focused tests and lint, then publish Demo HEAD and run a real 1440px/375px deployed browser journey with exact request counts and source receipt. Independent review and root-owned landing apply to each repo. Distinguish local preview from deployed production acceptance.

## Landed evidence and remaining acceptance

Tasks1–2 and4–8 are complete for their source, published-definition and independent fixture scope. Apps reviewed head `2f791963` landed/deployed as `db2f1a94f92f2041accd6bc044fe70c3a507ed8b`; Demo54 reviewed `47694e125f1ad28e0463411646c2c876b8623971` landed publicly as `0952fc54531d663b4df56f4654640763e2f913d1`. The compatible Core v0.60.1 consumer wave and unchanged clone budgets were verified before Demo publication. Generic signed/fractional bars, prototype-name selection IDs, ordinary unprofiled root admission, complete Orders filtering and legacy boards are covered by the exact-head independent source/fixture reviews.

Authoritative retained receipts outside the repository: `/Users/alex/projects/.wb/reports/showcase-country-comparison/final-release-and-live-dashboard.json`, `/Users/alex/projects/.wb/reviews/datatug-apps-country-comparison-2f791963.md` and `/Users/alex/projects/.wb/reviews/datatug-apps-country-browser-2f791963.md`. Independent captured-read acceptance passed eight fixture cases plus old-board, tutorial reload and reduced-motion checks; those transient servers were torn down. Root's public desktop/mobile observations showed17 countries, Canada3/8, USA13/13, and complete Orders830→30→830 on Canada/Clear. The local landed tutorial exercised its eight stages, Restart and Show Full.

Tasks3/9 remain in_progress: live request counts/no-save mechanism were not instrumented, tutorial source writes were not monitored live, and authenticated TEST copy→PR→merge→Query this table is unverified. Existing fixture request-count/no-mutation evidence does not close those real-network/auth gaps. The old candidate-only publication gate is satisfied; the remaining work is acceptance evidence, not another unpublished paired board. Country selection does not write storage; the tutorial's existing bounded cursor/action restoration intentionally uses session storage. New exploration changes belong to `held-result-exploration` and its `showcase-exploration-polish` plan.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/plan-specification*
