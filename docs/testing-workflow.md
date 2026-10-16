# Testing DataTug UI changes

Use focused unit tests and focused browser journeys while developing each behavior change. These must cover the changed path, including its loading, error, and navigation states where relevant.

When changing visible copy or selectors, search all browser and unit specs for the removed text or selectors. Update the affected assertions and run those focused specs before the final push.

Run lint through the owning Nx project target, such as `pnpm nx lint datatug-main` for library UI and `pnpm nx lint datatug-app` for app/E2E code. A direct ESLint command from the workspace root does not load every project's Angular rules and cannot substitute for these checks. For a file-only command, explicitly select that project's ESLint configuration.

For a group of related changes, keep them on one integration branch and PR. Run the required build, test, E2E, and CLI journey checks once against the final combined head before landing. If the head changes after that run, rerun the affected required checks against the new head.

Full E2E is expensive and belongs at the integration gate. Focused tests still run during development. Do not disable required checks or skip the coverage gate to reduce runtime.

## SpecScore status-only CI path

CI starts with a dependency-free classifier and its fixture tests. It permits the cheap path only when the entire exact Git tree difference consists of status fields in existing SpecScore Idea, Feature, or Plan Markdown files and the corresponding status cells in their indexes. The classifier compares every other byte, rejects additions, deletions, renames, mode changes, binaries, and unknown revisions, and runs `specscore spec lint` before any application job can report success.

For pull requests and merge groups, classification covers the complete base-to-head change, including earlier commits. For a push to `main`, it starts at the previous successfully verified CI commit; a failed code commit between that baseline and a later metadata edit therefore requires the full path. Manual or unknown CI contexts take the full path. Source, dependencies, configuration, workflows, and semantic spec prose always take the full path.

The existing required `build`, `test`, and `journey e2e (real datatug-cli agent)` checks remain present. On verified status-only changes, they report that application work is not applicable after the cheap validation succeeds. A failed preflight fails those jobs and the existing aggregates. Application code still runs the usual tests, coverage, build, browser, and CLI journeys.

Deployment uses a separate comparison against the last **actual successful application deploy** receipt, uploaded only after the reusable deploy job succeeds. It skips a deployment only if the whole deploy-to-tip difference is verified status-only. Missing, expired, or unverifiable receipts take the normal deployment path, even if the current CI run used its metadata-only path. The existing exact-head, current-main-tip, green-CI, and manual override rules still apply.

CI runs the Chromium app suite and Query mobile WebKit suite in separate jobs after build. Keep both in the required `e2e` aggregate so either failure blocks landing. A head change requires a fresh aggregate verdict for that exact commit.
