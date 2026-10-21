---
format: https://specscore.md/feature-specification
status: In Review
---

# Feature: Shared project environment order

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/shared-project-environment-order?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/shared-project-environment-order?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/shared-project-environment-order?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/shared-project-environment-order?op=request-change) |
**Status:** In Review
**Source Ideas:** —

## Summary

Persist and apply one project-owned environment order from least risky to most risky across every environment reader and selector.

## Problem

DataTug presents the same project's environments in several menus, overview
lists, board and query selectors, and hosted workflows. Those surfaces consume
different readers, and the project contract has no shared environment order.
Filesystem and GitHub listings therefore tend toward identifier order while
hosted state may retain another incidental order. A user cannot express that
`local` is safer than `dev`, or that `prod` belongs last, once for every reader
of the project.

The order is project metadata shared by every reader. It is not a browser
preference, a renamed environment, or a query-execution setting. A reorder must
never change environment identities, the selected environment, access, safety
presentation, or runtime behavior.

## Behavior

### Journey

I open a project's existing overview. It has one compact navigation row in the
form **Environments: LOCAL DEV QA UAT PROD**. The environment names are
borderless navigation links, not filter chips or large bordered cards. The row
stays on one line when it fits and wraps cleanly on a narrow viewport. Each link
keeps its metadata-derived warning icon/tone and an accessible destination
label. The **Environments** label opens the existing full Environments page;
each environment link opens that environment. Environments are shown from least
important or dangerous to most important or dangerous. If the project has no
saved order, DataTug gives me the deterministic default `LOCAL`, `DEV`, `QA`,
`UAT`, `PROD` ordering described below. I can keep using the project without
taking any action.

The overview does not also offer an Environments overview tab containing the
same list. That duplicate tab is removed while Boards, Queries, Databases and
other distinct overview content remain. Any environment action present in the
overview tab at implementation time must move to or remain reachable from the
full Environments page before the duplicate is removed.

If I have current project-metadata write access, I follow the Environments label
to the full Environments page. The page title remains **Environments**, without
a second Environments card heading. Each environment uses a neutral row surface
rather than filling the whole row with its presentation color. A compact
severity chip and the environment navigation link convey the metadata-derived
caution level with text, iconography, and an accessible color treatment.

The page-header **Add environment** action reveals and focuses a compact inline
creation row after the existing environments. The row contains a name input,
Add, and Cancel; no empty form occupies the page before I ask to add an
environment. A successful create appears through the same canonical environment
reader and order resolver. I can then open **Manage order**, move rows by drag
handle or by visible Move up and Move down controls that also work from the
keyboard. On a narrow screen the controls remain visible and usable without
hover. Cancel returns to the full Environments page with the persisted order
unchanged. Save disables duplicate submission, shows progress, and stays on the
editor until the canonical saved order has been read back. On success, the full
page, existing project overview and every other environment selector use the
new order. On denial, validation failure, conflict, or uncertain outcome, my
draft remains visible with a clear retry or reload action.

If I can read but cannot write the project, I see the same shared order in all
environment surfaces and no enabled reorder action. Opening the same project in
another authenticated browser or reader produces the saved order after reload.

### Default order

The default resolver classifies an environment by its stable ID only. It
lowercases ASCII letters and removes ASCII spaces, `-`, `_`, and `.` for
classification; it never rewrites the stored ID. The aliases are:

| Stage | Classified IDs |
| --- | --- |
| LOCAL | `local`, `localhost`, `sandbox` |
| DEV | `dev`, `development`, `demo` |
| QA | `qa`, `test`, `testing`, `qualityassurance` |
| UAT | `uat`, `useracceptance`, `stage`, `staging`, `preprod`, `preproduction` |
| PROD | `prod`, `production`, `live` |

