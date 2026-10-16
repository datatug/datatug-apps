---
format: https://specscore.md/feature-specification
status: Implementing
---

# Feature: In-browser query dispatch

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/browser-query-dispatch?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/browser-query-dispatch?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/browser-query-dispatch?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/browser-query-dispatch?op=request-change) |
**Status:** Implementing
**Source Ideas:** —

## Summary

Resolve saved query definitions and explicit execution targets through one browser dispatcher while preserving project storage identity, runtime capability and result envelopes.

## Problem

Saved project definitions can be read from local, GitHub, and cloud stores, while queries execute through different runtimes. Board widgets currently choose Chinook by name and bypass the query page's execution paths. That conflates where a definition is stored with where it runs and makes otherwise valid sources unavailable from a board.

## Behavior

### User journey

1. A user opens a project from its local CLI, GitHub, or supported cloud store. The project screen loads the definition; browser-owned runtimes also read the connection catalog. The visible project reference retains store, branch, project API, and space identity.
2. The user opens a generic query board card or ordinary query page. It reads the saved query, shows the current environment and project runtime, and offers matching open working copies for browser execution by title. The user explicitly chooses the project runtime or an open working copy for this run.
3. The user runs the card. The dispatcher captures the definition and bindings and validates the selected runtime. Browser runtimes resolve a unique catalog connection declaration; protected saved-query APIs admit sources against their own project and environment bindings. An unsupported or incomplete target produces a specific error without trying another runtime.
4. The user sees the returned rows, an empty result, or an actionable error. Leaving the card, changing project, branch, environment, principal, or runtime selection cancels the request; a late response cannot replace the current result. Independent cards retain independent execution sessions. Closing or refreshing a working copy invalidates its previous selection.

### Runtime responsibilities

- Project loading and definition reads stay in the project storage services. A project reference identifies that definition; it does not authorize or select a runtime.
- The dispatcher owns immutable request capture, browser-runtime connection catalog resolution, target planning, explicit capability checks, cancellation, and the common `FederatedQueryResult` envelope. Protected saved-query APIs admit their own source IDs against their selected environment; the browser catalog is not their authority.
- Adapters own transport and runtime-specific admission. Local CLI execution uses the existing semantic `RunQueryRequest` contract. Hosted execution uses the existing hosted query contract for supported shared Firestore/space contexts, including saved federation definitions and server-admitted connection IDs. OVDB uses the existing federated service only for its admitted source graph/protocol. Browser SQLite requires a unique structural `sqlite` descriptor with a pinned `browserFixture` URL, byte size, and SHA-256.
- Browser SQLite fetches bounded fixture bytes, verifies the pin, and executes one read-only statement with typed bindings and bounded rows, columns, bytes, and wall time in an isolated worker. It does not use a source-name or dataset-name check and has no built-in fixture fallback.
- The provider of an open working copy registers its live OVDB connection while it is ready. The registry offers it only when the catalog connection's explicit canonical SHA-256 matches the live descriptor and the descriptor reports query capability. Selection is opaque and checked again at dispatch; the adapter uses that connection's own `fetch`, so edits to the open copy are visible. A connection ID or dataset name alone never authorizes the binding.
- A target hint is validated against the resolved project context and adapter capability. Missing metadata, ambiguous connection IDs, unsupported SQL/runtime pairs, and stale or unbound branch targets fail explicitly. A dispatched request never retries against another runtime.
- Result provenance describes the selected runtime and fixture pin. Browser-reported bindings are marked client-reported; a browser result does not claim server retention, policy, license, or authorization evidence.
- Query-page author preview, proof, history, progress, and session presentation remain owned by the query page. Federation paging and continuation remain attached to the same per-run owner that created the federated worker.
- Shared Firestore hosted execution uses its existing saved-query contract. The shared-project API has a connection catalog for its pinned demo data, while paid hosted source admission follows the server's environment bindings. Shared Board asset reads remain a separate storage-provider capability; this feature does not create a missing Board reader.

### Capability matrix

| Runtime | Supported here | Explicitly unsupported here |
| --- | --- | --- |
| Local CLI / agent API | Existing saved-query requests supported by `RunQueryRequest` | Branch-qualified or cross-storage execution where the API cannot bind the displayed definition revision; invented branch/head fields |
| Hosted cloud query API | Existing shared Firestore/space saved-query contract, including server-admitted federation sources | GitHub-backed hosted SQL or any unimplemented server endpoint |
| OVDB federation | Existing admitted federation graph and structured source protocol | Arbitrary raw SQL over an OVDB URL or generic runtime inference from `source` |
| Open OVDB working copy | Explicitly selected live provider connection for supported single-source structured DTQL, bounded by rows, columns, response bytes, and time | Raw SQL, unsupported DTQL shapes or parameter binding, silent download of a pristine fixture, unregistered or mismatched runtime |
| Browser SQLite worker | Captured SQL and exact scalar inputs over a structurally pinned fixture descriptor of at most 10 MiB | Unpinned or larger fixture, multi-statement/write SQL, unsupported types, or silent fixture fallback |
| Browser HTTP | No new direct transport in this feature | Arbitrary URL/method execution; existing saved HTTP query requests remain server-owned |

## Acceptance Criteria

1. A pure resolver and dispatcher unit suite proves unique connection resolution, arbitrary connection IDs, target precedence, missing target/parameter failures, no fallback after adapter failure, and independent cancellation for concurrent requests.
2. Board cards route execution through the dispatcher, preserve board/query identity re-reads and generation/principal guards, show environment/target context, and use an injected dispatcher fake in component tests.
3. The query page routes its ordinary transport decisions through the shared dispatcher while retaining hosted binding validation, semantic author preview/receipts, result history/progress, cancellation, and the exact federated worker owner for page/continuation operations.
4. A generic SQLite worker test runs the same bounded read-only engine against at least two distinct fixture schemas and IDs. It verifies fixture pinning, no default fixture, parameter validation, worker termination, and bounded failure behavior.
5. A browser journey loads a saved query from project storage, runs a generic Board card through an explicitly supported runtime, and renders returned rows. A second arbitrary SQLite connection proves dispatch is descriptor-driven.
6. Project/principal/environment/target changes cancel or invalidate an in-flight result. No late success or error publishes into the new context.
7. An editable local copy is opened, changed, selected explicitly on a structured Board card and ordinary query page, and queried through its registered `fetch`. The result reflects the edit without downloading or substituting the published snapshot. Closing the copy removes that option and fences an in-flight result.
8. Focused owning Nx tests, lint, and spec lint pass. Full browser E2E remains an integration gate on the final combined head.

## Open Questions

Whether a future agent API should expose an atomic expected query revision/branch binding is unresolved. Until it exists, this dispatcher must reject cross-storage or branch-qualified SQL execution through that API when it cannot prove the requested definition matches the server-side saved query.

---
*This document follows the https://specscore.md/feature-specification*
