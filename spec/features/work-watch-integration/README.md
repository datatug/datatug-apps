---
format: https://specscore.md/feature-specification
status: Implementing
---

# Feature: Work and Watch integration

Version 1, 2026-10-24. The authoritative reviewed cross-service specification is
`datatug/backend/spec/features/work-watch-integration/README.md` on the coordinated
`datatug-work-watch` branch. Watches and Checks remain linked artefacts; Incident,
Detective Case and Task remain the canonical Work types.

## User journey

Open Watches in a shared project. The project server checks current membership
and its explicitly configured coordinator identity before showing events,
in-app notifications, email delivery state and linked work. Select Create
Incident, Create Detective Case, Create Task or Link existing work from a trigger.
Review the timestamp, environment, native Check receipt and selected context;
inspect and edit the normal Work form, then confirm. A duplicate confirmation
opens the same canonical item. Receiving a notification never creates work.

The handoff imports only explicitly mapped, authorised scalar context. Omitted
inputs are listed; raw matched source rows are not published into shared activity.
Personal evidence requires an explicit project-sharing checkbox. Context scope
must match both the Watch environment and configured identity domain.

Delegate an investigation from the Incident using the existing Work action.
Choose another assignee, due date and snapshot/follow-parent inheritance. The
assignee finds it in My Work, enriches their independent Context Bag and explicitly
proposes changes to the parent. Private execution snapshots still require Apply
before investigation. Assignment does not grant project or source access.

Work details retain imported Watch history even when the coordinator is offline.
Refresh evidence shows current authorised monitoring state; Record latest Watch
evidence opens a review before importing subsequent trigger/recovery events.
Recovery never closes work. Resolve/close explicitly after reviewing native
Check evidence. Recurring monitoring continues; one-shot completion/reset and
notification preferences remain available in the existing coordinator controls.
Those direct controls use the existing in-memory coordinator credential flow;
the trusted Work handoff requires no browser-side coordinator credential.

A completed one-shot can deliberately create a follow-up Task/Case or link
existing work from its recovery event. An Incident still requires a trigger.
Monitor next occurrence explicitly restarts the one-shot while preserving the
last known result, avoiding an immediate duplicate occurrence. Reset baseline
is a separate source-change acknowledgement. Trusted-panel notifications are
read-only; acknowledgement uses the existing connected coordinator inbox.

Retained Check execution can explicitly select the investigator's applied
private copy and attach its evidence to the linked Incident. The server checks
current canonical Work context and preserves immutable Work/source revision
references in the selected manifest. Shared Work bags are not execution sessions.
The additive `workContext` manifest field requires the updated Apps codec;
deploy Apps before Backend begins producing that field, or deploy both together.
Previously retained manifests remain readable and need no rewrite.

## Deployment and bounds

The manifest identifies coordinator endpoint/namespace. Backend runtime config
maps hosted users and exact Check/version/input identities to permitted context
subjects; credentials remain in a private deployment file. Missing configuration
fails closed and ordinary Work remains available. See the Backend deployment
notes for `DATATUG_WORK_WATCH_CONFIG`.

This version supports hosted Firestore Work and the existing transactional DALGO
SQLite single-coordinator runtime. It does not claim coordinator HA. Event
history is durable; operators must budget/backup its growth. Imports are bounded
to 200 evidence entries per work item and fail explicitly at capacity. Source
Check receipts are references, not remote runner database exports. Existing
Queries/Checks execute under current source authorisation and read-only rules.

## Reproducible verification

Use clean disposable Auth/Firestore emulators, not production or another agent's
state. Reuse Backend `TestWorkBrowserHost` and the demo project's original
`scripts/watch-shipping-demo.py` preparation and native daemon protocol. The test
host can export its exact accepted Shipping SQLite bytes for the native runners
with `DATATUG_WORK_WATCH_NATIVE_SQLITE`; its adjacent receipt identifies revision
and SHA-256. Correct/replay only the hosted source, then verify the exported bytes
match. This is a test fixture adapter, not a production replication service.

Build the SSO emulator profile through Nx. RecordsetCompare preparation must
verify its pinned artifact and attestation, and `consume.py verify-dist` must pass
for the emitted build. A private GitHub release credential belongs in the
environment; never commit it or substitute an unverified artifact.

Run the unchanged Work browser path:

```sh
wb run -- pnpm exec nx run datatug-app:e2e-work --output-style=static
```

For the integrated path, seed the existing 11045 shared recurring Watch as
`order-11045-shared` in the private coordinator fixture, with Alice/Bob in-app
and email subscriptions and one combined plus two outbound runners. The default
shipping scenario must still be delayed and unreplayed. Then run:

```sh
DATATUG_WORK_WATCH_E2E=1 wb run -- pnpm exec nx run datatug-app:e2e-work --output-style=static
```

The integrated primary journey begins at the real Watch event instead of manually
creating the Incident, then reuses the established delegation, Context Bag,
native Check, parent proposal, Task and human-resolution assertions. Recovery is
performed through the authorised hosted Shipping API, materialized from its
accepted revision for the runners, observed in the browser and explicitly
imported without changing the Incident status. No Work/Watch/Context/Check HTTP
request is intercepted. Browser screenshots and diagnostics are written under
`coverage/apps/datatug-work/`.

Reset by stopping the task-owned host/runners, saving any desired evidence,
starting fresh disposable emulator/coordinator storage, then initializing the
existing scenario and subscriptions again. Do not reset unrelated shared state.
For a restart proof, export/import the same emulator state and reuse coordinator
storage instead; verify exact Work/event/delivery IDs remain stable.

## Review and results

Independent specification reviews challenged semantic mapping, cross-user
correlation, partial commits, one-shot/delivery coupling, historical personal
data and coordinator/host identity boundaries. Independent UI review caught
monitoring-control regression, domain substitution, incomplete link selection,
stale response/navigation and personal sharing affordances. The implementation
preserves existing controls, checks exact scope, pages link candidates, fences
responses and uses the server's sharing requirement.

Executed acceptance evidence and exact revisions are recorded separately in
`acceptance.md`; this specification alone is not evidence of a passing browser
journey.
