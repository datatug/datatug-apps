---
format: https://specscore.md/feature-specification
status: Implementing
---

# Feature: DataTug Work web workspace

## Summary

A project Work view and membership-scoped My Work view share one authoritative Incident, Detective Case and Task domain. The existing specialised Incident conversation, Detective investigation, Check, Query and Context Bag tools remain available. Work is for accountable data operations, investigation and evidence-backed follow-up.

The reviewed cross-repository specification, architecture decisions, migration procedure, permissions and storage guarantees live in [Backend PR 105](https://github.com/datatug/backend/pull/105), under `spec/features/datatug-work/`. This document records the web implementation and its reproducible acceptance evidence; it does not define a second domain or Context Bag format.

## Behaviour

Project Work supports shared create/edit controls, owner and multiple assignees with a primary person, priority, deadlines, type-specific legal transitions, comments, chronological activity and navigable relationships. My Work discovers currently visible projects and reports partial discovery or admission failures honestly. Native Incident/Case entry points create canonical Work in hosted projects; shared metadata controls return to Work while evidence tools stay specialised.

Every Work type uses the existing session Context Bag wire format and authenticated HTTP commands. The UI distinguishes inherited snapshots/follow-parent references from local values, named sets and provenance. A child enrichment stays local until an explicit proposal is reviewed and accepted. Private execution copies remain unapplied until the investigator selects values and applies them in the existing Context Bag drawer. Source and project admission remain independent of assignment.

All writes go through authorised HTTP APIs. Commands preserve an operation ID for exact retry and carry expected versions. A failed modal submission reveals the recovery card rather than trapping the user behind a disabled overlay. Principal, project and item changes synchronously discard protected cached values, previews and drafts. Permission loss purges protected state. Native Incident response decoding admits only the published Work linkage and reopen/epoch fields while preserving strict legacy proof checks.

## Scope and limits

- First supported Work store: hosted Firestore with server transactions. Git/local projects show an explicit unsupported state. Existing legacy hosted projects require the documented operator migration; the UI distinguishes that gate from a stale write.
- Check and Query references and backlinks are supported. Watch remains an artefact and its scheduling/execution/notification architecture is untouched. Unimplemented Watch/dashboard reference selectors are not exposed as guaranteed-failing actions.
- Related Work titles are a same-project server display projection, never duplicated shared metadata or client-side N+1 reads.
- The existing Shipping browser fixture supplies a real SQLite Check and explicit typed `order_id`. It does not configure invoice-style native query authoring or semantic automatic query-input mapping. The acceptance journey uses the existing Case Check runner and retained run evidence, plus an independently admitted private Context Bag execution snapshot.
- Postmortem has no UI, route, generation, publishing or sharing workflow in this change. Future types extend the canonical discriminator/type-specific composition.

## Acceptance criteria

| Criterion | Automated coverage | Browser evidence |
|---|---|---|
| Shared create, edit, assignment, deadlines and type lifecycle | `work.models.spec.ts`, `work-form.component.spec.ts`, `work-page.component.spec.ts`; Backend domain/API tests | Real lead/developer journey and independent Case/Task journey |
| Context isolation, inheritance and explicit propagation | `work-context.component.spec.ts`, Work page transport tests, native workspace copied-set regression; Core/Backend session tests | Incident 11045 → delegated Case snapshot → local enrichment → reviewed parent proposal; private copy and explicit Apply |
| Existing evidence tools and artefact identity | Native Incident/Case/Check tests, artifact backlinks component/API tests | Actual Shipping SQLite Check run retained in Case; Task links existing Check and folder-qualified Query; both backlinks |
| Concurrency, authorisation and sensitive-state invalidation | Scope/principal/denial/modal-recovery component regressions; Backend HTTP/Firestore tests | Two-tab stale edit, invalid Case transition and viewer mutation rejected without state change |
| Native compatibility | Strict legacy/current proof, epoch, reopen and Work ID decoder tests; hosted Incident checkout regression | Canonical Incident resolves/closes then native Incident page cold-read succeeds |
| Responsive and keyboard UX | Shared controls/routing tests | 390×844 list/detail/form/context/status; no horizontal overflow; create-field tab order; context and transition focus/escape restoration |
| Persistence and Watch compatibility | Backend full-field restart receipt and real Watch integration regression | Reload throughout journey; coordinated real-service restart receipt, recorded separately from Watch browser claims |

See [acceptance evidence](acceptance.md) for exact commands, source versions, observed results and screenshots.

## Open questions

Production rollout requires coordinated Backend/Core deployment, existing-project migration and the Backend-documented Firestore access-control audit. The implementation does not deploy or merge these draft PRs automatically.
