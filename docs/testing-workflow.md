# Testing DataTug UI changes

Use focused unit tests and focused browser journeys while developing each behavior change. These must cover the changed path, including its loading, error, and navigation states where relevant.

When changing visible copy or selectors, search all browser and unit specs for the removed text or selectors. Update the affected assertions and run those focused specs before the final push.

Run lint through the owning Nx project target, such as `pnpm nx lint datatug-main` for library UI and `pnpm nx lint datatug-app` for app/E2E code. A direct ESLint command from the workspace root does not load every project's Angular rules and cannot substitute for these checks. For a file-only command, explicitly select that project's ESLint configuration.

For a group of related changes, keep them on one integration branch; lane branches merge into it locally without PRs, and only the one integration-to-main PR runs full CI (`rule:integration-branch-default-flow` in `sneat-co/backstage`). Run the required build and test checks against the final combined head before landing. Run focused browser and CLI journeys for the behavior changed by that branch. If the head changes after that run, rerun the affected focused checks against the new head.

There is no scheduled (nightly) CI run. Push, PR, and merge-group CI runs the offline browser and real-agent lanes and their deploy gate requires them together with build and unit tests; the one live-API test is `e2e-postgres-ovdb.yml` (below). Focused tests still run during development. Do not skip the required build, test, or coverage gates.

## Keeping the suites fast

Unit tests (`datatug-main`, `datatug-semantic`) share one module graph per worker (`isolate: false`, `moduleSharing` in `vite.config.base.ts`): Angular, Ionic and the app's modules are evaluated once per worker instead of once per spec file, which used to be most of the suite's run time. Two consequences for spec authors:

- A spec file that calls `vi.mock`, `vi.doMock`, `vi.doUnmock` or `vi.resetModules` is found automatically and runs isolated, in the separate `test-isolated` target that `test` depends on. It is slower, so prefer TestBed providers, injected fakes and `vi.stubGlobal` over module mocks. `test-focused` runs any chosen files isolated, as before.
- Every file starts from a clean set of shared globals: real timers, no stubbed globals or envs, no active spies, empty storage, the real `window.history` at `/`, and an empty body (`resetSharedGlobals` in `libs/testing`). Any other global a spec replaces (a `window` property, a prototype method) must be restored by that spec.

Shared test doubles live in `libs/datatug/main/src/lib/testing/` (for example `provideMockErrorLogger()`); reuse them instead of copying a mock into each spec. Domain fixtures stay in `*.spec-helper.ts` files next to the code they serve.

Browser lanes run their tests in parallel workers unless the tests share state that cannot be partitioned. Wait for the event an assertion depends on (a request, `networkidle`, a visible element) instead of `waitForTimeout`. Run a behaviour once in the browser where it can differ, and once elsewhere; for example, the per-dataset DemoDB matrix runs in Chromium only, while the OPFS and in-memory storage paths run in all three browsers.

## SpecScore status-only CI path

CI starts with a dependency-free classifier and its fixture tests. It permits the cheap path only when the entire exact Git tree difference consists of status fields in existing SpecScore Idea, Feature, or Plan Markdown files and the corresponding status cells in their indexes. The classifier compares every other byte, rejects additions, deletions, renames, mode changes, binaries, and unknown revisions, and runs `specscore spec lint` before any application job can report success.

For pull requests and merge groups, classification covers the complete base-to-head change, including earlier commits. For a push to `main`, it starts at the previous successfully verified **push** CI commit, with green `build`, `test`, and `deploy-gate`; a failed code commit between that baseline and a later metadata edit therefore requires the full path. Manual or unknown CI contexts take the full path. Source, dependencies, configuration, workflows, and semantic spec prose always take the full path.

The existing `build`, `test`, and `deploy-gate` checks remain present on push, pull request, and merge group runs. On verified status-only changes, `build` and `test` report that application work is not applicable after cheap validation succeeds; `deploy-gate` still requires both successful jobs. A failed preflight fails those jobs and the deploy gate. Normal application changes run the usual lint, test, coverage, and build checks. Browser and real-agent jobs keep their existing names and run on every pull request, merge group and push; `deploy-gate` fails if any gating lane fails or is skipped.

Deployment uses a separate comparison against the last **actual successful application deploy** receipt, uploaded only after the reusable deploy job succeeds. The gate finds the stable receipt artifact by exact name, validates its run, attempt, head and successful jobs, and checks every later deploy run including failed or rerun attempts. An unreceipted later publication cannot authorize a skip. It skips a deployment only if the whole deploy-to-tip difference is verified status-only. Missing, expired, or unverifiable receipts and ambiguous later runs take the normal deployment path, even if the current CI run used its metadata-only path. The lookup is bounded at 500 artifacts/runs and 10 later-run job audits; exceeding either limit also takes the normal deployment path. The existing exact-head, current-main-tip, green-CI, and manual override rules still apply.

