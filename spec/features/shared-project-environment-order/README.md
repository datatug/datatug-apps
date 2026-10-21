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
to the full Environments page and open **Manage order** there. I move rows by
drag handle or by visible Move up and Move down controls that also work from the
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
environment. The comparator is locale-independent and returns the same result
in the web app, Go backend, GitHub reader, and local agent.

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
tone; `IProjectSummary` and Core's `ProjectFile` have no order field. Environment
lists arrive through separate GitHub, local-agent, hosted project-state and
summary paths. Hosted shared-project summary serialization does not expose an
order, the general project-assets reader rejects shared-project environment
reads, the backend has no project-metadata order mutation, and the local agent
has no project-metadata mutation route. The current project overview renders
both a large bordered environment shortcut strip and a separate Environments
tab with the same destinations, while the full Environments page lists details
but has no reorder action. Design and implementation must close these gaps end
to end and reconcile the pending project-overview work before editing that
shared surface. A UI-only sort, browser storage, or demo-specific data path does
not satisfy this feature.

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
- Given environment add/edit/detail or other actions present in the overview or
  pending integration when the duplicate tab is removed, then each action is
  retained or moved to the full Environments page and remains reachable by
  keyboard and touch.
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

### Verification

- Focused contract tests cover the default comparator, aliases, case,
  deterministic custom-ID ordering, duplicate/unknown/missing reconciliation,
  complete-permutation validation, revision conflicts, idempotent retry, and
  scope changes.
- Focused UI tests exercise the compact overview row, removed duplicate tab,
  preserved full-page actions, navigation semantics, wrapping, warning icons,
  accessible labels, drag and keyboard/button reorder, mobile-visible controls,
  cancel, pending, denial, conflict, failure/retry, canonical reread, and
  selected-environment stability in the zoneless app.
- Store tests prove hosted Firestore, provider-backed GitHub, and local-agent
  project-file persistence through their real adapters. A whole browser journey
  uses a real writable project: reader A reorders a standard and custom
  environment, reloads, reader B observes the same order, and an existing query
  still runs against the previously selected environment. Mocked request tests
  and a Save click are recorded separately and do not establish persistence.
- Existing projects without the field and ordinary demo projects use the same
  generic default resolver. No fixture-only branch, personal-order substitute,
  TUI-only check, cloned-flow exception, or video rendering is acceptance
  evidence.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/feature-specification*
