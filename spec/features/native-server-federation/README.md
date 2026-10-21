---
format: https://specscore.md/feature-specification
status: Draft
---

# Feature: Native server federation for saved queries

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/native-server-federation?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/native-server-federation?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/native-server-federation?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/native-server-federation?op=request-change) |
**Status:** Draft
**Source Ideas:** —

## Summary

Execute a qualified multi-database saved DTQL plan in one bounded OVDB server request and validate physical sources before exposing rows.

## Problem

The original browser-scan fallback could not provide a truthful bounded whole-document server comparison. The landed native root path now executes at `/v1/dtql` and preserves physical-source evidence; continuing acceptance must distinguish verified source/fixture behavior from real-network mechanism and authenticated copy evidence.

## Behavior

Opening the saved Northwind/Chinook comparison and pressing Run sends one query POST to `https://cloud.openvaultdb.com/v1/dtql`. Without another action, the result displays 17 countries and separate customer-record counts from each sample. Existing query/result components provide inspection and retry. Numeric customer IDs are counted distinctly within each source; the result never claims matching people. Exact country labels are matched: UK/United Kingdom, source-exclusive countries and two Northwind null-country records are excluded and explained.

A native plan records its exact unique physical sources and root or database endpoint. Root execution requires a complete bounded ordinary JSON envelope, exact result count and physical-source set, the in-memory server route, current source-rights evidence and validated result types before exposing rows. Cancellation aborts discovery and query reads. A root refusal never silently falls back to browser scans. Existing single-database streaming and ordinary paths retain their contracts.

### Paired country chart and linked Orders exploration

The saved showcase board presents the existing one-query, 17-row comparison as grouped bars: one country category, separate Northwind and Chinook customer-record measures, one explicit common unit and a visible legend. Every supported two-to-eight-series chart uses a shared zero baseline and one numeric scale across all categories and series, stable source colors, visible exact values and no per-series normalization or implicit sum. Zero values remain visible; duplicate categories and unsupported/non-numeric or imprecise measures fail visibly. Both values for each showcase country remain available through keyboard focus and the existing chart/grid toggle. The chart uses the Core `board-multi-series-chart` wire's two-series `bar` variant, one saved query source and no second source scan. Initial execution is one native root POST; chart/grid toggle reuses its held result. Existing single-measure bars and bar races remain unchanged.

The native root result is an ordinary two-source result, without a protected execution profile. Its chart presentation path validates the existing root admission evidence: complete ordinary envelope, exact declared Northwind/Chinook physical-source identities, `totalRows === recordset.rows.length === 17` and typed category/series columns before exposing bars. It does not cast the result to the existing one-table `ServerChartRecordset` arm, invent a protected profile/collection/right, or relax backend result decoding. Incomplete, paged or mismatched output produces an error, not partial bars.

Public GitHub board reads return raw JSON rather than passing through Core's `Board.Validate`. Apps therefore runs one bounded whole-board validation before ordinary display or tutorial actions: inspect all rows/cards and active/inactive nested tabs to Core's depth32, skip valid empty placeholders, admit only the declared new chart/SQL filter fields, enforce unique selection producers and resolved filter references, and check the actual result columns/types after admission. The normal board, tutorial edits, Show Full and saved board all use the same rule; malformed nested data never silently selects two producers or filters another card.

Selecting a country sets an ephemeral board-local presentation selection, separate from `boardContext` and saved query parameters. A SQL detail widget with a declared `presentationFilter` compares that exact selected string with `ShipCountry` in its already held, publisher-verified Northwind Orders result. The existing Orders admission path proves 830 complete rows, a pinned canonical digest, `complete:true`, `hasMore:false`, `truncated:false`, a matching `publicApiReceipt.rowsReturned` and current source rights before filtering. A paged, truncated, unverified or stale result cannot claim a full-set filtered count and shows a clear unavailable state. The detail labels `X of 830 orders shipped to <country>`; zero is a valid match count. Clear restores the original 830-row order. Selection, rapid reselection and Clear do not execute another request or alter race playback, chart focus, other held results or query cache identity.

The selected chart value is a customer-country label, while `ShipCountry` describes an order destination. This link explores two country dimensions and does not join customers to orders or match people across Northwind and Chinook. Exact string labels apply: UK and United Kingdom are not normalized. Tutorial step changes drop a selection if its producing chart disappears; tutorial restart, leaving the board and Show Full clear the selection. This state is browser-session only and never changes the saved board. The SQL card displays its runtime choice control only when a working copy provides an actual alternative; multi-choice runtime switching remains available.

## Acceptance Criteria

### AC: server-query

Given a fully qualified multi-database global DTQL plan (aggregation, grouping, HAVING or ordering) without client lookups or bounded client execution, when Run is pressed, then one query POST executes the complete document at `/v1/dtql`, with no browser source scans, SQLite or WASM downloads.
### AC: trusted-result

Given a root result, when its envelope, route, row count, source set, column shape/types or rights evidence differs from the plan, then it fails before rows reach callbacks or result storage.
### AC: cancel-errors

