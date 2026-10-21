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

## Open Questions

Canonical Board/editor and declarative Dashboardius profile integration, actual retained provider enrichment, current-rights open behavior and browser-authored Go Project Store roundtrip remain owning consumer gates.

---
*This document follows the https://specscore.md/feature-specification*
