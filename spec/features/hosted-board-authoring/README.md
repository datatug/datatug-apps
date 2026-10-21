---
format: https://specscore.md/feature-specification
status: Draft
---

# Feature: Hosted board authoring

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/hosted-board-authoring?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/hosted-board-authoring?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/hosted-board-authoring?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/hosted-board-authoring?op=request-change) |
**Status:** Draft

**Source Ideas:** —

## Summary

Create, edit, save and reload canonical boards in an explicitly scoped hosted project.

## Problem

Hosted native projects have durable board APIs but their web pages reject asset reads and offer no revision-safe board authoring. Public tutorials and GitHub reads must retain their existing behavior.

## Behavior

### REQ: native-scope-and-rights

Project Boards navigation opens the existing canonical board workflow. Require the verified signed-in actor, native Space/project reference and explicit environment selected from actual State.environments. State.capabilities.canWrite controls save affordances; Backend remains authoritative for each operation. Missing environment never selects the first/default value. Actor/project/environment changes cancel stale publication and clear protected held definitions and results. GitHub/public reads and session-only tutorials remain unchanged; Entity UI/codec is a following slice.

### REQ: canonical-durable-editor

Boards → New board → title and saved-query widget controls → Save → canonical detail route → cold reload. Existing detail → edit controls → Save → reloaded definition. Use the same Board model, definition action/validation layer and BoardComponent renderer. Query choices come from the authorized project catalogue and include the canonical runner's SQL, DTQL and TugQL languages; HTTP and unknown languages are unavailable. The canonical SQL widget binds a saved query regardless of which supported language its definition uses. Its saved parameter bindings pass through the existing typed binding validation, and a changed saved binding blocks dispatch from an old card. Constants use structured typed parameter controls. Preserve supported untouched tab/chart graphs; refuse unsupported definitions rather than strip fields. Never persist inline SQL, results, credentials or selected runtime state.

### REQ: conditional-idempotent-save

GET board/list includes storage, spaceID, project, environment and detail id. Retain X-Datatug-Asset-Revision with matching ETag; missing/malformed revision blocks update. POST boards/save_board carries only scope, canonical board, operationId and ifNoneMatch:true for create XOR exact ifMatch revision for update. The authenticated response adapter preserves the existing token/401/failover path.

A bounded session-only journal freezes actor/full scope, payload, condition and operation. Lost replies/remount retry the identical operation. A successful replay may describe an older save: fetch current authorized detail before updating the view. Sequence/condition409 retains the draft and requires review of the current saved definition before a new operation. Explicit abandonment warns that an earlier operation may already have completed. Revocation withholds held content; no cached protected result fallback.

## Acceptance Criteria

### AC: board-save-reload

Given an authorized native project and explicit admitted environment, when a board is created or edited through saved-query controls and saved, then the same canonical definition and revision are loaded from the actual Go Project Store after cold reload. Existing public tutorial and GitHub read-only tests remain valid.

### AC: scope-retry-conflict

Given an uncertain save or changed project/actor/environment, when retried/remounted or a late response arrives, then retry retains its exact operation/payload/precondition and stale responses cannot publish into the new scope. Missing environment and unsupported definitions fail visibly. A409 requires current-definition review before a new save; current denial withholds protected definitions.

### AC: transport-and-consumer-evidence

Given actual auth transport, when detail gets a401 then succeeds, headers and opaque revision survive the authenticated retry. Request tests prove exact scope/body/conditions; DOM tests exercise structured inputs and save/conflict/reload states. A browser-author/save/reload journey through the deployed real Backend/Go Project Store remains a separate required gate; mocked request tests do not establish persistence or full shipping readiness.

## Open Questions

None at this time.

---

_This document follows the https://specscore.md/feature-specification_
