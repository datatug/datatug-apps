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
row to get there, because `EnvDbPageComponent`'s row-click handler
(`libs/datatug/main/src/lib/pages/signed-in/env-db/env-db-page.component.ts`)
builds a URL without the leading `store` segment and never matches
`datatugRoutes`. Phase 1 plan task 2 ("make the `EnvDbPageComponent` route
resolve") owns that fix. Swap the `page.goto` for a real click on task 2's
completion.

## CI status (2026-09-09): J1 currently fails, before the harness mechanics are exercised

The first CI run of the `journey-e2e` workflow job (datatug-apps PR #48,
[run 34336771160](https://github.com/datatug/datatug-apps/actions/runs/34336771160))
went red on J1's very first assertion — not the harness (checkout, CLI
build, agent boot all succeeded), and not yet the known route gap above:

```
Error: expect(locator).toBeVisible() failed
Locator: getByText('DataTug Demo Project 1')
Timeout: 15000ms
    at apps/datatug-app/e2e/journey/journey.spec.ts:38:7
```

The accessibility snapshot at failure time shows only:

```yaml
- navigation "menu": DataTug.app
- paragraph: Running in emulator mode. Do not use with production credentials.
```

i.e. the app shell rendered, but nothing project-specific did. The agent log
(`agent-worker-0.log`) shows it received exactly one request beyond `/ping`:

```
2026/09/09 09:51:50 GET 0 /datatug/projects/project_summary?id=datatug-demo-project
```

...and nothing after that — no further request, no panic (contrast with
`GET /datatug/exec/select`, whose backend, `pkg/api.ExecuteCommands`, is a
literal `panic("not implemented yet")` on `datatug-cli@main` as of this
writing — J1 doesn't get far enough to hit that yet). This wasn't
root-caused further: it's out of this stream's write scope (`.github/workflows/**`
and this README only), and per this stream's brief, another lane owns
`journey.spec.ts` and the app pages it drives. Worth checking first:
whether `/store/:storeId/project/:projectId` is guarded by an auth check
that a direct `page.goto` (no sign-in step) can't satisfy — the emulator
banner is a Firebase Auth Emulator artifact, and no other e2e spec in this
repo navigates straight to a `signed-in/**` route without one.
