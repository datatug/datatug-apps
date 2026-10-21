---
format: https://specscore.md/feature-specification
status: Implementing
---

# Feature: Independent chart source composition

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/independent-chart-sources?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/independent-chart-sources?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/independent-chart-sources?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/independent-chart-sources?op=request-change) |
**Status:** Implementing
**Source Ideas:** —

## Summary

Add a compatible independently executed saved query to a normal chart, with the same action in the guided session.

## Problem

The chart wire accepts several independent saved-query bindings, but the widget executes only single-source charts. The guide can reveal a finished federated chart without teaching visitors how to add another real source. This feature completes that ordinary product capability and demonstrates it with independently queried customer counts while retaining the existing genuine root-federation comparison.

## Behavior

An editable plain-bar card exposes Sources for at most two independent bindings. The visitor explicitly confirms that its existing declared unit applies to both sources; shape compatibility alone does not establish semantic compatibility. A visitor chooses a currently authorized saved query using the same category and measure columns and explicitly declares a common unit. Adding it runs the existing held dispatcher for that binding, retaining each original result, identity and receipt. Presentation aligns exact labels across the union; a missing observation remains missing, never zero. No values are summed, country aliases normalized, time ranges aligned or currencies converted. The unit is author-declared, not inferred from matching names or a provider licence.

The same validated source action operates in hosted authoring and session authoring. The guide initially adds the new canonical comparison card with an explicitly validated subset of its source bindings, then adds the second canonical binding using that ordinary action. Source definitions remain canonical; the seed cannot invent or replace queries or mappings. The final working board equals the canonical full dashboard. Restart starts empty, Previous/Next replay source edits, reload restores only bounded session state, and Show Full directly restores the canonical board.

Every binding retains its own loading, error, retry, raw rows and provenance. A failed or incomplete source withholds the combined chart and exposes retry without fabricating output. A source edit cancels obsolete requests; generation/identity checks reject stale completions. Unchanged source snapshots are reused, presentation controls execute no query, and explicit refresh is deliberate. Existing races, single-result grouped bars and evidence charts retain their current admission contracts.

Entry: ordinary board authoring or the demo guide → Sources → choose query/confirm common unit → Add source → same card with separately inspectable source results. Cancel and errors stay on the card. No new route or backend mutation path is introduced; hosted saving uses the existing authorized board endpoint, while the guide uses sessionStorage only.

## Acceptance Criteria

### AC: ordinary-source-action

Given an authorized plain-bar chart, when a visitor adds/removes a distinct authorized saved query through Sources, then ordinary and session editing share validation, at most two bindings are accepted and race/grouped/evidence incompatibilities are explained.
### AC: independent-execution

Given multiple bindings, when the card becomes active, then existing dispatcher paths execute each binding once with its complete identity; adding a source reuses unchanged held data and never invents an executor or provider receipt.
### AC: truthful-comparison

Given complete admitted compatible results and a declared unit, when aligned, then exact category union preserves missing values, original source rows/receipts and numeric precision; duplicate categories, unsupported numeric forms, missing units or ineligible rights/completeness fail visibly.
### AC: source-lifecycle

Given delayed or failed source reads, when a binding changes, is removed, retried or refreshed, then obsolete completions cannot publish, retry targets the failed source, and no partial result is presented as a complete comparison.
### AC: guided-construction

Given the demo's canonical two-source card, when its guide starts, then a validated canonical source subset displays Northwind alone, the ordinary add-source action executes Chinook, and the final working board matches canonical. Previous/Next, Take Control/Resume, reload, Restart and Show Full preserve their contracts without project writes or DB downloads.
### AC: source-inspection

Given a composed chart, when inspecting a source, then its original query, raw result and provenance are visible; gaps and author-declared units are explained with keyboard-accessible controls and narrow-screen layout.
### AC: acceptance-evidence

Focused model, preparation, controller/component and captured-browser tests prove the complete ordinary/tutorial journey, cancellation/retry/reuse and zero tutorial project mutations/downloads. Deployment and live browser evidence remain separate root-owned receipts.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/feature-specification*
