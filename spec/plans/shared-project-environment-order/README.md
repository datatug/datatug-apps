---
format: https://specscore.md/plan-specification
status: Draft
---
# Plan: Shared project environment order design

**Status:** Draft
**Source Feature:** shared-project-environment-order
**Date:** 2026-10-21
**Owner:** alex
**Supersedes:** —

## Summary

Implement the independently reviewed shared project order and real inline
create journey in Apps, Core, Backend, CLI agent and Cloud composition. This
DESIGN is a review candidate; it authorizes no implementation until the root's
independent DESIGN gate passes. Root owns landing into the Apps target.

Use the existing per-store adapters, scoped Go APIs and provider commit patterns.
Do not build a general metadata framework or replace query services. The extra
persistence is limited to the order field, combined revision and durable
operation receipts/recovery required by the approved feature. This minimizes
implementation time and review/token cost while preserving all three stores.

## Approach

### User journey and observable results

1. I open the project overview and do nothing else. One compact borderless
   `Environments: LOCAL DEV QA UAT PROD` navigation row appears in shared order;
   loading resolves without an extra click in the zoneless app. There is no
   duplicate Environments overview tab. Existing other tabs remain.
2. I follow the Environments label. The existing full page opens with one
   Environments title, neutral rows, metadata-derived caution link/chip, and
   header Add environment and Manage order when the authority permits them.
3. I choose Add environment. A compact final row appears and focuses its name
   input. I enter a name and submit with Enter or Add. Doing nothing else shows
   progress, then exactly one canonical new stable ID in the list. The row
   closes and focus returns to Add; creation stays on this management page as
   required by the approved feature. Cancel before submission clears/hides it.
4. I choose Manage order. The same page enters an inline editor with neutral
   rows, drag handles, visible Move up/down, Save and Cancel. Moves announce
   their result and preserve focus on the moved ID. Save remains disabled until
   the complete permutation changes. Cancel restores canonical order.
5. I save. Progress blocks duplicate actions; canonical reread establishes the
   result and returns to the normal page without changing my selected
   environment. Reader B reloads and sees that same order. My existing query
   still uses its original environment and connection.
6. If access disappears, another editor changes membership/order, or the
   response is lost, I retain the draft and see a specific denial, conflict or
   unresolved state. No other click is required to start reconciliation. A
   fresh create cannot be sent until the prior outcome is reconciled.

Entry and exit use the current project route helpers: overview → existing
project `environments` child → existing environment detail. Manage order and
Add are page states, not new routes. Cold deep-link/refresh fetches from the
full route identity; router state is never required. Every request captures
identity, principal/session generation and view generation; late responses
cannot paint a different scope. No product TUI work or TUI acceptance checks.

### Authoritative baseline and integration points

Freshly fetched `origin/main` snapshots on 2026-10-21:

| Repository | SHA | Existing boundary to extend |
| --- | --- | --- |
| datatug-apps | `356c79fb430bf68bd5a68e8662030841eb2d771b` | `ProjectQueryApiService` qualified routing; `EnvironmentService`; project summary/context and existing overview/full page |
| datatug-core | `08f7e5c2fb6b8e161bba44cf2a3591f7b18451b8` | `pkg/datatug/ProjectFile`, `pkg/dto`, filestore and caller-scoped DALgo store |
| backend | `3a5f77626d2862cbb81bd5c004acb5ab232444d6` | `api4datatug/routes.go`, shared project authority/transactions, GitHub scoped provider/query commit proof pattern |
| datatug-cli | `c22218c11e3ea717e355649046db0670977419ed` | `pkg/api/project_query_adapter.go`, secure serve principal, `pkg/server/endpoints` |
| datatug-cloud | `70a1ce742caca0b9e17bb3aab894b85d455cdce0` | `internal/composition` / `internal/datatug` route/service binding |

These are source observations, not already implemented environment contracts.
CodeGrapher verified `ProjectQueryApiService` source/relations in this worktree;
its environment read already preserves branch and Space through qualified
routing. Fresh origin/main source reads establish that the old
`EnvironmentService.listEnvironments(projectId)` loses qualifiers, shared
Firestore summary drops environment data, DALgo environment items are stubbed,
and no surveyed create handler implements the browser's existing route.
Core's `SaveProject` is explicitly non-atomic across collections; do not reuse
it for this mutation. Extend focused existing stores instead. All stages refresh
main and integrate with WB before editing shared surfaces; #464 is already
included. Other active Apps work is preserved by the root's landing owner.

