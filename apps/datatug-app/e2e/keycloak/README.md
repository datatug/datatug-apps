# Keycloak enterprise SSO E2E profile

This directory contains a self-contained, test-only Keycloak realm for the
DataTug/Sneat enterprise SSO browser test. It exercises a real OIDC discovery,
authorization-code, token, and JWKS implementation; the same Playwright test
then reconfigures the space for the deterministic signed SAML IdP so both
protocols converge on the same Firebase/Sneat user.

Run from the `datatug-apps` repository root:

```shell
pnpm e2e:sso:keycloak
```

The command starts Keycloak 26.7.3 in Docker, imports `realm-acme.json`, starts
the Firebase emulators, shared SSO HTTP host, and DataTug app, and tears the
processes down after the test. No host-machine Keycloak configuration is
required.

The realm is deliberately local-only:

- issuer: `http://127.0.0.1:8088/realms/acme`
- client ID: `datatug`
- client secret: `keycloak-client-secret`
- user: `alice@acme.test`
- password: `alice-firebase-password`

These credentials are fixtures, not deployment secrets. The realm disables
registration and direct-access grants. Production SSO clients must use HTTPS,
unique secrets from Secret Manager, and redirect URIs for their deployed
callback host.

For a faster deterministic run that does not require Docker:

```shell
pnpm e2e:sso
```

That test uses the checked-in cryptographic OIDC/SAML test providers while
still running the production protocol validation and Firebase/Firestore
emulators.
