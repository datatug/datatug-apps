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

Native project overview links to its scoped shipping workspace. The actual Space-owned router mounts shipping, Boards, new Board and Board detail pages; exact board aliases redirect to Boards. Unsupported session, malformed, public-store and extra-segment variants remain rejected. Actual Router navigation tests instantiate existing page templates and follow the rendered native Boards destination. Cold links refetch current metadata; Back opens overview and the exit opens Incidents, where an environment must be selected. Public/GitHub projects have no mutation controls. Verified actor and State.canWrite are affordance fences only: each Backend operation retains current Space/project/service authorization. Working-copy actions do not publish SQL sources. Separate explicit query-access controls use current authorized publication metadata and never change membership or entitlements. The Sessions exit preserves the native project and requires explicit full-scope selection/Apply; it performs no hidden context mutation.

### REQ: explicit-lifecycle

GET shipping/revision and POST shipping/action use their published environment-independent DTOs. Show current configuration, generation/revision/hash and immutable log identities. Correction does not imply assignment; replay explicitly names order11045 or11062. Reset requires confirmation and creates a new generation. A503 is unavailable metadata, never proof of an empty copy. Initialize is always explicit; the published server refuses a new initialize operation when a copy exists.

### REQ: frozen-operation-and-conflict

Hold the exact actor/scope, payload, expected pointer and operation ID through an uncertain reply and remount in a bounded session-only intent journal. Duplicate submission is disabled; retry explicitly repeats the original intent. Read authoritative current metadata after success, including an older replay receipt. A409 exposes expected/current revision and requires explicit review of fresh current metadata before a new action. Mutation POSTs never automatically resend after401. Original native auth/project streams synchronously cancel token waits and in-flight mutation subscriptions on scope changes, and destruction cancels them too. The same current native identity is checked before source subscription; no browser token parsing supplies principal authority. Actor/project changes fence late responses and clear protected held content and intent. Revocation removes mutation controls and held metadata. No protected rows, tokens or source blobs are persisted by this UI.

### REQ: observed-query-access-and-native-scope

GET shipping/publication uses the exact scope plus explicitly selected environment and returns `{exists:false}` only for authorized absence, or `{exists:true,publication:{revision,enabled}}`, including disabled current state. Malformed responses, denial and infrastructure errors never become revision0. POST uses one frozen operation and the observed expectedRevision;0 is allowed only after explicit absence. Never resubmit after401. Preserve an uncertain operation through bounded session-only remount; conflict requires explicit review of a successful fresh read. After acknowledgement or recovered old receipt, GET current state again: an old enable receipt cannot overwrite a later disable. No SQL/provider readiness follows from a publication acknowledgement alone.

Each native Session environment may carry optional `nativeDetective`; explicitfalse excludes shipping from unsupported dispatch while omission retains the existing global fallback. Preserve both invoice and shipping environment/identity-domain pairs. Unknown eligibility types refuse. Native Session authoring uses the existing workspace; this UI neither invents QuerySources nor creates/applies a Bag automatically. Full native lifecycle/active-account/source and retained Check evidence are owning Backend/host acceptance gates.

## Acceptance Criteria

### AC: scoped-native-lifecycle

Given a current authorized native project, when its overview entry or cold shipping link opens, then actual metadata appears asynchronously, navigation preserves Space/project, and only explicit initialize/correct/replay/confirmed reset sends the published action shape. Unavailable, denied and readonly states stay visible and honest.

### AC: retry-conflict-and-scope

Given a lost reply, old receipt,409 or actor/project change, when the user retries or refreshes, then exact operation identity and expected pointer survive uncertain retry; no automatic mutation/rebase occurs, fresh GET wins over older receipt projection, and stale responses cannot reveal content in the new scope.

### AC: observed-publication-and-eligibility

Given explicit absent, disabled, denied or failed current publication reads, when enabling/disabling, retrying an uncertain operation, remounting, changing actor/project or receiving409, then only an observed CAS version is submitted, the same operation survives uncertainty, no401 retry crosses identities, conflicts require fresh review and current GET state wins over old receipts. Given global invoice dispatch with explicitfalse shipping eligibility, only the supported invoice scope appears; the full shipping scope remains available for native authoring.

### AC: independent-runtime-gate

Native authenticated request and DOM regressions, strict test compilation, owning lint/build/zoneless checks must pass. Actual deployed browser action/reload evidence remains a parent-owned gate. Actual provider publication/current-grant enforcement, Session/Bag applied-context lifecycle, retained evidence, baseline Check before Case, live three-chart values, physical relationship publication and Resolve remain parent-owned runtime gates; component/transport fixtures do not establish them.

## Open Questions

None at this time.

---

_This document follows the https://specscore.md/feature-specification_
