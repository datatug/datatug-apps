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
| `e2e-app`, `e2e-query-mobile` | yes, `nx affected` | yes | none: the app's own chinook.sqlite download is served from local fixtures; fake GitHub |
| `e2e-demo-sqlite` (3 browsers) | yes, `nx affected` | yes | none: pinned files from local fixtures |
| `e2e-demo-handoff` | yes, `nx affected` | yes | none (local build, third parties stubbed) |
| `journey e2e (real datatug-cli agent)` | yes, always | yes | none to demodb.dev (GitHub release + raw.githubusercontent only) |
| `agent-links` | only when `DATATUG_LINKS_CLI_REF` is set | yes (may be `skipped`) | none |
| `e2e-postgres-ovdb.yml` (own workflow: manual or path-filtered push to main, never a PR) | no | no | `cloud.openvaultdb.com` |
| `demodb-live-smoke.yml` (manual `workflow_dispatch`) | no | no | `*.demodb.dev`, Chromium only |

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

### DemoDB fixtures

`helpers/demodb-guard.ts` answers every `*.demodb.dev` request locally. The 5 pinned SQLite files and the comparison
candidate come from `tmp/demodb-fixtures` (`DEMODB_FIXTURE_DIR`), filled by Playwright's globalSetup running
`node scripts/fetch-demodb-fixtures.mjs`: they are taken from the public `demo-db/<dataset>` GitHub repositories at a pinned
commit and accepted only when size and SHA-256 equal the pin. A valid file is never requested again, so a warm cache makes
0 requests and a cold one 1 per file, none of them to demodb.dev. The script writes `.complete` only when every file is
valid, and CI saves its cache only then. `corpus.json` and the six dataset home pages are committed in
`e2e/fixtures/demodb/` (built from `demo-db/websites`, provenance and SHA-256 in `provenance.json`; refresh them by building
the websites repo and copying the outputs). The `journey` lane downloads nothing (`--project=journey` skips the fixtures).

* **Not served, refused:** the OVDB API on `ovdb.demodb.dev`, and the chunked AdventureWorks download (`*.parts.json`
  manifest and gzip parts). Their tests run only in live mode.
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
# Use a clean checkout of demo revision f40286a57ea3a04b93875335234665ece2595ed0
# (the CI browser catalog pin) and an unused local port.
DATATUG_E2E_GITHUB_FAKE=/path/to/datatug-demo-project DATATUG_E2E_PORT=4200 \
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

Without `DATATUG_BIN` or `DATATUG_CLI_DIR` every test is skipped. CI runs it in the `agent-links` job once the
repository variable `DATATUG_LINKS_CLI_REF` names a datatug release that has those routes. It refuses to run when
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
below **0.102.1** (`COLUMN_TYPES_CLI`). For CI to run them, set the repository variable `DATATUG_LINKS_CLI_REF` to `v0.102.1` or later.

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
| `DATATUG_DEMO_DIR`        | Path to `datatug-demo-project/demo-project-1`.                                                                                                                                                                                                                                                                                                                      | `../datatug-demo-project/demo-project-1` relative to this repo (tried at 1–3 directory levels up, to cover both a plain sibling checkout and a nested `.worktrees/<task>` checkout) |
| `DATATUG_E2E_GITHUB_FAKE` | A checkout of `datatug/datatug-demo-project`, served in place of `api.github.com`, `raw.githubusercontent.com` and `cdn.jsdelivr.net` (`helpers/fake-github.ts`): no network, none of the 60 anonymous API requests an hour. Used by `github-store.spec.ts`, `query-author.spec.ts`, and `query-compare.spec.ts`. Unset, tests using the fake read the real GitHub. | Unset                                                                                                                                                                               |
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
   **pinned release tag** (`env.DATATUG_CLI_REF` at the top of the job —
   currently `v0.78.0`), verifies its SHA256 checksum against the published
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