Recognized stages sort in the table's order. Multiple IDs in one stage sort by
normalized ID and then by the exact stable ID. Unclassified custom IDs sort by
normalized ID and then exact stable ID after UAT and before PROD. This keeps a
recognized production environment last while retaining every custom
environment. Both normalized-ID and exact-ID comparisons are lexicographic comparisons of
Unicode scalar-value sequences (numeric code points), with a shorter equal
prefix sorting first. Only the stated ASCII normalization applies: no Unicode
case folding, normalization, locale collation, UTF-16 code-unit comparison, or
UTF-8 byte comparison. IDs must be valid Unicode scalar sequences; malformed
UTF-8 or unpaired UTF-16 surrogates are rejected at the contract boundary.
The comparator is locale-independent and returns the same result
in the web app, Go backend, GitHub reader, and local agent.
Shared golden fixtures must explicitly expect `Dev` before `dev`,
`qa-test` before `qa_test` before `qatest` when normalized IDs collide, and
custom IDs `é`, `Ω`, ``, `𐀀`, `😀` in that scalar-value order.
These examples use exact IDs and preserve their original spelling.

### Explicit project order

Project metadata may contain `environmentOrder`, an ordered list of exact,
case-sensitive stable environment IDs. A valid saved value is a complete
permutation of the environment IDs that existed at the accepted revision. It
overrides the default resolver without changing the environment records.

Readers reconcile older or damaged metadata defensively: the first occurrence
of each exact live ID is used, duplicate references are ignored, references to
deleted or unknown IDs create no phantom row, and live IDs missing from the
saved list are appended in default order. Thus custom, newly created, and
remaining environments never disappear because order metadata is incomplete.
Editors surface that the saved order needs repair. The next accepted save emits
one complete, duplicate-free list for the then-current environment set.

### Severity presentation

Environment order and environment caution are separate contracts. Order never
creates, upgrades, or downgrades a caution level. The presentation resolver
uses only stored environment presentation metadata. The currently supported
metadata has `label`, `icon`, and Ionic `tone`; it has no independent severity
field. Existing behavior maps `danger` to **High caution** and `warning` to
**Use caution**. Those two mappings remain the only metadata-derived caution
levels until the project contract gains an explicit severity value.

The full Environments page renders every environment on a neutral background.
For a `danger` or `warning` tone it shows a small severity chip containing the
existing caution text and matching accessible danger or warning color, and
styles the environment navigation link with that same caution color. The chip adds a fixed caution triangle icon, distinct from and in addition to
the stored environment artwork icon; chip text makes meaning available without
color. Both chip text and navigation-link text meet WCAG AA contrast, and the
link has a visible keyboard focus indicator in every supported theme. For
`neutral`, `primary`, `success`, invalid, or missing tone metadata, the row and link use the normal
neutral text treatment and no caution chip is shown; these tones do not imply a
safety level. Custom IDs and aliases receive no caution treatment merely from
their ID or resolved position. The compact overview row uses the same resolver
and lightweight link/icon treatment, without a colored block background.

This changes presentation only. Stored label, icon, tone, warning text, access,
and runtime risk semantics are preserved. If an explicit severity property is
introduced later, its allowed values and label/color mapping require a versioned
project-contract change rather than inference from environment order.

### Inline environment creation

The Environments page keeps its page title and removes the repeated card
heading. An **Add environment** action in the page header is visible and enabled
only when the current project/store advertises a real create-environment
capability and the current actor has project write access. Activating it reveals
one inline editor as the final list row and moves focus to its name input.
Cancel clears the draft, hides the row, and returns focus to the header action.

Creation is a required end-to-end deliverable for every current supported
store: hosted Space, GitHub, and local agent. The existing
`datatug/environment/create_environment` browser route is a starting point,
not proof of an implemented handler. DESIGN must specify the authenticated
Go handler and transport mapping for each store before implementation. Each
request carries the exact project identity described below, a trimmed nonempty
name, an opaque membership/order precondition, and a client-generated operation
ID. The authority generates the stable environment ID and validates names;
duplicate trimmed names within the exact project scope are rejected explicitly.
Enter and Add submit the same guarded operation; at most one request is in
flight. Validation or definitive denial keeps the draft and associated error
visible and restores usable controls.

The operation ID is scoped to actor identity plus the complete project identity
(including store, Space, repository/folder, branch, API and agent authority).
The authority persists a durable receipt atomically with the environment
creation and membership revision, including normalized request payload and
server-issued ID. An identical retry returns that same ID/result, including
when the original precondition is now stale; reuse with any changed scope or
payload conflicts. Receipts remain replayable for at least seven days. After
expiry the authority rejects the expired operation rather than creating again;
the client must reconcile canonical state before offering a fresh operation.
The response includes receipt expiry. An expired-operation tombstone remains
durable so expiry can never silently turn the same ID into a new create. These guarantees apply to all three
transports, including provider commits and agent restart recovery.