### Minimal shared wire and data contracts

Add Core `pkg/dto/environment_state.go` and matching Apps
`models/definition/environment-state.ts`; domain sorting belongs in Core
`pkg/datatug/environment_order.go` and Apps' pure environment-order resolver.
Version the wire contract as `environment-state/1`; keep `environmentOrder`
optional in `ProjectFile`, project summaries and hosted metadata. Old projects
need no migration and use the pure default resolver. All writers/serializers
that reconstruct a ProjectFile must preserve the field and unknown unrelated
JSON properties; updating order must patch only that field. Environment creation
patches only its new record plus transaction evidence, never rewrites order.

| DTO | Required fields |
| --- | --- |
| EnvironmentScope | exact `storeId`, `projectId`, optional `spaceID`, `projectApi`, `branch` preserved exactly; resolved `authorityId`, separate `resolvedBranch`; GitHub repository numeric ID, owner/name/folder when applicable |
| EnvironmentState | `contract`, exact resolved `scope`, `scopeBinding`, safe live `environments` (stable ID, title/access and stored label/icon/tone only), `savedOrder` (null if absent), complete `order`, `needsRepair`, opaque `revision`, `capabilities` |
| Capabilities | independent booleans `canReadOrder`, `canWriteOrder`, `canCreateEnvironment`, plus per-denial reason; never reuse `querySave` or authentication as write authority |
| CreateEnvironment | `scope`, `ifRevision`, `operationId`, trimmed `name` |
| SaveEnvironmentOrder | `scope`, `ifRevision`, `operationId`, complete `environmentOrder` |
| OperationResult | `operationId`, `kind`, `payloadDigest`, `acceptedAt`, `replayUntil`, server-issued `environmentId` for create or accepted order for save, `afterStateDigest`, status (`pending`, `committed`, `expired`, `unresolved`) |

`scopeBinding` is SHA-256 of a versioned, length-delimited canonical scope tuple
including the current authenticated actor. The actor is verified server-side,
never accepted from request JSON. Preserve undefined qualifiers as null in the
canonical tuple; aliases such as github/github.com resolve before comparison.
Conflicting branch qualifiers, unknown fields, duplicate JSON keys and duplicate
query selectors are rejected. A server-resolved authority ID distinguishes
agent installations and canonical served roots; a client supplies no arbitrary
filesystem path. Resolving a branch never replaces the original optional
`branch` qualifier: retain it and return the actual branch separately as
`resolvedBranch`, binding both in revision, scope digest and response checks. The browser's cache/generation key retains the original full
IProjectRef and resolved authority/principal. Switching any qualifier cancels
publication of every pending read, create, receipt read and save.

Operation IDs are `<scopeBinding>.<UUIDv4>` (101 ASCII characters). This bounds
length and makes reuse across actor/project/Space/branch/API/agent scope fail
before store access, even where operation ledgers live under different roots.
The payload digest hashes canonical JSON of kind, resolved full scope, exact
original `ifRevision`, trimmed name or exact ordered IDs, and operation ID.
No Unicode normalization or hidden case-folding changes a name. Duplicate exact
trimmed names in that scoped project return `DUPLICATE_NAME`; server validation
rejects controls, malformed Unicode, empty names and more than 200 scalar values.
New IDs use the lowercase ASCII name slug when available; on slug collision or
no usable slug the authority adds a random UUID suffix, validates a safe path
segment, and atomically verifies uniqueness. Existing IDs are never rewritten.
A created environment has neutral presentation and no invented warning level.

Revision is an opaque, versioned envelope containing a digest of raw order and
canonical membership IDs plus the store fence: hosted metadata generation,
GitHub branch OID, or local state fingerprint/current branch/head. Membership
and order use the same fence. Include safe presentation hashes in the digest
so the editor does not silently overwrite changed labels. No timestamp-only
revision or cached summary is sufficient. An absent field and an empty saved
order remain distinguishable for repair. State read and mutation validation
use the same canonical live membership; permission-filtered clients cannot
save a partial permutation. When a reader cannot see all live metadata, it may
read its authorized subset in relative order but receives no order-write
capability. Hosted mutation checks complete membership inside its transaction.

### Routes, errors and authority

