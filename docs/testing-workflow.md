# Testing DataTug UI changes

Use focused unit tests and focused browser journeys while developing each behavior change. These must cover the changed path, including its loading, error, and navigation states where relevant.

When changing visible copy or selectors, search all browser and unit specs for the removed text or selectors. Update the affected assertions and run those focused specs before the final push.

Run lint through the owning Nx project target, such as `pnpm nx lint datatug-main` for library UI and `pnpm nx lint datatug-app` for app/E2E code. A direct ESLint command from the workspace root does not load every project's Angular rules and cannot substitute for these checks. For a file-only command, explicitly select that project's ESLint configuration.

For a group of related changes, keep them on one integration branch and PR. Run the required build and test checks against the final combined head before landing. Run focused browser and CLI journeys for the behavior changed by that branch. If the head changes after that run, rerun the affected focused checks against the new head.

Full E2E runs nightly at 03:17 UTC on the latest `main` commit. Push, PR, and merge-group CI runs skip those jobs; their deploy gate requires build and unit tests. Focused tests still run during development. Do not skip the required build, test, or coverage gates.

Nightly CI runs the Chromium app, Query mobile WebKit, checkout, demo, and real-agent suites in separate jobs after build. The nightly `e2e` aggregate reports their combined verdict, including the optional card-link suite when its CLI ref is configured. It does not block landing or deployment.
