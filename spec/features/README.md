---
format: https://specscore.md/features-index-specification
---

# Features

Feature specifications for this project.

## Index

| Feature | Status | Description |
|---------|--------|-------------|
| [ai-query-builder](ai-query-builder/README.md) | Approved | Web Implementation of the AI Query Builder capability: an in-app web view that seeds and progressively refines a read-only query by natural language, with an auto-run checkbox + Apply button, an inspectable SQL panel, and results in an interactive data grid. |
| [ai-terminal-query-builder](ai-terminal-query-builder/README.md) | Approved | TODO: Add description. |
| [Enterprise SSO](enterprise-sso/README.md) | Approved | Sneat's shared auth surface provides email-first OIDC and SAML enterprise sign-in and a self-service unknown-domain onboarding path. DataTug.app is the first application registering the shared `/sso` routes; the same backend and `@sneat/auth-ui` components are reusable by sneat.work, sneat.team, and other Sneat sites. Enterprise identities are linked to canonical Firebase/Sneat users and ordinary Sneat space membership. Configuration belongs to the space SSO extension; global domain and optional tenant-host collections are routing indexes only. |
| [query-builder](query-builder/README.md) | Approved | TODO: Add description. |

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/features-index-specification*
