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
`playwright.config.ts`, `http://localhost:4200` — the literal hostname
matters, see that file's CORS comment) — the journey suite does not
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

### What CI provides: the `journey` job

`.github/workflows/ci.yml`'s `journey` job (needs: `build`) is what actually
runs this suite in CI. It:

1. Checks out this repo, plus `datatug/datatug-cli` at a **pinned release
   tag** (`env.DATATUG_CLI_REF` at the top of the job — currently
   `v0.20.6`) and `datatug/datatug-demo-projects` at `main`, both nested
   under the workspace (`actions/checkout`'s `path:` cannot escape the
   primary checkout).
2. Sets up Go from `datatug-cli/go.mod` and builds `datatug` from the CLI
   repo root (`go build -o "$RUNNER_TEMP/datatug-bin/datatug" .` —
   `CGO_ENABLED=0`; the root package is `main.go`, not
   `apps/datatugapp/`), then sets `DATATUG_BIN` to that path. This is a
   **build-from-source-at-a-pinned-tag** strategy, not a downloaded release
   binary: `datatug-cli` publishes release binaries too (GitHub Releases,
   plus a Homebrew cask named `datatug`), but pinning a source tag and
   building it keeps the Go toolchain step reproducible and version-pinned
   in one place (`DATATUG_CLI_REF`) without a separate binary-download step.
3. Fetches the Chinook SQLite fixture directly, keylessly, to
   `~/datatug/dbs/chinook-local.sqlite` — the exact path
   `environments/local/catalogs/chinook-local/chinook-local.db.json`
   declares in `datatug-demo-projects`. This is *not* `datatug demo`: that
   CLI command (`apps/datatugapp/commands/cmd_demo.go` in `datatug-cli`)
   does the same keyless download but then blocks forever serving the demo
   project (it hands off to `serve`), so it can't run as a CI step; the CI
   step replicates just its `downloadSQLiteSource` behavior (same URL) and
   stops there. `DATATUG_DEMO_DIR` is set to the checked-out
   `datatug-demo-projects/demo-project-1`, so the fixture never needs its
   own git clone.
4. Installs Playwright's `chromium` browser, builds `datatug-app`
   (production config — a fail-fast check; `playwright.config.ts`'s own
   `webServer` starts the *dev* server for the actual test run, so this
   is not a second server), then runs
   `playwright test -c apps/datatug-app/playwright.config.ts --project=journey --workers=1`.
5. On failure, uploads the Playwright HTML report (`journey-e2e-playwright-report`,
   from `coverage/apps/datatug-app-e2e/report` — traces are embedded in the
   report by Playwright's default HTML reporter behavior) and the agent's
   captured stdout+stderr (`journey-e2e-agent-logs`, from
   `coverage/apps/datatug-app-e2e/journey/*.log` — one file per worker; the
   only way to see why `datatug serve` refused to start or what it logged
   for a request).

Every setup step above (CLI build, fixture fetch) fails the job outright on
error — none of them use `continue-on-error`, because a broken build or a
missing fixture must not be reported as a passing (or silently skipped)
suite.

#### Bumping the pinned CLI tag

`DATATUG_CLI_REF` in the `journey` job is the only place the tag is pinned.
To bump it:

```sh
git ls-remote --tags https://github.com/datatug/datatug-cli.git \
  | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1
```

Update `DATATUG_CLI_REF` to that tag and re-run the `journey` job. There is
no other DataTug-CLI-version reference to keep in sync in this repo.

## Known gap this harness works around (not this stream's to fix)

RESOLVED 2026-09-10 (Task 17 item B.2, S121b): J1–J4 in `journey.spec.ts` now
walk real in-app navigation end to end — project page -> "Go to..." ->
Environments -> the environment -> Databases card -> the catalog -> a
Tabulator row click for the table (`goToCatalogTables()`/`catalogTableRow()`
helpers), and, for J3, the persistent "Queries" side-menu item -> folder ->
query title (`openSavedQuery()`) — instead of `page.goto()`-ing straight to a
table or query URL. This needed two datatug-cli endpoints B.2 depended on
(Task 17 items A.1/A.2, `GET /datatug/queries/all_queries` and
`GET /datatug/catalog-tables`) and datatug-apps wiring (item B.1,
`EnvDbPageComponent`/`EnvironmentPageComponent`/`EnvironmentsPageComponent`/
`QueriesTabComponent`). `page.goto(projectUrl)` remains each journey's single
entry point; only the table/query URL shortcuts were removed.

## Known blockers

`journey/README.md`'s own "Known blockers" section is the authoritative,
kept-current account, with `journey.spec.ts`'s file header behind it for
the per-test fix history. Read those two, not this file.

This file used to carry a second copy of that account — three
`datatug-cli`/`datatug-demo-projects` defects that blocked every journey
test. It went stale the moment those fixes landed and contradicted
`journey/README.md` for as long as it stood, which is why the status now
lives in exactly one place; please keep it that way rather than restoring
a copy here. As of 2026-09-09 nothing is blocked: J1–J4 and
`store-id-scheme.spec.ts` pass against the pinned `datatug-cli` tag in
CI's `journey` job.

## A hypothesis that does not hold: `signed-in/` is not an auth gate

Kept from the long blocker account this file used to carry, because it is
the one part of that account still true and still worth not
rediscovering. A journey failure here is
never explained by "the test navigates into a `signed-in/**` route
without signing in first". `datatugRoutes`' `store/:storeId/**` subtree
carries no `SNEAT_AUTH_GUARDS` (verified 2026-09-10 —
`datatug-routing.module.ts` spreads them onto `my`, `explore/:spaceId`
and `explore-vault` only, and `datatug-routing-store.ts` adds none),
`DatatugAppComponent`'s shell has no auth gate, and `ProjectService`
issues a plain unauthenticated `HttpClient` call. `signed-in/` is only
this app's directory-naming convention for pages under a store. Do not
gate the `store/:storeId/**` routes behind sign-in, and do not reach for
the emulator sign-in recipe, to "fix" a journey failure — neither
addresses any failure mode this suite has actually had.
