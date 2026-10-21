---
format: https://specscore.md/feature-specification
status: Draft
---

# Feature: Shipping working copy controls

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/shipping-working-copy-controls?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/shipping-working-copy-controls?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/shipping-working-copy-controls?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/shipping-working-copy-controls?op=request-change) |
**Status:** Draft

**Source Ideas:** —

## Summary

Expose the published Backend v0.42 working-copy lifecycle in the native hosted project web UI. This is one bounded part of the [shipping investigation story](https://github.com/datatug/backstage/tree/main/spec/features/unsigned-shipping-investigation), not recording-readiness proof.

## Behavior

### REQ: native-entry-and-current-authority

Native project overview links to its scoped shipping workspace. Cold links refetch current metadata; Back opens overview and the exit opens Incidents, where an environment must be selected. Public/GitHub projects have no mutation controls. Verified actor and State.canWrite are affordance fences only: each Backend operation retains current Space/project/service authorization. These controls do not publish SQL sources or change entitlements.

### REQ: explicit-lifecycle

GET shipping/revision and POST shipping/action use their published environment-independent DTOs. Show current configuration, generation/revision/hash and immutable log identities. Correction does not imply assignment; replay explicitly names order11045 or11062. Reset requires confirmation and creates a new generation. A503 is unavailable metadata, never proof of an empty copy. Initialize is always explicit; the published server refuses a new initialize operation when a copy exists.

### REQ: frozen-operation-and-conflict

Hold the exact actor/scope, payload, expected pointer and operation ID through an uncertain reply and remount in a bounded session-only intent journal. Duplicate submission is disabled; retry explicitly repeats the original intent. Read authoritative current metadata after success, including an older replay receipt. A409 exposes expected/current revision and requires explicit review of fresh current metadata before a new action. Actor/project changes fence late responses and clear protected held content and intent. Revocation removes mutation controls and held metadata. No protected rows, tokens or source blobs are persisted by this UI.

## Acceptance Criteria

### AC: scoped-native-lifecycle

Given a current authorized native project, when its overview entry or cold shipping link opens, then actual metadata appears asynchronously, navigation preserves Space/project, and only explicit initialize/correct/replay/confirmed reset sends the published action shape. Unavailable, denied and readonly states stay visible and honest.

### AC: retry-conflict-and-scope

Given a lost reply, old receipt,409 or actor/project change, when the user retries or refreshes, then exact operation identity and expected pointer survive uncertain retry; no automatic mutation/rebase occurs, fresh GET wins over older receipt projection, and stale responses cannot reveal content in the new scope.

### AC: independent-runtime-gate

Native authenticated request and DOM regressions, strict test compilation, owning lint/build/zoneless checks must pass. Actual deployed browser action/reload evidence remains a parent-owned gate. SQL publication, Session/Bag applied context, retained evidence, baseline Check before Case, three canonical charts, physical relationship publication and Resolve remain subsequent gates; this feature claims none of them.

## Open Questions

None at this time.

---

_This document follows the https://specscore.md/feature-specification_
