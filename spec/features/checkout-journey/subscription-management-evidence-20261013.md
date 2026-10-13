# Subscription management and recovery verification — 2026-10-13

Alex approved four follow-ups: real-provider/device verification, clearer pending purchases, hiding empty recovery, and shared subscription settings. This record distinguishes implemented behavior from acceptance that still requires external evidence.

## User journey

`/my?checkout=test` → actionable unfinished purchases or Subscriptions → `/subscriptions?checkout=test` → `/subscriptions/:accountId?checkout=test` → explicit cancellation confirmation or `/subscriptions/:accountId/transfer?checkout=test&requestId=…` → refreshed details. LIVE uses the same routes without `checkout=test`. Authentication retains the exact settings destination. The existing shared checkout remains independent of project creation.

Recovery entries show checkout start date, original amount paid, intended-space reference when supplied and a stable purchase reference. Older responses without metadata retain the full reference. A successful empty recovery result removes the card; loading, errors, Retry and pagination remain available.

The shared Sneat settings component lists personal Pro and independent Business accounts, receiving spaces, regular/discounted base prices, paid-through dates and cancellation state. A buyer can manage several Business accounts. Pro and other Business subscriptions stay active when one renewal is explicitly cancelled. Usage and separate add-ons are identified separately from displayed base prices.

Transfer requires an existing eligible company space and an explicit confirmation. Back and Cancel return to the selected subscription with its rail intact. Repeated clicks are blocked; refresh/retry retains the request ID. The server checks the buyer, current source/target roles, fresh financial evidence, source binding revision and destination vacancy atomically. A committed transfer can be replayed safely without a second access mutation.

## Transfer boundaries

- Only the paid-access beneficiary changes. Projects and memberships stay in their original space.
- Provider subscription/customer, payment history, billing anchor, paid-through/renewal date, scheduled cancellation, discount eligibility and launch-place identity stay unchanged.
- First-month unlimited usage does not consume paid allowance. Transfer retains only the original first month's remaining days; it never grants another introductory month.
- Later consumed current-period allowance requires settlement/allocation before transfer. Prior payable usage with unresolved closure/collection or a conflicting target usage window also blocks it. A bounded history scan fails closed when proof is incomplete.
- Separate prepaid capacity and SSO configuration/add-ons stay in their original space. They are never implicitly transferred or reset. Complete metered settlement remains separate work.
- The paying user's billing authority is distinct from beneficiary membership. A verified payer can view/cancel their own subscription after losing beneficiary membership; transfer requires current administrator authority in both company spaces.
- Historical space-bound Business accounts require an explicit financial-ownership migration into the new buyer-home index. This change does not infer a payer or silently migrate those records.

## Verified locally

The complete 38-case emulator browser matrix passed in Chromium and iPhone-profile WebKit. It covers the five starting situations separately for Pro and Business, monthly/yearly switching, separate authentication URLs, Back/Forward, refresh, payment-loader failure, delayed reconciliation, expiry, mixed-rail returns, destination permissions, existing subscriptions, paid setup/recovery, explicit optional Pro cancellation and shared settings transfer. Payment HTTP is simulated; Firebase authentication uses local emulators. The settings test also proves original project fields are unchanged and no checkout session is created.

All 975 application unit tests passed. Shared Sneat component tests/build/lint and backend/native-host tests pass against published dependencies. Production build and final lint/spec evidence are retained in the task logs. The final settings capture additionally waits for Ionic's incoming page to become interactive and outgoing transfer UI to disappear; an earlier transition capture was rejected as visual evidence.

Local receipts outside Git: `/private/tmp/checkout-management-browser-full.log`, `/private/tmp/checkout-management-browser-settings-final.log`, `/private/tmp/checkout-management-app-unit-final.log`, `/private/tmp/checkout-management-adapter-final-tests.log`, `/private/tmp/checkout-management-app-build-final.log`, `/private/tmp/checkout-management-host-final-tests.log`, `/private/tmp/checkout-management-host-final-vet.log`.

## Published dependencies

