---
format: https://specscore.md/feature-specification
status: Draft
---

# Feature: Continue an edited demo database in my project

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/demo-database-handoff?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/demo-database-handoff?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/demo-database-handoff?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/demo-database-handoff?op=request-change) |
**Status:** Draft
**Source Ideas:** —

## Summary

Carry the active edited SQLite database through optional GitHub and local project ownership without silently switching data.

## Problem

After I edit a demo database, project copying must preserve my working data and place me at a useful next screen. A project repository alone does not contain the browser SQLite database or its edits.

## Behavior

I edit a SQLite table and choose one of the two existing project copy options. If I keep exploring, nothing interrupts the table. With GitHub I review a prefilled project title and folder, choose an existing writable repository, complete sign-in and authorization if needed, and merge the existing setup PR. The app then opens that copied project with my edited browser database and the same table. It says “Project files in GitHub; database and edits in this browser”. Query this table opens a bounded DTQL draft on the existing Query screen using that same database.

With local Git I download the active edited SQLite file, enter its actual saved file path and keep a safe dataset-based project-folder default, and receive executable commands to clone the source project, register it, add the downloaded database in environment local, and serve the project. This path needs no sign-in. The app never claims a clone command includes browser edits, never silently substitutes upstream data, and never sends a runtime selection ID or browser database bytes in project setup requests.

Session continuation is private tab state, scoped by actor, immutable source, setup operation and destination project. It contains a canonical dataset ID, original catalog SHA256, optional table and the existing validated GitHub source identity; live runtime objects stay in memory. A continuation is intent only: the destination project catalog and current runtime descriptor must independently match before data is displayed or queried.

## Dependencies

- demo-project-copy

## Acceptance Criteria

### AC: continue-edits

Given an edited active demo table, when GitHub setup becomes merged_ready, then the copied project opens that same table against the same edited browser database without another click or data download, and clearly labels project-file ownership versus browser data.

### AC: preserve-intent

Given sign-in, OAuth, refresh, retry or pending-setup rediscovery, then validated continuation remains bound to its original actor, source, operation and destination; another actor or unrelated setup cannot inherit it. Browser runtime IDs and database bytes never enter create/status requests or repository content.

### AC: verify-destination

Given a copied project, then its actual branch connection catalog supplies exactly one eligible SQLite connection matching the dataset and original canonical SHA256; runtime canonical SHA256 must also match. Missing, ambiguous or changed declarations block continuation with explicit recovery.

### AC: explicit-recovery

Given a closed runtime, lost memory-only session, changed data version or denied storage, then the app explains what is available and offers explicit retry/reopen/download/return choices as applicable. It never silently falls back to an upstream database or resets edits.

### AC: query-table

Given a validated table and runtime, when Query this table is selected, then the existing project Query route opens a bounded unsaved DTQL draft, selects the destination connection and its declared environment, and returns the edited row values. Identifiers are structured and validated; no raw SQL is generated. Missing draft/runtime context shows recovery.

### AC: smooth-form

Given a new copy request, then dataset-derived title and folder defaults appear only when restored/user input is absent. Exactly one eligible Space is selected automatically; multiple Spaces remain a deliberate choice. Existing writable GitHub repository requirements and the external create-and-initialize link remain clear. No repository creation endpoint or added OAuth scope is introduced.

### AC: export-active

Given the local option, when Download edited SQLite is selected, then only the current active database is exported using the provider session export API with a 256 MiB cap and a safe filename. Busy export is disabled; size, busy, leader-change and unavailable-worker failures have actionable messages and retry where safe. Stale completion never downloads the wrong dataset. Download object URLs are revoked.

### AC: local-commands

Given a concrete exported-file path and safe dataset-based folder/project-ID defaults, then generated shell-quoted commands use a concrete registered project ID, git clone, projects add, db add with environment local and a dataset-browser source name, and serve "$PWD" after entering the cloned project directory. Commands are verified with the installed CLI against an isolated fixture; selecting the local option needs no sign-in.

### AC: test-admission

Given isolated TEST opt-in, then preview permits only the pinned buyer, origin, Space, repository, branch and destination plus exact immutable public source identity needed for source-copy create/status/pending flows. Native authentication, GitHub authority, paid writes and destination-conflict checks still run. Every unpinned route/source/target is refused; existing destination content is never overwritten.

### AC: whole-journey

Focused tests cover async, error, actor-switch, stale-catalog and reload paths. Browser acceptance edits a row, completes setup through existing auth/PR mechanisms, opens the copied project and runs Query this table against the edited row without manual refresh. A local export/CLI receipt proves the downloaded bytes contain that edit. Mocked checks are distinguished from real provider acceptance.

## Open Questions

- Provider export is pinned to merged ab42235a0e125139ebd4eea904c9ffca6aba7c42; local browser export/native CLI evidence is recorded separately from provider acceptance.
- CLI PR438 adds an absolute --config path using core v0.59.0; the local registration fixture uses that isolated path without changing HOME or user settings. Published consumer delivery remains a root landing gate.
- Root verified repository write authority and an unused r12-browser-copy folder; r11-browser-demo is occupied and must not be overwritten. Recheck r12 immediately before any write. The current authenticated TEST buyer browser session is unverified. Provider mutations wait for root acceptance approval.
- A dataset whose current public demo source does not contain a matching SQLite connection must receive explicit recovery; adding catalog declarations outside these repositories requires a separately owned source-project change.

---
*This document follows the https://specscore.md/feature-specification*
