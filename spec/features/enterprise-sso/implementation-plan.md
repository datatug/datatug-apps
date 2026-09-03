# Enterprise SSO implementation plan

## Repository findings and ownership

- `sneat-core-modules` owns the reusable OIDC application service, contracts, trust policy, secret protection, and DALgo persistence. It follows the existing `/spaces/{spaceID}/ext/{extensionID}` convention and does not depend on a particular product site.
- `sneat-libs` owns the reusable `@sneat/auth-ui` SSO routes, pages, and API client. It already owns normal Firebase login, custom-token sign-in, Sneat user state, and space creation services.
- `sneat-go` is wire/configure-only. It binds the shared module to Firebase Admin, current Sneat space role authority, canonical Sneat user creation, Contactus membership, Firestore/DALgo, the platform crypto root, and HTTP registration.
- `sneat-go-core` owns the shared API origin policy. It needs narrowly scoped HTTPS subdomain support so newly claimed Sneat-owned tenant hosts work without enumerating every company at process start.
- `datatug-apps` is the first consuming app. It registers shared literal SSO routes ahead of DataTug's catch-all route, owns the implementation documentation, and hosts the project-native Playwright proof.
- `datatug-gcloud` remains unchanged: product-neutral SSO does not belong in a DataTug-only backend.

## Screen flow

```text
/login ──company SSO──▶ /sso ──known──▶ provider ──callback──▶ requesting app
                         │
                         └─unknown──▶ normal /login ──preserved hash──▶ /sso/setup
                                         └─authenticated──▶ create/select Sneat space
                                                              └▶ /spaces/:id/settings/sso
                                                                   └─Test & Activate──▶ provider
                                                                                          └▶ active

acme.datatug.app/sso ──host lookup──▶ fixed acme.com email domain ──same provider flow──▶ same host
```

Every screen supports cold arrival from URL/query/hash context. Async actions disable their trigger and show inline loading, error, and success state.

## Backend implementation (`sneat-core-modules/auth/sso`)

1. Add `const4sso`, `dto4sso`, and `dbo4sso` for the extension and HTTP contracts.
2. Add `secret4sso` with AES-256-GCM, space-bound associated data, and HKDF purpose separation from the existing platform crypto root.
3. Add `oidc4sso` using `coreos/go-oidc/v3` and `oauth2` for discovery, authorization URL construction, code exchange, ID-token signature/issuer/audience/expiry validation, nonce, and PKCE S256. Add Microsoft Entra verified-domain evidence and an explicit trusted generic issuer/domain policy.
4. Add `facade4sso.Service` with injected store, OIDC/trust, clock/randomness, access, user, Sneat-user, and membership ports. Implement direct discovery, non-active save, pre-discovery provider trust gating, tested activation, stable identity linking, initiating-tab-bound one-time browser exchange, and tenant-host routing.
5. Add `dal4sso.Store` using the shared DALgo database. Atomically activate the source configuration with its domain and optional host claim; consume flow/exchange records transactionally.
6. Register the reusable extension endpoints:
   - `POST /v0/sso/discover`
   - `GET /v0/sso/config?spaceID=...`
   - `POST /v0/sso/config`
   - `POST /v0/sso/activation/start`
   - `POST /v0/sso/login/start`
   - `GET /v0/sso/callback`
   - `POST /v0/sso/session/exchange`
7. Add model, crypto, store, service, OIDC negative-path, account-linking, activation-race, tenant-host, and HTTP boundary tests. No migration is required because all records are additive.

## Shared frontend implementation (`sneat-libs/libs/auth/ui`)

1. Add typed SSO contracts and `SsoApiService`; discovery, login start, and one-time exchange are anonymous, while configuration and activation use the existing authenticated client.
2. Add signal/OnPush standalone pages:
   - `/sso`: email-first discovery, fixed-domain tenant-host probing, and unknown-domain handoff;
   - `/sso/setup`: guarded owner/admin space selection or company-space creation;
   - `/spaces/:spaceID/settings/sso`: guarded configuration, non-active save, optional company host, and real **Test & Activate SSO**;
   - `/sso/callback`: initiating-tab binding validation, one-time exchange, and existing Firebase custom-token sign-in with UID equality check.
3. Export `ssoRoutes` for applications that have catch-all routes and also include them in the shared auth route set.
4. Add **Sign in with company SSO** to the existing normal login page.
5. Add focused Vitest tests for email-domain parsing, anonymous/authenticated API calls, tenant-host behavior, route exposure, and login linkage.

## Host wiring (`sneat-go`, `sneat-go-core`)