After success or any uncertain outcome (timeout, disconnect, or lost response),
the client reads canonical environment state and reconciles the operation
receipt/server-issued ID before declaring success or enabling a fresh create.
While reconciliation is unavailable it keeps the draft, shows an unresolved
state, and allows only same-operation replay, reload/reconcile, or closing the
editor; Cancel does not cancel a possibly committed write. Only canonical
state establishes that the new stable ID exists exactly once. A definitive
uncommitted rejection may permit a corrected fresh operation. Scope changes
fence all late create responses and receipt reads just as they fence saves.

The shared resolver places the new ID using the missing-live-ID reconciliation
rule. Creation does not rewrite `environmentOrder`, classify from display name,
or change existing IDs, metadata, selection or scope. Add may be disabled for a
read-only actor, revoked provider grant, or explicitly unsupported old agent
version with a visible upgrade reason. Missing create implementation on a
current supported store fails feature acceptance; hiding Add cannot satisfy it.
The browser never substitutes direct Firestore, provider, or filesystem writes.

### Shared persistence and authority

The same project-owned contract is readable for local-agent, GitHub, and hosted
Space projects. An order save uses the existing authorized transport for that
store:

- Hosted Space project mutations go through an authenticated DataTug Go HTTPS
  endpoint. The browser never writes Firestore. The backend rechecks the
  current project role and paid project-write service in the mutation
  transaction before changing project metadata.
- A GitHub project save goes through the authenticated provider-backed project
  write path, checks repository/folder/branch authority, and preserves the
  provider's branch-head conflict semantics. Public readers remain read-only.
- A local project save goes through the authenticated local-agent HTTP
  transport and its existing project-file store. The web app never writes a
  local file directly.

DESIGN must deliver one store-neutral environment-state DTO and read/create/
order-save operations. The read request, response and every mutation retain all
`IProjectRef` qualifiers: `storeId`, `projectId`, `spaceID`, `projectApi`, and
`branch`, plus resolved repository/folder and agent authority where applicable.
No reader may collapse this to `projectId` alone. The response contains the exact
resolved identity, canonical live IDs and stored presentation, raw saved order,
reconciled complete order and repair status, one opaque revision covering both
membership and order, and independently authoritative `canReadOrder`,
`canWriteOrder`, and `canCreateEnvironment` capabilities with denial reasons.
Capabilities come from the relevant current store authority and are rechecked
on mutation; UI code must not infer them from authentication, `querySave`,
billing alone, Firestore readability, or presence of an environment list.

DESIGN must name concrete record/file paths, routes, serialization/versioning,
and authority checks for each store: hosted Space project metadata and
membership under its exact Space/project record through authenticated Go
handlers only; GitHub project metadata plus environment files under the exact
repository/folder/branch through a provider-backed atomic branch-head-fenced
commit; local project metadata plus environment files under the agent-resolved
project root through authenticated agent/store operations. It must specify how
create receipts and revisions are atomically persisted and recovered on each
store. Hosted Firestore summary serialization and every alternative collection
reader must expose the same authorized contract without browser writes.

Read/create/save responses distinguish unauthenticated, forbidden, unsupported
version/capability, invalid payload, stale revision, operation-ID conflict,
expired receipt, transient failure, and unresolved outcome. A canonical reread
uses the identical scoped state operation: the Go-backed authoritative hosted
record, GitHub state at the committed branch head, or agent project-file state
at the committed revision. Cached summaries or mutation acknowledgements alone
cannot prove persistence. Capabilities are refreshed on denial and scope change.

Every reader returns an opaque environment-order revision, or an equivalent
store precondition such as the exact Git branch head, together with the order.
A save carries the full project identity, complete ordered ID list, one exact
precondition, and a bounded operation ID. The precondition covers both order
metadata and the environment membership used to validate the permutation.
Concurrent order edits, environment creation, or environment deletion reject
the stale save without overwriting either actor's work. Reusing an operation ID
with a different scope or payload is a conflict. Retrying the identical
operation after a lost response is idempotent where the store's existing
mutation contract supports receipts; otherwise the client must reload before
claiming success. A mutation acknowledgement is not a persistence receipt by
itself: the client rereads canonical project metadata before publishing the
saved state.

