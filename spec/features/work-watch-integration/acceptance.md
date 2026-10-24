# Executed Work + Watch acceptance

2026-10-24. Local implementation on branch `datatug-work-watch`, not published.
The central [cross-service acceptance report](../../../../backend/spec/features/work-watch-integration/acceptance.md)
maps all 18 requested criteria, commits, operational evidence and limitations.
The [feature specification](README.md) describes user behaviour and deployment.

## Actual browser result

All three real-service Chromium tests passed together from clean disposable
state: [full log](evidence/browser-full.txt). Auth/Firestore, Backend, SQL,
Coordinator and three native Runners were real local services. Work/Watch/
Context/Check requests were not mocked. Zero guarded DemoDB/GitHub requests
escaped or reached live external services.

The primary journey reused the existing Northwind order 11045 fixture:

1. Alice opens the shared Watch trigger with its in-app notification and
   verified test-sink email state, inspects/edits the draft and confirms Incident.
2. Alice delegates a Detective Case with inherited Context Bag, assignee Bob
   and due date. Bob finds it in My Work.
3. Bob enriches child context without changing the parent, explicitly proposes
   an update and Alice accepts it. Bob creates a private execution snapshot,
   applies it, selects that exact session/revision in the existing Check evidence
   picker, and executes/retains actual evidence with canonical Work provenance.
4. A remediation Task, linked Query and Check retain Work navigation.
   Authorised hosted Shipping correct/replay actions publish accepted SQLite
   revisions to the native fixture. The Watch records real recovery.
5. Importing recovery leaves Incident open. Human lifecycle actions resolve and
   close it; recurring monitoring continues. Retained evidence survives reload.

Other tests cover independent Bags, accountability edits, stale-write conflicts,
viewer denial, direct event→Case/Task creation, linking existing Work without
overwriting context, explicit personal one-shot consent, and Bob confirming the
same event/type and receiving the existing Closed Incident without edit rights.

Selected screenshots:

- [Trigger and notification](evidence/watch-trigger-desktop.png)
- [Inherited private context selected for real Check](evidence/watch-inherited-context-check-binding.png)
- [Explicit parent proposal](evidence/parent-context-proposal-review.png)
- [Recovery before human closure](evidence/watch-recovery-human-resolution.png)
- [Closed Incident](evidence/incident-closed-desktop.png)
- [Existing-link context preserved](evidence/watch-existing-link-preserves-context.png)
- [Mobile handoff](evidence/watch-handoff-mobile.png)

The full lane ran through E2E revision `28bda2ca`, product source `ff367e6f`.
Independent cold-load/mobile/direct-control review then found the Watch host
height could put monitoring controls outside the scrollable viewport. Commit
`9e8290df` adopts the existing Work flex layout and wraps the control label;
the rebuilt UI has matching build metadata and independently repeated control
checks. A subsequent actual connection attempt found shared Firestore metadata
dropped the coordinator descriptor. Commit `4ff1abd9` preserves only its public
endpoint/namespace, with independent review and 38 service/auth-isolation tests
passing. Final connection observations accompany the central report.

The independent final browser pass connects the Coordinator and acknowledges
exactly one actual notification with HTTP 200 and a changed read receipt. It
also completes the personal one-shot's linked Task through In-progress→Done,
then verifies the Watch stays completed with identical events, source and five
email file hashes. **Monitor next occurrence** is visibly enabled and is not
clicked. See [independent browser evidence](evidence/independent-browser/report.json)
and the central one-shot closure receipt. The emulator-only warning footer can
overlap the tail of the mobile control label; an actual normal tap was verified.

The actual remote-runner expiry/reconnection and combined Coordinator restart
also pass. Eight Work items, notification read state, event/delivery identities,
source revision and all five email hashes survive unchanged; recurring execution
resumes and the completed one-shot stays idle. The central report retains the
before/after operational receipt and exact process transitions.

## Other checks and honest bounds

The [focused UI log](evidence/ui-focused-tests.txt) records **120 passing tests**
in 12 files; [address tests](evidence/address-tests.txt) record **595 passing**.
Final build, lint, TypeScript and verified 11-file RecordsetCompare asset results
are retained alongside the browser evidence. The pinned artifact's attestation
was verified; no unverified fallback bundle was substituted.

[Browser diagnostics](evidence/primary-diagnostics.json) have no blocking
Work/Watch errors. Existing checkout-config CORS, optional local-agent discovery
refusal, optional GitHub Business Query activity-context 503 and navigation
cancellations remain recorded; the console was not
entirely silent. Fixture audit time and native wall-clock time differ.
The browser executed the retained Check; Query context consumption has facade
coverage and is not represented as a successful browser Query execution.
Five messages were delivered to the configured local email test sink; external
SMTP delivery and production deployment were not tested.

No automatic work creation/closure is enabled. Trusted hosted notifications are
read-only; acknowledgement remains in existing connected Coordinator controls.
Context import is explicitly mapped scalar data, not a raw matched-row export.
The single-coordinator SQLite, bounded evidence import and paired Apps/Backend
rollout constraints are documented in the feature and central deployment notes.

For a repeatable demo, follow Backend's versioned
[launcher/reset walkthrough](../../../../backend/spec/features/work-watch-integration/demo.md).
Use a new private runtime directory and owned disposable emulators; do not run
the initial-trigger browser lane against the already recovered fixture.
