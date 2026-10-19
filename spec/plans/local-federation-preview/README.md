---
format: https://specscore.md/plan-specification
status: Draft
---

# Plan: Deliver a safe local public federation preview

**Status:** Draft
**Source Feature:** local-federation-preview
**Date:** 2026-10-19
**Owner:** showcase-interaction-design
**Supersedes:** —

## Summary

Journey: I open the local showcase from the canonical public GitHub demo; the overview loads real server data. I choose Northwind + Chinook shared countries and press Run; without another action the grid shows the complete server comparison. I inspect its actual source receipt. I cancel or retry a failed run and get a fresh bounded request. Observable results are a usable overview, one root POST, complete typed rows, canonical lineage, and no browser scans or SQLite downloads. This local macOS Codex Sol6.1 lane owns the Apps worktree; root alone owns landing.

## Approach

Reuse the existing Angular development server proxy and existing fetch injection seams. Add a development-only application InjectionToken with the sole value `public-ovdb-loopback-v1`; no saved schema or storage changes. The dispatcher passes it to each manually owned FederatedQueryService; the worker receives that enum only and constructs a pure fixed-host fetch adapter. The service's injected instance must receive the same optional config without requiring Angular injection in manually constructed test instances. Use the same adapter for executeSavedPublicChartQuery's existing fetch option. Do not change endpoint admission or source receipts. Production environment files have no provider, and runtime loopback checks fail closed if the enum is misconfigured. Paired bars, linked country selection, clone handoff and upstream policy changes are deferred.

Contract: fixed same-origin prefixes `/__datatug_public_ovdb/cloud` and `/__datatug_public_ovdb/demodb` map only to `https://cloud.openvaultdb.com` and `https://ovdb.demodb.dev`. Support only the existing public metadata GET `/v1/databases/<encoded-id>` and read-only DTQL POST `/v1/dtql` or `/v1/databases/<encoded-id>/dtql`; reject malformed/encoded separator, traversal, query/hash and alternate methods. Unsupported canonical requests retain their existing direct path. Preserve the original public Accept/Content-Type, body, signal, redirect:error and cache policy; force credentials:omit only for remapped public requests. Explicit Authorization is never remapped. No caller can supply an upstream URL. Static-source execution keeps its existing exclusive adapter.

Proxy guards run before the Vite proxy forwards: loopback socket address; Host is the actual loopback listener host/port; Origin, if present, is that same origin; no Authorization or Cookie; allowed method/path and intended Accept/Content-Type only (JSON/YAML POST, no form/simple-content-type query submission). Bind the development server to127.0.0.1 and use its allowed-host validation. Retain the actual incoming browser Origin, never substitute a production origin; changeOrigin changes only upstream Host for TLS routing. Disable redirect following and WebSocket forwarding. Forward only public request headers and remove Cookie/Authorization defensively. On browser disconnect, abort/destroy the upstream request; use existing bounded client readers and deadlines. Test server hooks with a controlled local fake upstream through dependency injection in tests, while production configuration fixes the HTTPS hosts.

Auth evidence at merged d63f16ed: query/page/query-page.component.ts defines ovdbToken=signal(''), setOvdbToken is called only by the optional OVDB input and query reset; run passes its trimmed value as federationRun.token. QueryDispatchService.runOwned constructs the service and forwards that token; executor converts it to Authorization. No Firebase token enters this path. Tests must prove signed-in surrounding state does not add credentials, explicit bearer stays direct and proxy rejects credentials. No QueryPage source changes are planned, avoiding the clone lane's entry hook.

Expected files: apps/datatug-app/project.json (development proxy + loopback binding only); apps/datatug-app/src/environments/environment.ts (dev provider only); new tools/public-ovdb-proxy.cjs and focused Node tests; new queries/public-ovdb-dev-transport.ts plus optional separate Angular token module and focused specs; queries/query-dispatch.service.ts; queries/federated-query.service.ts; queries/federated-query.worker.ts; existing eager semantic/src/lib/tokens/public-ovdb-dev-transport.token.ts and semantic public_api.ts for the narrow provider contract; main stays lazy. Existing service/worker/dispatch specs, apps/datatug-app/src/environments/environment.providers.spec.ts and apps/datatug-app/e2e/server-showcase.spec.ts cover integration. Update the old development providers=[] assertion to require only the dev transport provider while preserving API/auth defaults. Explicitly test effective Request plus init overrides, body/AbortSignal, progress/finished/source callbacks and disconnect after POST completion; normal incoming-request close must not cancel a healthy upstream response. Independent plan review approved with0 blockers/majors and these2 minor adjustments; root approved the narrow named token/provider export; lint confirmed the main library stays lazy, so the contract belongs in the existing eager semantic entry point. No API, Worker deployment, datatug-core, Demo Project or clone-offer files change.

## Tasks

### Task 1: Admit a fixed public development transport

**Verifies:** local-federation-preview#ac:app-authority, local-federation-preview#ac:public-credentials, local-federation-preview#ac:production-direct
**Status:** planning

Implement the app-owned dev token and fixed worker fetch adapter. Verify canonical admission/provenance, no saved-definition authority, loopback gating, public credential omission, explicit bearer/direct behavior, and unchanged default production fetch calls. Keep static adapters exclusive and both constructed/injected service callers compatible.

### Task 2: Secure the existing development proxy

**Verifies:** local-federation-preview#ac:loopback-routes, local-federation-preview#ac:public-credentials, local-federation-preview#ac:preserve-execution
**Status:** planning

Configure only development serve with fixed targets. Focused tests reject remote clients, forged Host/Origin, credentials, arbitrary URLs, traversal, unsupported methods/routes and redirects; verify intended public headers, streaming body and abort/disconnect behavior. Preserve existing rights/result guards and add cancellation/error integration coverage.

### Task 3: Verify the real local journey and production boundary

**Verifies:** local-federation-preview#ac:local-journey, local-federation-preview#ac:preserve-execution, local-federation-preview#ac:production-direct
**Status:** planning

Run focused Nx tests, typecheck, lint and official production build. Run one bounded Chromium journey against the canonical public GitHub demo and real OVDB. Assert mechanism and source receipt, 17 sample rows and Canada3/8, no SQLite/WASM, one root POST, and usable retry/cancel state. A production-mode unit/build smoke proves no remapping. Persist a concise public-data receipt without full customer rows or secrets; root independently reviews and lands the exact PR head.

### Local resource ownership

Owner is this WB task local-federation-preview and this agent. Planned listener127.0.0.1:4330, checked free before startup. Start through governed Nx serve/Playwright child only after plan approval. Exact teardown is SIGTERM to the recorded serve child PID followed by a listener check; Playwright normally terminates its own child automatically. Record the actual PID and teardown result in task evidence. No persistent daemon, tunnel, public binding or shared-browser resize is required. Root requested retaining the actual preview for user review: listener PID3302, governed child1419. Durable ownership and coordinated replacement/teardown receipt: /Users/alex/projects/.wb/evidence/local-federation-preview/resource.json. Do not stop this resource before coordinating with root; root will rehome it to synchronized canonical main before cleanup.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/plan-specification*
