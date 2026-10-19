---
format: https://specscore.md/plan-specification
status: Executing
---

# Plan: Polish the complete held-result exploration journey

**Status:** Executing
**Source Feature:** held-result-exploration
**Date:** 2026-10-19
**Owner:** clone_offer_polish
**Supersedes:** —

## Summary

Make the existing held-result showcase easier to explore without executing more queries or inventing a new board/provider contract. First repair the bounded TEST copy prerequisite, then add reusable presentation actions, ordering and monthly trend, extend the current tutorial, and prove the complete journey through focused fixtures and independent review.

## Approach

Reuse BoardWidget, HeldResultPresentation, existing Orders admission/date preparation, lazy ECharts and the tutorial driver. Pure preparation helpers own deterministic sorting/month buckets; transient view state stays outside query identity and persisted Board JSON. Keep the current single/paired bars, race and source grids compatible. Root owns landing, deployed preview, buyer login and provider mutations; this native Codex Sol6.1 macOS lane owns Apps source only. The separate Demo lane owns board documentation/metadata; PR396 hosted-personal-cloud-logs is outside scope and its overlapping environment additions must be preserved.

### Visitor journey and observable outcomes

1. Open the full showcase or tutorial; no additional action is needed for the existing automatic Orders/root loads. Loading and bounded failures are visible; retry is a deliberate action.
2. Scroll the page through all countries, choose a deterministic sort, and select Canada with keyboard or pointer. The persistent selection/Clear status and exact shipped-to count explain what changed.
3. Switch paired chart/rows and Orders race/trend/source rows. The same held data, selected country and paused race settings remain; the monthly overview contains all 23 months and 830 orders.
4. Follow tutorial trend → source rows → race. Previous, Restart and Show Full reconstruct predictable state; the completed board equals direct full mode, and route exit clears ephemeral selection.
5. Optionally copy the project: explicitly choose the approved TEST Business/Space destination, retain the active continuation across real authentication, and use authoritative OAuth lookup plus scoped setup routes. Root performs buyer/provider acceptance; failure or missing authorization stays explicit.

### Ownership and contract seams

Expected Apps files are held-result-presentation, board-widget, grouped-bar preparation, semantic Orders preparation, a reusable monthly chart view, tutorial runtime/session/scenario, focused component/model tests and existing country/tutorial browser fixtures. Trend requires a private session-presentation seam rather than expanding Core defaultView (`chart|grid`). Preserve existing edit/replay semantics and tutorial cursor persistence; manual controls do not persist. TEST work is limited to preview routing configuration/interceptor integration and the existing new-project navigation/form/copy-offer continuation seam, with focused auth/base-URL tests. No executor/provider/Core/Cloud/CLI changes in the original exploration slice; the authorized follow-through adds only query-session normal-completion cleanup and zoneless store-page rendering, without changing provider wire, routing, permissions or architecture. Repository creation, new OAuth scopes, live billing changes and new paid engines remain excluded.

## Tasks

### Task 1: Repair the TEST copy entry prerequisite

**Verifies:** held-result-exploration#ac:preview-entry
**Status:** complete

Make a small separately reviewable first commit: preserve normal authoritative OAuth routes with exact relative endpoint/method classification and injected bases while routing current scoped setup/read/status/pending routes to preview. Do not use arbitrary URL prefixes or change credential destinations for other builds. Add explicit Business/approved Space choice without changing production billing defaults or losing the continuation through auth/draft/retry. Coordinate environment/spec overlap with PR396 before editing. Cover exact route split and navigation/draft context; do not simulate buyer acceptance.

### Task 2: Make card actions and selected state easy to reach

**Id:** held-card-actions
**Verifies:** held-result-exploration#ac:actions-and-selection, held-result-exploration#ac:page-scroll, held-result-exploration#ac:execution-integrity
**Status:** complete
**Note:** Complete to reviewed source and captured-fixture scope; live/auth acceptance remains Task7.
**Evidence:** https://github.com/datatug/datatug-apps/pull/397, ea9419b844590d8b5b747cd93098a2e318886554

Reuse existing secondary action/button patterns for Refresh/Open query and visible retry. Remove paired-only vertical overflow, preserve grid horizontal overflow, and keep exact selected-country/Clear status outside view-specific content. Retain truthful Orders captions, complete-result refusal, focus and current 44px control behavior.

### Task 3: Derive stable grouped ordering

**Id:** grouped-ordering
**Verifies:** held-result-exploration#ac:stable-sort, held-result-exploration#ac:execution-integrity
**Status:** complete
**Note:** Complete to reviewed source and captured-fixture scope; live/auth acceptance remains Task7.
**Evidence:** https://github.com/datatug/datatug-apps/pull/397, ea9419b844590d8b5b747cd93098a2e318886554

Add a pure ordering projection over admitted rows with exact labels/index ties and signed first-minus-second difference for the paired contract. Compare integer differences exactly or visibly refuse unsupported differences; test safe-integer extremes (including MAX_SAFE minus a negative value), fractions and equal differences. Keep raw rows/receipts, category identity and shared scale unchanged. Test ties, negative/fractional values, invalid representations, selection/focus and generic declared-series labels.

