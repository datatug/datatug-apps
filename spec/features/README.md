---
format: https://specscore.md/features-index-specification
---

# Features

Feature specifications for this project.

## Index

| Feature | Status | Description |
|---------|--------|-------------|
| [DataTug Work](datatug-work/README.md) | Implementing | Canonical Incident, Detective Case and Task workspace with shared accountability, Context Bags, evidence and authorised HTTP workflows. |
| [AI Query Builder](ai-query-builder/README.md) | Approved | The **Web Implementation** of the AI Query Builder Capability (`specscore:feature/ai-query-builder@github.com/datatug/datatug`): an in-app web view where a user seeds and progressively refines a read-only query from natural language. The current query's SQL is shown in an always-visible panel, results render in the web app's interactive data grid, and execution is governed by an **Auto-run** checkbox with an explicit **Apply/Run** button for manual mode. This Feature specifies only the Web-specific surface and its deltas from the Capability; all platform-agnostic behavior is inherited from the Capability it `**Implements:**`. |
| [AI-Terminal Query Builder](ai-terminal-query-builder/README.md) | Approved | The web-side **communication layer** between the DataTug Web UI and the local DataTug DAL backend daemon (`datatug serve` + the serve-brokered query-builder broker). It ingests the deep link the terminal AI-agent produces, exchanges the one-time code for a session token, connects to the local daemon over HTTP (commands) and WebSocket (live updates), and brokers the query-builder protocol for the [`query-builder`](../query-builder/README.md) screen: subscribing to the tab's live current query + results + **mode**, maintaining the in-page change history, sending mode-appropriate edits (structured AST edits in TugQL mode, verbatim native text in native mode), parameter values, revert, and run, and transporting candidate options. This Feature owns the client/transport contract only; the screen and its controls are specified in `query-builder`. |
| [Enterprise SSO](enterprise-sso/README.md) | Approved | Sneat's shared auth surface provides email-first OIDC and SAML enterprise sign-in and a self-service unknown-domain onboarding path. DataTug.app is the first application registering the shared `/sso` routes; the same backend and `@sneat/auth-ui` components are reusable by sneat.work, sneat.team, and other Sneat sites. Enterprise identities are linked to canonical Firebase/Sneat users and ordinary Sneat space membership. Configuration belongs to the space SSO extension; global domain and optional tenant-host collections are routing indexes only. |
| [Query Builder](query-builder/README.md) | Approved | The **Web Implementation** of the Serve-Brokered AI Query Builder Capability (`specscore:feature/serve-brokered-query-builder@github.com/datatug/datatug`): the web screen where a user *views and edits* the current query that a terminal AI-agent is building, with results, history, and tabs. The screen reads and writes the query through the [`ai-terminal-query-builder`](../ai-terminal-query-builder/README.md) comms layer and adapts to the tab's **mode**: in **TugQL mode** it offers point-and-click edit controls over the dalgo AST (viewable as TugQL-YAML or rendered native query); in **native mode** it shows the connection's native query text in an editable text area. It also presents the live results, change history with revert, candidate-option previews, parameter inputs, an Auto-run/Run control, and tabs — and deliberately contains **no AI-chat/prose input**, because the conversation lives in the terminal. This Feature specifies the Web-specific surface; platform-agnostic behavior is inherited from the Capability it `**Implements:**`. |
| [Browser Chat Phase 1](browser-chat-phase-1/README.md) | Draft | Browser Chat translates questions to validated TugQL and queries a versioned local 11-table Chinook IndexedDB dataset through DALgo, rendering structured rows in AG Grid. |
| [Browser Chat Phase 4 Bookmarks](browser-chat-phase-4-bookmarks/README.md) | Approved | Project-scoped durable bookmarks for browser Chat RecordSets, Views and selections. |
| [Browser Chat Phase 5 FK JOIN exploration](browser-chat-phase-5/README.md) | Approved | Discover and apply deterministic FK JOIN candidates from browser Chat result grids. |
| [Checkout Journey](checkout-journey/README.md) | Implementing | Review of deployed Pro and Business checkout and a shared purchase flow with post-payment Business space linking. |
| [In-browser query dispatch](browser-query-dispatch/README.md) | Stable | Resolve saved query definitions and explicit execution targets through one browser dispatcher while preserving project storage identity, runtime capability and result envelopes. |
| [Copy a demo DataTug project](demo-project-copy/README.md) | Draft | Offer GitHub and local Git project copies after a browser SQLite demo is ready. |
| [Continue an edited demo database in my project](demo-database-handoff/README.md) | Draft | Carry the active edited SQLite database through optional GitHub and local project ownership without silently switching data. |
| [Native server federation for saved queries](native-server-federation/README.md) | Draft | Execute a qualified multi-database saved TugQL plan in one bounded OVDB server request and validate physical sources before exposing rows. |
| [Local preview of public server federation](local-federation-preview/README.md) | Draft | Run real public OVDB queries from the loopback development app through a fixed same-origin transport while retaining canonical source admission. |
| [Reusable held result exploration](held-result-exploration/README.md) | Implementing | Explore admitted held results with clear actions, stable sorting and complete monthly Orders trends without extra execution. |
| [Hosted Incident conversation](hosted-incident-conversation/README.md) | Draft | Authenticated human Incident messages, scoped history and replay-safe posting in the private project web UI. |
| [Shared shipping evidence charts](shared-shipping-evidence-charts/README.md) | Draft | Core-compatible held evidence preparation and one shared three-kind SVG presentation leaf. |
| [Hosted board authoring](hosted-board-authoring/README.md) | Draft | Create, edit, save and reload canonical boards in an explicitly scoped hosted project. |
| [Project cards](project-cards/README.md) | Approved | Save a dashboard card as a standalone, parameterised project card; reference it from dashboards; and show the matching card beside a grid when the user selects a cell (for example a `CustomerID` on an orders list), with cached results. |
| [Shipping working copy controls](shipping-working-copy-controls/README.md) | Draft | Expose the published Backend v0.42 working-copy lifecycle in the native hosted project web UI. This is one bounded part of the [shipping investigation story](https://github.com/datatug/backstage/tree/main/spec/features/unsigned-shipping-investigation), not recording-readiness proof. |
| [HTTP Query Editor](http-query-editor/README.md) | Implementing | Postman-like create, edit, save and run of HTTP queries in the DataTug web app. |
| [Shared project environment order](shared-project-environment-order/README.md) | Implementing | Persist and apply one project-owned environment order from least risky to most risky across every environment reader and selector. |
| [Independent chart source composition](independent-chart-sources/README.md) | Implementing | Add a compatible independently executed saved query to a normal chart, with the same action in the guided session. |

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/features-index-specification*