Use new common `GET /environments/state`, `POST /environments/save_order`,
`POST /environment/create_environment`, and `POST /environments/operation_status`
relative to the existing selected transport. Cloud routes are mounted literally
under `/v0/datatug/`; local routes are mounted by the existing agent base URL
convention. The singular create suffix retains the established client call.
GET scope uses the existing storage/project/spaceID/branch wire mapping, with
full scope validation; POST uses typed scope in JSON, never mixed query/body
scope. operation_status takes exact scope and operation ID, checks current
read authority and actor binding, and returns private result evidence only to
that operation's actor. No tokens or receipt internals enter public summaries.

| HTTP/code | Meaning and client result |
| --- | --- |
| 401 UNAUTHENTICATED | no verified principal; retain draft, sign-in recovery |
| 403 ACCESS_DENIED | current project/provider/agent authority denied; refresh capabilities, retain draft |
| 400 INVALID_REQUEST / DUPLICATE_NAME | definitive no-write validation; associated field error |
| 409 ENVIRONMENT_REVISION_CONFLICT | membership/order/branch moved; retain draft, load and review latest before new operation |
| 409 OPERATION_CONFLICT | operation ID scope/payload mismatch; never retry changed content under that ID |
| 410 OPERATION_EXPIRED | retained tombstone; reconcile canonical state, no replay creates again |
| 409 OUTCOME_UNCERTAIN | write may have committed; automatic status/read reconciliation, same-operation retry only |
| 426 ENVIRONMENT_CONTRACT_UNSUPPORTED | explicitly old local agent; show update reason, preserve read-only view |
| 503 TEMPORARILY_UNAVAILABLE | state/status unavailable; retain unresolved draft if write was sent |

Current supported deployments must implement all routes. 426 cannot hide a
missing implementation on a current supported store. Do not infer write access
from billing, Firestore readability, query-save capability or a nonempty list.
Recheck write permission even on replay; a revoked actor cannot use a receipt
to bypass current authorization. Browser Firestore access remains read-only.

### Shared receipt, replay and canonical confirmation

A mutation is identified once before sending. The client retains its draft,
operation ID, exact payload and captured scope while the view remains open;
page reload can rediscover that actor's pending operation via the scoped status
route using the locally saved operation ID only. Never store credentials or
runtime connection data with this recovery metadata. Canonical state/status,
not a locally cached draft, determines success.

Every authority durably stores the operation ID/digest, generated ID and intended
result before a possibly committing effect. The accepted result is immutable;
replay returns the same ID/accepted order/digest/times, even if a later reader
revision differs. A later delete or reorder is reported separately as current
state, not as original-operation failure. Replays check current authority,
then the existing operation, then expiry/payload; only a new operation checks
its original revision. Full receipts remain replayable for seven days from
first acceptance. After that retain a tombstone with binding, digest, kind,
issued ID/outcome and expiry indefinitely for the lifetime of that project;
never garbage-collect the ID into a new create. No receipt stores secrets.

On success or lost/uncertain response, reread scoped state plus operation status.
A committed receipt and canonical membership containing the original generated
ID establish create success; accepted order and canonical order establish save
success unless a later revision already superseded it, in which case show that
concurrent result explicitly. Pending/unresolved status holds the draft with
Reconcile / Retry same operation / Close editor; closing is not cancellation of
a server effect. Definite uncommitted rejection permits a corrected new operation
only after latest state. A deleted-after-commit environment is shown as that
specific result; the UI never creates a replacement automatically.

### Hosted Space: Go-only transactional mutation

Canonical root is `spaces/{spaceID}/ext/datatug/projects/{projectId}`. Store
`environmentOrder`, environment metadata generation and safe environment index
on that record; environment records remain its `environments/{id}` children.
Private receipts are scoped under
`users/{verifiedActor}/ext/datatug/environmentOperations/{sha256(operationId)}`.
Use one DALgo/Firestore transaction to read actor's current Space/project role,
project paid-write admission, root/index, receipt and targeted environment,
validate complete permutation/name, and atomically write record/index/revision
and receipt. Replay lookup occurs after admission but before stale-revision
rejection. Go handlers live in Backend `api4datatug`, facade/domain logic and
keys in their existing backend packages. Core caller-scoped DALgo environment
store must implement real environment records; no ErrNotImplemented fallback.