### Consistent consumers

One resolver contract applies the order before environments reach the project
overview, Environments page, side-menu selector, board selectors, query editors,
database/server views, hosted Incident/Detective selectors, shipping/session
context selectors, and API state responses that enumerate project
environments. A surface may filter environments for its own authorized purpose,
but it preserves the relative project order of the remaining IDs.

The project overview consumes that resolver once for its compact quick row. It
does not maintain a second list inside an Environments overview tab. The full
Environments page remains the management destination for environment detail,
add/edit actions that exist when implementation begins, and reorder.

Reordering is presentation only. It does not change stable IDs, titles,
presentation labels/icons/tones, warning text, access or risk semantics,
current route/query parameters, selected environment, connection resolution,
query dispatch, saved queries, board definitions, sessions, or incidents. If
the selected environment is still present, it stays selected while the list
moves around it.

### Current capability boundary

At specification time, `IEnvironmentPresentation` contains only label, icon and
tone. Its shared resolver maps `danger` to `High caution`, `warning` to `Use
caution`, and invalid or absent tone to neutral; it does not label other tones
as safe. `IProjectSummary` and Core's `ProjectFile` have no order field. Environment
lists arrive through separate GitHub, local-agent, hosted project-state and
summary paths. Hosted shared-project summary serialization does not expose an
order, the general project-assets reader rejects shared-project environment
reads, the backend has no project-metadata order mutation, and the local agent
has no project-metadata mutation route. The current project overview renders
both a large bordered environment shortcut strip and a separate Environments
tab with the same destinations. The full Environments page repeats its page
title in a card heading, fills each row with `presentation.tone`, and has no
reorder or inline-add action. An existing browser client calls
`datatug/environment/create_environment` with `projectRef` and name, but no
matching handler was found in the surveyed current backend or local-agent
repositories; all three current supported stores require real authenticated create and order
implementations. PR #464 is the landed overview baseline on fresh `origin/main`
at `356c79fb430bf68bd5a68e8662030841eb2d771b`. The specification branch has
integrated that baseline through WB. DESIGN and implementation must start from
current `origin/main`, preserve its distinct overview content, and close these
gaps end to end before editing the shared surface. A UI-only sort, browser storage, unverified create route, or
demo-specific data path does not satisfy this feature.

## Acceptance Criteria

### Default and reconciliation

- Given environments with mixed-case standard aliases and custom IDs and no
  saved order, when any supported reader lists them, then it applies the exact
  locale-independent default classification and tie-break rules above and
  includes every live stable ID exactly once.
- Given `LOCAL`, `development`, `qa`, `staging`, `customer-prod`, and `PROD`,
  when default ordering is resolved, then the result is `LOCAL`, `development`,
  `qa`, `staging`, `customer-prod`, `PROD`; no ID is rewritten.
- Given saved order metadata containing a duplicate, a deleted ID, and missing
  live custom/new IDs, when the project is read, then the first live occurrence
  wins, deleted references render no row, and every missing live ID is appended
  by the default resolver. An authorized editor sees a repair state; a read-only
  user still sees the complete reconciled list.
- Given a saved complete order, when environments are returned by any project
  reader or filtered by a consumer, then saved relative order wins and the
  consumer preserves it.

### Editor journey and accessibility

- Given a project overview with environments, when it renders, then it shows one
  compact borderless `Environments:` navigation row in resolved order, stays on
  one line when space permits, wraps without clipping on a narrow viewport,
  preserves metadata warning icons/tones and accessible destination labels,
  and contains no duplicate Environments overview tab or large bordered
  environment buttons.
- Given the compact row, when its Environments label is activated, then it opens
  the full Environments page; when an environment link is activated, then it
  opens that exact environment without changing current selection as a side
  effect. The links are presented as navigation, not selected filter chips.
- Given the compact overview row or full Environments page, when environments
  have `danger` or `warning` presentation tone, then their links use the
  matching accessible caution color, preserve stored artwork, and chips add a
  fixed caution icon and the full-page row has a small
  severity chip reading **High caution** or **Use caution**. The environment row
  itself has a neutral background and the caution meaning does not depend on
  color alone.
