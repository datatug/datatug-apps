# DataTug Work web acceptance — 2026-10-24

The browser uses Chromium against the built Angular/Ionic application, real Firebase Auth and Firestore emulators, the production HTTP handlers in the Backend integration host, and the actual Shipping SQLite source. No Work, session, Check, Query or Incident request is intercepted. Test-only emulator credentials are defined in the fixture and test; no credential/token or Playwright trace is included in this evidence.

> Final real profile: **2/2 passed in 54.7 seconds** on runtime `4e468225` (primary 40.2s; isolation 13.9s). After a complete Auth/Firestore export, stop and import plus Backend restart, an independent read-only Chromium pass verified the same five Work records, native Check evidence, relationships and native Incident state. That read-only browser check passed again after the final reviewed-main integration `cde138d9`, together with 206 combined tests and a 32.3-second app build.

## Reviewed revisions

- Apps Work implementation runtime: `4e468225`; latest reviewed-main integration: `cde138d9` (main `b900fbfa`); checkout compatibility fixture: `8b27a414`, verified against the same runtime. Both reviewed main integrations preserve Watch navigation, tests and runtime files. The final conflict resolution retained the new native journey origin and the dedicated Work profile boundaries.
- Backend production: `a53149534bb6775e0952fc4d2fa7d335a87bced0`; final browser route composition: `39b7dc5` (real optional business-activity handler).
- Published Core: `v0.79.1-0.20261024001142-c14594e4f0b4`.
- Draft changes: [Apps PR 540](https://github.com/datatug/datatug-apps/pull/540), [Backend PR 105](https://github.com/datatug/backend/pull/105), [Core PR 410](https://github.com/datatug/datatug-core/pull/410).

Independent architecture/security/UX review was performed before implementation and after it. The final review corrected context operation identity, principal/permission-loss cache clearing, stale modal recovery, explicit closure criteria, native Work/version admission, Query folder navigation, relation direction and native lifecycle transport drift. Reviewers inspected actual stable screenshots, including the narrow Context Bag and status form.

## Reproduce the real browser profile

Install the frozen repository dependencies. Start Auth and Firestore with the repository's emulator configuration (Auth 9099, Firestore 8180, project `demo-local-sneat-app`). The Backend fixture seed creates missing test accounts and native paid project/source access; it preserves existing Work records.

```sh
# Apps worktree, separate long-lived terminal
JAVA_TOOL_OPTIONS="-Xms64m -Xmx512m" node_modules/.bin/firebase emulators:start --only auth,firestore --project demo-local-sneat-app --export-on-exit /tmp/datatug-work-emulator-state
# On subsequent starts, also add: --import /tmp/datatug-work-emulator-state

# Paired Backend worktree
GOWORK=off GOPRIVATE=github.com/datatug/datatug-core wb run -- go test -c -tags=integration ./api4datatug -o /tmp/datatug-work-browser.test
FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=demo-local-sneat-app DATATUG_WORK_BROWSER_HOST=1 /tmp/datatug-work-browser.test -test.run '^TestWorkBrowserHost$' -test.count=1 -test.timeout=0 -test.v

# Apps worktree; capped build and one real-browser worker
NG_BUILD_MAX_WORKERS=2 NX_DAEMON=false wb run -- pnpm nx run datatug-app:build:sso-e2e --excludeTaskDependencies --output-style=static
NX_DAEMON=false wb run -- pnpm nx run datatug-app:e2e-work --output-style=static
```

The local verified build prepared pinned RecordsetCompare assets, build info and the AG Grid license separately because the host's old system `gh` could not run the repository's attestation preparation. `python3 tools/recordsetcompare/consume.py verify-dist` verified all 11 emitted locked assets. `--excludeTaskDependencies` did not skip Angular compilation. CI retains its normal dependency preparation. The browser profile owns its static server 4201; keep the Backend 8090 and emulator processes alive for the entire run. Generic application E2E excludes this prerequisite-dependent test in both its top-level and Chromium-project ignore lists, while `e2e-work` explicitly selects and executes it.

## Observed scenarios

The lead creates an Incident for delayed order 11045, adds its real UAT entity-qualified context, delegates a Detective Case to Bob with a deadline and closure criterion. Bob finds it in My Work, sees snapshot provenance, creates an authorised private execution snapshot, sees the copied 11045 initially unapplied, and explicitly selects/applies it in the existing drawer. The native Case Check runner executes `shipping-request-received` with integer `order_id=11045` against the real Shipping query and retains the completed passing run as Case evidence.

Bob enriches only the Case context. The fixture catalog supplies an order field, so the additional test value 11046 is a comparison order, not a fabricated shipment identifier. The parent remains 11045 until Alice reviews and accepts the explicit proposal. Bob creates a linked remediation Task, comments, and links existing Check and folder-qualified Query artefacts. Both artefact pages show Work backlinks. Bob closes the Case after explicitly checking the displayed criterion and reopens it. Alice moves the Incident through investigating/recovering/resolved/closed, retains its related investigation, and cold-loads the specialised native Incident page successfully. Relation labels are asserted against the actual server edge: parent source → child target.

A second scenario creates an independent Case and Task with their own Context Bags and reloads both. It changes assignees and due date, verifies activity, rejects an invalid active→open Case transition with the current version, rejects a stale two-tab save with 409 and shows useful recovery, and rejects a read-only viewer's mutation with 403 without changing the record. No automatic retry invents a fresh operation ID.

Desktop and 390×844 captures verify compact accountability/delegation placement, named and inherited context, create/status forms, readable relationships and lists. The test checks horizontal overflow and keyboard focus: title→description, context editor Escape/cancel return, and transition dialog entry/Escape return. Screenshot capture waits for Ionic animations before resetting scroll so cached-page transition frames are not used as evidence.

## Automated validation

| Command/profile | Result |
|---|---|
| `pnpm nx run datatug-main:test-focused` with combined Work/Watch/native/navigation/Query/environment suite | 16 suites, 206 tests passed after final reviewed main integration `cde138d9` |
| Focused native Incident contract, existing Incident client, hosted resolve, Work API/page | 5 suites, 128 tests passed; includes legacy/current proof and null/fractional/unsafe epoch rejection |
| Final Work page/form direction and controls | 2 suites, 22 tests passed (`--maxWorkers=1`); subsequent explicit Incident-environment route suite 18/18 passed |
| Native `session-workspace` copied-set regression | 40 tests passed; copied values remain unapplied and explicit named-set choice persists |
| Project-address suite | 580 tests passed |
| `pnpm exec tsc --noEmit -p libs/datatug/main/tsconfig.spec.json` | Passed |
| `pnpm nx run datatug-main:lint` | Passed, no findings in final run |
| Final `datatug-app:build:sso-e2e` | Passed, 32.3 seconds on final combined revision |
| `node tools/check-card-headers.mjs` | Passed; 963 files, no additions to 211 pre-existing allowed violations |
| `node tools/check-zoneless-fields.mjs` | Passed; 198 components, no additions to 8 pre-existing allowed files |
| `python3 tools/recordsetcompare/consume.py verify-dist` | Passed, 11 pinned emitted files |
| Generic Chromium `playwright ... --list` | 166 tests/44 files; real Work tests absent from this unrelated profile |
| Hosted Incident checkout compatibility | Passed 12.9 seconds; canonical create/comment/reload, native cold-read/note/reload, Case delegation and both relationship directions. This separate compatibility test uses its established HTTP fixture and is not counted as real Backend evidence. |

The final real-profile results and sanitised network/console observations are in [results.json](evidence/results.json), [primary diagnostics](evidence/primary-diagnostics.json), [isolation diagnostics](evidence/isolation-diagnostics.json), and the [passing browser log](evidence/browser-run.txt). Expected negative-test 409/403 responses are distinguished from primary-flow errors. No live DemoDB/GitHub request escaped the existing browser guard.

The complete service restart is documented by [the safe emulator receipt](evidence/emulator-restart-receipt.json) and [actual browser reload observations](evidence/restart-browser-observation.json). All 11 collection IDs, counts and complete field hashes, plus private record comparisons, were identical before and after export/import: 5 Work records, 4 links, 25 activity entries, 9 Context entries and 1 retained Check run. No raw database values or Auth export are committed. Reproduce the final read-only browser check after the operator restart with `wb run -- node spec/features/datatug-work/reload-persisted.mjs`; it starts/stops its own static 4201 preview and reads the prior run's receipts.

Console/network observations are classified rather than reported as clean:

| Observation | Disposition |
|---|---|
| Existing local agent discovery at `localhost:8989/datatug/agent-info` | Expected unavailable optional local CLI; hosted Work and actual Backend execution are independent |
| `net::ERR_ABORTED` on route/account scope changes | Deliberate cancellation of obsolete reads and completed-mutation follow-up requests |
| External TEST `/v0/checkout/config` CORS failure | Optional checkout configuration is not hosted by this fixture; actual Firebase sign-in succeeds |
| Initial `/v0/datatug/projects/query_activity_context` 404 | Fixed composed-host omission by mounting the existing real handler; final 503 `activity_unavailable` honestly reports the absent business binding/ledger/period. Query definition, references and actual Check execution remain functional |
| Deliberate invalid transition/stale 409 and viewer 403 | Accepted negative cases; versions/status remain unchanged |
| JavaScript page errors / primary Work HTTP failures | None; after restart, the only Backend HTTP error is the explicitly expected optional activity 503 |

One parallel local build/test attempt was killed by the host; the same targeted tests passed serially with one worker. An early backend process stop interrupted browser setup without writes. Later the original emulators exited without an export and lost disposable synthetic test records; this was disclosed, and the final scenarios were rerun against a freshly seeded real fixture. The replacement emulators use export/import; the complete successful persistence proof above follows that corrected setup. Interrupted attempts and prior partial/native-navigation assertions are not counted as passing final acceptance.

## Screenshots

| Workflow | Evidence |
|---|---|
| Incident accountability/delegation | [Desktop](evidence/incident-desktop.png), [mobile](evidence/incident-mobile.png) |
| Inherited and private Context Bags | [Case mobile](evidence/case-context-mobile.png), [private execution](evidence/private-execution-context-desktop.png), [parent proposal review](evidence/parent-context-proposal-review.png) |
| Retained SQL-backed Check evidence | [Native Case](evidence/case-evidence-desktop.png) |
| Shared forms and explicit criteria | [Task mobile](evidence/task-form-mobile.png), [Case status mobile](evidence/case-status-mobile.png) |
| Artefact identity and backlinks | [Check](evidence/check-work-backlinks-desktop.png), [Query](evidence/query-work-backlinks-desktop.png) |
| Closed Incident and specialised entry point | [Canonical Work](evidence/incident-closed-desktop.png), [native Incident](evidence/incident-native-evidence-desktop.png) |
| Project overview | [Desktop](evidence/project-work-desktop.png), [mobile](evidence/project-work-mobile.png) |
| Stale-write recovery | [Conflict review](evidence/stale-write-review-desktop.png) |
| After full service restart | [Query](evidence/query-after-service-restart.png), [native Incident](evidence/incident-after-service-restart.png) |

## Boundaries and remaining rollout work

The real Check/evidence workflow is validated; automatic Shipping semantic query-input binding is not configured and is not claimed. Follow-parent refresh, permission revocation races, migrations, transaction races, pagination bounds and Watch's coordinator/runner remain covered by their dedicated Backend/Core tests and independent reviews, rather than invented browser interactions. Watch integration evidence is recorded in Backend `spec/features/datatug-work/evidence/watch-2026-10-24/`; no new shared-cloud Watch browser claim is made here.

The paired Backend/Core changes and existing-project migration must roll out together. No production deployment, database reset or PR merge was performed. Postmortem remains unimplemented.
