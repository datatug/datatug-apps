# Testing DataTug UI changes

Use focused unit tests and focused browser journeys while developing each behavior change. These must cover the changed path, including its loading, error, and navigation states where relevant.

When changing visible copy or selectors, search all browser and unit specs for the removed text or selectors. Update the affected assertions and run those focused specs before the final push.

For a group of related changes, keep them on one integration branch and PR. Run the required build, test, E2E, and CLI journey checks once against the final combined head before landing. If the head changes after that run, rerun the affected required checks against the new head.

Full E2E is expensive and belongs at the integration gate. Focused tests still run during development. Do not disable required checks or skip the coverage gate to reduce runtime.
