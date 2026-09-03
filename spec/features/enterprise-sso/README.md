---
format: https://specscore.md/feature-specification
status: Approved
---

# Feature: Enterprise SSO

**Status:** Approved
**Date:** 2026-09-03
**Owner:** DataTug team
**Source Ideas:** enterprise-sso
**Supersedes:** —

## Summary

Sneat's shared auth surface provides email-first OIDC and SAML enterprise sign-in and a self-service unknown-domain onboarding path. DataTug.app is the first application registering the shared `/sso` routes; the same backend and `@sneat/auth-ui` components are reusable by sneat.work, sneat.team, and other Sneat sites. Enterprise identities are linked to canonical Firebase/Sneat users and ordinary Sneat space membership. Configuration belongs to the space SSO extension; global domain and optional tenant-host collections are routing indexes only.

## Behavior

### REQ: dedicated-sso-entry

DataTug.app MUST expose `/sso` with a work-email input and **Continue with SSO** action. The regular `/login` surface MUST link to it as **Sign in with company SSO**.

### REQ: shared-sso-surface

OIDC and SAML protocol handling, persistence, identity linking, and trust behavior MUST live in the shared Sneat Core SSO module. Angular SSO routes/pages and the API client MUST live in the shared Sneat auth UI library. Product applications MAY register those routes but MUST NOT fork their own SSO identity model.

### REQ: indexed-domain-discovery

The backend MUST canonicalize a valid work email to its lower-case domain and resolve that domain by direct lookup of `/sso-domains/{domain}`. Only an `active` index whose source configuration is also active may begin login. It MUST NOT scan spaces.

### REQ: fixed-domain-tenant-host

An owner/admin MAY configure one company login host such as `acme.datatug.app` for primary domain `acme.com`. The active `/sso-hosts/{host}` index MUST fix `/sso` to that email domain, refuse emails from other domains, and be version-checked against the source space extension. Domain and host claims MUST activate atomically. The MVP MUST accept only HTTPS subdomains of configured Sneat-owned suffixes whose company label matches the primary domain; arbitrary customer-owned hosts are out of scope.

### REQ: unknown-domain-continuity

An unknown/inactive domain MUST show that SSO is not configured and offer normal registration/login. The chosen domain MUST survive login and lead to authenticated space creation/selection and then that space's SSO settings.

### REQ: space-sso-configuration

An owner/admin MUST be able to choose OIDC or SAML and save one primary domain plus the protocol-specific provider configuration at `/spaces/{spaceID}/ext/sso`. Saving MUST leave the configuration non-active. The browser MUST never read stored secret plaintext or ciphertext; a read response reports only whether a secret is present.

### REQ: guided-setup

The shared settings UI MUST expose a provider-aware wizard for provider choice, domain proof, application/redirect details, provider configuration, real login testing, and active status. It MUST expose the settings page in normal company-space navigation and include lifecycle actions for disable, re-test/reactivate, secret rotation, and deletion.

### REQ: dns-domain-proof

An owner/admin MUST be able to request a random DNS TXT challenge and verify it through the backend. The challenge MUST use an application-specific record name and value, be bound to the space and domain, and be regenerated when the domain changes. Successful verification MUST be persisted on the source configuration. DNS proof MUST allow provider-neutral OIDC and SAML activation without trusting an arbitrary provider's email claim as proof of domain ownership.

### REQ: authorisation

Configuration reads, saves, and activation starts MUST require Firebase authentication and a current `owner` or `admin` role in the target Sneat space. Ordinary members and non-members MUST receive a forbidden response.

### REQ: secure-oidc-flow

Login and activation MUST use backend OIDC discovery and the authorization-code flow with random state, random nonce, PKCE S256, strict configured callback/app URLs, signature validation, exact issuer validation, client-ID audience validation, expiry validation, nonce validation, one-use flow state, initiating-browser correlation, and a ten-minute-or-shorter flow lifetime. Production backend discovery, token, redirect, and JWKS traffic MUST reject loopback, private, link-local, and reserved network destinations; an HTTP/private-network exception exists only in explicitly enabled loopback test mode.

### REQ: secure-saml-flow

