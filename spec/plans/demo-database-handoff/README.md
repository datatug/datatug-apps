---
format: https://specscore.md/plan-specification
status: Draft
---

# Plan: Continue edited demo databases through GitHub and local project copies

**Status:** Draft
**Source Feature:** demo-database-handoff
**Date:** 2026-10-19
**Owner:** alex
**Supersedes:** —

## Summary

Deliver continued use of the active edited demo database after the existing GitHub or local Git project copy. Apps owns continuation, project-scoped browsing, Query entry and local export instructions; Cloud owns narrow TEST admission. Provider export is consumed at its independently landed SHA. Root is the sole landing and provider acceptance owner.

## Approach

## User journey and observable results

1. I open a demo table and edit a row. The changed value remains visible; doing nothing else leaves the table usable.
2. I choose GitHub or local Git from the existing two choices. Defaults reflect my dataset, while restored/user edits win.
3. GitHub: I choose an existing writable repository and Space, complete existing sign-in/OAuth if required, and see the existing setup PR. Refresh/retry returns to the same intent and operation without losing the continuation.
4. I merge that setup PR. Once status is merged_ready, my copied project opens automatically at the original table, showing the edited row and the ownership label.
5. I select Query this table. Query opens an unsaved bounded TugQL draft using my copied project's matching SQLite connection and current browser runtime. Running returns the edited value.
6. Local Git: I download edited SQLite, keep safe dataset folder/project defaults and enter the actual downloaded SQLite path, run generated registration/add/serve commands, and query the exported row through the real CLI. No sign-in is introduced.
7. If a session/version/access check fails, I see the reason and explicit recovery choices; no original data is silently downloaded or substituted.

### Exact route and state contracts

- Existing entry: `/demo/sqlite/:dataset[/table/:table]`; normalize dataset via the catalog.
- Existing setup: `/new-project?store=github&source=<validated immutable GithubProjectCopySource>&returnUrl=<same-app path>`. Add a private session continuation token, never runtime object data; save typed continuation alongside the existing actor-bound NewProjectDraft and in an operation-keyed local continuation store for pending rediscovery.
- Proposed continuation: `{version:1,dataset,canonicalSha256,table?,source:GithubProjectCopySource}` plus local actor/operation/destination association. Bound and validate every field before use. Source identity includes repository ID, owner/name/folder, branch, immutable commit and tree.
- Proposed project child route: `/store/github.com/project/:projectId/browser-db/:connectionId[/table/:table]?branch=<actual setup base branch>&projectApi=cloud&demoContinuation=<opaque session token>`. Short GitHub `/-/browser-db/...` routes resolve through the existing project matcher. Use existing navigation helpers rather than URL concatenation.
- Project child resolves the actual destination catalog, requires exactly one eligible dataset/SHA declaration, then resolves the already-active LocalDemoDbService session. Add a read-only lookup if needed; do not call open/start implicitly when missing. A user-confirmed OPFS reopen is a recovery action and must warn before version replacement/reset.
- Query entry reuses `/store/github.com/project/:projectId/query?branch=...&projectApi=cloud&env=<catalog-declared environment>&runtime=<current registry selection>&demoDraft=<opaque session token>`. Existing Query reads env/runtime but has no generic draft token support. Add a narrow validated demo-draft reader, applied only to a new unsaved query and after project context is ready. Consume once without replacing an existing editor draft. TugQL uses the exact descriptor table identifier, bounded limit 100 and destination connection ID; runtime selection stays client-side and is never saved into the definition.
- TEST transport: existing `POST /v0/datatug/projects/create_project?store=github.com`, `GET /v0/datatug/projects/create_project/status`, `GET /v0/datatug/github/projects/pending-setups` and existing repository/catalog reads. Validate exact query names/duplicates, request JSON keys/source shape and scoped responses. Preview must not expose unrelated pending records.

### Ownership and file boundaries

Apps changes: `project/new-project/` continuation/form/offer files; `pages/demo-sqlite/`; `demo-sqlite/` service/runtime/worker/type export bridge; new project browser database page/helper; `routes/datatug-routing-proj.ts`; `ovdb/ovdb-database-browser.component.ts` only for a host-owned query action; a narrow `queries/query/page/query-page.component.ts` draft entry hook and dedicated helper; focused specs/E2E; dependency pin when published. Query dispatcher and federated executor are owned by the chart lane and are not edited without coordination.

Cloud changes: `internal/preview/preview.go` and focused tests only, preserving wire/configuration ownership. No provider IAM, OAuth scope or repository creation mutation belongs to implementation.

Root approved adding CLI and shared settings provider to this WB task. The previously installed `datatug 0.102.2 (18896ce400676e27d5010c3314e3cbab411738a3)` supports the intended commands but its shared settings loader always selects `~/.datatug.yaml`. Core v0.59.0 and CLI PR438 now support an absolute --config path; the native fixture uses a private settings file.

### Local instruction contract

Use a validated dataset slug as the relative clone folder and registered project ID by default. Require only the actual downloaded SQLite file path; advanced folder/ID controls are optional. Generate `git clone <source repo> <safe slug>`, `cd <safe slug>/demo-project-1`, `datatug projects add --project <safe ID> --directory "$PWD"`, `datatug db add --project <safe ID> --db <shell-quoted actual downloaded file path> --env local --name <dataset>-browser`, then `datatug serve --project "$PWD" --as local --role admin --allow-writes --open-browser`. Explain that the browser cannot determine the saved file path and cloning project files alone does not export edits. Enable Copy commands only with a concrete validated file path. Verify with a supported isolated CLI settings path; never change HOME or user settings.

