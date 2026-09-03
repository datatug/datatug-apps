---
format: https://specscore.md/idea-specification
status: Specified
---

# Idea: Enterprise SSO

**Status:** Specified
**Date:** 2026-09-03
**Owner:** DataTug team
**Promotes To:** enterprise-sso
**Supersedes:** —
**Related Ideas:** —

## Problem Statement

How might a company adopt OIDC sign-in in DataTug.app without support tickets, duplicate user accounts, a second organisation model, or weakening Sneat's existing space membership boundary?

## Context

DataTug.app already authenticates browsers with Firebase and represents an organisation as a Sneat space. Firebase UID, Sneat `users/{uid}`, and the user's role-bearing space membership are the canonical identity and authorisation records. Enterprise SSO should add an authentication method to that chain, not replace it.

The missing path is both discovery and bootstrap. Employees need an email-first `/sso` entry that routes a known domain directly to its provider. The first administrator of an unknown domain needs to continue through normal Firebase registration, create or select a Sneat space, configure OIDC, prove a real provider login, and return to the new setting without restarting the journey.

## Recommended Direction

Build a product-neutral OIDC extension in `sneat-core-modules/auth/sso` and mount it through narrow adapters in the existing Sneat Go host. Put its reusable Angular screens and API client in `@sneat/auth-ui`, so DataTug.app is the first consumer rather than the owner of a one-off identity stack; sneat.work, sneat.team, and later Sneat applications can register the same routes. Store the source-of-truth configuration at `/spaces/{spaceID}/ext/sso`; maintain global routing indexes only for lookup. The browser never receives the client secret and never validates an ID token. It receives a short-lived, one-use exchange code after the backend callback, exchanges it for a Firebase custom token, and signs in through the existing Firebase/Sneat client path.

Use `issuer + subject` as the durable external identity key. On the first trusted login, resolve an existing Firebase user by verified email before creating one, persist the stable linkage globally, ensure the Sneat user exists, and provision only the ordinary `member` role in the owning space through the existing Contactus membership facade.

Activation is an authenticated owner/admin flow and is distinct from issuer discovery. It completes an authorization-code login with state, nonce, and PKCE, validates the token with the provider's discovery keys, validates the claimed domain, and only then atomically claims the domain index and marks the configuration active.

## User Journey

```text
/sso → email discovery
  ├─ active domain → OIDC → callback → one-time exchange → Firebase/DataTug
  └─ unknown domain → regular /login → /sso/setup
                                      → create/select Sneat space
                                      → /spaces/:spaceID/settings/sso
                                      → Test & Activate → OIDC → active

acme.datatug.app/sso → host index fixes domain to acme.com
                      → employee enters only an @acme.com address
                      → same OIDC and Firebase/Sneat flow
```

The normal DataTug login also links to `/sso`, so the dedicated entry is discoverable without involving DataTug.io.

## Architecture and Identity Model

```text
OIDC issuer + subject
        ↓ stable external link
Firebase Auth UID
        ↓ canonical user record
Sneat user
        ↓ canonical roles/membership
Sneat space
```

The shared `@sneat/auth-ui` library owns screens and Firebase custom-token consumption. The shared Sneat Core SSO module owns OIDC discovery/validation, flows, configuration, domain and tenant-host routing, stable identity links, and one-time exchanges. Each application registers the shared routes ahead of its catch-all route. The Sneat Go composition root supplies narrow adapters for Firebase Admin, current space role authority, and Contactus membership; it contains no SSO business rules.

## Data Model

- `/spaces/{spaceID}/ext/sso`: OIDC configuration, status, domain list, optional `loginHosts`, issuer, client ID, encrypted client secret, provider/tenant metadata, and verification audit fields. It is the source of truth.
- `/sso-domains/{domain}`: active routing projection with `spaceID`, status, issuer, and configuration version. No discovery scans spaces.
- `/sso-hosts/{host}`: optional active tenant-host projection mapping a Sneat-owned host such as `acme.datatug.app` to its fixed email domain and owning space. It is version-checked against the source configuration.
- `/sso-identities/{sha256(issuer + NUL + subject)}`: global stable identity linkage to a Firebase/Sneat UID, with link-time email and associated space IDs.
- `/sso-flows/{sha256(state)}`: short-lived, single-use callback correlation containing flow kind, nonce, PKCE verifier, a hash of the initiating-tab binding, expected space/domain, and expiry.
- `/sso-exchanges/{sha256(code)}`: short-lived, single-use UID handoff, bound to the initiating browser tab, used to mint a Firebase custom token after the browser returns.

The schema uses domain/provider arrays or metadata-compatible records even though the MVP UI permits one primary domain and one provider.

## Security Assumptions

