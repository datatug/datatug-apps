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

Given an ordinary JSON or native stream result without a protected execution receipt, then locally constructed provenance never invents a protected profile. Source details identify OVDB server execution neutrally, preserve genuine API-supplied profiles and retain absent source terms without inventing a licence. Browser runtime receipt labels remain unchanged.

### AC: readable-inspector

Given the showcase inspector, then it occupies its own full-width row while neighboring chart cards remain unchanged. Long tab titles scroll horizontally on narrow screens; keyboard focus selects and reveals the active tab. Switching tabs or chart/grid views reuses existing query/result identities without rerunning held queries.

### AC: journey

Given the existing inspector tab and saved query route, when a visitor runs and inspects the comparison and revisits the result, then it works in the real browser without extra taps or client scans; existing native single-database focused tests pass and demo project-copy preflight remains within 500 KiB.

## Validation snapshot

The production app build and main/app Nx lint targets passed; TypeScript spec checking passed. The focused native/ordinary/rights/continuation regression batch passed101 tests across10 files, followed by a focused exact-integer typing regression. Demo Project PR50 passes focused project/board/query validation. The existing backend clone test measured683 files,502455-byte source proof and503264-byte final operation before the final87-character inspector title reduction; both are below unchanged limits.

The local built-app Chromium journey reached the comparison tab and Run. Capability discovery to cloud.openvaultdb.com failed from the localhost preview origin before a root POST; this is not claimed as browser acceptance. The retained trace is in the task coverage/native-federation-browser directory. Root must verify the real deployed datatug.app origin and network after landing. Public server capability evidence is recorded in 2026-10-19-server-observation.json. No source scans or fabricated comparison data were substituted.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/feature-specification*
