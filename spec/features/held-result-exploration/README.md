---
format: https://specscore.md/feature-specification
status: Implementing
---

# Feature: Reusable held result exploration

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/held-result-exploration?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/held-result-exploration?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/held-result-exploration?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/held-result-exploration?op=request-change) |
**Status:** Implementing
**Source Ideas:** —

## Summary

Explore admitted held results with clear actions, stable sorting and complete monthly Orders trends without extra execution.

## Problem

The existing showcase proves native server execution and linked held Orders, but exploration is harder than it needs to be: nested scrolling hides countries, actions and selection state are easy to lose, sorting is absent, and the race does not expose a complete monthly overview. TEST project-copy acceptance is also blocked when OAuth discovery is incorrectly sent to the scoped preview service.

## Behavior

A visitor opens the canonical showcase or its tutorial. Without another action, existing admitted query results load; compact secondary Refresh and Open query actions remain discoverable, with visible retry on failure. The page scrolls through every paired country; the source grid retains horizontal scrolling. Sorting changes presentation only. A selected country and Clear remain visible across chart/rows and declared Orders detail views, with truthful orders-shipped-to counts.

The Orders race gains a Monthly trend presentation using its same complete, verified raw Orders result. It shows calendar-month order counts, including empty months, with an accessible data alternative. Race, trend and source rows reuse the original rows and evidence; leaving the race pauses it without losing frame, mode or Top N. The tutorial demonstrates trend, then source rows and race, and ends at the canonical full board through the existing driver.

The TEST copy journey keeps authoritative OAuth discovery separate from scoped project setup. An explicit Business intent and approved Space travel with the active demo continuation through navigation, auth, draft restoration and retry. Production billing defaults and existing authentication remain unchanged. Actual buyer authentication and provider writes are root-owned acceptance gates, not fixture-test claims.

## Dependencies

- native-server-federation

## Acceptance Criteria

### AC: preview-entry

Given the business-preview build, when the visitor discovers or authorizes a GitHub repository, then existing authoritative OAuth discovery/start/complete/resolve routes use their normal service; scoped project create/status/pending-setups/read routes use the current preview host. An explicit Business/Space choice preserves the demo continuation in the same navigation and restored draft. Ordinary production defaults, auth headers/scopes and billing behavior remain unchanged. Missing authorization fails visibly; fixtures do not establish authenticated buyer acceptance.

### AC: actions-and-selection

Given a loaded or failed held-result card, then compact secondary Refresh/Open query actions are available, loading is clear and failure exposes retry. Given a country selection, then its exact label and a keyboard-accessible Clear control with at least a 44px hit area remain available across chart/rows and sort changes. Only the declared verified Orders detail shows `X of 830 orders shipped to <country>`; Clear restores original rows/order, and unsupported results remain visibly unavailable.

### AC: page-scroll

Given desktop or 375px mobile layout, then all 17 paired country groups use page scrolling without an inner vertical scrollbar or clipping; source grids retain horizontal overflow and accessible labels/focus remain visible.

### AC: stable-sort

Given the same admitted paired rows, when Country, Northwind, Chinook or Difference is selected, then Country sorts exact labels ascending, numeric measures sort descending, and Difference sorts signed Northwind minus Chinook descending. Exact-label then original-index ties are stable. All 17 labels, original values, shared zero baseline, common scale, selected label and focused control survive. Generic grouped charts use declared series labels; the difference option requires exactly two compatible measures. Unsupported precise numeric representations are never silently coerced. Safe-integer differences use exact comparison (including differences outside the safe-number range); otherwise Difference must visibly report unsupported while Country/per-series ordering remains usable. Fractional charts remain supported and equal-difference ties stay deterministic.

### AC: monthly-trend

Given an eligible Orders race with the existing complete publisher-verified raw result, when Monthly trend is selected, then every unique valid order contributes once by raw OrderDate to a chronological calendar-month count; gaps are zero-filled. The showcase displays all 23 months totaling 830 orders, independent of race Top N or selected frame. Units, observed minimum/maximum raw OrderDate and an accessible monthly-data alternative are explicit; boundary months may cover only part of the sample period and are never presented as evidence of business decline. Partial, unverified, malformed/duplicate/invalid-date data fails visibly without dropping rows or claiming completeness; empty results are honest. The generic preparation/view is reusable for eligible Orders races without a persisted line-chart wire, new query, provider schema or dependency.

### AC: tutorial-lifecycle

Given any existing tutorial stage, when Next/Previous, Restart or Show Full is used, then the existing driver predictably demonstrates trend, source rows and race and reaches the same canonical board/card/query identities as direct full mode. Repeated full-mode entry is idempotent. Selection clears at restart/Show Full/route exit and when its producer disappears. Tutorial cursor/action restoration may use its existing bounded session storage; manual sort/view/select/Clear are ephemeral. Trend is session presentation state, never a new Core ChartDefaultView or saved board field.

### AC: execution-integrity

Given settled held results, when sort/view/select/Clear changes, then no extra query, save, storage write, SQLite/WASM download or mutation occurs; result order/provenance and genuine rights/profile evidence are retained. Race frame/mode/Top N and applicable focus survive view changes; inactive playback pauses. Refresh/retry executes exactly one fresh request with existing abort/latest-wins behavior. Lazy tabs retain held results and explicit Run behavior.

### AC: acceptance-evidence

Given the final candidate, then focused model/helper/component tests cover invalid/partial/missing-month data, ties, keyboard, reduced motion, errors and retry. Desktop/mobile fixture journeys assert normalized per-query request bodies/counts and a mutation/download ledger, plus bounded preparation/interaction performance. Production build passes unchanged CSS budgets. Independent exact-head review and root-owned deploy/authenticated acceptance are recorded separately from fixture and live-read observations.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/feature-specification*
