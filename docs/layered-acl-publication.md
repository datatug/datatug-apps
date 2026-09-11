# Layered ACL task 24: current DataTug query integration

This integrates owner authorization diagnostics into the current query page and
`exec/run_query` error contract. It supersedes the recovered task-21 standalone
OpenVaultDB page/proxy and preserves current source IDs, session scope checks,
route layout and Incidentius changes. No policy viewer/editor is added.

The CLI companion PR sends a validated, owner-projected DTQL decision as
`details.authorization` beside the existing error body. The semantic decoder
accepts that optional extension, verifies denial invariants and blocker field
shapes, and retains unknown reason codes for forward compatibility. The current
query page renders layer IDs and reason codes with Angular text interpolation.
Retries clear the prior blockers; stale session responses remain discarded.
Private predicate contents are not rendered. There are no browser credentials.

Verification (2026-09-11): semantic suite 122 tests pass; focused query-page
suite 34 tests pass, including post-render asynchronous denial notification
without manual change detection. Both changed libraries lint successfully;
`nx build datatug-app` succeeds. A combined full main/semantic test run fails
without a final test-failure summary and emits happy-dom AbortError diagnostics;
it is not claimed green. The standalone semantic and focused page reruns pass.

CLI Query/Explain/Update/Evidence SDK methods are retained, but this integration
only connects current browser reads and their blocker display. Browser write and
Explain API convergence remains explicit in task 24. The lead owns DataTug
landing and must review this alongside the CLI companion before merging. The
original task-21 head is preserved at `recovery/acl-task21-original`.