1. Add `pkg/modules/sso` to compose the shared service from the existing DALgo database and `SNEAT_PLATFORM_CRYPTO_KEY` without moving business rules into the host.
2. Implement Firebase Admin adapters to resolve by verified email, create or race-resolve one verified-email Firebase user, and mint a custom token.
3. Call the existing auth facade to ensure the canonical Sneat user record and the existing Contactus self-join facade to create/resolve a deterministic contact and idempotently grant only `member`.
4. Enforce configuration with the current Space access authority for exact `owner`/`admin` roles and verify bearer tokens with the existing Firebase verifier.
5. Configure exact callback/default app URL, allowlisted requesting app URLs, Sneat-owned login-host suffixes, Entra trust, and optional operator-approved generic issuer/domain pairs from environment.
6. Extend `sneat-go-core/security` with explicit HTTPS subdomain suffixes. Reject HTTP, ports, suffix roots, malformed hosts, and lookalikes; register only the configured Sneat-owned suffixes.
7. Add host adapter/configuration and origin-policy tests, then wire the module into the existing composition root only when the platform root is available.

## DataTug integration (`datatug-apps`)

1. Register `ssoRoutes` before DataTug feature/catch-all routes in `apps/datatug-app/src/main.ts`.
2. Keep all reusable screens out of DataTug source; DataTug supplies only its normal app/Firebase/API providers.
3. Add the automated browser test and its deterministic local provider/backend setup to the existing Playwright target.

## Local provider and end-to-end proof

1. Add a checked-in deterministic OIDC provider used only by tests. It exposes discovery, authorization, token, and JWKS endpoints and signs short-lived ID tokens; the backend still uses the production OIDC library and validates state, nonce, PKCE, audience, issuer, signature, and expiry.
2. Run the browser app against Firebase Auth/Firestore emulators and the real shared SSO HTTP handler. Seed a normal Alice Firebase/Sneat user and an owner plus company space through test setup.
3. Playwright covers unknown-domain continuation, owner configuration, real redirect/login/callback activation, persisted active domain/host indexes, logout, known-domain discovery, a second real OIDC login, custom-token Firebase sign-in, same original Alice UID, one external identity, and one ordinary membership.

## Independently verifiable sequence

1. Shared models, validation, crypto, OIDC, and service tests pass.
2. DALgo transaction tests prove one-use records and atomic domain/host activation.
3. Shared auth UI unit tests, lint, and production library build pass.
4. Host adapters compile against local shared modules and focused tests pass.
5. Shared origin-policy tests prove tenant suffix boundaries.
6. DataTug unit tests, lint, and production build pass against the local shared UI worktree.
7. The focused Playwright SSO E2E passes, followed by each touched repository's WB hooks and full relevant test suites.

## Production-hardening and SAML increment

1. Extend the source configuration with provider preset, DNS challenge/proof, lifecycle timestamps, OIDC fields, and SAML IdP metadata while preserving the single-provider/single-domain shape.
2. Add DNS TXT verification behind an injected resolver. Preserve Entra verified-domain trust and the explicit generic allowlist as alternate evidence, but make DNS proof the provider-neutral self-service path.
3. Add atomic disable/delete operations that remove owned domain and login-host projections, invalidate active status, and append sanitized audit records. Material edits always require a new real-login activation.
4. Add bounded in-process endpoint rate limiting with hashed keys and standard `429`/`Retry-After` responses; retain edge/distributed rate limiting as deployment defense in depth.
5. Add a SAML protocol engine using an established XML-signature library, global SP signing material from Secret Manager, generated SP metadata, signed SP-initiated AuthnRequests, strict ACS validation, replay prevention, and persistent NameID linkage. Reuse the common Firebase/Sneat identity and membership completion path.
6. Replace the settings form with a provider-aware setup wizard and lifecycle/status panel. Add an Enterprise SSO entry to company-space navigation and provider presets for Entra, Okta, Keycloak, generic OIDC, and generic SAML.
7. Add local DNS, OIDC, and SAML protocol test doubles plus a pinned Keycloak Docker profile that executes the complete browser flow against a real OIDC provider. Keep cloud-tenant Entra/Okta certification as follow-up because repeatable interactive credentials and MFA policy do not belong in the normal local/CI suite.
8. Configure Firestore TTL for `sso-flows.expiresAt` and `sso-exchanges.expiresAt` in deployment automation.
9. Extend unit, integration, and browser tests for DNS proof, lifecycle route release, audit sanitization, rate limits, wizard/navigation, OIDC provider presets, SAML activation/login/account reuse, and tenant-host fixed-domain behavior.
