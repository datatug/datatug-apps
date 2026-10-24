# DataTug Work web acceptance — 2026-10-24

The browser uses Chromium against the built Angular/Ionic application, real Firebase Auth and Firestore emulators, the production HTTP handlers in the Backend integration host, and the actual Shipping SQLite source. No Work, session, Check, Query or Incident request is intercepted. Test-only emulator credentials are defined in the fixture and test; no credential/token or Playwright trace is included in this evidence.

> Verification checkpoint: the real two-scenario profile passed49.1 seconds at `2d0ac3dd`, followed by a separately verified true native Incident cold-read. The final `4e468225` rerun is waiting for root-owned Auth/Firestore emulator recovery; no app step or mutation ran in the interrupted attempt. Final receipts will replace this checkpoint after recovery.

## Reviewed revisions

- Apps runtime: `4e468225`; checkout compatibility fixture: `f0a36399` plus the reviewed environment-query expectation. Reviewed main integration: `0500101a`, preserving Watch navigation, tests and runtime files.
- Backend production: `a53149534bb6775e0952fc4d2fa7d335a87bced0`.
- Published Core: `v0.79.1-0.20261024001142-c14594e4f0b4`.
- Draft changes: [Apps PR 540](https://github.com/datatug/datatug-apps/pull/540), [Backend PR 105](https://github.com/datatug/backend/pull/105), [Core PR 410](https://github.com/datatug/datatug-core/pull/410).

Independent architecture/security/UX review was performed before implementation and after it. The final review corrected context operation identity, principal/permission-loss cache clearing, stale modal recovery, explicit closure criteria, native Work/version admission, Query folder navigation, relation direction and native lifecycle transport drift. Reviewers inspected actual stable screenshots, including the narrow Context Bag and status form.

## Reproduce the real browser profile

Install the frozen repository dependencies. Start Auth and Firestore with the repository's emulator configuration (Auth 9099, Firestore 8180, project `demo-local-sneat-app`). The Backend fixture seed creates missing test accounts and native paid project/source access; it preserves existing Work records.

```sh
# Apps worktree, separate long-lived terminal
node_modules/.bin/firebase emulators:start --only auth,firestore --project demo-local-sneat-app

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
| `pnpm nx run datatug-main:test-focused` with combined Work/Watch/native/navigation suite | 14 suites, 156 tests passed after reviewed main integration |
| Focused native Incident contract, existing Incident client, hosted resolve, Work API/page | 5 suites, 128 tests passed; includes legacy/current proof and null/fractional/unsafe epoch rejection |
| Final Work page/form direction and controls | 2 suites, 22 tests passed (`--maxWorkers=1`); subsequent explicit Incident-environment route suite18/18 passed |
| Native `session-workspace` copied-set regression | 40 tests passed; copied values remain unapplied and explicit named-set choice persists |
| Project-address suite | 580 tests passed |
| `pnpm exec tsc --noEmit -p libs/datatug/main/tsconfig.spec.json` | Passed |
| `pnpm nx run datatug-main:lint` | Passed, no findings in final run |
| Final `datatug-app:build:sso-e2e` | Passed, 30.7 seconds |
| `node tools/check-card-headers.mjs` | Passed; 963 files, no additions to 211 pre-existing allowed violations |
| `node tools/check-zoneless-fields.mjs` | Passed; 198 components, no additions to 8 pre-existing allowed files |
| `python3 tools/recordsetcompare/consume.py verify-dist` | Passed, 11 pinned emitted files |
| Generic Chromium `playwright ... --list` | 166 tests/44 files; real Work tests absent from this unrelated profile |
| Hosted Incident checkout compatibility | Passed 12.2 seconds; canonical create/comment/reload, native cold-read/note/reload, Case delegation and both relationship directions. This separate compatibility test uses its established HTTP fixture and is not counted as real Backend evidence. |

The final real-profile results and sanitised network/console observations are in the adjacent evidence receipts. Expected negative-test 409/403 responses are distinguished from primary-flow errors. No live DemoDB/GitHub request escaped the existing browser guard.

One parallel local build/test attempt was killed by the host; the same targeted tests passed serially with one worker. A later final-browser attempt encountered Backend 8090 stopped before writes; Auth and Firestore remained intact. Restarting the exact Backend binary preserved every recorded collection field hash, then the clean browser profile was repeated. These interrupted attempts are not claimed as passing acceptance.

## Boundaries and remaining rollout work

The real Check/evidence workflow is validated; automatic Shipping semantic query-input binding is not configured and is not claimed. Follow-parent refresh, permission revocation races, migrations, transaction races, pagination bounds and Watch's coordinator/runner remain covered by their dedicated Backend/Core tests and independent reviews, rather than invented browser interactions. Watch integration evidence is recorded in Backend `spec/features/datatug-work/evidence/watch-2026-10-24/`; no new shared-cloud Watch browser claim is made here.

The paired Backend/Core changes and existing-project migration must roll out together. No production deployment, database reset or PR merge was performed. Postmortem remains unimplemented.