Pull requests, merge groups and pushes run the offline browser and real-agent lanes (Chromium app, Query mobile WebKit, checkout, demo SQLite, demo hand-off, `journey`, card links) and `deploy-gate` requires them; none of them sends a request to demodb.dev (pinned files come from local fixtures, see `apps/datatug-app/e2e/README.md`). The read-only PostgreSQL-through-OpenVaultDB test (`cloud.openvaultdb.com`) is not part of `ci.yml`: it has its own workflow, `.github/workflows/e2e-postgres-ovdb.yml`, run manually (`workflow_dispatch`) or on a push to `main` that touches the OVDB/PostgreSQL code, its spec or its config (path-filtered), never on a pull request. Runs are serialized and never cancelled mid-run, Playwright retries 0, each test has a request budget (`DEMODB_E2E_MAX_OVDB_REQUESTS`, 40) and the first HTTP 429 or Cloudflare block page (such as error 1027) stops the run. It is not a required check and not in `deploy-gate`, so it never blocks landing or deployment; a failure is that workflow's own red run. Run focused browser and CLI journeys for the behavior changed by a branch against its final head.

The AdventureWorks in-browser journey (download through the chunked gzip parts, verify, open, read, edit, reload, Reset) is its own workflow, `.github/workflows/demo-sqlite-adventureworks.yml`, in Chromium only, because the file is 126.8 MB unpacked and is downloaded twice. It runs on a pull request and on a push to `main` only when demo SQLite code, its catalog, the DemoDB guard or fixtures, the lane itself or the dependencies changed, and by hand; never on a schedule, and it is not part of `deploy-gate`. It sends no request to a DemoDB host: the gzip parts come from the `demo-db/adventureworks` GitHub repository (`apps/datatug-app/e2e/README.md`, "DemoDB fixtures"). When you change demo SQLite code, run `pnpm nx run datatug-app:e2e-demo-sqlite-adventureworks` locally.

Every GitHub repository the e2e suites read is pinned in ONE place, `apps/datatug-app/e2e/github-pins.json`
(see `apps/datatug-app/e2e/README.md`, "GitHub checkouts"). The browser lanes (Chromium app, Query mobile WebKit,
demo SQLite) read the demo project at pin `demo-browser` (the validated catalog revision: required creation dates on
all 59 query definitions and the server-comparison query the showcase specs read); the independent chart sources
journey (`showcase-independent-sources.spec.ts`), which needs per-database customer queries that pin predates, runs
through `datatug-app:e2e-showcase-independent` at pin `demo-independent`; the real-agent journey and card-link jobs
check out pin `demo-agent`. The guard answers `api.github.com`, `raw.githubusercontent.com` and `cdn.jsdelivr.net`
from shallow checkouts of those commits and fails a test whose GitHub request reaches the network or names a commit
or branch no pin answers. The one lane that reads the real GitHub, and checks every pin still exists there, is
`.github/workflows/github-live-smoke.yml` (push to `main`, or by hand). The demo SQLite job includes the edited-copy
Board to Query acceptance in its three-browser suite. The demo catalog admits the relative bundled Chinook asset and
rights sidecar; the app serves those exact checked bytes and the real SQLite worker executes them. The standalone
`/demo/sqlite` import and comparison baseline still use their declared public URLs, served from the same checked-in
bundled bytes only in focused browser journeys. Bump a pin deliberately, together with the specs that read it.

## Project Meanings acceptance

Run `DATATUG_BIN=/absolute/path/to/current/datatug wb run -- pnpm nx run datatug-app:e2e-meanings` with a CLI that supports the Meanings catalog/change endpoints and canonical query references. The app build may require `GH_TOKEN` for its verified release dependency; keep the token in the environment. This focused lane owns an isolated browser, app server, temporary Git project, agent port and foreground CLI child, and removes them on teardown. It does not use the older CLI pinned by the general browser suite.

The journey creates an entity and field through the UI, cold-reloads both, checks the list-to-field deep link, saves an exact canonical reference through the real query API, checks the disabled Delete action and provider rejection, removes the query reference, then deletes the field and entity through the UI. It records screenshots of the list, persisted field, protected field and empty catalog. The reference setup exercises the real persistence API; the semantic picker is covered separately by focused unit tests.
