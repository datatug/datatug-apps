# Testing DataTug UI changes

Use focused unit tests and focused browser journeys while developing each behavior change. These must cover the changed path, including its loading, error, and navigation states where relevant.

When changing visible copy or selectors, search all browser and unit specs for the removed text or selectors. Update the affected assertions and run those focused specs before the final push.

Run lint through the owning Nx project target, such as `pnpm nx lint datatug-main` for library UI and `pnpm nx lint datatug-app` for app/E2E code. A direct ESLint command from the workspace root does not load every project's Angular rules and cannot substitute for these checks. For a file-only command, explicitly select that project's ESLint configuration.

For a group of related changes, keep them on one integration branch and PR. Run the required build and test checks against the final combined head before landing. Run focused browser and CLI journeys for the behavior changed by that branch. If the head changes after that run, rerun the affected focused checks against the new head.

Full E2E runs nightly at 03:17 UTC on the latest `main` commit. Push, PR, and merge-group CI runs skip those jobs; their deploy gate requires build and unit tests. Focused tests still run during development. Do not skip the required build, test, or coverage gates.

## SpecScore status-only CI path

CI starts with a dependency-free classifier and its fixture tests. It permits the cheap path only when the entire exact Git tree difference consists of status fields in existing SpecScore Idea, Feature, or Plan Markdown files and the corresponding status cells in their indexes. The classifier compares every other byte, rejects additions, deletions, renames, mode changes, binaries, and unknown revisions, and runs `specscore spec lint` before any application job can report success.

For pull requests and merge groups, classification covers the complete base-to-head change, including earlier commits. For a push to `main`, it starts at the previous successfully verified **push** CI commit, with green `build`, `test`, and `deploy-gate`; a failed code commit between that baseline and a later metadata edit therefore requires the full path. Nightly scheduled CI always takes the full path, including every browser and real-agent suite. Manual or unknown CI contexts take the full path. Source, dependencies, configuration, workflows, and semantic spec prose always take the full path.

The existing `build`, `test`, and `deploy-gate` checks remain present on push, pull request, and merge group runs. On verified status-only changes, `build` and `test` report that application work is not applicable after cheap validation succeeds; `deploy-gate` still requires both successful jobs. A failed preflight fails those jobs and the deploy gate. Normal application changes run the usual lint, test, coverage, and build checks. Browser and real-agent jobs keep their existing names and run nightly; the scheduled `e2e` aggregate fails if any required lane fails or is skipped.

Deployment uses a separate comparison against the last **actual successful application deploy** receipt, uploaded only after the reusable deploy job succeeds. The gate finds the stable receipt artifact by exact name, validates its run, attempt, head and successful jobs, and checks every later deploy run including failed or rerun attempts. An unreceipted later publication cannot authorize a skip. It skips a deployment only if the whole deploy-to-tip difference is verified status-only. Missing, expired, or unverifiable receipts and ambiguous later runs take the normal deployment path, even if the current CI run used its metadata-only path. The lookup is bounded at 500 artifacts/runs and 10 later-run job audits; exceeding either limit also takes the normal deployment path. The existing exact-head, current-main-tip, green-CI, and manual override rules still apply.

Nightly CI runs the Chromium app, Query mobile WebKit, checkout, demo, and real-agent suites in separate jobs after build. Its `e2e` aggregate reports their combined verdict, including the optional card-link suite when its CLI ref is configured. It does not block landing or deployment. Run focused browser and CLI journeys for the behavior changed by a branch against its final head.

The Chromium app, Query mobile WebKit, and demo SQLite jobs use the validated demo catalog revision
`f40286a57ea3a04b93875335234665ece2595ed0` through the fake GitHub
reader. The app job verifies GitHub's API, tree and raw source at that same
commit. The demo SQLite job includes the edited-copy Board to Query acceptance
in its existing three-browser suite. The demo catalog admits the relative
bundled Chinook asset and rights sidecar; the app serves those exact checked
bytes and the real SQLite worker executes them. The standalone `/demo/sqlite`
import and comparison baseline still use their declared public URLs, served
from the same checked-in bundled bytes only in focused browser journeys.
Other live dataset checks and demo checkouts remain independent of this
browser catalog pin.