- Given an environment with `neutral`, `primary`, `success`, invalid, or missing
  tone, when it is shown, then its link uses neutral text and no caution chip.
  Custom and recognized IDs never create or suppress stored caution: a custom
  ID with `danger` or `warning` receives the same caution treatment as any other
  ID with that tone. Stored presentation metadata and warning semantics remain
  unchanged regardless of ID, alias, list position, or order.
- Given environment add/edit/detail or other actions present in the overview or
  landed baseline when the duplicate tab is removed, then each action is
  retained or moved to the full Environments page and remains reachable by
  keyboard and touch.
- Given the full Environments page, when it renders, then it has one page-level
  Environments title, no repeated Environments card heading, and no permanently
  empty creation form.
- Given a store with a verified create-environment capability and an actor with
  project write access, when Add environment is activated, then one compact
  final-row editor opens, the name input receives focus, and Add and Cancel are
  keyboard- and touch-operable. Cancel clears and hides the draft and restores
  focus to the page-header action.
- Given an empty or whitespace-only name, when submission is attempted, then no
  request is sent and the name error is associated with the input. Given a
  nonempty name, submission trims it and sends the extended create request
  mapped from `datatug/environment/create_environment` with the exact project
  reference, operation ID and membership/order precondition through the
  store-specific authenticated handler; Enter and Add share the guarded operation.
- Given environment creation is pending, when Add is clicked, Enter is pressed,
  or the action is clicked again, then only one request is in flight. Definitive validation, duplicate,
  authorization or conflict rejection retains the draft with a specific error.
  An uncertain network/server outcome enters reconciliation; it cannot enable
  a fresh operation until the canonical state and receipt establish the result.
- Given the create request succeeds, when the canonical environment collection
  is reread, then the server-issued stable ID appears exactly once through the
  shared resolver's missing-live-ID rule. No success state or new row is
  published from the acknowledgement alone, and the create does not silently
  rewrite a saved order or current selection.
- Given a read-only actor, revoked provider grant, or explicitly unsupported
  old agent version, when the page renders, then there is no enabled Add
  environment mutation. The reason is visible and an old agent offers upgrade guidance.
  Missing implementation on a current supported store fails acceptance.
  Direct client Firestore, provider, or filesystem writes cannot substitute.
- Given an authorized project editor on Project overview → Environments label →
  full Environments page, when Manage order is opened, then the editor shows
  actual project environments with stable identity and presentation, a drag
  handle, keyboard-operable Move up and Move down controls, Save and Cancel, and
  an announced result for each move. The same tasks work at mobile width without
  hover or browser resizing.
- Given an unchanged draft, Save is disabled. Given a changed valid draft, when
  Save is submitted, then controls prevent double submission and expose the
  pending state. Cancel before submission discards the draft and returns to the
  same project flow.
- Given a user with project read access but no current metadata-write
  capability, when the Environments flow renders, then the resolved shared
  order is visible but no enabled reorder mutation is available. Calling the
  endpoint directly is denied without changing metadata.
- Given validation, authorization, network, or server failure, when Save does
  not establish canonical persistence, then the editor stays open with its
  draft, shows a specific error and offers a safe retry or reload. It does not
  display a saved state from an HTTP acknowledgement alone.

### Persistence, concurrency, and scope

- Given an authorized editor and a valid complete permutation, when Save
  succeeds and canonical metadata is reread, then reload and another authorized
  reader show the same project-owned order across the overview and every
  environment selector.
- Given a selected environment, when another environment is moved before or
  after it and the order is accepted, then the same exact environment ID remains
  selected and query/runtime scope does not change.
- Given two editors read the same revision, when one saves and the other then
  saves a different order, then the second operation conflicts, retains its
  draft, and requires review of the latest order before a new operation. The
  first accepted order is not overwritten.
- Given environment membership changes after the editor loaded, when the stale
  permutation is submitted, then the backend rejects it rather than dropping a
  new environment or reviving a deleted one. Reload includes every current
  environment.
- Given a lost response, when the client retries, then a receipt-capable store
  accepts only the identical operation/scope/payload and returns the same
  result; a store without that guarantee requires canonical reload. A reused
  operation ID with different content conflicts.