For a pre-index project, a readonly transaction reads canonical child membership
and returns a fingerprint revision. Its first mutation scans/rechecks that same
membership transactionally and installs the index without altering IDs. All
hosted create/delete/environment-import paths subsequently update the same
index/generation; old paths that bypass it must be wired to this store boundary
before release. The transaction compares canonical child membership as well as
index when needed, so a stale index never hides a new ID. Summary projection
may carry safe list/order/generation, but capabilities and mutation receipts
come from the Go state endpoint; a Firestore watch invalidates/refetches state,
never grants authority. Firestore rules deny client writes and private receipt
reads. Cloud and sneat-go hosts only bind/pin the published Backend routes and
ports; no business logic belongs in sneat-go composition.

### GitHub: one fenced commit plus durable Go operation evidence

Read current repository/folder at one pinned branch head through the existing
scoped provider snapshot. Canonical order lives in `<folder>/datatug-project.json`;
new records use `<folder>/environments/<id>/<id>.env.json`. Retain the existing
legacy environment-summary filename when reading existing environments. Empty
projects must return an empty state instead of the current snapshot reader's
empty-list error. Never return connection/server declarations in the safe DTO.

Use Backend's current authenticated provider repository admission and exact
`expectedHeadOid` commit mechanism, parallel to GitHub query saves. Go's private
operation record (same actor-wide receipt path above) first fixes the exact
scope, original head, deterministic planned file bytes, generated ID and result.
The one provider commit includes only the order patch or new environment file
and a small non-secret operation marker at
`<folder>/.datatug/environment-operations/<sha256(operationId)>.json` containing
scope/payload digest, kind, issued ID, acceptedAt/replayUntil and afterStateDigest.
No raw actor identifiers or tokens enter the repository. Native expected-head
CAS atomically publishes both data and marker. Preserve every unrelated file
and property; no force push, branch switch, repository creation or setup PR.

After the commit, persist its OID in the Go operation receipt. A response lost
between provider commit and Go finalization is reconciled by the marker's exact
content and expected-parent/tree proof, using the existing provider commit-proof
pattern. Extend proof with resumable history pagination rather than treating
its current 64-ancestor search bound as permanent failure during the seven-day
window. Never send a second effect under a fresh ID while proof is unresolved.
The original expected-head fence prevents a duplicate CAS even when replay is
concurrent. If external force-push/history deletion removes all commit evidence,
return unresolved and retain the operation; never invent committed or failed
status. Reconciliation may resume after provider recovery. This is an explicit
external-history limitation, not a supported-store implementation omission.

Provider grants, repository ID, folder, branch and current project-write
admission are rechecked on every request/replay. Public reads verify public
repository visibility and expose canReadOrder only; authenticated read-only
actors receive independent false write/create capabilities with reasons. Branch
protection/provider rejection is a visible denial/conflict, never a silently
successful direct browser provider write. Canonical confirmation reads the
current branch and records the committed OID; later branch movement is surfaced.

### Local agent: focused recoverable file transaction

Support registered filesystem projects both with and without Git. Reuse served
project resolution, the fixed authenticated serve principal and explicit write
opt-in; add real environment-metadata policy checks for that principal rather
than inheriting the query adapter's coarse QuerySave boolean. Require current
read and write admission at the HTTP/store boundary. A selected branch must be
the served current branch, as existing local query operations require; branch
switch/create is outside this feature. Unqualified local scope resolves to the
served project plus current branch (or null for non-Git), without switching it.

Canonical order lives in the existing `datatug-project.json`; create writes
`environments/<id>/<id>.env.json`. Add a small Core filestore environment
transaction helper, not a general transaction framework. Private local evidence
and WAL use one namespace per canonical served project root, shared across
participating processes; actor/authority bindings belong inside individual
receipts and never partition WAL discovery. For Git, use the resolved Git
directory's `datatug-environment-operations/<rootDigest>/`; `rootDigest` hashes
only the canonical project root. For non-Git, use the fixed project-root
`.datatug-environments.lock` plus a durable
`.datatug-environments-owner.json` recovery locator. The locator contains format,
canonical-root digest, OS owner UID, namespace UUID and the absolute private
namespace directory selected by the first process. It contains no operation
payload or credentials, is mode 0600, and is excluded from project exports;
private namespace directories are mode 0700 and records mode 0600.

