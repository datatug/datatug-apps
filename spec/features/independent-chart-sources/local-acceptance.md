# Independent source editing: local acceptance — 2026-10-21

## Scope and inputs

Apps base: `d147f87e1f6ae011fb90907ea13fc001d852a1d2`. Paired Demo fixture head: `2692f1c09d35dc384313dba9444c6635de0f8c68`. This evidence covers generic local source editing and the guided journey, not provider publication, deployment or whole-epic completion. The browser fixture uses pinned SQLite-derived real aggregates plus explicitly simulated valid server declarations matching the selected query contracts. It invokes the real application worker, normal dispatcher and terminal stream parser; it does not mock a completed dispatcher result or invent a provider execution profile.

## Expected versus observed

| Check | Expected | Observed |
| --- | --- | --- |
| Seed and ordinary action | Northwind only, then Take Control → Sources → explicit unit confirmation → Add Chinook | Northwind21 original source rows; Add disabled before confirmation; shared action adds canonical `chinook` ID. |
| Independent result | Exact label union, separate rows/receipts, missing not zero | 28 categories; UK/United Kingdom remain distinct missing observations; Canada3/8. Unit and dated null disclosure remain visible. |
| Lazy reuse | Adding/removing sibling preserves first source | Northwind request count1 through Add and Previous/Next. No source query on row/terms inspection. |
| Failure lifecycle | Chinook failure, scoped retry/cancel, late completion ignored | Northwind1/Chinook3 after503 → deferred retry → Cancel → late completion → successful retry. Chart withheld during failure/cancellation; raw first-source rows retained. |
| Full-state guide | Manual Add → Resume recognizes achieved action; replay and final board match saved definition | Previous/Next succeeded; final five-card working board equals canonical, then reload and Show Full equality. Existing17-country root chart remains successful with coordinated simulated terms. |
| Read boundary | No project mutation or whole DB download | Both browser journeys assert zero mutation/download requests; guard reports zero live requests and escapes. |
| Responsive | Desktop and375px layout, metadata and labels remain readable | Viewport screenshots show wrapping source labels and visible title/unit/null disclosure; document has no horizontal overflow. Mobile screenshot shows the card introduction, not every category simultaneously. |

## Verification

- Focused model suite:26/26 passed, covering shared edit validation, canonical subset seeding and encoded session replay/undo/redo.
- Focused main suite:73/73 passed across widget lifecycle51, terminal stream11, independent preparation5, guide4 and source editor2. Existing BoardPage9 passed in the earlier affected run.
- Nx main spec and showcase E2E type checks passed. Owning main, board-model and app scoped lint passed; SpecScore lint reports zero errors.
- `datatug-app:e2e-showcase-independent`:2/2 passed,26.3s, retries0, actual streaming capability enabled. Browser source inventories/terms are explicitly simulated; no live provider attestation is claimed.
- Existing generated RecordsetCompare assets were copied into the ignored worktree asset folder and verified against the unchanged11-file lock with the official `verify-dist` command. No pin/dependency/lockfile change or new online acquisition claim.

Durable workspace-local receipt and JSON reporter output: `.wb/reports/showcase-source-add/final-local/summary.json` and `report.json`; screenshots are in its `results/` directory. These are local evidence locators. Transient localhost44378 belonged to this lane and is stopped; lsof verified no listener after Playwright teardown.

The first browser pass exposed an equal-array input reset bug that cleared the selected query/confirmation. A semantic identity guard and focused regression fixed it. The first seed test also clicked ahead of Angular rendering; it now waits each visible step change. Earlier failed runs are not represented as successful. The final fixture preserves captured root rows while simulating the newly coordinated structured source terms; it does not imply those terms are deployed.

See [acceptance reconciliation](acceptance-reconciliation.md) for the explicit provider-rights publication dependency and separate root-owned live evidence.
