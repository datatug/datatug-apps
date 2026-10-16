# Testing DataTug UI changes

Use focused unit tests and focused browser journeys while developing each behavior change. These must cover the changed path, including its loading, error, and navigation states where relevant.

When changing visible copy or selectors, search all browser and unit specs for the removed text or selectors. Update the affected assertions and run those focused specs before the final push.

Run lint through the owning Nx project target, such as `pnpm nx lint datatug-main` for library UI and `pnpm nx lint datatug-app` for app/E2E code. A direct ESLint command from the workspace root does not load every project's Angular rules and cannot substitute for these checks. For a file-only command, explicitly select that project's ESLint configuration.

For a group of related changes, keep them on one integration branch and PR. Run the required build, test, E2E, and CLI journey checks once against the final combined head before landing. If the head changes after that run, rerun the affected required checks against the new head.

Full E2E is expensive and belongs at the integration gate. Focused tests still run during development. Do not disable required checks or skip the coverage gate to reduce runtime.

CI runs the Chromium app suite and Query mobile WebKit suite in separate jobs after build. Both are required lanes of `deploy-gate` (see the lane matrix in `apps/datatug-app/e2e/README.md`), so either failure blocks landing. A head change requires a fresh `deploy-gate` verdict for that exact commit. The `e2e` aggregate is the strict nightly roll-up, including the live-host lanes.
