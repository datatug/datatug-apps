# datatug-app e2e

## Lane matrix: which lanes run when, and which touch live hosts

CI is `.github/workflows/ci.yml`. A lane that needs a live third-party host never runs on pull requests, merge groups
or pushes (the live PostgreSQL test has its own workflow, `e2e-postgres-ovdb.yml`). Rule of the repo: no live request from a per-PR path (on 2026-10-16 about 25,500 CI requests for one
`chinook.demodb.dev` file got the whole demodb.dev zone rate limited with HTTP 429).

| Lane (job) | pull_request / merge_group / push | In `deploy-gate` | Live hosts |
| --- | --- | --- | --- |
| `build`, `test` | yes | yes | none |
| `e2e-checkout` | yes, `nx affected` | yes | none |
| `e2e-cloud-logs` | yes | yes | none |
| `e2e-app`, `e2e-query-mobile` | yes, `nx affected` | yes | none: the app's own chinook.sqlite download is served from local fixtures; GitHub from the pinned checkouts |
| `e2e-demo-sqlite` (3 browsers) | yes, `nx affected` | yes | none: pinned files from local fixtures |
| `e2e-demo-handoff` | yes, `nx affected` | yes | none (local build, third parties stubbed) |
| `journey e2e (real datatug-cli agent)` | yes, always | yes | none to demodb.dev; the browser sends GitHub nothing (CI steps download the CLI release and the Chinook file) |
| `agent-links` | only when `DATATUG_LINKS_CLI_REF` is set | yes (may be `skipped`) | none |
| `demo-sqlite-adventureworks.yml` (own workflow, Chromium: only when demo SQLite code, catalog, guard or fixtures changed, on `pull_request` and push to `main`; or manual; never scheduled) | path-filtered | no | none: gzip parts from the `demo-db/adventureworks` GitHub repo |
| `e2e-postgres-ovdb.yml` (own workflow: manual or path-filtered push to main, never a PR) | no | no | `cloud.openvaultdb.com` |
| `demodb-live-smoke.yml` (manual `workflow_dispatch`) | no | no | `*.demodb.dev`, Chromium only |
| `github-live-smoke.yml` (push to `main` or manual; never a PR, never scheduled) | no | no | `api.github.com` (budget 50/run), `raw.githubusercontent.com`; every other lane answers GitHub from the pins ("GitHub checkouts") |

`deploy-gate` requires exact `success` for its lanes (only `agent-links` may be `skipped`), so a lane that is
`skipped` because `nx affected` found nothing still reports `success` (the job runs, its step is a no-op). A job that is
skipped by an `if:` does not gate anything even if it is a required check; that is why the live-host lanes are kept
out of `needs`.

### Keeping every lane off DemoDB and the public OpenVaultDB API: five layers

All lanes that run on a pull request, merge group or push (above, plus the manual dispatch of `agent-links`) are covered by:

1. **The guard** (`helpers/demodb-guard.ts`). Specs and fixtures import `test` from it; it wraps the worker's `browser`, so
   every context (`newContext`, `newPage`, the `context` fixture, contexts a spec creates by hand) gets a route for
   `demodb.dev` and every sub-domain. It answers from fixtures, refuses what has none, and counts every request. A request
   that still reaches the network (a response from a real server address, or a failed name lookup / connection) is counted
   as *escaped* and fails the test; one that a spec's own route fulfils from bundled bytes does not leave the machine and is not.
   `chat-phase4.spec.ts` is a deliberate exception (Chromium aborts its `/favicon.ico` navigation while a route is
   installed), and the real-agent lanes (`journey`, `session-continuity`, `agent-links`) use the guard *passively*: they count
   requests and detect escapes on every context but install no route, because interception of every request slowed those
   long flows into their test timeouts on CI runners; for them layers 2 and 3 do the blocking and layer 4 the proof.
2. **Chromium resolves every `*.demodb.dev` name to nothing** (`helpers/demodb-config.ts`, `--host-resolver-rules`; not in
   live mode).