- Production self-service activation is Entra-first. The backend verifies the tenant and claimed domain against Microsoft Graph verified domains using the configured confidential client. This requires the Entra application to have tenant-admin consent for the documented Graph domain-read permission.
- Generic OIDC does not prove domain ownership. It is accepted only when the issuer/domain pair is explicitly allow-listed in server configuration; activation is rejected before discovery/network access when the pair is absent. This supports controlled partners and the local test provider without allowing arbitrary Keycloak instances to claim arbitrary domains or turn self-service configuration into an issuer-discovery SSRF primitive.
- Entra account-link email trust comes from the exact validated tenant issuer and `tid` plus Microsoft Graph's verified-domain evidence; it does not assume Entra will emit the generic OIDC `email_verified` claim. Other generic providers must emit `email_verified=true` in addition to being allow-listed.
- Client secrets are encrypted with AES-256-GCM using an HKDF purpose-derived key from the existing Secret Manager-provided Sneat platform root; ciphertext is bound to the space as associated data.
- Callback state is random and server-persisted, nonce is checked by the OIDC verifier, PKCE S256 is used, flows and exchanges expire and are consumed once, and return URLs are selected from server configuration rather than request-controlled redirects. The final exchange also requires a random value retained only in the initiating tab's `sessionStorage`, preventing a callback captured from another browser from creating a Firebase session.
- Domain activation reads and writes the domain index and configuration in one transaction. A domain already owned by another space fails closed.
- An optional tenant-host claim is written in that same transaction. MVP host claims are restricted to configured Sneat-owned suffixes, require HTTPS, and require the subdomain label to match the primary company-domain label (`acme.com` → `acme.datatug.app`). The API origin policy permits only subdomains of those explicitly configured Sneat-owned suffixes.
- Only current space owners/admins can read or change the configuration. SSO logins grant only the existing ordinary member role.

## MVP Scope

- Shared web routes `/sso`, `/sso/callback`, onboarding continuity, space selection/creation, and space SSO settings in `@sneat/auth-ui`; DataTug.app registers and proves the first vertical slice.
- Optional fixed-domain company hosts for Sneat-owned application suffixes, including `acme.datatug.app`, with the same route set reusable by sneat.work and sneat.team.
- One OIDC provider and one primary domain per space in the UI.
- Authorization code flow with discovery, backend token validation, PKCE, nonce, and state.
- Entra verified-domain self-service plus explicitly trusted generic issuers for local/approved use.
- Existing-user link by sufficiently trusted verified email, then stable issuer/subject lookup on later logins.
- Firebase custom-token browser sign-in and normal Sneat user/member provisioning.
- Automated Go tests and Playwright E2E with a deterministic local OIDC provider/test backend.

## Not Doing (and Why)

- SAML, SCIM, group-to-role mapping, IdP-initiated login, SLO, multiple IdPs, multi-domain UI, CLI/mobile-specific SSO, Conditional Access management, enterprise billing gates, and elaborate audit reporting: none is required to prove the authentication and membership vertical slice.
- DNS TXT verification: Entra verified-domain evidence is the production proof; trusted generic issuer/domain pairs are an explicit operational exception.
- Treating arbitrary generic OIDC email claims as domain ownership: an operator-controlled issuer can mint any email, so this would permit domain takeover.
- A parallel Company entity or SSO-specific user/member store: Sneat spaces, users, and roles remain authoritative.
- Arbitrary customer-owned vanity login domains: the MVP supports subdomains under explicitly Sneat-owned suffixes; DNS/certificate/routing automation for external domains is deferred.

## Key Assumptions to Validate

| Tier           | Assumption                                                                                             | How to validate                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Must-be-true   | A normal Firebase account and a trusted OIDC identity with the same verified email resolve to one UID. | E2E seeds Alice, activates SSO, signs in through OIDC, and asserts the original UID plus one stable external link.            |
| Must-be-true   | Domain claims cannot race across spaces.                                                               | Transaction test concurrently activates two configurations for one domain and accepts only one owner.                         |
| Must-be-true   | The Contactus member facade can idempotently provision an SSO user without elevated roles.             | Integration test runs provisioning twice and asserts one contact/membership containing only `member`.                         |
| Must-be-true   | A tenant host cannot select another company's email domain or bypass the API origin policy.            | Service and origin-policy tests cover fixed-domain mismatch, suffix lookalikes, HTTP/ports, and atomic duplicate host claims. |
| Should-be-true | Entra Graph verified domains are practical for self-service administrators.                            | Test against a staging tenant and refine setup guidance around admin consent.                                                 |

## Open Questions

- Whether a later enterprise tier should replace Graph permission setup with DNS verification for lower-friction provider-neutral activation.
- Whether one external identity should be permitted to join several spaces configured against the same issuer; the global link schema supports it, while MVP routing remains one domain to one space.

---

_This document follows the https://specscore.md/idea-specification_