Create/validate that locator while holding the common project lock, using
atomic rename and directory fsync before creating any transaction intent or
changing canonical files. Never replace the locked inode. A later process,
regardless of its configured private state root or authority ID, must use the
registered namespace: its own empty directory cannot prove there is no WAL.
Validate canonical-root binding, OS ownership/modes, namespace identity and
symlink-free resolution before opening the registered directory. Missing,
unreadable, mismatched or corrupt registered state returns recovery-required
before any successful environment read or mutation; never silently initialize
a replacement. A locator/namespace may be rehomed only with the project locked,
all intents recovered, retained receipts/tombstones durably copied and verified,
and an atomic fsynced locator switch; this feature adds no rehome endpoint.

Stage files beside their allowlisted destinations so rename stays on the same
filesystem. No absolute paths or auth secrets go in wire responses. All current
agent/Core environment collection and summary readers, and environment
create/delete/full-project-save writers, acquire the same process-plus-file
project environment lock, discover the registered namespace and recover its WAL
before touching those files. Physical recovery completes a previously durable
commit decision; it does not transfer the originating actor's receipt access or
mutation authority to the recovering actor. Recheck current request authority
before serving data or starting a new operation. Reuse the existing project API
Git lock when Git exists; non-Git processes always use the fixed root lock even
when private state roots and authority IDs differ. Lock order is Git/project lock then environment lock. Use private already-locked store helpers to avoid recursively acquiring the
same file lock. Never call the existing non-atomic parallel SaveProject from
inside this operation. Existing SaveProject must hold the outer lock for its
environment/metadata section and preserve order when reconstructing metadata.

Under the lock: resolve/check principal and root, recover existing WAL, capture
current branch/head and exact bytes of project metadata and environment files,
validate revision, then fsync an intent with old/new hashes, exact relative
allowlisted destinations, staged bytes, generated ID, result and receipt.
Fsync stage files and their directories. Fsync a commit-decision marker before
replacing any canonical destination. Apply each replacement with atomic rename
and directory fsync, then install/fsync the committed receipt and mark/remove
the WAL. Hold the lock through canonical reread. Reads after restart run the
same recovery before serving; no successful read can observe half a create.

Crash before durable commit decision: discard stages and leave old canonical
state. Crash after it: roll forward idempotently using staged bytes and hashes;
for each destination allow exactly old hash or intended new hash, never blindly
overwrite external modifications. Once complete, persist the same receipt and
return the original ID. Unexpected hash, symlink/root escape, disk-full or
unrecoverable fsync leaves a visible unresolved/recovery-required state and
blocks new writes for that project; preserve evidence and external files.
Receipt expiry replaces full evidence with the durable tombstone. Restart
replay and every crash point must be fault-injected in store tests, including
a crash after environment rename but before receipt installation. Add an
actual two-process non-Git test: A and B use different configured private state
roots and authority IDs for the same canonical project. Crash A after each
canonical rename and before committed receipt installation; a subsequent read
and mutation through B must discover/recover A's exact registered intent or
return recovery-required, with no partial successful read or new write. Repeat
with A's namespace inaccessible and with a corrupt locator to prove fail-closed
behavior; when recovery succeeds, A's replay returns its original ID and B
cannot read A's private receipt. Ordinary
reorder changes only metadata plus receipt; no README regeneration or unrelated
query/connection save is invoked. Local Git state is fenced but this feature
adds no automatic commit/push. External tools that bypass agent locks are
outside atomicity; byte/branch rechecks detect them and fail closed.

### Pure resolver and consumer cutover

Implement ASCII-only classification and numeric Unicode-scalar lexicographic
comparison exactly once per language, never localeCompare/JS UTF-16 ordering.
Share JSON goldens for aliases, `Dev`/`dev`, punctuation collisions,
`é`/`Ω`/`\uE000`/`𐀀`/`😀`, malformed-scalar rejection and saved-order repair.
Go validates UTF-8; JS validates surrogate pairs then iterates code points.
Tests assert exact original ID spelling and relative order after filtering.

Apps adds a focused `ProjectEnvironmentStateService` over the established
transport routing, not a replacement query API. Remove projectId-only list
calls; callers supply IProjectRef. Make project context/summary and existing
EnvironmentService delegate to scoped state. A single resolved list feeds
overview, Environments, menu, board/query/database/server selectors. Backend
hosted Incident/Detective, shipping/session and API enumerations call Core's
same resolver. Any remaining public file reader reads project order at the
same pinned snapshot before enumerating. No component sorts independently;
a source inventory/test proves every environment enumeration is covered.
Selection remains keyed by ID and all query/route/runtime bindings remain intact.