- Given the actor, Space, project, repository, branch, local agent, or access
  capability changes while a save is pending, when a late response arrives,
  then it cannot publish into the new scope or replace its displayed order.

- Given each supported store, when environment state is read as a writer or
  read-only actor, then the mandatory DTO retains every identity qualifier,
  canonical membership/presentation, raw/reconciled order, combined revision,
  repair state and three independently authoritative capabilities. Tests prove
  that different Space, branch, API, folder or agent qualifiers never alias.
- Given create commits but its response is lost on each supported transport,
  when the same operation is replayed or reconciled after a client/agent
  restart, then canonical state exposes the original server-issued ID exactly
  once, the same result is returned, and no false failure/success is shown.
  Changed payload/scope conflicts; expired receipts reject replay and require
  reconciliation before a fresh operation; concurrent create/order writes
  cannot bypass the combined revision fence.
- Given any current supported hosted, GitHub or local store with authorized
  write access, then authenticated create and order operations are implemented
  and exercised through the real transport. Missing handlers or permanently
  hidden Add fail acceptance. Per-store contract tests include validation,
  denial, stale membership, receipt replay/expiry and canonical reread.

### Store and safety boundaries

- Given a hosted Space project, when its order is saved, then a Go HTTPS handler
  authorizes the current actor and writes Firestore transactionally; browser
  code contains no Firestore write path and Firestore client rules remain
  read-only.
- Given an authorized GitHub project, when its order is saved, then the project
  metadata file changes only through the provider-backed write with an exact
  branch-head fence. Revoked repository authority or a moved branch returns a
  visible denial/conflict and no false saved state.
- Given an authorized local-agent project, when its order is saved, then the
  agent updates the existing project metadata file through its authenticated
  HTTP/store boundary with an exact revision fence. A browser cannot select an
  arbitrary filesystem path or bypass the agent's project scope.
- Given any accepted or rejected reorder, then environment IDs, current
  selection, scopes, presentation tone and warning text, access checks, query
  dispatch, board/query/session/incident data, and connection definitions are
  byte-for-byte or semantically unchanged as applicable.
- Given any accepted or rejected environment create, then existing environment
  IDs, current selection, scopes, stored presentation metadata, warning
  semantics, query dispatch, and connection definitions remain unchanged. A
  new environment's caution presentation comes only from its stored metadata.

### Verification

- Focused contract tests cover the default comparator, aliases, case,
  deterministic custom-ID ordering using identical JS/Go golden fixtures
  containing `Dev`/`dev`, `qa-test`/`qa_test`/`qatest`, BMP `é`/`Ω`, and
  supplementary `😀`/`𐀀` versus BMP `` (scalar order, not UTF-16 order),
  invalid-scalar rejection, duplicate/unknown/missing reconciliation,
  complete-permutation validation, revision conflicts, idempotent retry, and
  scope changes.
- Focused UI tests exercise the compact overview row, removed duplicate tab,
  preserved full-page actions, single page title, neutral environment rows,
  caution chip/link mapping, missing-tone fallback, navigation semantics,
  wrapping, warning icons, accessible labels, inline-add focus and keyboard
  behavior, create validation, double-submit prevention, create failure/retry,
  canonical create reread, drag and keyboard/button reorder, mobile-visible
  controls, cancel, pending, denial, conflict, reorder failure/retry, canonical
  order reread, and selected-environment stability in the zoneless app.
- Store tests prove hosted Firestore, provider-backed GitHub, and local-agent
  project-file persistence through their real adapters. A real web-browser acceptance journey for each materially different
  transport (hosted Go, GitHub provider, local authenticated agent) uses a real
  writable project on that store: the editor adds an environment through a
  capability-backed create route, observes it after canonical reread, reader A
  reorders a standard and custom environment, reloads, reader B observes the
  same order, and an existing query still runs against the previously selected
  environment. Mocked request tests, an HTTP acknowledgement, an Add click, and
  a Save click are recorded separately and do not establish persistence.
- Existing projects without the field and ordinary demo projects use the same
  generic default resolver. No fixture-only branch, personal-order substitute,
  TUI-only check, cloned-flow exception, or video rendering is acceptance
  evidence.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/feature-specification*