3. **CI maps the DemoDB names to `0.0.0.0` in `/etc/hosts`** (`.github/actions/block-demodb`, host list from the catalog,
   `scripts/demodb-hosts.mjs`) and proves it with a failing `curl`. That covers Firefox, WebKit, Node's `request`, and
   the `datatug` CLI processes. Fixtures are answered by the route before any name lookup, so the block does not break them.
4. **The dev server's public OVDB proxy** (`tools/public-ovdb-proxy.cjs`) forwards the app's calls to `https://ovdb.demodb.dev` and
   `https://cloud.openvaultdb.com` from Node, where layers 1-3 cannot see them. Lanes that start the dev server give it
   `DATATUG_PUBLIC_OVDB_UPSTREAM=refuse` (`demodbServerEnv`): it answers 403 + `x-datatug-ovdb-refused` and the guard counts the
   refusal as an escape. `demodb-guard-selftest.spec.ts` holds a negative control for it. A dev server that is already running
   (`reuseExistingServer` outside CI) keeps its own environment: stop it before a local `nx e2e`. The block action and the
   Chromium rule also cover `openvaultdb.com`, `www.` and `cloud.`; the live PostgreSQL workflow uses neither.
5. **The report.** Every Playwright run prints a `DemoDB request report` (per host: asked, fixture, memory, LIVE, refused,
   ESCAPED), appends it to `$GITHUB_STEP_SUMMARY` (Nx truncates long job logs; the summary does not), writes `coverage/demodb-request-report-<job>-<pid>.md` (one file per Playwright run) and prints all of them in a late CI step, and fails the run when
   anything escaped or a live budget was exceeded. The `journey`, `session-continuity`, `agent-links`, `checkout`, `hand-off`
   and `cloud-logs` configs report too.

### GitHub checkouts: real repositories, pinned, served locally

No lane but one talks to GitHub. `e2e/github-pins.json` is the one list of `owner/repo@sha` the suites read (the demo
project at three commits, `datatug/datatug-meta-iso`, the `demo-db/northwind` publications the app admits), each with the
branch names it answers (`HEAD`, `main`). It is the source of the pins for CI too: no workflow names a SHA of its own
(`helpers/github-pins.unit.ts` fails the build if one does, or if the product reads a pinned repository at a commit the
manifest lacks).

1. **Fetch.** Every lane's globalSetup (`helpers/github-pins-setup.ts`) runs `scripts/fetch-github-pins.mjs`: for each
   pin missing from `tmp/github-checkouts/<owner>/<repo>/<sha>`, `git init` + `git fetch --depth 1 origin <sha>` +
   `git checkout`, in parallel; a present, clean checkout at the right commit is reused with no network. CI caches the
   directory with `actions/cache`, keyed on the manifest, so a warm run fetches nothing. Lazy blobs
   (`--filter=blob:none`) are not used: the fake serves whole trees, so the checkout fetched every blob anyway in a
   second round trip.
2. **Serve.** The guard installs `helpers/fake-github.ts` on every browser context as the fallback route for
   `api.github.com`, `raw.githubusercontent.com` and `cdn.jsdelivr.net`. It answers from the git objects of the exact
   commit (`git ls-tree`, `git cat-file`), in GitHub's shapes: `repos/{o}/{r}`, `commits/{ref}` (the bare SHA for
   `application/vnd.github.sha`, JSON otherwise), `git/trees/{commit|tree}` (recursive or not, with modes, SHAs and
   sizes), `contents/{path}`, raw files (binaries stay binary) and the jsDelivr `/gh/` mirror, with
   `cache-control: max-age=300`, an `etag` (304 on `If-None-Match`) and CORS. (Playwright turns the browser HTTP cache
   off on a routed context, so the headers reach the app's own logic but not Chromium's disk cache.)
3. **Strict.** A repository that is not pinned, a branch name no pin maps, a commit no pin has, a write, or an endpoint
   the fake does not implement is answered 404 with `x-datatug-github-fake: unpinned` and FAILS the test, naming the
   URL. A file missing at a pinned commit is an ordinary 404. Several pins of one repository: all answer their SHA; only
   the lane's selected one (`DATATUG_E2E_GITHUB_PINS=<id>`, default the first) answers its branch names.
