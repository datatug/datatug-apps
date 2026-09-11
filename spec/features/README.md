---
format: https://specscore.md/features-index-specification
---

# Features

Feature specifications for this project.

## Index

| Feature | Status | Description |
|---------|--------|-------------|
| [AI Query Builder](ai-query-builder/README.md) | Approved | The **Web Implementation** of the AI Query Builder Capability (`specscore:feature/ai-query-builder@github.com/datatug/datatug`): an in-app web view where a user seeds and progressively refines a read-only query from natural language. The current query's SQL is shown in an always-visible panel, results render in the web app's interactive data grid, and execution is governed by an **Auto-run** checkbox with an explicit **Apply/Run** button for manual mode. This Feature specifies only the Web-specific surface and its deltas from the Capability; all platform-agnostic behavior is inherited from the Capability it `**Implements:**`. |
| [AI-Terminal Query Builder](ai-terminal-query-builder/README.md) | Approved | The web-side **communication layer** between the DataTug Web UI and the local DataTug DAL backend daemon (`datatug serve` + the serve-brokered query-builder broker). It ingests the deep link the terminal AI-agent produces, exchanges the one-time code for a session token, connects to the local daemon over HTTP (commands) and WebSocket (live updates), and brokers the query-builder protocol for the [`query-builder`](../query-builder/README.md) screen: subscribing to the tab's live current query + results + **mode**, maintaining the in-page change history, sending mode-appropriate edits (structured AST edits in DTQL mode, verbatim native text in native mode), parameter values, revert, and run, and transporting candidate options. This Feature owns the client/transport contract only; the screen and its controls are specified in `query-builder`. |
| [Enterprise SSO](enterprise-sso/README.md) | Approved | Sneat's shared auth surface provides email-first OIDC and SAML enterprise sign-in and a self-service unknown-domain onboarding path. DataTug.app is the first application registering the shared `/sso` routes; the same backend and `@sneat/auth-ui` components are reusable by sneat.work, sneat.team, and other Sneat sites. Enterprise identities are linked to canonical Firebase/Sneat users and ordinary Sneat space membership. Configuration belongs to the space SSO extension; global domain and optional tenant-host collections are routing indexes only. |
| [Query Builder](query-builder/README.md) | Approved | The **Web Implementation** of the Serve-Brokered AI Query Builder Capability (`specscore:feature/serve-brokered-query-builder@github.com/datatug/datatug`): the web screen where a user *views and edits* the current query that a terminal AI-agent is building, with results, history, and tabs. The screen reads and writes the query through the [`ai-terminal-query-builder`](../ai-terminal-query-builder/README.md) comms layer and adapts to the tab's **mode**: in **DTQL mode** it offers point-and-click edit controls over the dalgo AST (viewable as DTQL-YAML or rendered native query); in **native mode** it shows the connection's native query text in an editable text area. It also presents the live results, change history with revert, candidate-option previews, parameter inputs, an Auto-run/Run control, and tabs — and deliberately contains **no AI-chat/prose input**, because the conversation lives in the terminal. This Feature specifies the Web-specific surface; platform-agnostic behavior is inherited from the Capability it `**Implements:**`. |

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/features-index-specification*
