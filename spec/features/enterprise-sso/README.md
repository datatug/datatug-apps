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

Sneat's shared auth surface provides email-first OIDC enterprise sign-in and a self-service unknown-domain onboarding path. DataTug.app is the first application registering the shared `/sso` routes; the same backend and `@sneat/auth-ui` components are reusable by sneat.work, sneat.team, and other Sneat sites. OIDC identities are linked to canonical Firebase/Sneat users and ordinary Sneat space membership. Configuration belongs to the space SSO extension; global domain and optional tenant-host collections are routing indexes only.

## Behavior

### REQ: dedicated-sso-entry

DataTug.app MUST expose `/sso` with a work-email input and **Continue with SSO** action. The regular `/login` surface MUST link to it as **Sign in with company SSO**.

### REQ: shared-sso-surface

OIDC protocol, persistence, identity linking, and trust behavior MUST live in the shared Sneat Core SSO module. Angular SSO routes/pages and the API client MUST live in the shared Sneat auth UI library. Product applications MAY register those routes but MUST NOT fork their own SSO identity model.

### REQ: indexed-domain-discovery

The backend MUST canonicalize a valid work email to its lower-case domain and resolve that domain by direct lookup of `/sso-domains/{domain}`. Only an `active` index whose source configuration is also active may begin login. It MUST NOT scan spaces.

### REQ: fixed-domain-tenant-host

An owner/admin MAY configure one company login host such as `acme.datatug.app` for primary domain `acme.com`. The active `/sso-hosts/{host}` index MUST fix `/sso` to that email domain, refuse emails from other domains, and be version-checked against the source space extension. Domain and host claims MUST activate atomically. The MVP MUST accept only HTTPS subdomains of configured Sneat-owned suffixes whose company label matches the primary domain; arbitrary customer-owned hosts are out of scope.

### REQ: unknown-domain-continuity

An unknown/inactive domain MUST show that SSO is not configured and offer normal registration/login. The chosen domain MUST survive login and lead to authenticated space creation/selection and then that space's SSO settings.

### REQ: space-sso-configuration

An owner/admin MUST be able to save one primary domain, OIDC issuer, client ID, and client secret at `/spaces/{spaceID}/ext/sso`. Saving MUST leave the configuration non-active (`configured`). The browser MUST never read stored secret plaintext or ciphertext; a read response reports only whether a secret is present.

### REQ: authorisation

Configuration reads, saves, and activation starts MUST require Firebase authentication and a current `owner` or `admin` role in the target Sneat space. Ordinary members and non-members MUST receive a forbidden response.

### REQ: secure-oidc-flow

Login and activation MUST use backend OIDC discovery and the authorization-code flow with random state, random nonce, PKCE S256, strict configured callback/app URLs, signature validation, exact issuer validation, client-ID audience validation, expiry validation, nonce validation, one-use flow state, initiating-browser correlation, and a ten-minute-or-shorter flow lifetime.

### REQ: proven-activation

**Test & Activate SSO** MUST perform a real provider login. Discovery success alone MUST NOT activate. After token validation, the authenticated email MUST match the configured domain and the provider/domain trust policy MUST pass. The backend MUST atomically mark the config active and claim `/sso-domains/{domain}`; an active claim by another space MUST fail.

### REQ: provider-domain-trust

Production self-service MUST support Microsoft Entra tenant issuers and verify the domain using Microsoft's verified tenant-domain data. A matching validated Entra tenant `tid`, exact issuer, and Graph-verified domain form trusted email evidence even when Entra omits generic `email_verified`. Generic OIDC MUST be disabled unless the server explicitly trusts that issuer/domain pair, and untrusted pairs MUST be rejected before issuer discovery. An arbitrary issuer's `email` or `email_verified` claim alone MUST NOT authorize activation or first-link email matching.

### REQ: stable-account-linking

After validated login, the backend MUST resolve `/sso-identities/{hash(issuer,subject)}` first. When absent, it may resolve an existing Firebase user by the trusted verified email; otherwise it creates one. It MUST persist the issuer/subject linkage and MUST NOT use email as the permanent external identifier.

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

SAML, SCIM, group/role mapping, IdP-initiated login, SLO, multiple providers, multiple-domain UI, arbitrary customer-owned vanity hosts, CLI/mobile-specific SSO, Conditional Access administration, billing enforcement, and enterprise reporting are deferred.

## Open Questions

- A provider-neutral DNS verification method may replace or complement Entra Graph verified-domain evidence after the MVP.

---

_This document follows the https://specscore.md/feature-specification_