Shared UI [PR #142](https://github.com/sneat-co/sneat-libs/pull/142) and release [PR #143](https://github.com/sneat-co/sneat-libs/pull/143) are merged. The app consumes registry package `@sneat/components@0.27.32`, without local links.

Paymentus management [PR #113](https://github.com/sneat-co/paymentus/pull/113) and introductory-period correction [PR #114](https://github.com/sneat-co/paymentus/pull/114) are merged. Published `backend/v0.54.1` resolves to `ccf540cb4fb0f102b0cbd40a7177e7c23641e170`; exact target checks passed. Native host [PR #1253](https://github.com/sneat-co/sneat-go/pull/1253) wires that published version and the strict isolated TEST route boundary. Host/app landing and deployed revision each require their own receipt; dependency publication alone does not prove deployment.

## Unverified acceptance

Dedicated real TEST-buyer credentials/storage state are not configured in this session; the private fixture-path question is pending. Existing opt-in Playwright tooling supports normal dedicated-account authentication, verifies identity/rail and mounts unpaid provider forms with traces/video/screenshots disabled. This record does not claim real provider payment, decline, additional authentication, webhook reconciliation or paid-return acceptance.

Physical iPhone Safari is not available here. iPhone-profile WebKit is automated browser evidence only. No live payment, deployed customer subscription mutation or access-permission change was submitted. No IAM, origin allowlist or deployment configuration changes are part of this implementation.


Settled simulated destination captures: [desktop](subscription-settings-chromium.png), [mobile WebKit](subscription-settings-mobile-webkit.png). These show the transferred beneficiary and unchanged scheduled cancellation, without a provider payment.


### Broader library CI regression

Initial app PR CI failed `datatug-main:test`. Reproduction with the full local library suite identified the existing My DataTug creation fixture missing the newly required `ActivatedRoute` provider. The fixture now uses the real Angular router, and a regression checks that the Subscriptions link follows TEST/live query changes. The full library suite passes: 3,159 tests, with three pre-existing skips (208 passing files, one skipped file). No runtime behavior or test gate was weakened. Logs: `/private/tmp/checkout-management-main-coverage-final.log` and `/private/tmp/checkout-management-account-link-tests.log`.

Native host PR #1253 merged at `848775e1b63710a26ba18b4f9b4911b6fc47a6c9`; WB synchronized its clean canonical checkout and retired the source branch/worktree. Exact-source deployment run `38367428873` succeeded. The isolated TEST service subsequently adopted the same immutable image at revision `datatug-checkout-test-manage848775e1`; configuration and IAM fingerprints remained unchanged. Read-only boundary checks confirmed TEST catalog availability, authentication on protected management endpoints, and rejection of the LIVE selector. These checks do not prove an authenticated provider purchase or paid return.


### Post-merge main CI findings — unresolved delivery gate

Main CI [run 38375475833](https://github.com/datatug/datatug-apps/actions/runs/38375475833) failed after app merge `10d5bc181a6a71d266dabc32993846dbafac18d4`, although the PR checks passed and the normal frontend deployment succeeded. The checkout browser step passed. The app unit job hit Vitest's five-second deadline while cold-loading the complete lazy Angular feature graph in the route/WASM-pin integration assertion. General browser E2E failed the chat bookmark reload assertion: the dialog click completed before the tagged bookmark was confirmed durable. Neither failure is treated as a green main receipt.

Two narrow test-only repairs are prepared locally: give only the full lazy-feature integration assertion a twenty-second cold-load deadline, and wait for the joined tag in IndexedDB before the existing reload/persistence assertion. All original behavioral assertions remain. Focused routing tests pass; the full chat FK-join/persist journey passes three Chromium repeats. Logs: `/private/tmp/checkout-management-ci-route-repair.log`, `/private/tmp/checkout-management-ci-bookmark-repair.log`, `/private/tmp/checkout-management-ci-repair-lint.log`.

The repairs were initially held unpublished because six unrelated canonical edits blocked WB synchronization. Alex subsequently authorized reviewing, committing and merging those edits. Main CI remains a delivery gate until the repaired source lands and passes its exact-main checks; real-provider/device acceptance remains outstanding.


### Canonical review authorized by Alex

WB rescued all six original canonical edits into commit `edf4b3fcbd29dfca4d77be32ba91d18f112a4ea5`, verified the remote rescue ref, and restored exactly the captured state. WB then synchronized canonical main for PR #287 while retaining this worktree's unfinished CI repairs. The feature branch fast-forwarded to the subsequently updated origin/main before incorporating the rescue commit, so the original work remains recoverable in Git history.

Review retained the dedicated DataTug GA ID in all opt-out guards, including authentication and subscription settings. It declined the raw patch's new shared production analytics configuration/loader destination because that would also send Incidentius app events to DataTug's GA property. It also declined automatic GA/PostHog enablement: the existing handover records optional DataTug analytics as disabled pending a reviewed consent decision. DataTug remains default-off. Incidentius's original banner loaded the SDK before acceptance and advertised that analytics was off; the reconciled banner loads the dedicated property only after explicit acceptance, remembers declines, remains off on blocked storage, and strips query/hash from its configured page URL. The dynamic banner uses global styles and was visually inspected in the local built site. No property provisioning, IAM or deployment-setting change was made.

Verification of the reconciled source: 980 app unit tests pass; all eight built Incidentius landing tests pass, covering explicit acceptance, repeated acceptance, reload after decline, saved acceptance, unavailable storage and existing site contracts. App and landing lint pass after correcting the new consent fixture's empty method. The fixture correction is a separate test commit. Production and exact-head CI retain their own final gates; these local checks do not claim real provider or physical-device acceptance.