### Task 4: Present complete monthly Orders trends

**Id:** monthly-orders-trend
**Verifies:** held-result-exploration#ac:monthly-trend, held-result-exploration#ac:execution-integrity
**Status:** complete
**Note:** Complete to reviewed source and captured-fixture scope; live/auth acceptance remains Task7.
**Evidence:** https://github.com/datatug/datatug-apps/pull/397, ea9419b844590d8b5b747cd93098a2e318886554

Reuse/extract the existing strict raw Orders date/id validation and admission boundary. Produce calendar buckets including gaps from the full raw result, independently of country race totals/Top N. Add a lazy ECharts view with transparent orders-per-month units and accessible data alternative. Preserve the race instance/state while inactive and respect reduced motion/manual controls. Cover full 23-month/830-row fixture, duplicate/invalid/partial/unverified/empty inputs and missing months.

### Task 5: Extend the existing tutorial presentation seam

**Id:** tutorial-presentation
**Verifies:** held-result-exploration#ac:tutorial-lifecycle, held-result-exploration#ac:execution-integrity
**Status:** complete
**Note:** Complete to reviewed source and captured-fixture scope; live/auth acceptance remains Task7.
**Evidence:** https://github.com/datatug/datatug-apps/pull/397, ea9419b844590d8b5b747cd93098a2e318886554

Add session-only presentation view state/actions compatible with existing tutorial replay; do not persist trend in Board JSON or widen provider wire. Demonstrate trend then source/race. Test every semantic stage, Previous/Restart/Show Full/reload/route lifecycle and canonical equivalence, distinguishing intentional tutorial session writes from ephemeral manual controls. Send final copy/selectors to the separate Demo author.

### Task 6: Prove the complete fixture journey and bounded performance

**Id:** fixture-acceptance
**Verifies:** held-result-exploration#ac:actions-and-selection, held-result-exploration#ac:page-scroll, held-result-exploration#ac:stable-sort, held-result-exploration#ac:monthly-trend, held-result-exploration#ac:tutorial-lifecycle, held-result-exploration#ac:execution-integrity, held-result-exploration#ac:acceptance-evidence
**Status:** complete
**Note:** Complete to reviewed source and captured-fixture scope; live/auth acceptance remains Task7.
**Evidence:** https://github.com/datatug/datatug-apps/pull/397, ea9419b844590d8b5b747cd93098a2e318886554

Resolve owning Nx targets and test context before execution. Extend existing desktop/mobile captured-read fixtures with settled initial one-root/one-Orders baselines, exact normalized bodies/source evidence, refresh/fail/retry, chart/trend/rows/sort/select/Clear, keyboard and reduced motion. Record all query prefixes and forbidden mutation/downloads. Measure bounded helper/view work over the fixed fixture; no public DB load loops. Declare a transient test port owner and teardown before starting it; do not touch root's canonical4330/TEST18782 resources or resize a shared browser.

### Task 7: Publish the reviewed candidate and retain honest acceptance gates

**Id:** release-acceptance
**Verifies:** held-result-exploration#ac:preview-entry, held-result-exploration#ac:acceptance-evidence
**Status:** in_progress
**Note:** Published/deployed source; strict real-network measurement and actual GitHub buyer authentication/copy remain open.

PR397 source/fixture delivery landed at ea9419b844590d8b5b747cd93098a2e318886554. Tasks2–6 are complete to independently reviewed source and captured-fixture scope; this does not close the live/auth gates. The first live attempt failed comparison readiness without a retained inline ledger; the second rendered all three results but retained an Orders net::ERR_ABORTED. Query completion teardown and diagnostic persistence are being repaired in showcase-query-completion; a successful strict live measurement and actual GitHub buyer authentication/copy remain pending. Run focused units/type/lint and actual production build with existing CSS budgets and official frozen artifact preparation. Fix own findings through normal hooks; no approvals/budget bypass. Freeze exact source head/tree, retain logs/screenshots/limits, obtain independent review, then publish one Apps PR through WB and attach it. Root alone lands and switches its same-origin buyer preview to the frozen candidate. Task1 source review passed at bd442ca2 with108 focused tests and owning lint/typecheck; this does not close actual buyer authentication or copy acceptance. Record deployment, actual instrumented live-read mechanism and authenticated copy independently; missing real-network/auth evidence remains open.

### Task 8: Enable the licensed Query Editor result exploration

**Verifies:** held-result-exploration#ac:query-grid-enterprise
**Status:** in_progress

Reuse the shared ResultsGrid and existing lazy Enterprise/Charts module loader. Enable group drop zone, range clipboard and explicit selected-range charting without automatic grouping/chart creation. Decorate numeric columns with safe whole-column projections while retaining raw text for display/export/inspection and exact text filters for excluded columns. Name approximate analytics and current loaded-page scope. Preserve native grouping/filtering/chart updates, raw leaf-row counts/copy and Current-row identity; clean charts only on actual snapshot/page/schema replacement. Add focused adapter/component/query-page regressions and a captured-read licensed browser journey; root owns the actual browser, vendor/license validation, publication and landing. No key/config is committed and no live provider query is required for fixtures.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/plan-specification*