Provider API: `session.export(options?: {maxBytes?:number}): Promise<Uint8Array>`, bounded by `MAX_SQLITE_EXPORT_BYTES=268435456`; exported error codes include `sqlite_export_too_large`, `sqlite_export_busy`, `leader_changed` with retriable true, and `worker_unavailable`. UI captures dataset/session generation and discards stale results. The underlying SQLite export is the provider's responsibility.

### TEST scope

Retain opt-in `DATATUG_BUSINESS_TEST_PROJECT_CREATE`, buyer Firebase validation and Origin `http://localhost:18782`. Pin Space `datatugbusinessmaur1020261011`, repository `trakhimenok/datatug-pro-launch-test` numeric ID `1411348122`, destination folder `r12-browser-copy`, branch `main`, and the independently verified immutable public demo source commit/tree. The legacy r11-browser-demo scope is retained only for its existing template path; new source-copy admission requires exact r12-browser-copy and configured immutable source pins. Cloud PR7 adds exact source keys and scoped setup status/pending reads. Admit only those routes and the source identity schema needed for this one journey, preserving all native GitHub and billing checks. Preflight must prove the destination is unused; an existing folder is a visible conflict, never an overwrite or implicit change of target. If occupied, root must authorize a new exact scope in a later configuration change before acceptance.

## Tasks

### Task 1: Validate typed private continuation and form defaults

**Status:** planning
**Verifies:** demo-database-handoff#ac:preserve-intent, demo-database-handoff#ac:smooth-form

Add bounded readers/private session storage, actor/source/operation/destination binding and ownership-safe restore across all existing setup completion paths. Default title/folder only without restored/user intent; auto-select exactly one authorized Space. Keep existing writable-repository/create-initialize guidance and two project choices. Test invalid links, blocked storage, auth/OAuth, stale requests, retries, actor switches and pending rediscovery.

### Task 2: Open copied project with validated edited database

**Status:** planning
**Verifies:** demo-database-handoff#ac:continue-edits, demo-database-handoff#ac:verify-destination, demo-database-handoff#ac:explicit-recovery

Add project browser database routes/page and continuation completion helper. Validate actual branch catalog and active runtime independently before opening; retain table and ownership label. Test missing/ambiguous/changed catalogs, closed/runtime-lost states, denied reads and explicit recovery. Reuse existing browser CRUD and lifecycle.

### Task 3: Add bounded TugQL table draft on existing Query screen

**Status:** planning
**Verifies:** demo-database-handoff#ac:query-table, demo-database-handoff#ac:explicit-recovery

Coordinate the exact helper API with chart owner before editing QueryPage. Add a host Query this table action plus private one-shot draft handoff bound to current project/branch/connection/environment/table/runtime. Preserve existing user drafts and validate capabilities. Focused browser test runs the edited row value on the selected runtime; loss of context blocks explicitly.

### Task 4: Bridge provider export and executable local instructions

**Status:** planning
**Verifies:** demo-database-handoff#ac:export-active, demo-database-handoff#ac:local-commands

Wait for root's merged provider SHA pin. Bridge active session export across worker messages and render bounded download/retry state. Use safe slug defaults with optional folder/ID overrides and collect the actual downloaded file path; generate exact quoted commands. Unit tests assert export bytes/error codes, stale completion, filename/URL cleanup, quoting and no-sign-in. Do not fake database export or register an original upstream file.

### Task 5: Provide safe CLI fixture configuration if required

**Status:** planning
**Verifies:** demo-database-handoff#ac:local-commands

Root reviews whether an existing supported isolated config path can be used; discovery found none in current CLI help or settings loader. If absent, root authorizes minimal explicit config-path support and extends repository scope before edits. Then run installed/released CLI registration and db-add against fixture settings and query the exported changed row. Never change HOME or user settings. No server is needed for registration/query; any eventual serve test has a named owner, bounded lifetime and teardown receipt.

### Task 6: Narrow isolated TEST source-copy admission

**Status:** planning
**Verifies:** demo-database-handoff#ac:test-admission

Extend preview's exact request/response scoping for immutable source, status and pending routes. Keep native auth/GitHub/paid-space enforcement. Tests prove wrong buyer/origin/Space/repository/folder/branch/source/query/body keys and unrelated pending operations are denied. Changed Go code receives full statement coverage. Root handles deployment/provider acceptance separately.

### Task 7: Verify and publish the complete journey

**Status:** planning
**Verifies:** demo-database-handoff#ac:whole-journey, demo-database-handoff#ac:continue-edits, demo-database-handoff#ac:query-table, demo-database-handoff#ac:local-commands

Run focused units, owning Nx lint and focused production browser journeys on final combined head. Assert edited bytes survive export and query results, automatic merged-ready navigation and auth refresh without manual crutches. Request independent adversarial review before disruptive source and again on the final diff. Publish exact-head PR receipts to root; root alone performs TEST buyer/provider mutation after approved admission and unused-destination checks, then WB landing and cleanup. Distinguish mock/local evidence from real source-read/PR-create/merge acceptance.

## Open Questions

- Root approved this plan after independent review; final source review and exact-head verification remain required.
- Provider export is pinned to merged ab42235a0e125139ebd4eea904c9ffca6aba7c42.
- Root approved the shared config-path provider (core v0.59.0) and CLI PR438. Native local fixture registration/query passed with --config and exported edited bytes.
- Root verified repository read/write authority and that r12-browser-copy returns 404 while r11-browser-demo is occupied. Recheck r12 immediately before any write. Actual TEST buyer session and immutable source read authority remain unverified; provider acceptance is a later root gate.
- Dataset catalog coverage is not universal. Missing/mismatched declarations are explicit unsupported continuation until an independently approved source-project update exists.

---
*This document follows the https://specscore.md/plan-specification*
