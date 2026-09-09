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

J1 navigates directly to the Album table's URL instead of clicking a table
row to get there. `EnvDbPageComponent`'s row-click handler was fixed by
stream S9b (2026-09-09 — see `env-db-page.component.spec.ts` /
`datatug-nav.service.spec.ts`), so a real click-through would work now; J1
still uses the direct URL to keep proving the grid-render/agent-contract
mechanism independent of that page's own navigation.

## Known blockers, not fixable in this repo (as of 2026-09-09)

Every journey test (J1, J2, J3) currently fails against a `datatug-cli` main
build. Causes, all outside `datatug-apps` except the first (already fixed
here):

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
   an allowed origin, `GET /datatug/projects/project_summary` (which the
   project page needs just to show its title, and which blocks J1 before it
   can confirm the project loaded, and therefore J2/J3 too since they
   navigate to the same project first) panics the server on every call,
   closing the connection before any response is written (the browser sees
   `HttpErrorResponse{status: 0, statusText: 'Unknown Error'}`, which is why
   the project title never renders and nothing else follows in the agent
   log — not a stalled/slow request). Reproduced 2026-09-09 against
   `datatug-cli` main (a30132d, `CGO_ENABLED=0 go build .`) +
   `datatug-demo-projects/demo-project-1`, both with a bare `curl` and by
   running this suite itself — same agent-log signature CI saw (`GET
   /datatug/ping` then exactly one `GET
   /datatug/projects/project_summary?id=datatug-demo-project`, then
   nothing):

   ```
   $ curl -i 'http://127.0.0.1:8971/datatug/projects/project_summary?id=datatug-demo-project'
   curl: (52) Empty reply from server
   ```

   Server side:

   ```
   2026/09/09 GET 0 /datatug/projects/project_summary?id=datatug-demo-project
   2026/09/09 http: panic serving 127.0.0.1:xxxxx: GetAuthTokenFromHttpRequest is nil
     .../sneat-go-core@v0.67.3/apicore/request_validation.go:121 (VerifyRequest)
     .../sneat-go-core@v0.67.3/apicore/api_http.go:39 (Execute)
     pkg/server/endpoints/project_endpoints.go:46 (getProjectSummary)
   ```

   Root cause: `pkg/server/http_server.go:81` wires every `handle(...)`-routed
   endpoint straight to `sneat-go-core/apicore.Execute`, whose `VerifyRequest`
   unconditionally panics when the package-level
   `apicore.GetAuthTokenFromHttpRequest` hook is unset
   (`request_validation.go:118-121`) — before it even reads
   `AuthRequired`/`AuthenticationRequired()`. `datatug serve` never assigns
   that hook anywhere in the repo (`grep -rn GetAuthTokenFromHttpRequest`
   outside `sneat-go-core` returns nothing): it authenticates the whole
   process once, up front, via `--as`/`--role`/`--group` into a fixed
   `secureread.Session` (`apps/datatugapp/commands/cmd_serve.go`
   `resolveServeSession`), not per-request bearer tokens, so the
   hosted-backend auth hook `apicore.Execute` expects was simply never
   appropriate here. Every other `handle(...)`-routed endpoint
   (`createProject`,
   `getProjectItem`/`saveProjectItem`/`createProjectItem`-based handlers —
   `getEntity`, `saveEntity`, the query/board equivalents) panics the same
   way; only the bespoke `exec/select` / `exec/run_query` /
   `execute_commands` handlers and the endpoints that bypass `handle()`
   entirely (e.g. `entities/all_entities`) are unaffected. Needs a
   `datatug-cli` fix — wire `apicore.GetAuthTokenFromHttpRequest` (e.g. to a
   no-auth-required passthrough for the local `serve` command) — before any
   journey test can pass.
3. **Not fixable here — even past #2, a second `datatug-cli` /
   `datatug-demo-projects` mismatch**: `GET /datatug/exec/select` (the
   request the Album table page needs) fails against this exact demo
   project:

   ```
   $ curl 'http://127.0.0.1:8971/datatug/exec/select?proj=datatug-demo-project&env=local&db=chinook-local&from=main.Album&limit=5'
   {"error":"load environment \"local\": failed to load *datatug.Environment[local] from project: open .../demo-project-1/environments/local/environment-summary.json: no such file or directory"}
   ```

   `pkg/datatug-core/storage/filestore/loader_internals.go:165` (via
   `environments_store.go`) only ever looks for a fixed
   `environment-summary.json` (`storage.EnvironmentSummaryFileName`,
   `file_names.go:79`) inside each `environments/<id>/` folder, but
   `datatug-demo-projects/demo-project-1/environments/local/` ships
   `local.env.json` instead — same mismatch in every other environment
   folder in that project (`prod.env.json`, `QA.env.json`, `UAT.env.json`,
   `dev.env.json`). Either the loader needs to also accept `<id>.env.json`,
   or the demo project's environment files need renaming/duplicating to
   `environment-summary.json` — a `datatug-cli` and/or
   `datatug-demo-projects` fix, not a `datatug-apps` one.

J2 additionally needs `GET /datatug/semantic/columns`, `GET
/datatug/semantic/related` and `POST /datatug/queries/applicable`, none of
which exist on `datatug-cli` main yet. See `journey.spec.ts`'s file header
and per-test comments for the exact assertion each currently fails at.

Blockers #2 and #3 are `datatug-cli`/`datatug-demo-projects`-side defects
with no workaround available from this repo (a server that panics before
writing a response can't be routed around from the client). A prior CI run
(https://github.com/datatug/datatug-apps/actions/runs/34337467977)
attributed J1's failure to the journey navigating straight into a
`signed-in/**`-named route with no sign-in step instead — that hypothesis
does not hold: `datatugRoutes`' `store/:storeId/**` subtree (see
`libs/datatug/main/src/lib/routes/datatug-routing*.ts`) carries no
`SNEAT_AUTH_GUARDS`, `DatatugAppComponent`'s shell has no auth gate, and
`ProjectService`/`ProjectPageComponent` make a plain unauthenticated
`HttpClient` call. "`signed-in/`" is only this app's directory-naming
convention for pages under a store, not an auth-guarded route tree. Do not
gate the `store/:storeId/**` routes behind sign-in or reach for the emulator
sign-in recipe to "fix" this — neither addresses the actual failure. J1's
assertions are correct as written; leave them unmodified until the CLI
fixes land, then re-run this suite with `DATATUG_CLI_DIR` (or a
`DATATUG_BIN` newer than a30132d fixing both) to confirm.
