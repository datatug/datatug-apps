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

Qualified queries spanning multiple databases currently fall back to browser scans, although the existing OVDB server supports the whole document at `/v1/dtql`. A reproducible comparison must execute on that server and preserve its physical-source receipt.

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

The production app build and main/app Nx lint targets passed; TypeScript spec checking passed. The focused native/ordinary/rights/continuation regression batch passed101 tests across10 files, followed by a focused exact-integer typing regression. Demo Project PR50 passes focused project/board/query validation. The existing backend clone test measured683 files,502455-byte source proof and503264-byte final operation before the final87-character inspector title reduction; both are below unchanged limits.

The local built-app Chromium journey reached the comparison tab and Run. Capability discovery to cloud.openvaultdb.com failed from the localhost preview origin before a root POST; this is not claimed as browser acceptance. The retained trace is in the task coverage/native-federation-browser directory. Root must verify the real deployed datatug.app origin and network after landing. Public server capability evidence is recorded in 2026-10-19-server-observation.json. No source scans or fabricated comparison data were substituted.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/feature-specification*