SAML MUST initially support service-provider-initiated Web SSO only. The backend MUST generate signed AuthnRequests, expose SP metadata, accept assertions only at the exact ACS URL, and validate the configured IdP signature/certificate, response destination, audience, recipient, `InResponseTo`, assertion time bounds, permitted signature algorithms, and one-use request/response identifiers. IdP-initiated login and SLO MUST remain disabled. A persistent/non-transient NameID, or an immutable subject attribute when the IdP supplies only a transient NameID, plus IdP entity ID MUST be the stable external identity.

### REQ: proven-activation

**Test & Activate SSO** MUST perform a real provider login. Discovery success alone MUST NOT activate. After token validation, the authenticated email MUST match the configured domain and the provider/domain trust policy MUST pass. The backend MUST atomically mark the config active and claim `/sso-domains/{domain}`; an active claim by another space MUST fail.

### REQ: provider-domain-trust

Production self-service MUST support Microsoft Entra tenant issuers and verify the domain using Microsoft's verified tenant-domain data. A matching validated Entra tenant `tid`, exact issuer, and Graph-verified domain form trusted email evidence even when Entra omits generic `email_verified`. A successfully verified DNS challenge MUST be accepted as provider-neutral domain authority for generic OIDC and SAML. Without DNS proof, generic OIDC MUST be disabled unless the server explicitly trusts that issuer/domain pair, and untrusted pairs MUST be rejected before issuer discovery. An arbitrary issuer's `email` or `email_verified` claim alone MUST NOT authorize activation or first-link email matching.

### REQ: stable-account-linking

After validated login, the backend MUST resolve `/sso-identities/{hash(protocol,issuer,subject)}` first. When absent, it may resolve an existing Firebase user by the trusted verified email; otherwise it creates one. It MUST persist the protocol/issuer/subject linkage and MUST NOT use email as the permanent external identifier.

### REQ: lifecycle-and-audit

Only owners/admins MAY disable, reconfigure, re-test, or delete SSO. Disable, material edits, and deletion MUST atomically remove routes owned by that space; reactivation MUST always perform a new provider login. Security-relevant configuration, domain-proof, activation, disable, delete, and successful-login events MUST attempt to append sanitized audit records without tokens, assertions, secrets, raw subjects, or email addresses. Audit-sink failure MUST be observable but MUST NOT make company authentication unavailable.

### REQ: abuse-controls

Public discovery, login-start, callback/ACS, and exchange endpoints MUST be rate-limited with endpoint-specific limits and return HTTP 429 with `Retry-After`. Rate-limit keys and logs MUST not contain raw email addresses or tokens. Flow and exchange documents MUST carry TTL timestamps and deployment configuration MUST enable Firestore TTL cleanup.

### REQ: canonical-sneat-identity

The resolved Firebase UID MUST have a normal Sneat user record and an idempotent membership in the configuration's owning space. SSO provisioning MUST grant only the existing default `member` role, never owner/admin/contributor. Existing membership MUST not be duplicated or downgraded.

### REQ: browser-session-handoff

The backend callback MUST redirect to the exact server-allowlisted application base URL that started the flow with an opaque, short-lived, one-use exchange code. Exchanging it MUST also require a random binding retained only by the initiating browser tab, then return a Firebase custom token for the resolved UID; the browser MUST call the existing Firebase custom-token sign-in path and enter the requesting Sneat application normally.

### REQ: secret-protection

The OIDC client secret MUST be encrypted at rest with authenticated encryption under a purpose-derived key rooted in the existing deployment secret outside Firestore. It MUST never be returned to the browser or included in logs. Access/ID tokens, flow secrets, and sensitive claims MUST not be logged.

## Acceptance Criteria

### AC: unknown-domain-onboards (verifies REQ:dedicated-sso-entry, REQ:unknown-domain-continuity)

**Given** an unauthenticated visitor enters `alex@newcompany.test` at `/sso`
**When** no active domain index exists
**Then** the app offers normal sign-up, preserves `newcompany.test`, and after login leads through create/select space to that space's SSO settings.

### AC: config-requires-admin (verifies REQ:space-sso-configuration, REQ:authorisation)

**Given** an ordinary member and an owner of the same space
**When** each attempts to save SSO settings
**Then** the member is refused and the owner can save a `configured`, non-active record whose response never contains a secret.

### AC: activation-proves-login (verifies REQ:secure-oidc-flow, REQ:proven-activation, REQ:provider-domain-trust)

