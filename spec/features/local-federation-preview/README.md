---
format: https://specscore.md/feature-specification
status: Draft
---

# Feature: Local preview of public server federation

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/local-federation-preview?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/local-federation-preview?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/local-federation-preview?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/local-federation-preview?op=request-change) |
**Status:** Draft
**Source Ideas:** —

## Summary

Run real public OVDB queries from the loopback development app through a fixed same-origin transport while retaining canonical source admission.

## Problem

The loopback preview reaches the saved comparison but browser CORS blocks public OVDB capability discovery before execution. The deployed DataTug origin is admitted by the upstream API. Developers need a real local preview without changing upstream policy, saved source identity or authorization.

## Behavior

The visitor opens the local development showcase, selects the saved Northwind/Chinook comparison and presses Run. Without another action the grid displays the complete server result. The browser makes same-origin requests to a development-only fixed transport; that transport forwards to the existing HTTPS OVDB APIs. The root query still executes once on cloud.openvaultdb.com, with no browser scans or SQLite downloads. The canonical saved source and provenance remain the actual OVDB URLs.

An application-owned development provider enables a fixed transport mode, never an arbitrary target URL. Only loopback browser contexts and credential-free public requests can use it. Explicit OVDB bearer requests retain the direct path and authorization; protected requests are never silently downgraded. The proxy rejects invalid Host/Origin/client addresses, credential headers and unsupported routes or methods before forwarding. Cookies and authorization are removed defensively; only intended public headers are forwarded. Production has no provider or proxy route and keeps direct transport.

QueryPage owns a separate empty-by-default ovdbToken signal. Only its optional OVDB bearer input and query-reset method change it; federationRun.token passes it to the worker. It is independent of Firebase/DataTug sign-in credentials. The existing source-rights preflight, canonical endpoint validation, deadlines, redirect refusal, result byte limits, physical-source validation and cancellation remain authoritative.

## Acceptance Criteria

### AC: local-journey

Given the development app on loopback with the canonical public GitHub demo, when the visitor opens the comparison and presses Run, then the real server returns a complete 17-row result with Canada 3/8, exactly one root query POST, the two physical source receipts and no SQLite/WASM downloads, without another action. Counts are an observed sample receipt, not an immutable source promise.

### AC: app-authority

Given development configuration, when dispatch starts a worker, then only the application-owned fixed transport enum can enable proxying. Saved definitions cannot supply a proxy target, host, token or route override. Canonical saved URLs and source evidence remain unchanged. The overview uses the same admitted fetch seam.

### AC: public-credentials

Given a public query while signed in to DataTug, when it executes locally, then no DataTug token or cookie reaches OVDB. Given an explicit OVDB bearer token, then it remains on the direct authorized path without downgrade. Credential-bearing requests to the local public proxy are rejected before upstream forwarding.

### AC: loopback-routes

Given a proxy request, when the remote address, Host, Origin, method or path is outside the fixed loopback/public-read contract, then it fails before forwarding. Upstreams are fixed HTTPS cloud.openvaultdb.com and ovdb.demodb.dev; redirects are not followed and no URL field can choose a destination.

### AC: preserve-execution

Given successful, refused, oversized, redirected or cancelled public server requests, when run through the local transport, then existing rights checks, abort signals, deadlines, bounded readers, exact source/typing validation and visible retry behavior still apply. Source-rights or root failures never fall back to client scans.

### AC: production-direct

Given a production build or a non-loopback context, when a query executes, then proxy configuration is absent or fails closed and the original canonical direct fetch URL/options and bearer behavior are preserved. No development proxy is deployed.

## Validation snapshot

Local Chromium on canonical public GitHub HEAD passed the overview and comparison journey in3.5s:830 orders,23 frames,17 comparison rows, Canada3/8, one root POST200, two capability preflights, canonical source details and no SQLite/WASM downloads. No GitHub or OVDB fixture was used. Public evidence is in2026-10-19-local-observation.json; the screenshot and running resource ownership are retained outside ignored coverage under /Users/alex/projects/.wb/evidence/local-federation-preview/. Chromium did not retain the completed worker response body; this receipt records visible UI/network evidence, not an archived raw envelope. Strict native source/type/envelope admission remains covered by focused executor and worker gates.

Focused main transport/service/worker/dispatch/native gates passed74 distinct cases together on the merged main and exact SQLite adapter pinab42235. Environment provider tests passed3 cases; main spec typecheck and main/app/semantic lint passed. The official production build passed with integrity-verified Core preparation. Six proxy tests pass and cover real Vite forwarding, normal POST completion and cancellation after POST completion. Production providers remain empty and direct fetch options remain unchanged. Pinned demo refs intentionally require Refresh chart; automatic first-touch execution is tested on the canonical HEAD route only.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/feature-specification*