4. **Guard.** The GitHub hosts are counted in the request report beside DemoDB; any GitHub request that reaches the
   network (a real server address, or a failed name lookup: Chromium resolves the three names to nothing,
   `helpers/demodb-config.ts`) is ESCAPED and fails the test and the run. The real-agent lanes stay passive (no route at
   all: a route makes Chromium intercept every request, which pushes those long flows past their timeouts); a GitHub
   request there still escapes and fails.
5. **Live.** `GITHUB_E2E_MODE=live` sends GitHub requests to the real hosts: `api.github.com` under a budget
   (`GITHUB_E2E_MAX_LIVE_REQUESTS` per test, 30; `GITHUB_E2E_MAX_RUN_LIVE_REQUESTS` per run, 50, under the anonymous 60
   an hour), each URL once per run, and a 403 with `x-ratelimit-remaining: 0` stops the run. Only
   `.github/workflows/github-live-smoke.yml` uses it (push to `main` or by hand, never a PR, never a schedule): it checks
   every pin against the real GitHub (commit, tree, one raw file byte for byte) and walks the G-A2 request-budget and
   side-menu tests of `github-store.spec.ts` at the demo project's live `main`. The production read configs
   (`playwright.showcase-measurement.config.ts`, `playwright.business-preview.config.ts`) default to live too.