**Given** a configured, trusted provider/domain pair
**When** the owner completes **Test & Activate SSO** through the provider
**Then** issuer, audience, signature, expiry, state, nonce, PKCE correlation, email/domain, and provider trust pass before the configuration and domain index become active.

### AC: invalid-oidc-is-refused (verifies REQ:secure-oidc-flow)

**Given** an activation or login flow
**When** state or nonce is wrong, the token is expired/invalid, the audience is wrong, or issuer differs
**Then** the callback fails without activating, linking an identity, provisioning membership, or issuing an exchange.

### AC: saml-converges-on-canonical-user (verifies REQ:secure-saml-flow, REQ:stable-account-linking)

**Given** Alice already has a Firebase/Sneat account and her domain has passed DNS proof
**When** an owner activates SP-initiated SAML and Alice completes a signed SAML login
**Then** strict assertion validation passes, the IdP entity/NameID link resolves the same Firebase UID, and no duplicate user or membership is created.

### AC: duplicate-domain-refused (verifies REQ:proven-activation)

**Given** one space owns an active domain
**When** a second space completes provider validation for the same domain
**Then** the second atomic claim fails and the first index remains unchanged.

### AC: company-host-fixes-domain (verifies REQ:fixed-domain-tenant-host)

**Given** Acme activates `acme.com` with `acme.datatug.app`
**When** an unauthenticated employee opens `https://acme.datatug.app/sso`
**Then** the page is fixed to `acme.com`, rejects a non-Acme email, routes a valid Acme email through the same provider, returns to the same allowlisted tenant origin, and no lookalike origin is accepted.

### AC: existing-account-is-linked (verifies REQ:stable-account-linking, REQ:canonical-sneat-identity, REQ:browser-session-handoff)

**Given** Firebase/Sneat user `uid-alice` already owns verified email `alice@acme.test`
**When** Alice signs in through the trusted OIDC issuer for the first time
**Then** the external identity links to `uid-alice`, no duplicate user is created, one ordinary membership is ensured, and the browser signs into Firebase as `uid-alice`.

### AC: subsequent-login-uses-subject (verifies REQ:stable-account-linking)

**Given** Alice's issuer/subject is linked to `uid-alice`
**When** the provider later returns a changed verified email for the same subject
**Then** the existing stable link resolves `uid-alice` without creating or email-linking another account.

### AC: secret-never-leaves-server (verifies REQ:secret-protection)

**Given** an owner saves and later reads SSO settings
**When** Firestore and HTTP responses are inspected
**Then** Firestore contains authenticated ciphertext rather than plaintext and the HTTP response contains only `hasClientSecret: true`.

## Not Doing / Out of Scope

SCIM, group/role mapping, IdP-initiated SAML login, SLO, multiple providers, multiple-domain UI, arbitrary customer-owned vanity hosts, CLI/mobile-specific SSO, Conditional Access administration, billing enforcement, and enterprise reporting are deferred.

## Deployment and local verification

Production SAML requires one global SP RSA key pair supplied through Secret Manager as `SNEAT_SSO_SAML_SP_PRIVATE_KEY_B64` and `SNEAT_SSO_SAML_SP_CERTIFICATE_B64`. Optional `SNEAT_SSO_SAML_SP_ENTITY_ID`, `SNEAT_SSO_SAML_SP_METADATA_URL`, and `SNEAT_SSO_SAML_SP_ACS_URL` overrides must remain exact allowlisted HTTPS URLs. OIDC client secrets continue to be stored as authenticated ciphertext derived from the platform encryption root.

The deterministic full browser proof is `pnpm e2e:sso`. The real-provider profile is `pnpm e2e:sso:keycloak`; it starts the pinned checked-in Keycloak realm in Docker and requires no manual provider configuration. Both exercise unknown-domain onboarding, DNS proof, OIDC and signed SAML activation/login, stable existing-account linking, and idempotent Sneat membership.

The application-level rate limiter is intentionally per-process. Production deployments should retain gateway/distributed throttling as defense in depth; Firestore TTL cleanup for flow and exchange documents is enabled by deployment automation.

Sneat-owned short tenant hosts are a first-come namespace. The fixed email-domain message limits ambiguity, but trademark/name dispute handling and arbitrary customer-owned vanity domains remain phase-4 operational work.

## Open Questions

- Whether production should require both DNS and Entra tenant proof for high-assurance customers rather than accepting either trust path.

---

_This document follows the https://specscore.md/feature-specification_
