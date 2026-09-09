# datatug-app e2e

Two kinds of e2e live here.

- `root-and-login.spec.ts`, `debug.spec.ts` (project `chromium`, the default) —
  fast smoke tests. They stub the agent at `localhost:8989`
  (`page.route(/https?:\/\/localhost:8989\/.*/, ...)`) so they can run
  without a CLI binary.
- `journey/` (project `journey`) — walks the real user journeys J1–J4 from
  Feature [`core-investigation-loop`](../../../../datatug/spec/features/core-investigation-loop/README.md)
  against a **real, running `datatug serve` agent**, with **no route
  interception**. This is what the hub calls out as the fix for "an e2e that
  intercepts the backend never proves the contract" — the stubbed specs above
  are staying, this suite is the thing that actually proves the web ↔ agent
  contract.

Both projects share the same Angular dev server (the `webServer` block in
`playwright.config.ts`, `http://127.0.0.1:4200`) — the journey suite does not
need its own dev server or any build-time/env-var wiring to "point" it at the
agent. The DataTug web app resolves which agent to talk to **at runtime**,
from the `:storeId` route segment (`/store/<storeId>/...`): `getStoreUrl()`
in `@sneat/api` turns a `host:port`-shaped storeId into `//host:port`, which
the browser resolves against the current page's protocol. So a journey test
can point at any agent instance simply by navigating to
`/store/127.0.0.1:<port>/...` — no source change, no env var baked into the
dev server build. (If a future change to that resolution ever breaks this,
the fallback is a one-line env var read in `environment.ts`'s
`agents` map — do not add it speculatively.)

## Running the journey suite

```sh
# whole file
pnpm exec playwright test -c apps/datatug-app/playwright.config.ts --project=journey

# via Nx (the existing "e2e" target, scoped to the journey project)
pnpm exec nx e2e datatug-app -- --project=journey
```

The suite needs a `datatug` binary and the demo project on disk. It resolves
them from environment variables, and **skips the whole project with a clear
reason** when they are not available — it never fails CI silently and never
fails CI hard just because the binary wasn't provisioned for that job.

| Variable | Meaning | Default |
|---|---|---|
| `DATATUG_BIN` | Path to a built `datatug` binary. | — |
| `DATATUG_CLI_DIR` | Path to a `datatug-cli` checkout; used to `go build` a binary on demand when `DATATUG_BIN` is not set. | — |
| `DATATUG_DEMO_DIR` | Path to `datatug-demo-projects/demo-project-1`. | `../datatug-demo-projects/demo-project-1` relative to this repo (tried at 1–3 directory levels up, to cover both a plain sibling checkout and a nested `.worktrees/<task>` checkout) |

If neither `DATATUG_BIN` nor `DATATUG_CLI_DIR` is set, or the demo project
can't be found, every journey test is skipped with a message naming exactly
what was tried (see `fixtures/agent-server.ts`, `resolveBinary()` /
`resolveDemoDir()`).

### What CI should provide

`datatug-cli` publishes release binaries (GitHub Releases) and a Homebrew
cask named `datatug`. CI for this repo should install one of those and set
`DATATUG_BIN` to its path — that avoids a `go build` step (and a Go
toolchain dependency) in a Node/Playwright job. `DATATUG_CLI_DIR` is the
local-dev / "build from source" fallback.

The agent's own stdout+stderr is captured to
`coverage/apps/datatug-app-e2e/journey/agent-worker-<n>.log` (one file per
Playwright worker) — publish that path as a CI artifact when the suite is
run in CI; it is the only way to see why `datatug serve` refused to start or
what it logged for a request.

## Known gap this harness works around (not this stream's to fix)

J1 navigates directly to the Album table's URL instead of clicking a table
row to get there. `EnvDbPageComponent`'s row-click handler was fixed by
stream S9b (2026-09-09 — see `env-db-page.component.spec.ts` /
`datatug-nav.service.spec.ts`), so a real click-through would work now; J1
still uses the direct URL to keep proving the grid-render/agent-contract
mechanism independent of that page's own navigation.

## Known blockers, not fixable in this repo (as of 2026-09-09)

Every journey test (J1, J2, J3) currently fails against a `datatug-cli` main
build. Two separate causes, both outside `datatug-apps`:

1. **Fixed here**: this suite's dev server and agent both used to bind
   `127.0.0.1`, but `datatug-cli`'s CORS origin check
   (`github.com/sneat-co/sneat-go-core/security.VerifyOrigin`, vendored via
   `apicore.Execute`) allow-lists the literal hostname `localhost`, not
   `127.0.0.1` — every real request from the page was blocked by the
   browser's own CORS enforcement. Fixed by serving the dev server (and
   therefore the page origin) from `http://localhost:4200` instead — see
   `../../playwright.config.ts`'s `use.baseURL` / `webServer` comment for the
   `curl` repro.
2. **Not fixable here — a `datatug-cli`/`sneat-go-core` defect**: even from
   an allowed origin, any request that reaches
   `apicore.Execute`/`VerifyRequest` (e.g. `GET
   /datatug/projects/project_summary`, which the project page needs just to
   show its title) panics server-side with `GetAuthTokenFromHttpRequest is
   nil` and the connection closes with no response. Reproduced directly:
   `curl -H "Origin: http://localhost:4200"
   ".../datatug/projects/project_summary?id=<id>"` → `Empty reply from
   server`; the agent's own log shows `http: panic serving ...:
   GetAuthTokenFromHttpRequest is nil` at
   `sneat-go-core@v0.67.3/apicore/request_validation.go:121`.
   `apicore.GetAuthTokenFromHttpRequest` is a package-level function var
   every consumer must set at startup
   (`sneat-go-core/apicore/request_validation.go:105`) — `datatug-cli` never
   does (`grep -rn GetAuthTokenFromHttpRequest` in that repo finds nothing),
   so this panics unconditionally for every client on every endpoint routed
   through `handle()`/`apicore.Execute` (`/datatug/exec/select` and
   `/datatug/exec/run_query` bypass it — they call their `api.*` functions
   directly — but `/datatug/projects/project_summary` and most other routes
   in `pkg/server/endpoints/routes.go` do not). This blocks J1 before it can
   confirm the project loaded, and therefore J2/J3 too (they navigate to the
   same project first). Needs a `datatug-cli` fix — wire
   `apicore.GetAuthTokenFromHttpRequest` (e.g. to a no-auth-required
   passthrough for the local `serve` command) — before any journey test can
   pass.

J2 additionally needs `GET /datatug/semantic/columns`, `GET
/datatug/semantic/related` and `POST /datatug/queries/applicable`, none of
which exist on `datatug-cli` main yet. See `journey.spec.ts`'s file header
and per-test comments for the exact assertion each currently fails at.