To serve your own variant of a repository (a scratch clone with an extra commit), call `installFakeGithub(context,
[{ fullName, dir }])` in the spec: it answers that repository at the clone's `HEAD` ahead of the pins and passes
everything else to the guard. Bump a pin by editing the manifest (CI's cache key changes with it) together with the
specs that read it.

### DemoDB fixtures

`helpers/demodb-guard.ts` answers every `*.demodb.dev` request locally. The 5 pinned SQLite files and the comparison
candidate come from `tmp/demodb-fixtures` (`DEMODB_FIXTURE_DIR`), filled by Playwright's globalSetup running
`node scripts/fetch-demodb-fixtures.mjs`: they are taken from the public `demo-db/<dataset>` GitHub repositories at a pinned
commit and accepted only when size and SHA-256 equal the pin. A valid file is never requested again, so a warm cache makes
0 requests and a cold one 1 per file, none of them to demodb.dev. The script writes `.complete` only when every file is
valid, and CI saves its cache only then. `corpus.json` and the six dataset home pages are committed in
`e2e/fixtures/demodb/` (built from `demo-db/websites`, provenance and SHA-256 in `provenance.json`; refresh them by building
the websites repo and copying the outputs). The `journey` lane downloads nothing (`--project=journey` skips the fixtures).

* **Not served, refused:** the OVDB API on `ovdb.demodb.dev`; and, unless the run asked for them, the chunked AdventureWorks
  download (`*.parts.json` manifest and gzip parts). Only the AdventureWorks lane asks: `DEMODB_FIXTURE_ADVENTUREWORKS=only` (set by
  `playwright.demo-sqlite-adventureworks.config.ts`; `=1` adds it to the default set) makes `fetch-demodb-fixtures.mjs` download the two
  provider gzip parts (`artifacts/adventureworks.sqlite.gz.part-000N` of `demo-db/adventureworks` at a pinned commit, 35.4 MB, 2 requests
  to raw.githubusercontent.com), check every part and the joined gzip against `corpus.json`, gunzip the result and check the unpacked file
  against the catalog pin (126,820,352 bytes, SHA-256), and write a `demodb-chunked-export/v1` manifest named like the live one
  (`adventureworks.sqlite.gz.<sha256[:16]>.part-<n>`, as `demo-db/websites` `scripts/build-hosts.mjs` does). The guard serves both.
* **AdventureWorks journey** (`demo-sqlite-adventureworks.spec.ts`, Chromium only, workflow `demo-sqlite-adventureworks.yml`):
  fixture integrity -> confirmation before the large download -> download (manifest + each part once) -> stored OPFS file hashed in the
  page -> table list = registry -> read a table -> edit (capability gated) -> reload keeps it -> Reset Database (confirmation, downloads
  again: single-copy) -> original value back, also after a reload. It is heavy (126.8 MB unpacked, downloaded twice), so it runs on its
  own and only for changes that can affect it (see the path filter in the workflow) and by hand; never on a schedule. The evidence of a
  run (timings, bytes, row counts, requests, screenshots, trace) is attached to the test and uploaded as the artifact
  `demo-sqlite-adventureworks-e2e-report`. Run it locally with `GH_TOKEN=... pnpm nx run datatug-app:e2e-demo-sqlite-adventureworks`
  (the build needs a token for the private Core artifact check). The older opt-in journeys behind `DATATUG_E2E_ADVENTUREWORKS=1`
  (`demo-sqlite.spec.ts`, `demo-sqlite-datasets.spec.ts`) remain for a manual run in live mode.
* **Newly live-only checks** (the 28 skipped demo-sqlite tests in CI are WebKit/OPFS, the opt-in AdventureWorks journeys, and
  these 21 that probe the live site rather than the app): "every complete-database download DemoDB advertises answers"
  for each of the 6 datasets and the AdventureWorks manifest check, in 3 browsers. They run in the manual smoke only.
* `DEMODB_E2E_MODE=live` (only the manual `DemoDB live smoke` workflow): real hosts, each URL at most once per run
  (repeats come from a file memo shared by all workers), at most `DEMODB_E2E_MAX_LIVE_REQUESTS` (15) per test and
  `DEMODB_E2E_MAX_RUN_LIVE_REQUESTS` (120) per run. The budgets are enforced before a request is sent (a 503 retry by the
  app spends budget), Playwright retries 0, `maxFailures` 1.
* A rate-limit answer (HTTP 429, or a Cloudflare block page: 403/503/52x with `cf-mitigated`, or an error 1015/1020/1027
  page) trips a breaker kept in a file, so every worker of the run, also one started after a failure, refuses every
  further request. `e2e-postgres-ovdb.yml` (nx target `e2e-demo-postgresql`) has retries 0, `maxFailures` 1 and a per-test budget of 40 requests to
  `cloud.openvaultdb.com` (`DEMODB_E2E_MAX_OVDB_REQUESTS`), refused once spent. `helpers/demodb-guard-state.unit.ts` and
  `helpers/demodb-guard-logic.unit.ts` test the state and the request logic (run in the `test` job together with
  `scripts/mutate-demodb-guard.mjs`, which breaks the budget, count-before-send, breaker and 52x rules one at a time and
  requires the tests to fail).
* `scripts/check-demo-sqlite-catalog.mjs --online` and `check-demo-postgresql-catalog.mjs --online` are manual only and are
  in no CI path.

## Subscription checkout

`checkout-journey.spec.ts` runs the real Sneat sign-in/sign-up components against
Firebase Auth and Firestore emulators. Payment and reconciliation HTTP are
simulated. The required affected-app CI job runs this suite on desktop Chromium
and iPhone-profile WebKit. Java 21 is required by the Firestore emulator only.

```sh
pnpm nx run datatug-app:e2e-checkout
```

The 38 cases cover five starting situations for each plan on both browsers,
including separate auth URLs, quote/annual switching, Back/Forward, refresh,
Pro TEST confirmation, Business paid-space setup and optional Pro cancellation.
Additional cases cover delayed reconciliation, permission retry, payment-loader
failure/retry, expired return, mixed TEST/LIVE return rejection, an existing
Business subscription and a referenced-space permission denial. Account recovery checks
cover delayed status, original-payment resumption and removal of a successful empty
card. Subscription settings checks cover independent Pro/Business records, explicit
selected-subscription cancellation, refresh-safe transfer, unchanged projects and
TEST-only authenticated requests. These tests
never submit a provider payment. Test reports are in
`coverage/apps/datatug-checkout/results/`.

The opt-in `checkout-provider.spec.ts` checks the real isolated TEST service,
without mocking checkout HTTP. The read-only catalog/preflight check does not
need a running local app or an authenticated account:

```sh
DATATUG_CHECKOUT_PROVIDER_TEST=1 \
  pnpm nx run datatug-app:e2e-checkout-provider --grep='deployed TEST catalog'
```

For unpaid provider-form mounting, serve the current app at the already allowed
origin `http://datatug.localhost:4328`. Use the designated TEST buyer's Playwright
storage state, including IndexedDB, saved outside the repository. The suite
skips these two authenticated cases when that state is absent; skipped cases
are not verification. It forwards checkout traffic only to the fixed TEST host,
disables traces/video/screenshots and never enters cards or clicks Pay.

```sh
DATATUG_CHECKOUT_PROVIDER_TEST=1 \
DATATUG_CHECKOUT_TEST_BUYER_UID=designated-test-uid \
DATATUG_CHECKOUT_TEST_STORAGE_STATE=/private/path/test-buyer-state.json \
  pnpm nx run datatug-app:e2e-checkout-provider
```

No suite starts or replaces another owner's server on port 4328. Use an owned
preview with that exact allowed origin; the visual preview on 127.0.0.1:18787
cannot call the deployed TEST service. Provider charge/decline/3DS, real webhook
reconciliation and physical Mobile Safari still require separate evidence.

To inspect an already paid TEST return without creating a session or changing
its destination, also set `DATATUG_CHECKOUT_TEST_RETURN_SESSION` to that existing
`cs_test_…` identifier. This case allows GET checkout requests only. It is skipped
when the identifier is absent; authentication requires dedicated credentials or designated buyer state plus expected UID. it never creates the
paid fixture it needs. Provider-form and return checks are manual opt-in gates,
not part of the simulated CI suite.

## Query authoring in mobile WebKit

The query-only WebKit profile is a required CI check whenever Nx marks
`datatug-app` affected. It covers coloring, explicit TugQL
suggestions and native editing,
the saved Invoice → Customer Compose/Code/Preview/Run journey, and the maintained
two-fixture comparison. It uses the iPhone 13 browser profile and also checks
320px and 390px layouts. This is automated WebKit coverage; physical iPhone
Safari testing is a separate check. The default CI projects remain unchanged.

```sh
# The demo project comes from the GitHub pins (see "GitHub checkouts"); pick an unused local port.
DATATUG_E2E_PORT=4200 \
  pnpm nx run datatug-app:e2e-query-mobile
```

Install Playwright's WebKit browser before running the profile locally.
The GitHub reader is served from the local demo checkout; query execution and
comparison use the real SQLite workers and Core bridge. The exact Chinook
browser URL is fulfilled from the hash-checked, admitted
[local fixture](fixtures/chinook.FIXTURE.md), so public download rate limits do
not turn these application checks into source availability checks. The live
DemoDB browser checks retain their public-source coverage. Reports are
written under `coverage/apps/datatug-query-mobile/`.

The Chromium app and Query mobile WebKit suites run in separate CI jobs after
build. Both remain in the required `e2e` aggregate. The real-agent journey
remains in its separate job with its current gate.

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

## Card links (real `datatug daemon`)

`agent-links/` opens the pages a DataTug Claude Code mod card links to (a table's metadata, its records, one
record) against a real `datatug daemon start`, with links minted by `datatug daemon url`. The fixture runs the daemon
with a temporary HOME that registers only the demo project, and stops it afterwards. The agent admits pages only
from `https://datatug.app` and `datatug.localhost`, so this suite serves the app at
`http://datatug.localhost:4312` (not `localhost`) and has its own config. It needs a CLI with the read-only
`records/schema` and `records/lookup` routes (datatug-cli #399), the demo project and the Chinook fixture, as the
journey suite does:

```sh
DATATUG_BIN=/path/to/datatug \
DATATUG_DEMO_DIR=~/projects/datatug/datatug-demo-project/demo-project-1 \
  pnpm nx run datatug-app:e2e-agent-links
```

Without `DATATUG_BIN` or `DATATUG_CLI_DIR` every test is skipped. CI runs it in the `agent-links` job when the
repository variable `DATATUG_LINKS_CLI_REF` is set, against the release pinned by `DATATUG_CLI_REF` (the workflow-level `env:` of `ci.yml`,
v0.113.0; the app speaks the TugQL wire contract since v0.109.0 and `environment-state/1` since v0.113.0); an older binary answers `dtql` and the result editor
and Run again tests fail). It refuses to run when
another DataTug API already listens on port 8989 (the daemon would adopt it). The https-to-loopback path of the
hosted UI is not exercised here; that is the reach script of the plan.

`result-editor.spec.ts` covers the Table view of a stored query result, which is the query editor
(`/project/<p>/query?result=<id>`): the saved rows in the shared results grid, the "Saved result from" strip, the
Prompt section, the other result views and Back. Its checks of the query text and the prompt need a CLI with the
editor-ready result members and `query results annotate` (datatug-cli #431, after v0.100.1); against an older binary
they are skipped and the strip's "older DataTug" message is asserted instead.

`results-grid.spec.ts` covers the community toolbar of the shared results grid on a stored result opened in the
editor: the column chooser (hide, order, pin, show all, reset), the layout and density remembered across a refresh
(localStorage keys of ids only, never a value), Autosize, row checkboxes with "CSV selected" and "Copy selected", the
keyboard and a 360 px wide screen. Its first test (the grid's columns in the table's order, with no `$key`) needs
**datatug 0.102.1 or later** (datatug-cli #435) and is skipped against an older binary (the fixture reads `datatug
version`). The numeric right-alignment test needs the column type metadata and is likewise skipped
below **0.102.1** (`COLUMN_TYPES_CLI`). CI's pinned v0.113.0 runs them.

Running the suite on a computer that already has a real daemon on port 8989: the fixture's daemon would adopt it
(see above). Run the binary through a wrapper that may not connect to that port, so the throwaway daemon picks
another one and the real one is never contacted, e.g. on macOS
`exec sandbox-exec -p '(version 1)(allow default)(deny network-outbound (remote ip "localhost:8989"))' /path/to/datatug "$@"`
as `DATATUG_BIN`.

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

| Variable                  | Meaning                                                                                                                                                                                                                                                                                                                                                             | Default                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATATUG_BIN`             | Path to a built `datatug` binary.                                                                                                                                                                                                                                                                                                                                   | —                                                                                                                                                                                   |
| `DATATUG_CLI_DIR`         | Path to a `datatug-cli` checkout; used to `go build` a binary on demand when `DATATUG_BIN` is not set.                                                                                                                                                                                                                                                              | —                                                                                                                                                                                   |
| `DATATUG_DEMO_DIR`        | Path to `datatug-demo-project/demo-project-1`, in a checkout on a named branch (a detached HEAD gets 409 from the agent's environment state).                                                                                                                                                                                                                                                                                                                      | `../datatug-demo-project/demo-project-1` relative to this repo (tried at 1–3 directory levels up, to cover both a plain sibling checkout and a nested `.worktrees/<task>` checkout) |
| `DATATUG_E2E_GITHUB_FAKE` | Set by globalSetup to the lane's demo project pin checkout (see "GitHub checkouts"), for specs that read its files directly. Set it by hand only to serve a local working checkout of `datatug/datatug-demo-project` as its `HEAD`/`main` instead of the pin. | The lane's demo pin |
| `DATATUG_LARGE_E2E`       | Set to `1` to run the cross-source join journey with 120,000 rows instead of the CI default of 205 rows and 25-row source pages.                                                                                                                                                                                                                                    | Unset                                                                                                                                                                               |

If neither `DATATUG_BIN` nor `DATATUG_CLI_DIR` is set, or the demo project
can't be found, every journey test is skipped with a message naming exactly
what was tried (see `fixtures/agent-server.ts`, `resolveBinary()` /
`resolveDemoDir()`).

### What CI provides: the `journey` job

`.github/workflows/ci.yml`'s `journey` job (needs: `build`) is what actually
runs this suite in CI. It:

1. Checks out this repo, plus `datatug/datatug-demo-project` at `main`
   nested under the workspace (`actions/checkout`'s `path:` cannot escape the
   primary checkout).
2. Downloads the prebuilt `datatug` CLI binary from `datatug/datatug` at a
   **pinned release tag** (`DATATUG_CLI_REF` in the workflow-level `env:` at the
   top of `ci.yml` — currently `v0.113.0`), verifies its SHA256 checksum against the published
   checksums file, and sets `DATATUG_BIN` to that path.
3. Fetches the Chinook SQLite fixture directly, keylessly, to
   `~/datatug/dbs/chinook-local.sqlite` — the exact path
   `environments/local/catalogs/chinook-local/chinook-local.db.json`
   declares in `datatug-demo-project`. This is _not_ `datatug demo`: that
   CLI command (`apps/datatugapp/commands/cmd_demo.go` in `datatug-cli`)
   does the same keyless download but then blocks forever serving the demo
   project (it hands off to `serve`), so it can't run as a CI step; the CI
   step replicates just its `downloadSQLiteSource` behavior (same URL) and
   stops there. `DATATUG_DEMO_DIR` is set to the checked-out
   `datatug-demo-project/demo-project-1`, so the fixture never needs its
   own git clone.
4. Installs Playwright's `chromium` browser, builds `datatug-app`
   (production config — a fail-fast check; `playwright.config.ts`'s own
   `webServer` starts the _dev_ server for the actual test run, so this
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

`DATATUG_CLI_REF` in the workflow-level `env:` of `.github/workflows/ci.yml` is the only
place the tag is pinned; the `journey` and `agent-links` jobs both read it. It must be at least
`FIRST_CONTRACT_VERSION` in `libs/datatug/main/src/lib/services/project/project-environment-state.service.ts`
(the first release with the `environment-state/1` contract, v0.113.0): an older agent shows local project
environments read-only. To bump it:

```sh
git ls-remote --tags https://github.com/datatug/datatug-cli.git \
  | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1
```

Update `DATATUG_CLI_REF` to that tag and re-run the `journey` job. The tag
named in these READMEs and in the `playwright.config.ts` note is documentation only.

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
`datatug-cli`/`datatug-demo-project` defects that blocked every journey
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


### Unattended isolated TEST authentication

The provider suite can sign in normally with a dedicated TEST account using
private environment variables `DATATUG_CHECKOUT_TEST_EMAIL`,
`DATATUG_CHECKOUT_TEST_PASSWORD` and `DATATUG_CHECKOUT_TEST_BUYER_UID`.
It validates the expected UID and Firebase project `sneat-eur3-1` before
forwarding checkout traffic. This is ordinary password authentication, with no
admin custom tokens, impersonation or account/permission creation. Existing
private storage state is optional but must pass the same identity check.
Missing credentials fail authenticated cases explicitly; they do not prompt or
silently skip. Catalog-only checks still run without authentication.

Use `DATATUG_CHECKOUT_PROVIDER_TEST=1` and, after building production,
`DATATUG_CHECKOUT_PROVIDER_SERVE=1` to let Playwright own an ephemeral static
server on the already approved origin `http://datatug.localhost:4328`.
It refuses an occupied port, closes on test teardown, and never changes origin
allowlists or replaces a preview. Traces, screenshots, video and authentication
state output are off. The separate manual GitHub Actions workflow consumes
repository secrets; it never runs automatically for a pull request.

This suite creates only unpaid TEST forms. It never enters cards or submits a
payment; provider intent confirmation requests are blocked. Any future actual
TEST payment suite must use a separate explicit opt-in. An existing paid return
may be checked read-only by supplying `DATATUG_CHECKOUT_TEST_RETURN_SESSION`.
No configured credentials or executed authenticated provider result are implied
by adding this fixture/workflow.

## Business project preview (live, opt-in)

`business-project-preview.spec.ts` signs the designated TEST Business buyer in to
the `business-preview` build on `http://localhost:18782` and opens the pinned
Business project against the deployed datatug-cloud-preview (Stripe TEST keys
only). It asserts that the project API calls (`project_summary`, `all_queries`
and every other allow-listed route) go to the preview origin and return 2xx, and
that a saved query of the project renders. It never enters a card, saves a
query, or reaches a checkout or Stripe host, and keeps traces, video and
screenshots off, and refuses to run with `--trace on`, `--reporter html`,
video/screenshot flags or any non-empty `DEBUG` variable (including `DEBUG=*`). Every non-GET DataTug API call, and any
DataTug API call outside the preview origin, is aborted and fails the test. It is not part of the default CI run
(`playwright.config.ts` ignores it); `playwright.business-preview.config.ts`
runs it.

The buyer comes only from the environment. Without the first two variables every
case is skipped and no dev server is started.

| Variable | Meaning |
| --- | --- |
| `DATATUG_BUSINESS_PREVIEW_BUYER_EMAIL` | the TEST buyer's email |
| `DATATUG_BUSINESS_PREVIEW_BUYER_PASSWORD` | the TEST buyer's password |
| `DATATUG_BUSINESS_PREVIEW_BUYER_UID` | optional: the signed-in uid must equal it |
| `DATATUG_BUSINESS_PREVIEW_PROJECT` | optional: `<repository>@<owner>@<folder>`, default is the preview's pinned project |

```sh
DATATUG_BUSINESS_PREVIEW_BUYER_EMAIL=... DATATUG_BUSINESS_PREVIEW_BUYER_PASSWORD=... \
  pnpm nx run datatug-app:e2e-business-preview
```

The target serves `datatug-app:serve:business-preview` itself and refuses an
occupied port 18782 (free it first). The port and the host name `localhost` matter:
datatug-cloud-preview admits only the origin `http://localhost:18782`.

## Watch cloud acceptance against the actual backend

`datatug-app:e2e-watch-cloud` checks the browser contract with mocked Watch HTTP responses and real Firebase emulators. The separate opt-in `datatug-app:e2e-watch-cloud-native` target uses a running backend fixture, Firestore, Firebase authentication and actual native CLI runners. It does not mock Watch requests.

The backend owner starts `api4datatug/watch_native_integration_test.go::TestWatchCloudNativeJourney` with `DATATUG_WATCH_NATIVE_HOLD=1`, `DATATUG_WATCH_NATIVE_EXTENDED=1`, its source-built `DATATUG_WATCH_NATIVE_BINARY`, exact `DATATUG_WATCH_NATIVE_SOURCE_SHA`, and an owned `DATATUG_WATCH_NATIVE_OUTPUT` directory. Its governed Go command is `go test -tags=integration ./api4datatug -run '^TestWatchCloudNativeJourney$' -count=1 -timeout=20m -v`. The owner also provides the isolated emulators required by that fixture. Wait for its `WATCH_NATIVE_BROWSER_READY` message and use the emitted `ready.json`; keep the backend owner responsible for its processes and stop file.

Run the browser from a clean, published WB checkout. Supply `DATATUG_WATCH_BROWSER_EMAIL` and `DATATUG_WATCH_BROWSER_PASSWORD` privately in the environment using the fixture's emulator-only account. Do not put credentials in arguments, source, screenshots or receipts. Set `DATATUG_WATCH_NATIVE_READY` to the emitted ready file, then run:

```sh
wb run -- pnpm nx run datatug-app:e2e-watch-cloud-native --output-style=static -- --case healthy --output-dir /private/tmp/watch-native-healthy
wb run -- pnpm nx run datatug-app:e2e-watch-cloud-native --output-style=static -- --case partial-setup --output-dir /private/tmp/watch-native-partial
```

The healthy case signs in, creates a personal Watch with email and in-app consent, verifies the returned detail's accepted Core run and completed state, cold-reloads it, opens its exact inbox notification, and enrolls/configures/revokes a runner before signing out. The setup credential stays separate from the nonsecret configuration and is dismissed before screenshots. Native SQL requires an explicit operator grant.

The partial-setup case requires the fixture's private `subscriptionTimeoutFile`. It requests one deliberate DALGO transaction timeout, checks the actual HTTP 503, verifies the paused detail and visible notice, and confirms that cold reload consumes the notice without enabling or evaluating the Watch. This injected fault case is separate from the healthy proof; it adds no production hook or automatic retry.

The tool accepts only explicit loopback services in a `demo-` Firebase project. It builds an ignored temporary environment configuration, starts its own foreground preview on port 18848 and browser, then removes/stops only those resources. An occupied preview port or existing generated configuration is an error. Screenshots and credential-free request timings/receipts stay in the private temporary output directory. Receipts identify the clean UI source and fixture CLI source; backend and emulator teardown remains with the fixture owner.
