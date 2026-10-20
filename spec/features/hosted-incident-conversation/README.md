---
format: https://specscore.md/feature-specification
status: Draft
---

# Feature: Hosted Incident conversation

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/hosted-incident-conversation?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/hosted-incident-conversation?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/hosted-incident-conversation?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/hosted-incident-conversation?op=request-change) |
**Status:** Draft
**Source Ideas:** —

## Summary

Authenticated human Incident messages, scoped history and replay-safe posting in the private project web UI.

## Problem

Hosted Incidents currently link Cases but lack the persisted human messages needed to explain the issue and its evidence. AI-provider chat and Case notes do not own this human Incident conversation.

## Behavior

### REQ: hosted-event-conversation

Use the existing authenticated hosted Incident event stream. Read `/datatug/detective/incident_events` with full project/Space/environment/IncidentRef, afterSeq and bounded pages. Render note.added messages using the shared Incident event summary helper, actual server actor/interface/time and assertion. Do not let a caller choose actor/persona labels or deterministic-result. The composer offers claim, question, hypothesis and observation; inference remains unavailable until supported evidence references can meet its requirements. Refresh replaces held history under current rights. Cursor is the last scanned sequence, including hidden events; empty visible pages must still advance. Scope/principal changes clear held state and ignore old responses.

### REQ: replay-safe-message

Post append-message with a stable operationId and frozen expectedSeq/message. Preserve the pending human draft and reference IDs in session-only storage scoped by principal and exact transport/project/environment/IncidentRef, solely for uncertain retry; confirmed messages remain server-owned. Lost replies/remount reuse the same request. Successful confirmation clears the pending intent and permits a later intentional message with identical text and a new operation. Older replay receipts preserve their actual event but never lower the known sequence or replace a newer Incident title/status/context projection. A sequence conflict requires explicit review/reload before a new operation uses the latest sequence. Paginated history must reach the current end before the review can release the conflicted draft. Errors preserve drafts; unauthorized reads/writes clear previously held messages. Disabled storage retains same-component retry semantics.

### REQ: honest-references-and-navigation

Offer existing saved Check definitions as a typed selector, clearly distinguished from an actual Check run/outcome. Never offer raw reference JSON/IDs, unsupported Check-run attachments or physical-folder references that the merged resolver cannot admit. Existing query/Check refs use scoped project route helpers; unsupported execution views remain explicit text rather than fabricated links. The backend remains authoritative for every reference and current rights. Preserve list → cold Incident detail → distinct Case and return. Private shared-Firestore Incidents navigation retains project scope. Use flat Ionic rows/panels, zoneless signals and accessible loading/empty/error/retry states.

This delivery covers human conversation only. Shipping source admission, semantic relationship publication, actual red/green Check-run attachment, fixed criterion/recovery/Resolve integration and shared dashboard persistence/rendering remain separate full-journey dependencies.

## Acceptance Criteria

### AC: real-attribution-and-reload

Given scoped persisted messages, when history arrives asynchronously or the detail cold-loads, then the UI renders actual server attribution and assertion without a second user action; no fake actor or deterministic claim is sent.

### AC: replay-and-conflict

Given an uncertain message reply or a remount, when Retry is selected, then the identical operation/payload/expectedSeq is sent. Given a conflict, when the user reviews current history, then the draft survives and only a subsequent post creates a new intent at the refreshed sequence.

### AC: scope-and-rights

Given delayed responses, hidden events, revoked access or a changed project/principal, when history refreshes/pages, then scanned cursors advance, old projections clear on refresh, unexpected scoped events fail closed and old responses cannot populate the new scope.

### AC: existing-flow-and-evidence

Given a private project Incident and saved Check, when the user navigates from the project menu, posts a definition reference and opens a linked Case, then full canonical refs remain in navigation/API, definition references stay distinct from run results and the Case remains separate. No protected cached rows or inline SQL enter the message.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/feature-specification*