Given pending discovery or result reads, when execution is cancelled or fails, then reads stop, no partial result is exposed, errors stay bounded and retry uses a fresh execution.
### AC: comparison

Given the saved demo query, when run against the real server, then 17 rows include Canada 3/8 and USA 13/13, with explicit units and exact-label exclusions.
### AC: truthful-provenance

Given an ordinary JSON or native stream result without a protected execution receipt, then locally constructed provenance never invents a protected profile. Source details identify OVDB server execution neutrally, preserve genuine API-supplied profiles and retain absent source terms without inventing a licence. Browser runtime receipt labels remain unchanged. Ordinary/native paging and local graph history remain usable without protected receipts; unprofiled local envelopes cannot acquire a protected execution reference, while genuinely profiled history retains strict backend validation.

### AC: readable-inspector

Given the showcase inspector, then it occupies its own full-width row while neighboring chart cards remain unchanged. Long tab titles scroll horizontally on narrow screens; keyboard focus selects and reveals the active tab, with stable tab/panel accessible associations. Switching tabs or chart/grid views reuses existing query/result identities without rerunning held queries.

### AC: journey

Given the existing inspector tab and saved query route, when a visitor runs and inspects the comparison and revisits the result, then it works in the real browser without extra taps or client scans; existing native single-database focused tests pass and demo project-copy preflight remains within 500 KiB.

### AC: paired-chart

Given the saved comparison query returns its complete 17 exact-shared-country rows, when the board opens and its paired card runs, then one root POST supplies grouped Northwind and Chinook customer-record bars with distinct series labels, stable colors and one unit on a common zero-based scale. Canada reads 3/8 and USA 13/13 in chart and grid. Keyboard focus exposes both values; zero values retain their category/series label; chart/grid switching adds no query. All two-to-eight declared series render on that scale, with no implicit sum or normalization; duplicate categories, missing/imprecise/nonnumeric or partial results fail visibly. The full-width inspector and adjacent existing Northwind chart remain usable at desktop and 375px widths.

### AC: root-chart-admission

Given the genuine two-source, unprofiled native root result, when the paired chart receives it, then the exact planned source pair, `ordinaryComplete`, `nativeDirect`, `totalRows`, row count and typed columns are checked before any bar or callback appears. Its provenance remains neutral and source-specific with no fabricated protected profile, collection, right or execution reference. A missing source, third source, mismatched row count, incomplete flag or paging is refused, while the ordinary inspector remains available.

### AC: raw-board-validation

Given a public GitHub board in raw JSON form or a tutorial-edited board, when it loads or Show Full is chosen, then all nested active/inactive widgets receive the same bounded new-field and producer/reference validation before selection is active. Duplicate selection producers, unresolved references, unknown/null/executable filter fields, invalid series and excessive nesting fail visibly. Existing legacy boards and empty tab placeholders remain usable.

### AC: linked-orders

Given the current admitted 830-row Orders result, when a visitor selects Canada, another country, an exact-label nonmatch or Clear, then only the declared Orders detail changes. It shows an accurate `X of 830 orders shipped to` caption, a truthful zero state or all 830 original rows. Rapid selections show the latest choice, while toggle/select/Clear add no OVDB request or SQLite download and do not reset other held cards, bar-race playback or focus. A result without the concrete complete/admission fields reports filtering unavailable.

### AC: tutorial-and-runtime

Given `?mode=tutorial`, when a visitor moves back and forward, restarts or chooses Show Full, then the country selection follows the currently present chart and clears on restart/Show Full without persisting to the saved board or browser storage. With no working copy, the SQL runtime caption remains but the one-option select is hidden; with working copies, the picker and explicit choice continue to work.

## Validation snapshot

The paired visual slice is landed and deployed: Apps reviewed `2f791963` → production `db2f1a94f92f2041accd6bc044fe70c3a507ed8b`, Demo54 reviewed `47694e125f1ad28e0463411646c2c876b8623971` → public `0952fc54531d663b4df56f4654640763e2f913d1`. Independent exact-head source and captured-read browser reviews passed, including eight fixture cases, old boards, tutorial reload, reduced motion and desktop/mobile layout. Root observed real17-country results (Canada3/8, USA13/13) and complete Orders830→30→830 on Canada/Clear. The landed local tutorial's eight stages, Restart and Show Full were observed.

The authoritative release/live receipt is `/Users/alex/projects/.wb/reports/showcase-country-comparison/final-release-and-live-dashboard.json`; exact-head reviews are `/Users/alex/projects/.wb/reviews/datatug-apps-country-comparison-2f791963.md` and `/Users/alex/projects/.wb/reviews/datatug-apps-country-browser-2f791963.md`. These receipts supersede the earlier localhost capability-discovery failure and candidate-only publication notes. Live request-count/no-save instrumentation and authenticated TEST project-copy continuation remain unverified; Tasks3/9 retain those gaps. Tutorial cursor/action storage is intentional; country selection remains ephemeral.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/feature-specification*
