---
format: https://specscore.md/feature-specification
status: Draft
---

# Feature: Shared shipping evidence charts

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/shared-shipping-evidence-charts?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/shared-shipping-evidence-charts?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/shared-shipping-evidence-charts?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/shared-shipping-evidence-charts?op=request-change) |
**Status:** Draft
**Source Ideas:** —

## Summary

Core-compatible held evidence preparation and one shared three-kind SVG presentation leaf.

## Problem

Evidence charts need a shared presentation boundary that preserves held row identity, honest unavailable states and the published Go fingerprint rather than creating a separate demo renderer.

## Behavior

The semantic leaf mirrors Core v0.63.0 timeline, timing-bars and heatmap mappings and optional Result.rowEvidence v1. Existing Results remain compatible. Synchronous metadata decoding is structural only. Asynchronous standard WebCrypto fingerprint verification must complete before preparation or public evidence resolution exposes inspection selectors/refs; structural decoding alone grants no availability. Metadata validation binds exact execution, scope, source generation, typed row keys and canonical recordset fingerprint. A raw JSON entry rejects duplicate members before parsing discards them. Returned references and selectors are detached.

Canonical bytes and SHA-256 agree with all seven published Core fixtures, including Go HTML escaping, U+2028/U+2029, negative zero, floating formatting and large integer strings. Caller supplied expected held identity is a comparison context, never an authorization grant.

Asynchronous prepareEvidenceChart accepts one complete held result, a persisted mapping and expected held context. Timeline renders observed points in declared lane sequence, never implied spans. Measured timing requires distinct observed endpoint identities, compatible clock and precision, ordered timestamps and both admitted endpoint slots; otherwise it is unavailable. Heatmap admits only pass/fail/unknown and refuses duplicate cells; missing evidence is unknown.

One EvidenceChartComponent consumes this prepared data for both future canonical DataTug and Dashboardius consumers, renders ECharts SVG scatter/bar/heatmap and exposes the same exact cells and inspection requests in an accessible table. Inputs represent loading/error/empty/active lifecycle; disposal cancels presentation observers. The component does not fetch, execute, route, store, authorize or silently rerun.

Public entry points: decodeEvidenceChartSpec, prepareEvidenceChart, decodeEvidenceResultJSON, decodeRowEvidence, verifyRowEvidence, resolveRowEvidence, canonicalRecordsetJSON, recordsetFingerprint and EvidenceChartComponent. Inspection carries the exact selector plus actual observation ID for timing endpoints. Consumers must await preparation and fence its publication against scope changes, discard prepared data on revocation, and recheck current rights/retention on open. All public resolve/JSON admission paths verify fingerprints asynchronously.

## Acceptance Criteria

### AC: wire-and-fingerprint-compatibility

Given published Core fixtures and old Results, strict decoding preserves old output and all seven exact canonical byte/digest fixtures pass. Malformed sidecars, unsupported versions, mismatched execution/fingerprint/scope/generation, duplicate keys/rows and invalid refs refuse presentation.

### AC: honest-three-kind-preparation

Given complete held data, timeline emits points without inferred spans, timing measures only distinct compatible admitted endpoints and heatmap refuses duplicate cells. NULL or missing evidence never becomes a passing cell or measured zero.

### AC: shared-accessible-presentation

Given each prepared kind, the same shared leaf renders a distinct actual SVG series and exact typed-cell table. Native buttons emit the unchanged held selector; unsafe labels remain text. Loading/error/empty/inactive transitions and disposal work in zoneless change detection.

### AC: bounded-consumer-boundary

Leaf tests make no provider/ACL, current retention, Board persistence, canonical editor/profile integration, deployed rendering or full shipping journey claim.

### Review correction

Independent review of `fcf15711` found that direct public hashing and evidence resolution could bypass full recordset/Result validation. One shared decodeRecordset path now validates closed Core column types, names, every cell and row width before all public hashes; public verify/resolve use the shared full Result decoder, including the absent-sidecar path, before exposing references. Digest and verified operations live in a separate integrity module to avoid a decoder import cycle. Regressions include independently computed matching digests for invalid non-key cells/columns and missing required Result envelopes. One shared exact Go strings.TrimSpace helper is used for Core-required nonempty versus canonical checks, including parameter/fact IDs, column names, provenance/limitation labels, execution segments and sidecar context. NEL is whitespace and BOM is preserved; public API regressions establish both refusal and valid behavior. Follow-up Core parity checks require canonical selection/context fact IDs before verified resolution and preserve proleptic Gregorian years 0000–0099 without JavaScript Date.UTC remapping. Public helper tests cover valid early dates and leap-century refusals. No validation bypass or authority waiver is accepted.

### Published wire compatibility boundary

The additional byte-pinned core-v063-wire-parity.json oracle was generated with the actual published Core v0.63.0 under Go1.27.2. It captures legal/invalid UTC time forms, dates, integer/decimal values and nil-slice Result validation. Legal one-digit hours and comma fractions retain their exact original text in canonical bytes. Explicit null slice fields normalize to typed empty arrays for Recordset columns/rows, zero-column nil rows, Result limitations/bindings and Limitation hiddenColumns; missing required envelope fields and nonzero-width nil rows still fail.

This is tested scalar-wire compatibility, not an assertion of complete Core transport coverage. Scalar-only Binding remains the existing client contract: Core TypedValueOrSet/valueFactIds is unsupported here. Core-valid check-run versions beyond JavaScript safe integers remain refused rather than rounded. Chart observation arithmetic still accepts only canonical UTC millisecond timestamps; other legal wire times or finer precision remain unavailable for measured spans without inventing zero. None of these limits is a current-rights or execution admission grant.

## Open Questions

Canonical Board/editor and declarative Dashboardius profile integration, actual retained provider enrichment, current-rights open behavior and browser-authored Go Project Store roundtrip remain owning consumer gates.

---
*This document follows the https://specscore.md/feature-specification*