UI follows the existing Ionic/Sneat UI bible without nested cards. Compact
overview links have no border/filled chip; the management severity chip exists
only for danger/warning. Stored artwork remains separate from a fixed caution
triangle and text High caution / Use caution. Neutral/primary/success/invalid/
missing tones use normal link text; custom IDs never override tone. Chip and
link text meet WCAG AA in supported themes, focus is visible, and caution is
not color-only. Header actions retain labels where needed; narrow rows wrap
and controls remain operable without hover. No duplicate page/card title or
permanent empty form. Use signals/computed and OnPush; deferred HTTP tests
assert asynchronous repaint without a manual detectChanges rescue.

## Tasks

### Task 1: Shared model, scope and portable resolver

**Id:** task-1
**Verifies:** shared-project-environment-order#ac:default-and-reconciliation
**Depends-On:** —
**Status:** in_progress

Publish additive Core DTO/order/presentation-safe contracts, optional ProjectFile field, scalar comparator and shared golden fixtures. Preserve unknown project/environment metadata and update every reconstruction/summary serialization path; prove full qualifier isolation and complete-permutation validation.

### Task 2: Hosted authoritative environment operations

**Id:** task-2
**Verifies:** shared-project-environment-order#ac:persistence-concurrency-and-scope
**Depends-On:** 1
**Status:** planning

Implement Backend read/create/save/status with role and paid-write admission, real caller-scoped DALgo environment persistence, transactional membership/index/revision/receipt and expiry tombstones. Tests exercise denial, concurrent create/delete/order, lost responses and exact Space isolation.

### Task 3: Provider-backed environment operations

**Id:** task-3
**Verifies:** shared-project-environment-order#ac:store-and-safety-boundaries
**Depends-On:** 2
**Status:** planning

Implement GitHub snapshot read and atomic expected-head create/order commit with durable Go intent, non-secret marker, resumable commit proof and canonical reread. Verify real provider transport, revoked grant, branch movement, receipt expiry, lost-response and unchanged unrelated tree.

### Task 4: Recoverable local environment operations

**Id:** task-4
**Verifies:** shared-project-environment-order#ac:store-and-safety-boundaries
**Depends-On:** 3
**Status:** planning

Implement authenticated agent endpoints and narrowly scoped filestore WAL/locking/recovery for Git and non-Git projects. Wire all environment readers and membership writers through the lock; fault-inject every durable step and verify restart replay, two-process shared namespace discovery across different private roots/authority IDs, fail-closed inaccessible recovery, external modification refusal, branch/root fencing and write opt-in.

### Task 5: Host wiring and consumer order cutover

**Id:** task-5
**Verifies:** shared-project-environment-order#ac:default-and-reconciliation
**Depends-On:** 4
**Status:** planning

Pin published Core/Backend contracts in CLI and Cloud and wire the existing Go host ports. Inventory and route every Apps and Go enumeration through scoped state/resolver; preserve current selection, route/query/connection/runtime semantics and ordinary demo behavior.

### Task 6: Compact overview and full-page management

**Id:** task-6
**Verifies:** shared-project-environment-order#ac:editor-journey-and-accessibility
**Depends-On:** 5
**Status:** planning

Implement the specified neutral Ionic navigation/list, remove only duplicate overview tab, retain existing actions, add header-triggered bottom inline create and keyboard/drag order editor. Deferred-response tests verify zoneless repaint, focus, narrow wrapping, authority changes, double-submit guards and unresolved reconciliation.

### Task 7: Independent implementation review and real transport acceptance

**Id:** task-7
**Verifies:** shared-project-environment-order#ac:verification
**Depends-On:** 6
**Status:** planning

Run focused contracts and UI checks plus one real web-browser create/reorder/reload/second-reader/query journey on each hosted, GitHub and local transport. Record canonical backend/provider/file persistence separately from UI clicks and mocked checks, independently review the exact implementation head, then hand root the receipts for governed landing/release/cleanup.

### Coverage ledger

Every bullet in the source Feature acceptance sections is in scope: task 1 and
5 cover Default and reconciliation; task 6 covers Editor journey and
accessibility; tasks 2–4 cover Persistence, concurrency, and scope plus Store
and safety boundaries; task 7 covers Verification and the complete journey.
No acceptance criterion or supported transport is deferred.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/plan-specification*
